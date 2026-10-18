import fs from 'node:fs';
import path from 'node:path';
import type { Track } from './queue.js';

export interface LocalFileEntry {
  id: string;
  filename: string;
  title: string;
  sizeBytes: number;
  uploadedAt: number;
  filePath: string;
}

const SUPPORTED_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus']);

export class LocalFileManager {
  private readonly uploadsDir: string;

  constructor(private readonly dataDir: string = './data') {
    this.uploadsDir = path.join(this.dataDir, 'uploads');
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.uploadsDir)) {
      try {
        fs.mkdirSync(this.uploadsDir, { recursive: true });
      } catch (err) {
        console.error('[LocalFiles] Konnte Uploads-Ordner nicht erstellen:', err);
      }
    }
  }

  public getUploadsDir(): string {
    return this.uploadsDir;
  }

  public listFiles(): LocalFileEntry[] {
    this.ensureDir();
    try {
      const files = fs.readdirSync(this.uploadsDir);
      const results: LocalFileEntry[] = [];

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (!SUPPORTED_EXTS.has(ext)) continue;

        const fullPath = path.join(this.uploadsDir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            const rawTitle = path.basename(file, ext);
            // Sauberen Titel ohne Unterstriche formatieren
            const title = rawTitle.replace(/[_-]+/g, ' ').trim();

            results.push({
              id: `local:${encodeURIComponent(file)}`,
              filename: file,
              title: title || file,
              sizeBytes: stat.size,
              uploadedAt: stat.mtimeMs,
              filePath: fullPath
            });
          }
        } catch {}
      }

      // Neueste Uploads zuerst
      return results.sort((a, b) => b.uploadedAt - a.uploadedAt);
    } catch (err) {
      console.error('[LocalFiles] Fehler beim Auflisten lokaler Dateien:', err);
      return [];
    }
  }

  public getFilePath(filename: string): string | null {
    // Verhindert Directory Traversal Angriffe (..)
    const safeName = path.basename(filename);
    const target = path.join(this.uploadsDir, safeName);
    if (fs.existsSync(target)) {
      return target;
    }
    return null;
  }

  public deleteFile(filename: string): boolean {
    const target = this.getFilePath(filename);
    if (!target) return false;
    try {
      fs.unlinkSync(target);
      return true;
    } catch (err) {
      console.error('[LocalFiles] Fehler beim Löschen der Datei:', err);
      return false;
    }
  }

  public findFile(query: string): LocalFileEntry | undefined {
    const clean = query.trim().toLowerCase().replace(/^local:/i, '');
    const files = this.listFiles();

    // 1. Exakter Dateiname oder ID Match
    const byExact = files.find(f => f.filename.toLowerCase() === clean || f.id.toLowerCase() === clean);
    if (byExact) return byExact;

    // 2. Suche nach Titel oder Dateinamen
    return files.find(f =>
      f.title.toLowerCase().includes(clean) ||
      f.filename.toLowerCase().includes(clean)
    );
  }

  public entryToTrack(entry: LocalFileEntry, requestedBy: string = 'Lokale Datei'): Track {
    return {
      id: entry.id,
      title: `📁 ${entry.title}`,
      url: entry.filePath,
      durationSec: 0,
      thumbnail: '',
      requestedBy,
      isLocal: true
    };
  }
}
