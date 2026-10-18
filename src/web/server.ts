import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import multer from 'multer';
import type { TeamSpeakBot } from '../bot/client.js';
import { UserManager } from '../auth/users.js';
import { getYtdlpAuthArgs } from '../audio/auth-args.js';
import { saveConfig, type AudioFilterPreset } from '../config.js';
import { RADIO_STATIONS, findRadioStation, radioStationToTrack } from '../audio/radio.js';

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

  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // Öffentliche Healthcheck & Metrik Endpunkte (Docker/Kubernetes/Prometheus)
  app.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptime: Math.round(process.uptime()), timestamp: Date.now() });
  });

  app.get('/readyz', (_req: Request, res: Response) => {
    const status = bot.getStatus();
    res.json({
      ready: true,
      tsConnected: status.connected,
      playerActive: status.player.isPlaying
    });
  });

  app.get('/metrics', (_req: Request, res: Response) => {
    const status = bot.getStatus();
    const mem = process.memoryUsage();
    const lines = [
      '# HELP redtune_uptime_seconds Process uptime in seconds',
      '# TYPE redtune_uptime_seconds counter',
      `redtune_uptime_seconds ${Math.round(process.uptime())}`,
      '# HELP redtune_ts_connected TeamSpeak connection state (1 = connected, 0 = disconnected)',
      '# TYPE redtune_ts_connected gauge',
      `redtune_ts_connected ${status.connected ? 1 : 0}`,
      '# HELP redtune_player_playing Playback state (1 = playing, 0 = stopped)',
      '# TYPE redtune_player_playing gauge',
      `redtune_player_playing ${status.player.isPlaying ? 1 : 0}`,
      '# HELP redtune_queue_length Number of tracks in queue',
      '# TYPE redtune_queue_length gauge',
      `redtune_queue_length ${status.queue.items.length}`,
      '# HELP redtune_packets_sent_total Total audio packets sent',
      '# TYPE redtune_packets_sent_total counter',
      `redtune_packets_sent_total ${status.player.packetsSent}`,
      '# HELP redtune_memory_rss_bytes Memory RSS in bytes',
      '# TYPE redtune_memory_rss_bytes gauge',
      `redtune_memory_rss_bytes ${mem.rss}`
    ];
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(lines.join('\n') + '\n');
  });

  // Auth Middleware für geschützte API Endpunkte
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/auth/status' || req.path === '/auth/login' || req.path === '/auth/setup') {
      return next();
    }

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

  // System & Telemetrie Stats für Dashboard
  app.get('/api/system/stats', (_req: Request, res: Response) => {
    const mem = process.memoryUsage();
    res.json({
      uptimeSec: Math.round(process.uptime()),
      memoryRssMb: Math.round(mem.rss / 1024 / 1024),
      memoryHeapMb: Math.round(mem.heapUsed / 1024 / 1024),
      nodeVersion: process.version,
      platform: os.platform(),
      cpus: os.cpus().length,
      packetsSent: bot.player.totalPacketsSent,
      bytesSent: bot.player.totalBytesSent,
      underruns: bot.player.underrunCount
    });
  });

  // Track Suche mit Thumbnail & Vorschau
  app.get('/api/search', async (req: Request, res: Response) => {
    const q = req.query.q as string;
    if (!q || !q.trim()) {
      return res.status(400).json({ error: 'Suchbegriff fehlt' });
    }
    try {
      const results = await bot.resolver.search(q.trim(), 5, 'Web Dashboard');
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
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

  app.post('/api/seek', async (req: Request, res: Response) => {
    const { position } = req.body;
    if (typeof position !== 'number') {
      return res.status(400).json({ error: 'Ungültige Position' });
    }
    await bot.player.seek(position);
    broadcast();
    res.json({ success: true, position: bot.player.positionSec });
  });

  app.post('/api/filter', (req: Request, res: Response) => {
    const { filter } = req.body;
    if (['normal', 'bassboost', 'nightcore', 'vaporwave', 'loudnorm'].includes(filter)) {
      bot.player.setFilter(filter as AudioFilterPreset);
      broadcast();
      res.json({ success: true, filter: bot.player.activeFilter });
    } else {
      res.status(400).json({ error: 'Ungültiger Filter' });
    }
  });

  app.post('/api/soundboard', (req: Request, res: Response) => {
    const { sound } = req.body;
    if (['airhorn', 'applause', 'notification', 'rimshot'].includes(sound)) {
      bot.player.playSoundEffect(sound);
      res.json({ success: true, sound });
    } else {
      res.status(400).json({ error: 'Ungültiger Soundboard-Effekt' });
    }
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

  // Drag & Drop Reordering
  app.post('/api/queue/move', (req: Request, res: Response) => {
    const { fromIndex, toIndex } = req.body;
    if (typeof fromIndex === 'number' && typeof toIndex === 'number') {
      const ok = bot.queue.move(fromIndex, toIndex);
      broadcast();
      res.json({ success: ok });
    } else {
      res.status(400).json({ error: 'Indizes fehlen' });
    }
  });

  // Playlist Export (JSON oder M3U)
  app.get('/api/queue/export', (req: Request, res: Response) => {
    const format = req.query.format === 'm3u' ? 'm3u' : 'json';
    if (format === 'm3u') {
      res.setHeader('Content-Type', 'audio/x-mpegurl');
      res.setHeader('Content-Disposition', 'attachment; filename="redtune-playlist.m3u"');
      res.send(bot.queue.exportM3U());
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="redtune-playlist.json"');
      res.send(bot.queue.exportJSON());
    }
  });

  // Playlist Import
  app.post('/api/queue/import', (req: Request, res: Response) => {
    const { playlist } = req.body;
    if (!playlist) {
      return res.status(400).json({ error: 'Keine Playlist-Daten übermittelt' });
    }
    const count = bot.queue.importJSON(playlist);
    broadcast();
    res.json({ success: true, imported: count });
  });

  app.post('/api/autodj', (req: Request, res: Response) => {
    const { enabled } = req.body;
    bot.config.bot.autoDj = Boolean(enabled);
    saveConfig(path.join(bot.dataDir, 'config.json'), bot.config);
    broadcast();
    res.json({ success: true, autoDj: bot.config.bot.autoDj });
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

  // --- Internet Radio Endpunkte ---
  app.get('/api/radio/stations', (_req: Request, res: Response) => {
    res.json({ stations: RADIO_STATIONS });
  });

  app.post('/api/radio/play', async (req: Request, res: Response) => {
    const { stationId } = req.body;
    const station = findRadioStation(stationId || '');
    if (!station) {
      return res.status(404).json({ error: 'Radiosender nicht gefunden' });
    }
    const track = radioStationToTrack(station, 'Web Dashboard');
    bot.queue.setCurrent(track);
    await bot.player.play(track);
    broadcast();
    res.json({ success: true, station, track });
  });

  // --- Lokale Song-Uploads mit Multer ---
  const uploadDir = bot.resolver.localFiles.getUploadsDir();
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'upload';
      cb(null, `${base}-${Date.now()}${ext}`);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB Limit
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus'].includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error('Nicht unterstütztes Format. Bitte MP3, WAV, OGG, FLAC oder M4A wählen.'));
      }
    }
  });

  app.get('/api/uploads', (_req: Request, res: Response) => {
    res.json({ files: bot.resolver.localFiles.listFiles() });
  });

  app.post('/api/upload', (req: Request, res: Response) => {
    upload.single('audio')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || 'Fehler beim Hochladen' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'Keine Audiodatei übermittelt' });
      }
      const files = bot.resolver.localFiles.listFiles();
      const created = files.find(f => f.filename === req.file?.filename);
      broadcast();
      res.json({ success: true, file: created });
    });
  });

  app.delete('/api/uploads/:filename', (req: Request, res: Response) => {
    const raw = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
    const ok = bot.resolver.localFiles.deleteFile(raw || '');
    broadcast();
    res.json({ success: ok });
  });

  app.post('/api/uploads/play/:filename', async (req: Request, res: Response) => {
    const raw = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
    const match = bot.resolver.localFiles.findFile(raw || '');
    if (!match) {
      return res.status(404).json({ error: 'Datei nicht gefunden' });
    }
    const track = bot.resolver.localFiles.entryToTrack(match, 'Web Dashboard');
    bot.queue.setCurrent(track);
    await bot.player.play(track);
    broadcast();
    res.json({ success: true, track });
  });

  app.get('/api/uploads/raw/:filename', (req: Request, res: Response) => {
    const raw = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
    const full = bot.resolver.localFiles.getFilePath(raw || '');
    if (!full) {
      return res.status(404).json({ error: 'Datei nicht gefunden' });
    }
    res.sendFile(path.resolve(full));
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

  app.post('/api/youtube/cookies', (req: Request, res: Response) => {
    const { cookies } = req.body;
    if (typeof cookies !== 'string' || cookies.trim().length === 0) {
      return res.status(400).json({ error: 'Keine Cookies übermittelt.' });
    }

    const trimmed = cookies.trim();
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

  // Echter Stream-Verbindungstest
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

    const configPath = path.join(bot.dataDir, 'config.json');
    saveConfig(configPath, bot.config);
    console.log('[Web] TeamSpeak Konfiguration aktualisiert und in config.json gespeichert.');

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
