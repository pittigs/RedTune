import fs from 'node:fs';
import path from 'node:path';

export interface Track {
  id: string;
  title: string;
  url: string;
  durationSec: number;
  thumbnail?: string;
  requestedBy: string;
}

export type LoopMode = 'off' | 'track' | 'queue';

export class MusicQueue {
  private items: Track[] = [];
  private history: Track[] = [];
  private current: Track | null = null;
  public loopMode: LoopMode = 'off';
  public onQueueChange?: () => void;

  constructor(private readonly persistFile?: string) {
    if (this.persistFile) {
      this.loadFromFile(this.persistFile);
    }
  }

  getCurrent(): Track | null {
    return this.current;
  }

  setCurrent(track: Track | null): void {
    if (this.current && track?.id !== this.current.id) {
      this.history.unshift(this.current);
      if (this.history.length > 50) this.history.pop();
    }
    this.current = track;
    this.notifyChange();
  }

  getItems(): Track[] {
    return [...this.items];
  }

  getHistory(): Track[] {
    return [...this.history];
  }

  add(track: Track): void {
    this.items.push(track);
    this.notifyChange();
  }

  addMultiple(tracks: Track[]): void {
    this.items.push(...tracks);
    this.notifyChange();
  }

  next(): Track | null {
    if (this.loopMode === 'track' && this.current) {
      return this.current;
    }

    if (this.loopMode === 'queue' && this.current) {
      this.items.push(this.current);
    }

    const nextTrack = this.items.shift() ?? null;
    this.setCurrent(nextTrack);
    return nextTrack;
  }

  previous(): Track | null {
    const prev = this.history.shift();
    if (prev) {
      if (this.current) {
        this.items.unshift(this.current);
      }
      this.current = prev;
      this.notifyChange();
      return prev;
    }
    return null;
  }

  clear(): void {
    this.items = [];
    this.notifyChange();
  }

  remove(index: number): boolean {
    if (index >= 0 && index < this.items.length) {
      this.items.splice(index, 1);
      this.notifyChange();
      return true;
    }
    return false;
  }

  move(fromIndex: number, toIndex: number): boolean {
    if (
      fromIndex < 0 ||
      fromIndex >= this.items.length ||
      toIndex < 0 ||
      toIndex >= this.items.length ||
      fromIndex === toIndex
    ) {
      return false;
    }
    const [movedItem] = this.items.splice(fromIndex, 1);
    this.items.splice(toIndex, 0, movedItem);
    this.notifyChange();
    return true;
  }

  shuffle(): void {
    for (let i = this.items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    }
    this.notifyChange();
  }

  isDuplicate(urlOrId: string): boolean {
    const clean = urlOrId.trim();
    if (this.current && (this.current.id === clean || this.current.url === clean)) {
      return true;
    }
    return this.items.some(t => t.id === clean || t.url === clean);
  }

  size(): number {
    return this.items.length;
  }

  exportJSON(): string {
    return JSON.stringify({
      version: 1,
      current: this.current,
      queue: this.items,
      history: this.history
    }, null, 2);
  }

  exportM3U(): string {
    let out = '#EXTM3U\n';
    if (this.current) {
      out += `#EXTINF:${this.current.durationSec},${this.current.title}\n${this.current.url}\n`;
    }
    for (const t of this.items) {
      out += `#EXTINF:${t.durationSec},${t.title}\n${t.url}\n`;
    }
    return out;
  }

  importJSON(raw: any): number {
    let count = 0;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const list: Track[] = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.queue) ? parsed.queue : []);
      for (const t of list) {
        if (t && t.title && t.url) {
          this.items.push({
            id: t.id || Math.random().toString(36).substring(7),
            title: t.title,
            url: t.url,
            durationSec: Number(t.durationSec) || 0,
            thumbnail: t.thumbnail,
            requestedBy: t.requestedBy || 'Playlist Import'
          });
          count++;
        }
      }
      this.notifyChange();
    } catch (err) {
      console.error('[Queue] Fehler beim Importieren:', err);
    }
    return count;
  }

  private notifyChange(): void {
    if (this.persistFile) {
      this.saveToFile(this.persistFile);
    }
    this.onQueueChange?.();
  }

  saveToFile(filePath: string): void {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, this.exportJSON(), 'utf-8');
    } catch (err) {
      console.error('[Queue] Fehler beim Speichern der Warteschlange:', err);
    }
  }

  loadFromFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.queue)) {
          this.items = parsed.queue;
        }
        if (Array.isArray(parsed.history)) {
          this.history = parsed.history;
        }
        if (parsed.current && !this.current) {
          this.current = parsed.current;
        }
        console.log(`[Queue] ${this.items.length} Titel aus ${path.basename(filePath)} wiederhergestellt.`);
      }
    } catch (err) {
      console.error('[Queue] Fehler beim Laden der Warteschlange:', err);
    }
  }
}
