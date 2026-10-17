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
import { OAuthManager } from '../audio/oauth.js';
import { getYtdlpAuthArgs } from '../audio/auth-args.js';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function startWebServer(bot: TeamSpeakBot, port: number = 58913) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const userManager = new UserManager(bot.dataDir);
  const oauthManager = new OAuthManager(bot.dataDir);

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

  // YouTube / Cookie & OAuth Management Endpunkte
  const cookiesPath = path.join(bot.dataDir, 'cookies.txt');

  app.get('/api/youtube/status', (_req: Request, res: Response) => {
    let cookiesInfo: any = null;
    try {
      if (fs.existsSync(cookiesPath)) {
        const stat = fs.statSync(cookiesPath);
        const content = fs.readFileSync(cookiesPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('#')).length;
        cookiesInfo = {
          size: stat.size,
          lines,
          modified: stat.mtime
        };
      }
    } catch (e) {
      console.error('[Web] Fehler beim Abfragen der Cookies:', e);
    }

    const oauth = oauthManager.getStatus();

    res.json({
      hasCookies: Boolean(cookiesInfo),
      cookiesInfo,
      oauth
    });
  });

  // Google OAuth Flow starten
  app.post('/api/youtube/oauth/start', async (_req: Request, res: Response) => {
    try {
      console.log('[Web] Starte Google Device-Code OAuth Flow...');
      const authData = await oauthManager.startFlow(bot.config.audio.ytdlpPath);
      res.json({ success: true, ...authData });
    } catch (err: any) {
      console.error('[Web] OAuth Fehler:', err);
      res.status(500).json({ error: err?.message || 'Fehler beim Starten der Google-Anmeldung' });
    }
  });

  // Google OAuth trennen
  app.post('/api/youtube/oauth/disconnect', (_req: Request, res: Response) => {
    oauthManager.disconnect();
    res.json({ success: true });
  });

  // Cookies speichern
  app.post('/api/youtube/cookies', (req: Request, res: Response) => {
    const { cookies } = req.body;
    if (typeof cookies !== 'string' || cookies.trim().length === 0) {
      return res.status(400).json({ error: 'Keine Cookies übermittelt.' });
    }

    try {
      fs.writeFileSync(cookiesPath, cookies.trim(), 'utf-8');
      console.log(`[Web] Neue cookies.txt mit ${cookies.length} Zeichen gespeichert.`);
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
    try {
      console.log('[Web] Starte YouTube Verbindungstest (Videotest)...');
      const testArgs = [
        '--dump-single-json',
        '--no-warnings',
        '--socket-timeout', '15',
        ...getYtdlpAuthArgs(bot.dataDir),
        '--',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      ];

      const { stdout } = await execFileAsync(bot.config.audio.ytdlpPath, testArgs, { maxBuffer: 10 * 1024 * 1024 });
      const data = JSON.parse(stdout);
      res.json({
        success: true,
        message: `✔ Verbindung erfolgreich! Stream autorisiert für: "${data.title}"`
      });
    } catch (err: any) {
      const stderr = err?.stderr || '';
      const msg = err?.message || '';
      console.error('[Web] YouTube Test fehlgeschlagen:', stderr || msg);
      res.status(500).json({
        success: false,
        error: stderr.trim() || msg
      });
    }
  });

  server.listen(port, () => {
    console.log(`[Web] Dashboard läuft auf http://0.0.0.0:${port} (Registrierte Benutzer: ${userManager.getUserCount()})`);
  });

  return server;
}
