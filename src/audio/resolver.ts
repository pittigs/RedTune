import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
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
  constructor(
    private readonly ytdlpPath: string = 'yt-dlp',
    private readonly dataDir: string = './data'
  ) {}

  async resolve(query: string, requestedBy: string): Promise<Track[]> {
    const isUrl = /^https?:\/\//i.test(query);
    const target = isUrl ? query : `ytsearch1:${query}`;

    const args = [
      '--dump-single-json',
      '--flat-playlist',
      '--no-warnings',
      '--extractor-args', 'youtube:player_client=ios,android,web',
      '--socket-timeout', '15',
    ];

    const cookiesFile = path.join(this.dataDir, 'cookies.txt');
    if (fs.existsSync(cookiesFile)) {
      try {
        const stat = fs.statSync(cookiesFile);
        if (stat.size > 0) {
          args.push('--cookies', cookiesFile);
        }
      } catch {}
    }

    args.push('--', target);

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
      const msg = (err as Error).message || '';
      console.error('[Resolver] Fehler beim Auflösen von:', query, msg);

      if (msg.includes('Sign in to confirm you\'re not a bot') || msg.includes('bot')) {
        throw new Error('YouTube blockiert die Anfrage (Bot-Erkennung). Bitte hinterlege YouTube Cookies im Web-Dashboard unter Einstellungen.');
      }

      throw new Error(`Konnte Titel nicht abrufen: ${msg}`);
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
