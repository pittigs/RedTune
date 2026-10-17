import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isOAuthEnabled } from './auth-args.js';

export interface OAuthState {
  connected: boolean;
  pending: boolean;
  url?: string;
  code?: string;
  error?: string;
}

export class OAuthManager {
  private activeProcess?: ChildProcess;
  private pendingAuth?: { url: string; code: string; startedAt: number };
  private state: 'idle' | 'pending' | 'success' | 'error' = 'idle';
  private lastError: string = '';

  constructor(private readonly dataDir: string = './data') {}

  public getStatus(): OAuthState {
    const connected = isOAuthEnabled(this.dataDir);

    if (connected) {
      return { connected: true, pending: false };
    }

    if (this.state === 'pending' && this.pendingAuth) {
      if (Date.now() - this.pendingAuth.startedAt < 180_000) {
        return {
          connected: false,
          pending: true,
          url: this.pendingAuth.url,
          code: this.pendingAuth.code,
        };
      } else {
        this.cancel();
      }
    }

    return {
      connected: false,
      pending: false,
      error: this.state === 'error' ? this.lastError : undefined,
    };
  }

  public async startFlow(ytdlpPath: string = 'yt-dlp'): Promise<{ url: string; code: string }> {
    this.cancel();

    const cacheDir = path.join(this.dataDir, '.cache');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    this.state = 'pending';
    this.lastError = '';

    return new Promise((resolve, reject) => {
      let resolved = false;
      const child = spawn(ytdlpPath, [
        '--cache-dir', cacheDir,
        '--username', 'oauth2',
        '--password', '',
        '--dump-json',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      ]);

      this.activeProcess = child;
      let outputBuffer = '';

      const onData = (data: Buffer) => {
        const text = data.toString();
        outputBuffer += text;

        if (!resolved) {
          // Suche nach: go to https://www.google.com/device and enter code XXXX-XXXX
          const match = outputBuffer.match(/enter\s+code\s+([A-Z0-9\-]{4,15})/i);
          if (match) {
            resolved = true;
            const url = 'https://www.google.com/device';
            const code = match[1];
            this.pendingAuth = { url, code, startedAt: Date.now() };
            console.log(`[OAuth] Device-Code erhalten: ${code} (${url})`);
            resolve({ url, code });
          }
        }
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', onData);

      child.on('close', (code) => {
        this.activeProcess = undefined;

        if (code === 0) {
          console.log('[OAuth] ✔ Autorisierung erfolgreich! Tokens wurden gespeichert.');
          fs.writeFileSync(path.join(this.dataDir, 'oauth_enabled'), '1', 'utf-8');
          this.state = 'success';
          this.pendingAuth = undefined;
        } else {
          console.warn(`[OAuth] Prozess beendet mit Code ${code}`);
          this.state = 'error';
          this.lastError = outputBuffer.trim() || 'Authentifizierung abgebrochen oder fehlgeschlagen.';
          if (!resolved) {
            reject(new Error(this.lastError));
          }
        }
      });

      child.on('error', (err) => {
        this.activeProcess = undefined;
        this.state = 'error';
        this.lastError = err.message;
        if (!resolved) reject(err);
      });

      // Timeout nach 3 Minuten
      setTimeout(() => {
        if (this.activeProcess === child) {
          this.cancel();
          if (!resolved) reject(new Error('Timeout beim Warten auf den Google Device-Code.'));
        }
      }, 180_000);
    });
  }

  public cancel(): void {
    if (this.activeProcess) {
      try {
        this.activeProcess.kill('SIGTERM');
      } catch {}
      this.activeProcess = undefined;
    }
    this.pendingAuth = undefined;
    this.state = 'idle';
  }

  public disconnect(): void {
    this.cancel();
    const marker = path.join(this.dataDir, 'oauth_enabled');
    if (fs.existsSync(marker)) {
      try { fs.unlinkSync(marker); } catch {}
    }
    console.log('[OAuth] Verbindung getrennt.');
  }
}
