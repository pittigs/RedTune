import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
    // YouTube Music Radio/Mix URL Parameter entfernen für einzelne Tracks
    if (cleanQuery.includes('/watch?v=') && cleanQuery.includes('list=RD')) {
      cleanQuery = cleanQuery.replace(/[&?]list=RD[^&]*/g, '');
    }

    // music.youtube.com zu www.youtube.com normalisieren, um Standard-Extraktoren zu nutzen
    if (cleanQuery.includes('music.youtube.com')) {
      cleanQuery = cleanQuery.replace('music.youtube.com', 'www.youtube.com');
    }

    const isUrl = /^https?:\/\//i.test(cleanQuery);
    const target = isUrl ? cleanQuery : `ytsearch1:${cleanQuery}`;

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

      const { stdout } = await execFileAsync(this.ytdlpPath, args, { maxBuffer: 10 * 1024 * 1024 });
      const data: YtdlpEntry = JSON.parse(stdout);

      // Falls es eine Playlist ist
      if (data._type === 'playlist' && Array.isArray(data.entries)) {
        return data.entries
          .filter(e => e && (e.url || e.id))
          .map(e => this.formatEntry(e, requestedBy));
      }

      // Einzelner Track oder Suchergebnis
      if (Array.isArray(data.entries) && data.entries.length > 0) {
        return [this.formatEntry(data.entries[0], requestedBy)];
      }

      return [this.formatEntry(data, requestedBy)];
    };

    try {
      return await runYtdlp(true);
    } catch (err: any) {
      const stderr = err?.stderr || '';
      const msg = err?.message || '';

      // Falls YouTube mit Cookies "The page needs to be reloaded" meldet, ohne Cookies versuchen
      const combined = `${stderr}\n${msg}`;
      if (combined.includes('The page needs to be reloaded') || combined.includes('Requested format is not available')) {
        console.warn('[Resolver] YouTube-Fehler mit Cookies. Versuche Fallback ohne Cookies...');
        try {
          return await runYtdlp(false);
        } catch (fallbackErr: any) {
          console.error('[Resolver] Fallback ohne Cookies ebenfalls fehlgeschlagen:', fallbackErr?.message || fallbackErr);
        }
      }

      console.error('[Resolver] Fehler beim Auflösen von:', query, stderr || msg);

      if (stderr.includes('Sign in to confirm you\'re not a bot') || msg.includes('Sign in to confirm you\'re not a bot')) {
        throw new Error('YouTube verlangt eine Verifizierung (Bot-Erkennung). Bitte hinterlege deine cookies.txt in den Einstellungen (Zahnrad ⚙️).');
      }

      throw new Error(`Fehler beim Abrufen von YouTube: ${stderr.trim() || msg}`);
    }
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
