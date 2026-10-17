import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { TeamSpeakBot } from '../bot/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function startWebServer(bot: TeamSpeakBot, port: number = 58913) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  const activeTokens = new Set<string>();
  const isAuthRequired = () => Boolean(bot.config.web.password && bot.config.web.password.trim().length > 0);

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

  function isAuthenticated(req: Request): boolean {
    if (!isAuthRequired()) return true;
    const token = getRequestToken(req);
    return Boolean(token && activeTokens.has(token));
  }

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // Auth Middleware für geschützte API Endpunkte
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    // Öffentliche Auth-Endpunkte
    if (req.path === '/login' || req.path === '/auth/status') {
      return next();
    }

    if (!isAuthenticated(req)) {
      return res.status(401).json({ error: 'Nicht autorisiert. Bitte einloggen.' });
    }

    next();
  });

  // Auth Endpunkte
  app.get('/api/auth/status', (req: Request, res: Response) => {
    res.json({
      authRequired: isAuthRequired(),
      authenticated: isAuthenticated(req)
    });
  });

  app.post('/api/login', (req: Request, res: Response) => {
    const { password } = req.body;
    if (!isAuthRequired()) {
      return res.json({ success: true, token: 'open' });
    }

    if (password && password === bot.config.web.password) {
      const token = crypto.randomBytes(32).toString('hex');
      activeTokens.add(token);
      console.log('[Web-Auth] Erfolgreiche Anmeldung, neuer Token generiert.');
      return res.json({ success: true, token });
    }

    res.status(401).json({ error: 'Falsches Passwort' });
  });

  app.post('/api/logout', (req: Request, res: Response) => {
    const token = getRequestToken(req);
    if (token) activeTokens.delete(token);
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

  // WebSocket Verbindung mit Token-Prüfung
  wss.on('connection', (ws, req) => {
    if (isAuthRequired()) {
      const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
      const token = parsedUrl.searchParams.get('token');

      if (!token || !activeTokens.has(token)) {
        ws.send(JSON.stringify({ type: 'auth_required' }));
        ws.close(4401, 'Unauthorized');
        return;
      }
    }

    ws.send(JSON.stringify({ type: 'status', data: bot.getStatus() }));
  });

  // Player & Queue Endpunkte
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

  server.listen(port, () => {
    console.log(`[Web] Dashboard läuft auf http://0.0.0.0:${port} (Passwort-Schutz: ${isAuthRequired() ? 'Aktiv' : 'Deaktiviert'})`);
  });

  return server;
}
