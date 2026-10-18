import fs from 'node:fs';
import path from 'node:path';
import { Client, generateIdentitySync, parseIdentity, type Identity, type ClientOptions } from '@honeybbq/teamspeak/client';
import { 
  Codec, 
  ClientStatus, 
  listChannels, 
  listClients, 
  moveClient, 
  sendChannelMessage, 
  sendPrivateMessage, 
  sendServerMessage 
} from '@honeybbq/teamspeak';
import type { BotConfig } from '../config.js';
import { AudioPlayer } from '../audio/player.js';
import { MusicQueue } from '../audio/queue.js';
import { AudioResolver } from '../audio/resolver.js';
import { CommandHandler } from './commands.js';

export class TeamSpeakBot {
  private client?: Client;
  private identity!: Identity;
  public player!: AudioPlayer;
  public queue!: MusicQueue;
  public resolver!: AudioResolver;
  public commandHandler!: CommandHandler;
  public onStatusChange?: () => void;

  public lastConnectionError: string | null = null;
  public isConnecting: boolean = false;
  public currentChannelName: string = '';

  constructor(
    public readonly config: BotConfig,
    public readonly dataDir: string = './data'
  ) {
    this.queue = new MusicQueue();
    this.resolver = new AudioResolver(config.audio.ytdlpPath, this.dataDir);

    // Initialisiert den AudioPlayer mit unserem voiceSender Hook
    this.player = new AudioPlayer(
      (packet: Uint8Array, codec: Codec) => {
        if (!packet || packet.length === 0) return;
        if (this.client?.status === ClientStatus.Connected) {
          try {
            this.client.sendVoice(packet, codec);
          } catch (err) {
            console.error('[Bot] sendVoice Fehler:', err);
          }
        }
      },
      config.audio.ffmpegPath,
      config.audio.ytdlpPath,
      this.dataDir
    );

    this.player.volume = config.audio.defaultVolume;

    // Automatisch den nächsten Song abspielen wenn der aktuelle endet
    this.player.onTrackEnd = async () => {
      const next = this.queue.next();
      if (next) {
        await this.player.play(next);
        await this.broadcastChannel(`🎶 Spiele jetzt nächsten Track: **${next.title}**`);
      } else {
        console.log('[Bot] Warteschlange beendet.');
      }
    };

    this.commandHandler = new CommandHandler(
      this.player,
      this.queue,
      this.resolver,
      config.bot.commandPrefix,
      (targetChannel: string) => this.joinChannel(targetChannel)
    );
  }

  async start(): Promise<void> {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch {}
      this.client = undefined;
    }

    this.identity = this.loadOrGenerateIdentity();
    console.log(`[Bot] TeamSpeak Identity geladen. UID: ${this.identity.uid("sha1")}`);

    const serverAddr = this.config.server.address;
    const nickname = this.config.server.nickname || 'RedTune';

    console.log(`[Bot] Verbinde zu TeamSpeak Server: ${serverAddr}...`);
    this.isConnecting = true;
    this.lastConnectionError = null;
    this.onStatusChange?.();

    const clientOptions: ClientOptions = {
      serverPassword: this.config.server.password || undefined,
      defaultChannel: this.config.server.channel || undefined,
      defaultChannelPassword: this.config.server.channelPassword || undefined,
      logger: {
        debug: (msg, ...args) => console.log('[TS-Debug]', msg, ...args),
        info: (msg, ...args) => console.log('[TS-Info]', msg, ...args),
        warn: (msg, ...args) => console.warn('[TS-Warn]', msg, ...args),
        error: (msg, ...args) => console.error('[TS-Error]', msg, ...args),
      }
    };

    this.client = new Client(this.identity, serverAddr, nickname, clientOptions);
    this.setupEvents();

