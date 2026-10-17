import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Track } from './queue.js';

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
  constructor(private readonly ytdlpPath: string = 'yt-dlp') {}

  async resolve(query: string, requestedBy: string): Promise<Track[]> {
    const isUrl = /^https?:\/\//i.test(query);
    const target = isUrl ? query : `ytsearch1:${query}`;

    const args = [
      '--dump-single-json',
      '--flat-playlist',
      '--no-warnings',
      '--socket-timeout', '15',
      '--',
      target
    ];

    try {
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
    } catch (err) {
      console.error('[Resolver] Fehler beim Auflösen von:', query, err);
      throw new Error(`Konnte Titel nicht abrufen: ${(err as Error).message}`);
    }
  }

  private formatEntry(entry: YtdlpEntry, requestedBy: string): Track {
    const id = entry.id || Math.random().toString(36).substring(7);
    const url = entry.webpage_url || (entry.id ? `https://music.youtube.com/watch?v=${entry.id}` : entry.url || '');
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
