import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TeamSpeakBot } from '../bot/client.js';
import { UserManager } from '../auth/users.js';
import { getYtdlpAuthArgs } from '../audio/auth-args.js';
import { saveConfig } from '../config.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function startWebServer(bot: TeamSpeakBot, port: number = 58913) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const userManager = new UserManager(bot.dataDir);

  function getRequestToken(req: Request): string | undefined {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    const customHeader = req.headers['x-auth-token'];
    if (typeof customHeader === 'string') {
      return customHeader.trim();
    }
    return undefined;
  }

  function getAuthenticatedSession(req: Request) {
    const token = getRequestToken(req);
    if (!token) return null;
    return userManager.validateSession(token);
  }

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // Auth Middleware für geschützte API Endpunkte
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    // Öffentliche Auth-Endpunkte
    if (req.path === '/auth/status' || req.path === '/auth/login' || req.path === '/auth/setup') {
      return next();
    }

    // Wenn noch keine Benutzer angelegt sind, Ersteinrichtung verlangen
    if (!userManager.hasUsers()) {
      return res.status(401).json({
        setupRequired: true,
        error: 'Ersteinrichtung erforderlich. Bitte erstelle einen Administrator-Account.'
      });
    }

    const session = getAuthenticatedSession(req);
    if (!session) {
      return res.status(401).json({ error: 'Nicht autorisiert. Bitte einloggen.' });
    }

    next();
  });

  // Auth Endpunkte
  app.get('/api/auth/status', (req: Request, res: Response) => {
    const session = getAuthenticatedSession(req);
    res.json({
      setupRequired: !userManager.hasUsers(),
      authenticated: Boolean(session),
      user: session ? { username: session.username, role: session.role } : null
    });
  });

  app.post('/api/auth/setup', async (req: Request, res: Response) => {
    if (userManager.hasUsers()) {
      return res.status(400).json({ error: 'Ersteinrichtung wurde bereits abgeschlossen.' });
    }

    const { username, password } = req.body;
    try {
      const user = await userManager.createUser(username, password, 'admin');
      const token = userManager.createSession(user);
      console.log(`[Web-Auth] Ersteinrichtung abgeschlossen durch Admin "${user.username}".`);
      res.json({ success: true, token, user });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    if (!userManager.hasUsers()) {
      return res.status(400).json({ setupRequired: true, error: 'Bitte zuerst die Ersteinrichtung durchführen.' });
    }

    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Bitte Benutzername und Passwort angeben.' });
    }

    const user = await userManager.verifyUser(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Ungültiger Benutzername oder Passwort.' });
    }

    const token = userManager.createSession(user);
    console.log(`[Web-Auth] Erfolgreiche Anmeldung für Benutzer "${user.username}".`);
    res.json({ success: true, token, user });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const token = getRequestToken(req);
    if (token) userManager.invalidateSession(token);
    res.json({ success: true });
  });

  // WebSocket Broadcast bei Statusänderung
  const broadcast = () => {
    const payload = JSON.stringify({ type: 'status', data: bot.getStatus() });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  };

  bot.player.onStateChange = broadcast;
  bot.onStatusChange = broadcast;

  // WebSocket Verbindung mit Token-Prüfung
  wss.on('connection', (ws, req) => {
    const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const token = parsedUrl.searchParams.get('token');
    const session = token ? userManager.validateSession(token) : null;

    if (!session) {
      ws.send(JSON.stringify({
        type: 'auth_required',
        setupRequired: !userManager.hasUsers()
      }));
      ws.close(4401, 'Unauthorized');
      return;
    }

    ws.send(JSON.stringify({ type: 'status', data: bot.getStatus() }));
  });

  // REST API Endpunkte für Musik & Steuerung
  app.get('/api/status', (_req: Request, res: Response) => {
    res.json(bot.getStatus());
  });

  app.post('/api/play', async (req: Request, res: Response) => {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query fehlt' });
    }

    try {
      const tracks = await bot.resolver.resolve(query, 'Web Dashboard');
      if (tracks.length === 0) {
        return res.status(404).json({ error: 'Keine Titel gefunden' });
      }

      if (!bot.player.isPlaying) {
        const first = tracks[0];
        bot.queue.setCurrent(first);
        if (tracks.length > 1) {
          bot.queue.addMultiple(tracks.slice(1));
        }
        await bot.player.play(first);
      } else {
        bot.queue.addMultiple(tracks);
      }

      broadcast();
      res.json({ success: true, count: tracks.length, track: tracks[0] });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/pause', (_req: Request, res: Response) => {
    bot.player.pause();
    broadcast();
    res.json({ success: true });
  });

  app.post('/api/resume', (_req: Request, res: Response) => {
    bot.player.resume();
    broadcast();
    res.json({ success: true });
  });

  app.post('/api/skip', async (_req: Request, res: Response) => {
    const next = bot.queue.next();
    if (next) {
      await bot.player.play(next);
    } else {
      bot.player.stop();
    }
    broadcast();
    res.json({ success: true, next });
  });

  app.post('/api/previous', async (_req: Request, res: Response) => {
    const prev = bot.queue.previous();
    if (prev) {
      await bot.player.play(prev);
    }
    broadcast();
    res.json({ success: true, prev });
  });

  app.post('/api/stop', (_req: Request, res: Response) => {
    bot.queue.clear();
    bot.player.stop();
    broadcast();
    res.json({ success: true });
  });

  app.post('/api/volume', (req: Request, res: Response) => {
    const { volume } = req.body;
    if (typeof volume === 'number') {
      bot.player.setVolume(volume);
      broadcast();
      res.json({ success: true, volume: bot.player.volume });
    } else {
      res.status(400).json({ error: 'Ungültige Lautstärke' });
    }
  });

  app.delete('/api/queue/:index', (req: Request, res: Response) => {
    const rawIdx = Array.isArray(req.params.index) ? req.params.index[0] : req.params.index;
    const idx = parseInt(rawIdx || '-1', 10);
    const removed = bot.queue.remove(idx);
    broadcast();
    res.json({ success: removed });
  });

  app.post('/api/queue/shuffle', (_req: Request, res: Response) => {
    bot.queue.shuffle();
    broadcast();
    res.json({ success: true });
  });

  app.post('/api/queue/clear', (_req: Request, res: Response) => {
    bot.queue.clear();
    broadcast();
    res.json({ success: true });
  });

  // Channel wechseln über Web Dashboard
  app.post('/api/channel', async (req: Request, res: Response) => {
    const { channel, password } = req.body;
    if (!channel) {
      return res.status(400).json({ error: 'Channel-Name oder ID fehlt' });
    }
    const ok = await bot.joinChannel(channel, password);
    res.json({ success: ok });
  });

  // YouTube / Cookie Management Endpunkte
  const cookiesPath = path.join(bot.dataDir, 'cookies.txt');

  app.get('/api/youtube/status', (_req: Request, res: Response) => {
    let cookiesInfo: any = null;
    try {
      if (fs.existsSync(cookiesPath)) {
        const stat = fs.statSync(cookiesPath);
        const content = fs.readFileSync(cookiesPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('#')).length;
        const hasAuthCookie = content.includes('LOGIN_INFO') || content.includes('SAPISID') || content.includes('SID');
        cookiesInfo = {
          size: stat.size,
          lines,
          hasAuthCookie,
          modified: stat.mtime
        };
      }
    } catch (e) {
      console.error('[Web] Fehler beim Abfragen der Cookies:', e);
    }

    res.json({
      hasCookies: Boolean(cookiesInfo && cookiesInfo.size > 0),
      cookiesInfo
    });
  });

  // Cookies speichern
  app.post('/api/youtube/cookies', (req: Request, res: Response) => {
    const { cookies } = req.body;
    if (typeof cookies !== 'string' || cookies.trim().length === 0) {
      return res.status(400).json({ error: 'Keine Cookies übermittelt.' });
    }

    const trimmed = cookies.trim();
    // Prüfen ob es wie eine Netscape cookie file aussieht
    if (!trimmed.includes('.youtube.com') && !trimmed.includes('youtube.com')) {
      return res.status(400).json({
        error: 'Die Cookies scheinen nicht von YouTube zu stammen (Domain .youtube.com fehlt). Bitte öffne YouTube im Browser und exportiere die Cookies dort.'
      });
    }

    try {
      fs.writeFileSync(cookiesPath, trimmed, 'utf-8');
      console.log(`[Web] Neue cookies.txt mit ${trimmed.length} Zeichen gespeichert.`);
      res.json({ success: true, message: 'Cookies erfolgreich gespeichert!' });
    } catch (err) {
      res.status(500).json({ error: `Fehler beim Speichern: ${(err as Error).message}` });
    }
  });

  // Cookies löschen
  app.delete('/api/youtube/cookies', (_req: Request, res: Response) => {
    try {
      if (fs.existsSync(cookiesPath)) {
        fs.unlinkSync(cookiesPath);
        console.log('[Web] cookies.txt gelöscht.');
      }
      res.json({ success: true, message: 'Cookies wurden gelöscht.' });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Echter Stream-Verbindungstest mit unzensierter Fehlerausgabe
  app.post('/api/youtube/test', async (_req: Request, res: Response) => {
    const runTest = async (withCookies: boolean) => {
      const testArgs = [
        '--dump-single-json',
        '--no-warnings',
        '--socket-timeout', '15',
        '-f', 'ba/b',
        '--skip-download',
        ...getYtdlpAuthArgs(bot.dataDir, withCookies),
        '--',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      ];
      const { stdout } = await execFileAsync(bot.config.audio.ytdlpPath, testArgs, { maxBuffer: 10 * 1024 * 1024 });
      return JSON.parse(stdout);
    };

    console.log('[Web] Starte YouTube Verbindungstest...');
    let cookieError = '';
    try {
      const data = await runTest(true);
      return res.json({
        success: true,
        message: `✔ Verbindung erfolgreich! Audio-Format ${data.format_id} für "${data.title}" verfügbar.`
      });
    } catch (err: any) {
      cookieError = (err?.stderr || err?.message || '').trim();
      console.warn('[Web] YouTube Test mit Cookies fehlgeschlagen:', cookieError);
    }

    try {
      const data = await runTest(false);
      res.json({
        success: true,
        message: `✔ Wiedergabe funktioniert (ohne Cookies, Format ${data.format_id}). Mit Cookies trat ein Fehler auf – ggf. cookies.txt neu exportieren: ${cookieError.slice(0, 200)}`
      });
    } catch (err: any) {
      const errMsg = (err?.stderr || err?.message || '').trim();
      console.error('[Web] YouTube Test fehlgeschlagen:', errMsg);
      res.status(500).json({ success: false, error: errMsg || cookieError });
    }
  });

  // TeamSpeak Server-Konfiguration abrufen
  app.get('/api/teamspeak/config', (_req: Request, res: Response) => {
    res.json({
      address: bot.config.server.address,
      nickname: bot.config.server.nickname,
      channel: bot.config.server.channel || '',
      hasPassword: Boolean(bot.config.server.password),
      hasChannelPassword: Boolean(bot.config.server.channelPassword),
      status: bot.getStatus()
    });
  });

  // TeamSpeak Server-Konfiguration aktualisieren & Reconnect auslösen
  app.post('/api/teamspeak/config', async (req: Request, res: Response) => {
    const { address, password, nickname, channel, channelPassword } = req.body;
    if (!address || typeof address !== 'string' || !address.trim()) {
      return res.status(400).json({ error: 'Bitte eine gültige Server-Adresse angeben.' });
    }

    bot.config.server.address = address.trim();
    if (typeof password === 'string') {
      bot.config.server.password = password;
    }
    if (nickname && typeof nickname === 'string' && nickname.trim()) {
      bot.config.server.nickname = nickname.trim();
    }
    if (typeof channel === 'string') {
      bot.config.server.channel = channel.trim();
    }
    if (typeof channelPassword === 'string') {
      bot.config.server.channelPassword = channelPassword;
    }

    // In config.json speichern
    const configPath = path.join(bot.dataDir, 'config.json');
    saveConfig(configPath, bot.config);
    console.log('[Web] TeamSpeak Konfiguration aktualisiert und in config.json gespeichert.');

    // Sofortigen Reconnect im Hintergrund ausführen
    bot.reconnect().catch((err) => {
      console.error('[Web] Reconnect-Fehler nach Konfigurationsänderung:', err.message);
    });

    broadcast();
    res.json({ 
      success: true, 
      message: 'TeamSpeak Konfiguration gespeichert. Neuer Verbindungsversuch gestartet!',
      config: {
        address: bot.config.server.address,
        nickname: bot.config.server.nickname,
        channel: bot.config.server.channel,
      }
    });
  });

  server.listen(port, () => {
    console.log(`[Web] Dashboard läuft auf http://0.0.0.0:${port} (Registrierte Benutzer: ${userManager.getUserCount()})`);
  });

  return server;
}