    try {
      await this.client.connect({ signal: AbortSignal.timeout(25_000) });
      this.isConnecting = false;
      this.lastConnectionError = null;
      console.log(`[Bot] ✔ Erfolgreich mit TeamSpeak verbunden! Client-ID: ${this.client.clientID}`);
      this.onStatusChange?.();

      // Channel synchronisieren und beitreten
      setTimeout(async () => {
        if (this.config.server.channel) {
          await this.joinChannel(this.config.server.channel, this.config.server.channelPassword);
        } else {
          await this.syncCurrentChannelInfo();
        }
      }, 1500);
    } catch (err: any) {
      this.isConnecting = false;
      this.lastConnectionError = err?.message || String(err);
      console.error('[Bot] Verbindungsfehler:', this.lastConnectionError);
      this.onStatusChange?.();
      throw err;
    }
  }

  public async reconnect(): Promise<void> {
    console.log('[Bot] Starte Reconnect...');
    this.player.stop();
    await this.start();
  }

  private setupEvents(): void {
    if (!this.client) return;

    this.client.on('connected', () => {
      console.log('[Bot] Status: Online');
      this.isConnecting = false;
      this.lastConnectionError = null;
      this.onStatusChange?.();
    });

    this.client.on('disconnected', ({ error, willReconnect }) => {
      console.warn(`[Bot] Verbindung getrennt. Reconnect: ${willReconnect ? 'Ja' : 'Nein'}`, error?.message || '');
      this.isConnecting = false;
      this.lastConnectionError = error?.message || 'Verbindung getrennt';
      this.player.stop();
      this.onStatusChange?.();
    });

    // Chat-Nachrichten verarbeiten
    this.client.on('textMessage', async (msg) => {
      // Ignoriere eigene Nachrichten
      if (msg.invokerID === this.client?.clientID) return;

      console.log(`[Chat] [${msg.invokerName}]: ${msg.message}`);

      const reply = async (text: string) => {
        if (!this.client || this.client.status !== ClientStatus.Connected) return;
        try {
          if (msg.targetMode === 1 /* Private */) {
            await sendPrivateMessage(this.client, msg.invokerID, text);
          } else if (msg.targetMode === 3 /* Server */) {
            await sendServerMessage(this.client, text);
          } else {
            await sendChannelMessage(this.client, text);
          }
        } catch (err) {
          console.error('[Bot] Fehler beim Senden der Chat-Antwort:', err);
        }
      };

      await this.commandHandler.handle(msg.message, {
        senderUID: msg.invokerUID,
        senderName: msg.invokerName,
        channelId: 0n,
        reply
      });
    });
  }

  public async broadcastChannel(text: string): Promise<void> {
    if (this.client?.status === ClientStatus.Connected) {
      try {
        await sendChannelMessage(this.client, text);
      } catch (err) {
        // Ignorieren falls keine Channel-Schreibrechte
      }
    }
  }

  public async syncCurrentChannelInfo(): Promise<void> {
    if (!this.client || this.client.status !== ClientStatus.Connected) return;
    try {
      const [channels, clients] = await Promise.all([
        listChannels(this.client, { timeoutMs: 10_000 }),
        listClients(this.client, { timeoutMs: 10_000 })
      ]);
      const selfClient = clients.find(c => c.id === this.client?.clientID);
      if (selfClient) {
        const ch = channels.find(c => c.id === selfClient.channelID);
        if (ch) {
          this.currentChannelName = ch.name;
          if (ch.codec !== undefined) {
            this.player.codec = ch.codec as Codec;
            console.log(`[Bot] Aktueller Channel: "${ch.name}" (Codec: ${ch.codec === Codec.OpusVoice ? 'Opus Voice' : 'Opus Music'})`);
          }
          this.onStatusChange?.();
        }
      }
    } catch (e) {
      // Ignorieren falls Berechtigungen eingeschränkt sind
    }
  }

  public async joinChannel(channelTarget: string, password?: string): Promise<boolean> {
    if (!this.client || this.client.status !== ClientStatus.Connected) {
      console.warn('[Bot] Kann Channel nicht beitreten: Nicht verbunden.');
      return false;
    }

    try {
      console.log(`[Bot] Suche Channel: "${channelTarget}"...`);
      const channels = await listChannels(this.client, { timeoutMs: 10_000 });
      const targetLower = channelTarget.trim().toLowerCase();

      // 1. Suche nach exaktem Channel-Namen oder Channel-ID
      let targetCh = channels.find(
        (ch) =>
          ch.name.trim().toLowerCase() === targetLower ||
          String(ch.id) === channelTarget.trim()
      );

      // 2. Falls nicht gefunden, suche nach Teilübereinstimmung
      if (!targetCh) {
        targetCh = channels.find((ch) =>
          ch.name.toLowerCase().includes(targetLower)
        );
      }

      if (targetCh) {
        console.log(`[Bot] Wechsle in Channel "${targetCh.name}" (ID: ${targetCh.id})...`);
        await moveClient(this.client, this.client.clientID, targetCh.id, {
          password: password || undefined,
          timeoutMs: 10_000,
        });
        this.currentChannelName = targetCh.name;
        if (targetCh.codec !== undefined) {
          this.player.codec = targetCh.codec as Codec;
          console.log(`[Bot] Verwende Channel-Codec: ${targetCh.codec === Codec.OpusVoice ? 'Opus Voice' : 'Opus Music'}`);
        }
        console.log(`[Bot] ✔ Erfolgreich in Channel "${targetCh.name}" gewechselt.`);
        this.onStatusChange?.();
        return true;
      } else {
        console.warn(`[Bot] ❌ Channel "${channelTarget}" nicht gefunden.`);
        console.log(`[Bot] Gefundene Channels:`, channels.map((c) => c.name).join(', '));
        return false;
      }
    } catch (err) {
      console.error('[Bot] Fehler beim Wechseln in Channel:', (err as Error).message);
      return false;
    }
  }

  private loadOrGenerateIdentity(): Identity {
    const identFile = path.join(this.dataDir, 'identity.txt');
    if (fs.existsSync(identFile)) {
      try {
        const str = fs.readFileSync(identFile, 'utf-8').trim();
        return parseIdentity(str);
      } catch (err) {
        console.warn('[Bot] Gespeicherte Identity ungültig, generiere neue...', err);
      }
    }

    // Neue Identity mit Sicherheitslevel 8 generieren
    console.log('[Bot] Generiere neue TeamSpeak Identity (Level 8)...');
    const ident = generateIdentitySync(8);
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(identFile, ident.export(), 'utf-8');
    return ident;
  }

  public getStatus() {
    return {
      connected: this.client?.status === ClientStatus.Connected,
      isConnecting: this.isConnecting,
      lastError: this.lastConnectionError,
      currentChannel: this.currentChannelName,
      botName: this.config.server.nickname,
      server: this.config.server.address,
      uid: this.identity?.uid("sha1"),
      player: {
        isPlaying: this.player.isPlaying,
        isPaused: this.player.isPaused,
        volume: this.player.volume,
        positionSec: this.player.positionSec,
        currentTrack: this.player.currentTrack,
        lastError: this.player.lastPlaybackError
      },
      queue: {
        items: this.queue.getItems(),
        loopMode: this.queue.loopMode
      }
    };
  }
}
