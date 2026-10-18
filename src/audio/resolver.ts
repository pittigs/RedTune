import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import https from 'node:https';
import type { Track } from './queue.js';
import { getYtdlpAuthArgs } from './auth-args.js';

const execFileAsync = promisify(execFile);

interface YtdlpEntry {
  id?: string;
  title?: string;
  url?: string;
  webpage_url?: string;
  duration?: number;
  thumbnail?: string;
  thumbnails?: Array<{ url: string }>;
  uploader?: string;
  _type?: string;
  entries?: YtdlpEntry[];
}

export class AudioResolver {
  constructor(
    private readonly ytdlpPath: string = 'yt-dlp',
    private readonly dataDir: string = './data'
  ) {}

  async resolve(query: string, requestedBy: string): Promise<Track[]> {
    let cleanQuery = query.trim();

    // 1. Spotify URL Unterstützung
    if (cleanQuery.includes('open.spotify.com/')) {
      const spotifyResult = await this.resolveSpotify(cleanQuery, requestedBy);
      if (spotifyResult.length > 0) return spotifyResult;
    }

    // 2. YouTube Music Radio/Mix URL Parameter entfernen für einzelne Tracks
    if (cleanQuery.includes('/watch?v=') && cleanQuery.includes('list=RD')) {
      cleanQuery = cleanQuery.replace(/[&?]list=RD[^&]*/g, '');
    }

    // 3. music.youtube.com zu www.youtube.com normalisieren
    if (cleanQuery.includes('music.youtube.com')) {
      cleanQuery = cleanQuery.replace('music.youtube.com', 'www.youtube.com');
    }

    const isUrl = /^https?:\/\//i.test(cleanQuery);
    const target = isUrl ? cleanQuery : `ytsearch1:${cleanQuery}`;

    return await this.fetchTracks(target, requestedBy);
  }

  // Suche nach mehreren Ergebnissen für das Web-Dashboard Suchmodal
  async search(query: string, limit: number = 5, requestedBy: string = 'Suche'): Promise<Track[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];
    const target = /^https?:\/\//i.test(cleanQuery) ? cleanQuery : `ytsearch${limit}:${cleanQuery}`;
    return await this.fetchTracks(target, requestedBy);
  }

  // Auto-DJ: Ähnliche Tracks zu einem gegebenen Track abrufen
  async getRelated(trackUrlOrId: string, requestedBy: string = 'Auto-DJ'): Promise<Track[]> {
    try {
      const videoId = trackUrlOrId.includes('v=') ? trackUrlOrId.split('v=')[1].split('&')[0] : trackUrlOrId;
      const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
      const tracks = await this.fetchTracks(mixUrl, requestedBy);
      // Den aktuellen Track herausfiltern
      return tracks.filter(t => !t.url.includes(videoId) && t.id !== videoId).slice(0, 5);
    } catch (err) {
      console.warn('[Resolver] Konnte keine Auto-DJ Tracks laden:', err);
      return [];
    }
  }

  private async fetchTracks(target: string, requestedBy: string): Promise<Track[]> {
    const runYtdlp = async (withCookies: boolean): Promise<Track[]> => {
      const args = [
        '--dump-single-json',
        '--flat-playlist',
        '--no-warnings',
        '--socket-timeout', '15',
        '-f', 'ba/b',
        '--skip-download',
        '--ignore-no-formats-error',
        ...getYtdlpAuthArgs(this.dataDir, withCookies),
        '--',
        target
      ];

      const { stdout } = await execFileAsync(this.ytdlpPath, args, { maxBuffer: 15 * 1024 * 1024 });
      const data: YtdlpEntry = JSON.parse(stdout);

      // Falls es eine Playlist ist
      if (data._type === 'playlist' && Array.isArray(data.entries)) {
        return data.entries
          .filter(e => e && (e.url || e.id))
          .map(e => this.formatEntry(e, requestedBy));
      }

      // Mehrere Suchergebnisse
      if (Array.isArray(data.entries) && data.entries.length > 0) {
        return data.entries.map(e => this.formatEntry(e, requestedBy));
      }

      return [this.formatEntry(data, requestedBy)];
    };

    try {
      return await runYtdlp(true);
    } catch (err: any) {
      const stderr = err?.stderr || '';
      const msg = err?.message || '';

      const combined = `${stderr}\n${msg}`;
      if (combined.includes('The page needs to be reloaded') || combined.includes('Requested format is not available')) {
        console.warn('[Resolver] YouTube-Fehler mit Cookies. Versuche Fallback ohne Cookies...');
        try {
          return await runYtdlp(false);
        } catch (fallbackErr: any) {
          console.error('[Resolver] Fallback ohne Cookies fehlgeschlagen:', fallbackErr?.message || fallbackErr);
        }
      }

      if (stderr.includes('Sign in to confirm you\'re not a bot') || msg.includes('Sign in to confirm you\'re not a bot')) {
        throw new Error('YouTube verlangt eine Verifizierung (Bot-Erkennung). Bitte hinterlege deine cookies.txt in den Einstellungen (Zahnrad ⚙️).');
      }

      throw new Error(`Fehler beim Abrufen von YouTube: ${stderr.trim() || msg}`);
    }
  }

  // Spotify OEmbed & Metadaten Auflösung
  private async resolveSpotify(spotifyUrl: string, requestedBy: string): Promise<Track[]> {
    try {
      console.log(`[Resolver] Löse Spotify-Link auf: ${spotifyUrl}`);
      const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`;
      const data = await new Promise<any>((resolve, reject) => {
        https.get(oembedUrl, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        }).on('error', reject);
      });

      if (data && data.title) {
        // Spotify Titel suchen (z. B. "Song Name by Artist")
        const searchTerm = `${data.title} audio`;
        console.log(`[Resolver] Spotify-Titel erkannt: "${data.title}". Suche auf YouTube...`);
        const searchResults = await this.search(searchTerm, 1, requestedBy);
        if (searchResults.length > 0) {
          searchResults[0].thumbnail = data.thumbnail_url || searchResults[0].thumbnail;
          return searchResults;
        }
      }
    } catch (err) {
      console.warn('[Resolver] Spotify-Auflösung fehlgeschlagen, versuche Direktextraktion mit yt-dlp:', err);
    }
    return [];
  }

  private formatEntry(entry: YtdlpEntry, requestedBy: string): Track {
    const id = entry.id || Math.random().toString(36).substring(7);
    const rawUrl = entry.webpage_url || entry.url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : '');
    const url = rawUrl.replace('music.youtube.com', 'www.youtube.com');
    const title = entry.title || 'Unbekannter Titel';
    const durationSec = Math.round(entry.duration || 0);
    const thumbnail = entry.thumbnail || (entry.thumbnails && entry.thumbnails[0]?.url) || '';

    return {
      id,
      title,
      url,
      durationSec,
      thumbnail,
      requestedBy
    };
  }
}
