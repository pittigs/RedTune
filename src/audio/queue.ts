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

  getCurrent(): Track | null {
    return this.current;
  }

  setCurrent(track: Track | null): void {
    if (this.current && track?.id !== this.current.id) {
      this.history.unshift(this.current);
      if (this.history.length > 50) this.history.pop();
    }
    this.current = track;
  }

  getItems(): Track[] {
    return [...this.items];
  }

  getHistory(): Track[] {
    return [...this.history];
  }

  add(track: Track): void {
    this.items.push(track);
  }

  addMultiple(tracks: Track[]): void {
    this.items.push(...tracks);
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
      return prev;
    }
    return null;
  }

  clear(): void {
    this.items = [];
  }

  remove(index: number): boolean {
    if (index >= 0 && index < this.items.length) {
      this.items.splice(index, 1);
      return true;
    }
    return false;
  }

  shuffle(): void {
    for (let i = this.items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    }
  }

  size(): number {
    return this.items.length;
  }
}
