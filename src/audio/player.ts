import { spawn, type ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import OpusScript from 'opusscript';
import { Codec } from '@honeybbq/teamspeak';
import type { Track } from './queue.js';
import { getYtdlpAuthArgs } from './auth-args.js';

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const SAMPLES_PER_FRAME = 960; // 20 ms @ 48 kHz
const FRAME_BYTES = SAMPLES_PER_FRAME * CHANNELS * 2; // 3840 Bytes
const PREBUFFER_BYTES = FRAME_BYTES * 10; // 200 ms Prebuffer

export type VoiceSender = (packet: Uint8Array, codec: Codec) => void;

export class AudioPlayer {
  private encoder: OpusScript;
  private currentProcessFf?: ChildProcess;
  private currentProcessYt?: ChildProcess;
  private pcmStream?: PassThrough;
  private timer?: NodeJS.Timeout;

  public volume: number = 50; // 0 - 100
  public isPlaying: boolean = false;
  public isPaused: boolean = false;
  public positionSec: number = 0;
  public currentTrack: Track | null = null;

  public onTrackEnd?: () => void;
  public onStateChange?: () => void;

  constructor(
    private readonly voiceSender: VoiceSender,
    private readonly ffmpegPath: string = 'ffmpeg',
    private readonly ytdlpPath: string = 'yt-dlp',
    private readonly dataDir: string = './data'
  ) {
    // OpusScript Encoder für 48 kHz Stereo Musik (Application AUDIO = 2049)
    this.encoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO);
  }

  async play(track: Track): Promise<void> {
    this.stop();

    this.currentTrack = track;
    this.isPlaying = true;
    this.isPaused = false;
    this.positionSec = 0;
    this.onStateChange?.();

    console.log(`[Player] Starte Wiedergabe: ${track.title}`);

    const pcm = new PassThrough({ highWaterMark: 1024 * 1024 });
    this.pcmStream = pcm;

    try {
      // 1. ffmpeg Prozess starten (liest PCM von stdin oder URL, gibt s16le 48kHz stereo auf stdout)
      const ffArgs = [
        '-hide_banner',
        '-loglevel', 'error',
        '-nostdin',
        '-i', 'pipe:0',
        '-vn',
        '-f', 's16le',
        '-ar', String(SAMPLE_RATE),
        '-ac', String(CHANNELS),
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

      // 2. yt-dlp Prozess starten (streamt den YouTube Music / YouTube Audiotrack in ffmpeg stdin)
      const ytArgs = [
        '--no-playlist',
        '--no-warnings',
        '-f', 'bestaudio[ext=webm]/bestaudio/best',
        '--socket-timeout', '15',
        ...getYtdlpAuthArgs(this.dataDir),
        '-o', '-',
        '--',
        track.url
      ];

      const yt = spawn(this.ytdlpPath, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      this.currentProcessYt = yt;

      yt.stdout.pipe(ff.stdin);
      yt.stdout.on('error', () => {});
      ff.stdin.on('error', () => {});

      let ytStderr = '';
      yt.stderr?.on('data', (chunk) => {
        ytStderr += chunk.toString();
      });

      yt.on('close', (code) => {
        if (code !== 0 && code !== null) {
          console.error(`[Player] yt-dlp beendet mit Code ${code}. Details:`, ytStderr.trim() || 'Keine Fehlerausgabe');
        }
      });

      yt.on('error', (err) => {
        console.error('[Player] yt-dlp Prozessfehler:', err.message);
        this.handleEnd();
      });

      ff.on('error', (err) => {
        console.error('[Player] ffmpeg Prozessfehler:', err.message);
        this.handleEnd();
      });

      // 3. Audio-Schleife starten
      this.startAudioLoop();
    } catch (err) {
      console.error('[Player] Start-Fehler:', err);
      this.handleEnd();
    }
  }

  private startAudioLoop(): void {
    let frameCount = 0;

    const tick = () => {
      if (!this.isPlaying) return;

      if (this.isPaused) {
        // Stille senden und Sprech-Indikator deaktivieren
        this.voiceSender(new Uint8Array(0), Codec.OpusMusic);
        this.timer = setTimeout(tick, 50);
        return;
      }

      const pcm = this.pcmStream;
      if (!pcm) return;

      // Prebuffer abwarten bevor wir anfangen
      if (frameCount === 0 && pcm.readableLength < PREBUFFER_BYTES && !pcm.writableFinished) {
        this.timer = setTimeout(tick, 20);
        return;
      }

      // 20ms Frame lesen
      let frame: Buffer | null = null;
      if (pcm.readableLength >= FRAME_BYTES) {
        frame = pcm.read(FRAME_BYTES) as Buffer;
      } else if (pcm.writableFinished) {
        // Stream beendet
        if (pcm.readableLength > 0) {
          const rest = pcm.read(pcm.readableLength) as Buffer;
          frame = Buffer.alloc(FRAME_BYTES);
          rest.copy(frame);
        } else {
          this.handleEnd();
          return;
        }
      }

      if (frame) {
        // Lautstärke digital skalieren (0 bis 100)
        const volMultiplier = Math.max(0, Math.min(100, this.volume)) / 100;
        if (volMultiplier < 1.0) {
          for (let i = 0; i < frame.length; i += 2) {
            const sample = frame.readInt16LE(i);
            const scaled = Math.max(-32768, Math.min(32767, Math.round(sample * volMultiplier)));
            frame.writeInt16LE(scaled, i);
          }
        }

        // In Opus komprimieren und an TeamSpeak senden
        try {
          const opusPacket = this.encoder.encode(frame, SAMPLES_PER_FRAME);
          this.voiceSender(opusPacket, Codec.OpusMusic);
        } catch (err) {
          console.error('[Player] Opus Encoding Fehler:', err);
        }

        frameCount++;
        if (frameCount % 50 === 0) {
          this.positionSec = Math.round(frameCount / 50);
          this.onStateChange?.();
        }
      }

      this.timer = setTimeout(tick, 20);
    };

    this.timer = setTimeout(tick, 20);
  }

  private handleEnd(): void {
    if (!this.isPlaying) return;
    this.stop();
    this.onTrackEnd?.();
  }

  pause(): void {
    if (this.isPlaying && !this.isPaused) {
      this.isPaused = true;
      this.voiceSender(new Uint8Array(0), Codec.OpusMusic);
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
      clearTimeout(this.timer);
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

    // Sprech-Status beenden
    this.voiceSender(new Uint8Array(0), Codec.OpusMusic);

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
