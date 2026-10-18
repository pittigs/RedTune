import { spawn, type ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import OpusScript from 'opusscript';
import { Codec } from '@honeybbq/teamspeak';
import type { Track } from './queue.js';
import { getYtdlpAuthArgs } from './auth-args.js';
import type { AudioFilterPreset } from '../config.js';

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
  public activeFilter: AudioFilterPreset = 'normal';

  // Telemetrie & Performance Metrics
  public totalPacketsSent: number = 0;
  public totalBytesSent: number = 0;
  public underrunCount: number = 0;
  public playStartTime: number = 0;

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
      this.encoder.encoderCTL(4010, 5); // Complexity 5
    } catch {}
  }

  public setFilter(preset: AudioFilterPreset): void {
    if (this.activeFilter === preset) return;
    this.activeFilter = preset;
    console.log(`[Player] Audio-Filter geändert auf: ${preset}`);
    if (this.isPlaying && this.currentTrack) {
      // Aktuellen Track nahtlos an der aktuellen Position mit neuem Filter neu starten
      const pos = this.positionSec;
      this.play(this.currentTrack, pos);
    } else {
      this.onStateChange?.();
    }
  }

  public async seek(targetSec: number): Promise<void> {
    if (!this.isPlaying || !this.currentTrack) return;
    const clamped = Math.max(0, Math.min(targetSec, this.currentTrack.durationSec || targetSec));
    console.log(`[Player] Springe zu Sekunde ${clamped} in "${this.currentTrack.title}"...`);
    await this.play(this.currentTrack, clamped);
  }

  async play(track: Track, startSec: number = 0): Promise<void> {
    this.stopProcessesAndTimer();

    this.currentTrack = track;
    this.isPlaying = true;
    this.isPaused = false;
    this.positionSec = startSec;
    this.playStartTime = Date.now();
    this.onStateChange?.();

    console.log(`[Player] Starte Wiedergabe: ${track.title}${startSec > 0 ? ` ab ${startSec}s` : ''} (Filter: ${this.activeFilter})`);

    const pcm = new PassThrough({ highWaterMark: 2 * 1024 * 1024 });
    this.pcmStream = pcm;

    try {
      const channels = this.getChannels();

      // Audio-Filter-Argumente ermitteln
      const filterArgs: string[] = [];
      if (this.activeFilter === 'bassboost') {
        filterArgs.push('-af', 'equalizer=f=60:width_type=h:width=50:g=12');
      } else if (this.activeFilter === 'nightcore') {
        filterArgs.push('-af', 'asetrate=48000*1.25,aresample=48000,atempo=1.05');
      } else if (this.activeFilter === 'vaporwave') {
        filterArgs.push('-af', 'asetrate=48000*0.85,aresample=48000,atempo=0.9');
      } else if (this.activeFilter === 'loudnorm') {
        filterArgs.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
      }

      const seekArgs = startSec > 0 ? ['-ss', String(startSec)] : [];

      // 1. Erkennung des Track-Typs
      const isDirectStream = Boolean(
        track.isStream ||
        ((track.url.startsWith('http://') || track.url.startsWith('https://')) &&
         !track.url.includes('youtube.com') && !track.url.includes('youtu.be') && !track.url.includes('spotify.com'))
      );

      const isLocalFile = Boolean(
        track.isLocal ||
        track.url.startsWith('/') ||
        track.url.startsWith('./')
      );

      // A. Direkter Web-/Radio-Stream (Icecast, HLS, Shoutcast, MP3)
      if (isDirectStream) {
        console.log(`[Player] Direkter Web-/Radio-Stream gestartet: ${track.title} (${track.url})`);
        const ffArgs = [
          '-hide_banner',
          '-loglevel', 'error',
          '-nostdin',
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5',
          '-i', track.url,
          ...seekArgs,
          '-vn',
          ...filterArgs,
          '-f', 's16le',
          '-ar', String(SAMPLE_RATE),
          '-ac', String(channels),
          'pipe:1'
        ];

        const ff = spawn(this.ffmpegPath, ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
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
            const errMsg = ffStderr.trim() || `Radio-Stream beendet mit Code ${code}`;
            console.error(`[Player] Radio ffmpeg beendet mit Code ${code}:`, errMsg);
            this.lastPlaybackError = errMsg;
          }
        });

        ff.on('error', (err) => {
          console.error('[Player] Radio ffmpeg Fehler:', err.message);
          this.lastPlaybackError = err.message;
          this.handleEnd();
        });

        this.startAudioLoop(startSec);
        return;
      }

      // B. Lokale Datei (Upload)
      if (isLocalFile) {
        console.log(`[Player] Lokale Datei gestartet: ${track.title} (${track.url})`);
        const ffArgs = [
          '-hide_banner',
          '-loglevel', 'error',
          '-nostdin',
          '-i', track.url,
          ...seekArgs,
          '-vn',
          ...filterArgs,
          '-f', 's16le',
          '-ar', String(SAMPLE_RATE),
          '-ac', String(channels),
          'pipe:1'
        ];

        const ff = spawn(this.ffmpegPath, ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
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
            const errMsg = ffStderr.trim() || `Lokale Datei FFmpeg beendet mit Code ${code}`;
            console.error(`[Player] Lokale Datei ffmpeg beendet mit Code ${code}:`, errMsg);
            this.lastPlaybackError = errMsg;
          }
        });

        ff.on('error', (err) => {
          console.error('[Player] Lokale Datei ffmpeg Fehler:', err.message);
          this.lastPlaybackError = err.message;
          this.handleEnd();
        });

        this.startAudioLoop(startSec);
        return;
      }

      // C. YouTube Stream via yt-dlp & FFmpeg
      const ffArgs = [
        '-hide_banner',
        '-loglevel', 'error',
        '-nostdin',
        '-i', 'pipe:0',
        ...seekArgs,
        '-vn',
        ...filterArgs,
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
          const errMsg = ffStderr.trim() || `FFmpeg beendet mit Code ${code}`;
          console.error(`[Player] ffmpeg beendet mit Code ${code}:`, errMsg);
          this.lastPlaybackError = errMsg;
        }
      });

      const playUrl = track.url.replace('music.youtube.com', 'www.youtube.com');
      ff.stdin.on('error', () => {});

      const startYt = (withCookies: boolean) => {
        const ytArgs = [
          '--no-playlist',
          '--no-warnings',
          '-f', 'bestaudio/best',
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
          if (this.currentProcessYt !== yt) return;
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

      this.startAudioLoop(startSec);
    } catch (err: any) {
      console.error('[Player] Start-Fehler:', err);
      this.lastPlaybackError = err?.message || String(err);
      this.handleEnd();
    }
  }

  private startAudioLoop(initialOffsetSec: number = 0): void {
    const channels = this.getChannels();
    const frameBytes = SAMPLES_PER_FRAME * channels * 2;
    // 400 ms Prebuffer (20 Frames = 76.800 Bytes bei Stereo) sorgt für sofortigen Start ohne Knistern
    const prebufferBytes = frameBytes * 20;

    let frameCount = BigInt(Math.round(initialOffsetSec * 50));
    let startTime = process.hrtime.bigint() - frameCount * FRAME_DURATION_NS;
    let isPrebuffering = true;

    const tick = () => {
      if (!this.isPlaying) return;

      if (this.isPaused) {
        startTime = process.hrtime.bigint() - frameCount * FRAME_DURATION_NS;
        this.timer = setTimeout(tick, 40);
        return;
      }

      const pcm = this.pcmStream;
      if (!pcm) return;

      if (isPrebuffering) {
        if (pcm.readableLength < prebufferBytes && !pcm.writableFinished) {
          this.timer = setTimeout(tick, 20);
          return;
        }
        isPrebuffering = false;
        startTime = process.hrtime.bigint() - frameCount * FRAME_DURATION_NS;
      }

      if (pcm.readableLength < frameBytes) {
        if (pcm.writableFinished) {
          if (pcm.readableLength > 0) {
            const rest = pcm.read(pcm.readableLength) as Buffer;
            const frame = Buffer.alloc(frameBytes);
            rest.copy(frame);
            this.sendFrame(frame);
          }
          this.handleEnd();
          return;
        }

        this.underrunCount++;
        try {
          this.voiceSender(OPUS_SILENCE_PACKET, this._codec);
        } catch {}

        // Nach Buffer-Underrun Zeitanker synchronisieren, um Paket-Stau zu verhindern
        startTime = process.hrtime.bigint() - frameCount * FRAME_DURATION_NS;
        this.timer = setTimeout(tick, 20);
        return;
      }

      const frame = pcm.read(frameBytes) as Buffer;
      if (frame && frame.length === frameBytes) {
        this.sendFrame(frame);
        frameCount++;

        if (frameCount % 50n === 0n) {
          this.positionSec = Number(frameCount / 50n);
          this.onStateChange?.();
        }
      }

      const targetNs = startTime + frameCount * FRAME_DURATION_NS;
      const nowNs = process.hrtime.bigint();
      const diffNs = targetNs - nowNs;
      const diffMs = Number(diffNs / 1_000_000n);

      if (diffMs > 2) {
        this.timer = setTimeout(tick, Math.max(1, diffMs - 1));
      } else if (diffMs >= 0) {
        this.timer = setImmediate(tick);
      } else {
        if (diffMs < -200) {
          startTime = nowNs - frameCount * FRAME_DURATION_NS;
        }
        this.timer = setImmediate(tick);
      }
    };

    this.timer = setTimeout(tick, 20);
  }

  private sendFrame(frame: Buffer): void {
    const volMultiplier = Math.max(0, Math.min(100, this.volume)) / 100;
    if (volMultiplier < 1.0) {
      if (frame.byteOffset % 2 === 0) {
        const samples = new Int16Array(frame.buffer, frame.byteOffset, frame.byteLength / 2);
        for (let i = 0; i < samples.length; i++) {
          samples[i] = (samples[i] * volMultiplier) | 0;
        }
      } else {
        for (let i = 0; i < frame.length; i += 2) {
          const sample = frame.readInt16LE(i);
          frame.writeInt16LE((sample * volMultiplier) | 0, i);
        }
      }
    }

    try {
      const opusPacket = this.encoder.encode(frame, SAMPLES_PER_FRAME);
      this.voiceSender(opusPacket, this._codec);
      this.totalPacketsSent++;
      this.totalBytesSent += opusPacket.length;
    } catch (err) {
      console.error('[Player] Opus Encoding Fehler:', err);
    }
  }

  // Soundboard Synthese für Sofort-Effekte
  public playSoundEffect(type: 'airhorn' | 'applause' | 'notification' | 'rimshot'): void {
    const channels = this.getChannels();
    const totalFrames = type === 'airhorn' ? 60 : 35; // ca. 0.7 - 1.2s

    let f = 0;
    const playEffectLoop = () => {
      if (f >= totalFrames) return;
      const samples = new Int16Array(SAMPLES_PER_FRAME * channels);
      for (let s = 0; s < SAMPLES_PER_FRAME; s++) {
        const time = (f * SAMPLES_PER_FRAME + s) / SAMPLE_RATE;
        let val = 0;
        if (type === 'airhorn') {
          // Zweiklang 466 Hz (Bb4) + 622 Hz (Eb5) mit Sägezahn/Distortion
          const freq1 = 466.16;
          const freq2 = 622.25;
          const env = Math.min(1, f / 5) * Math.max(0, 1 - f / totalFrames);
          val = ((Math.sin(2 * Math.PI * freq1 * time) + Math.sin(2 * Math.PI * freq2 * time)) * 0.4) * env;
        } else if (type === 'notification') {
          // Glockenklang 880Hz -> 1760Hz
          const freq = f < 15 ? 880 : 1760;
          const env = Math.exp(-((f % 15) * 0.15));
          val = Math.sin(2 * Math.PI * freq * time) * env * 0.5;
        } else {
          // Percussiver Rausch-Impuls
          val = (Math.random() * 2 - 1) * Math.exp(-f * 0.1) * 0.3;
        }

        const sampleVal = Math.round(val * 24000);
        for (let c = 0; c < channels; c++) {
          samples[s * channels + c] = sampleVal;
        }
      }

      const buf = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
      try {
        const packet = this.encoder.encode(buf, SAMPLES_PER_FRAME);
        this.voiceSender(packet, this._codec);
      } catch {}

      f++;
      setTimeout(playEffectLoop, 20);
    };

    playEffectLoop();
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

  private stopProcessesAndTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer as NodeJS.Timeout);
      clearImmediate(this.timer as NodeJS.Immediate);
      this.timer = undefined;
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
  }

  stop(): void {
    this.stopProcessesAndTimer();

    if (this.isPlaying) {
      try {
        this.voiceSender(OPUS_SILENCE_PACKET, this._codec);
      } catch {}
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
