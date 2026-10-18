import { spawn, type ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import OpusScript from 'opusscript';
import { Codec } from '@honeybbq/teamspeak';
import type { Track } from './queue.js';
import { getYtdlpAuthArgs } from './auth-args.js';

const SAMPLE_RATE = 48000;
const SAMPLES_PER_FRAME = 960; // 20 ms @ 48 kHz
const FRAME_DURATION_NS = 20_000_000n; // 20 ms in nanoseconds
const OPUS_SILENCE_PACKET = new Uint8Array([0xf8, 0xff, 0xfe]);

export type VoiceSender = (packet: Uint8Array, codec: Codec) => void;

export class AudioPlayer {
  private encoder!: OpusScript;
  private currentProcessFf?: ChildProcess;
  private currentProcessYt?: ChildProcess;
  private pcmStream?: PassThrough;
  private timer?: NodeJS.Timeout | NodeJS.Immediate;
  private _codec: Codec = Codec.OpusMusic;

  public volume: number = 50; // 0 - 100
  public isPlaying: boolean = false;
  public isPaused: boolean = false;
  public positionSec: number = 0;
  public currentTrack: Track | null = null;
  public lastPlaybackError: string | null = null;

  public onTrackEnd?: () => void;
  public onStateChange?: () => void;

  constructor(
    private readonly voiceSender: VoiceSender,
    private readonly ffmpegPath: string = 'ffmpeg',
    private readonly ytdlpPath: string = 'yt-dlp',
    private readonly dataDir: string = './data'
  ) {
    this.initEncoder();
  }

  public get codec(): Codec {
    return this._codec;
  }

  public set codec(val: Codec) {
    this.setCodec(val);
  }

  public setCodec(codec: Codec): void {
    if (this._codec === codec && this.encoder) return;
    this._codec = codec;
    this.initEncoder();
  }

  public getChannels(): number {
    return this._codec === Codec.OpusVoice ? 1 : 2;
  }

  private initEncoder(): void {
    const channels = this.getChannels();
    const app = this._codec === Codec.OpusVoice
      ? OpusScript.Application.VOIP
      : OpusScript.Application.AUDIO;

    try {
      this.encoder?.delete();
    } catch {}

    this.encoder = new OpusScript(SAMPLE_RATE, channels, app);
    try {
      this.encoder.setBitrate(this._codec === Codec.OpusVoice ? 64000 : 128000);
      // Complexity 5 (CTL 4010): Optimaler Kompromiss aus Audioqualität und minimaler CPU-Last
      this.encoder.encoderCTL(4010, 5);
    } catch {}
  }

  async play(track: Track): Promise<void> {
    this.stop();

    this.currentTrack = track;
    this.isPlaying = true;
    this.isPaused = false;
    this.positionSec = 0;
    this.onStateChange?.();

    console.log(`[Player] Starte Wiedergabe: ${track.title}`);

    // Großzügiger 2 MB Puffer für unterbrechungsfreies Streaming
    const pcm = new PassThrough({ highWaterMark: 2 * 1024 * 1024 });
    this.pcmStream = pcm;

    try {
      const channels = this.getChannels();

      // 1. ffmpeg Prozess starten (dekodiert Audio in s16le 48kHz mono/stereo)
      const ffArgs = [
        '-hide_banner',
        '-loglevel', 'error',
        '-nostdin',
        '-probesize', '131072',
        '-analyzeduration', '500000',
        '-i', 'pipe:0',
        '-vn',
        '-f', 's16le',
        '-ar', String(SAMPLE_RATE),
        '-ac', String(channels),
        'pipe:1'
      ];

      const ff = spawn(this.ffmpegPath, ffArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.currentProcessFf = ff;

      ff.stdout.pipe(pcm);
      ff.stdout.on('error', () => {});
      ff.on('close', () => {
        pcm.end();
      });

      let ffStderr = '';
      ff.stderr?.on('data', (chunk) => {
        ffStderr += chunk.toString();
      });
      ff.on('close', (code) => {
        if (code !== 0 && code !== null) {
          console.error(`[Player] ffmpeg beendet mit Code ${code}:`, ffStderr.trim());
        }
      });

      // 2. yt-dlp Prozess starten
      const playUrl = track.url.replace('music.youtube.com', 'www.youtube.com');
      ff.stdin.on('error', () => {});

      const startYt = (withCookies: boolean) => {
        const ytArgs = [
          '--no-playlist',
          '--no-warnings',
          '-f', 'bestaudio/best',
          '--buffer-size', '64K',
          '--socket-timeout', '15',
          ...getYtdlpAuthArgs(this.dataDir, withCookies),
          '-o', '-',
          '--',
          playUrl
        ];

        const yt = spawn(this.ytdlpPath, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        this.currentProcessYt = yt;

        let bytesReceived = 0;
        yt.stdout.on('data', (chunk: Buffer) => { bytesReceived += chunk.length; });
        yt.stdout.pipe(ff.stdin, { end: false });
        yt.stdout.on('error', () => {});

        let ytStderr = '';
        yt.stderr?.on('data', (chunk) => {
          ytStderr += chunk.toString();
        });

        yt.on('close', (code) => {
          if (this.currentProcessYt !== yt) return; // gestoppt oder ersetzt
          if (code !== 0 && code !== null) {
            const details = ytStderr.trim() || 'Keine Fehlerausgabe';
            console.error(`[Player] yt-dlp beendet mit Code ${code}${withCookies ? '' : ' (ohne Cookies)'}. Details:`, details);
            this.lastPlaybackError = details;

            if (withCookies && bytesReceived === 0) {
              console.warn('[Player] Versuche Wiedergabe erneut ohne Cookies...');
              startYt(false);
              return;
            }
          } else {
            this.lastPlaybackError = null;
          }
          ff.stdin.end();
        });

        yt.on('error', (err) => {
          console.error('[Player] yt-dlp Prozessfehler:', err.message);
          this.lastPlaybackError = err.message;
          this.handleEnd();
        });
      };

      startYt(true);

      ff.on('error', (err) => {
        console.error('[Player] ffmpeg Prozessfehler:', err.message);
        this.lastPlaybackError = err.message;
        this.handleEnd();
      });

      // 3. Audio-Schleife mit Jitter-freiem Drift-Ausgleich starten
      this.startAudioLoop();
    } catch (err: any) {
      console.error('[Player] Start-Fehler:', err);
      this.lastPlaybackError = err?.message || String(err);
      this.handleEnd();
    }
  }

  private startAudioLoop(): void {
    const channels = this.getChannels();
    const frameBytes = SAMPLES_PER_FRAME * channels * 2;
    // 1500 ms Prebuffer verhindert Buffer-Underruns durch Netzwerklatenz
    const prebufferBytes = (SAMPLE_RATE * channels * 2 * 1500) / 1000;

    let frameCount = 0n;
    let startTime = process.hrtime.bigint();
    let isPrebuffering = true;

    const tick = () => {
      if (!this.isPlaying) return;

      if (this.isPaused) {
        // Zeitbasis mitführen, damit positionSec während Pause nicht abweicht
        startTime = process.hrtime.bigint() - frameCount * FRAME_DURATION_NS;
        this.timer = setTimeout(tick, 40);
        return;
      }

      const pcm = this.pcmStream;
      if (!pcm) return;

      // 1. Initialer Prebuffer vor Start der Wiedergabe
      if (isPrebuffering) {
        if (pcm.readableLength < prebufferBytes && !pcm.writableFinished) {
          this.timer = setTimeout(tick, 20);
          return;
        }
        isPrebuffering = false;
        startTime = process.hrtime.bigint() - frameCount * FRAME_DURATION_NS;
      }

      // 2. Umgang mit Buffer-Underrun / Latenzloch
      if (pcm.readableLength < frameBytes) {
        if (pcm.writableFinished) {
          // Stream beendet
          if (pcm.readableLength > 0) {
            const rest = pcm.read(pcm.readableLength) as Buffer;
            const frame = Buffer.alloc(frameBytes);
            rest.copy(frame);
            this.sendFrame(frame);
          }
          this.handleEnd();
          return;
        }

        // Kein vollständiges Frame verfügbar -> Stille-Paket senden, um Jitter-Buffer-Abriss (Knistern) zu verhindern
        try {
          this.voiceSender(OPUS_SILENCE_PACKET, this._codec);
        } catch {}

        this.timer = setTimeout(tick, 20);
        return;
      }

      // 3. 20ms Frame lesen und senden
      const frame = pcm.read(frameBytes) as Buffer;
      if (frame && frame.length === frameBytes) {
        this.sendFrame(frame);
        frameCount++;

        if (frameCount % 50n === 0n) {
          this.positionSec = Number(frameCount / 50n);
          this.onStateChange?.();
        }
      }

      // 4. Drift-freier Timer mit Nanosekunden-Genauigkeit (process.hrtime.bigint)
      const targetNs = startTime + frameCount * FRAME_DURATION_NS;
      const nowNs = process.hrtime.bigint();
      const diffNs = targetNs - nowNs;
      const diffMs = Number(diffNs / 1_000_000n);

      if (diffMs > 2) {
        // Node.js setTimeout feuert minimal später, daher 1ms Vorlauf abziehen
        this.timer = setTimeout(tick, Math.max(1, diffMs - 1));
      } else if (diffMs >= 0) {
        this.timer = setImmediate(tick);
      } else {
        // Wir liegen hinter der Zielzeit (z. B. Event-Loop-Verzögerung oder GC)
        if (diffMs < -200) {
          // Große Verzögerung (System-Schlafmodus etc.): Zeitbasis neu synchronisieren
          startTime = nowNs - frameCount * FRAME_DURATION_NS;
        }
        // Sofort aufholen ohne Wartezeit
        this.timer = setImmediate(tick);
      }
    };

    this.timer = setTimeout(tick, 20);
  }

  private sendFrame(frame: Buffer): void {
    // Schnelle Vektor-Lautstärkeskalierung mit Int16Array ohne Garbage-Collection-Last
    const volMultiplier = Math.max(0, Math.min(100, this.volume)) / 100;
    if (volMultiplier < 1.0) {
      const samples = new Int16Array(frame.buffer, frame.byteOffset, frame.byteLength / 2);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = (samples[i] * volMultiplier) | 0;
      }
    }

    try {
      const opusPacket = this.encoder.encode(frame, SAMPLES_PER_FRAME);
      this.voiceSender(opusPacket, this._codec);
    } catch (err) {
      console.error('[Player] Opus Encoding Fehler:', err);
    }
  }

  private handleEnd(): void {
    if (!this.isPlaying) return;
    this.stop();
    this.onTrackEnd?.();
  }

  pause(): void {
    if (this.isPlaying && !this.isPaused) {
      this.isPaused = true;
      try {
        this.voiceSender(OPUS_SILENCE_PACKET, this._codec);
      } catch {}
      this.onStateChange?.();
    }
  }

  resume(): void {
    if (this.isPlaying && this.isPaused) {
      this.isPaused = false;
      this.onStateChange?.();
    }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer as NodeJS.Timeout);
      clearImmediate(this.timer as NodeJS.Immediate);
      this.timer = undefined;
    }

    if (this.isPlaying) {
      try {
        this.voiceSender(OPUS_SILENCE_PACKET, this._codec);
      } catch {}
    }

    if (this.currentProcessYt) {
      this.currentProcessYt.kill('SIGKILL');
      this.currentProcessYt = undefined;
    }

    if (this.currentProcessFf) {
      this.currentProcessFf.kill('SIGKILL');
      this.currentProcessFf = undefined;
    }

    if (this.pcmStream) {
      this.pcmStream.destroy();
      this.pcmStream = undefined;
    }

    this.isPlaying = false;
    this.isPaused = false;
    this.positionSec = 0;
    this.currentTrack = null;
    this.onStateChange?.();
  }

  setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(100, Math.round(vol)));
    this.onStateChange?.();
  }
}
