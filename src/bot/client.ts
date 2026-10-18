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
  sendServerMessage,
  type ChannelID
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
  public currentChannelId?: ChannelID;

  constructor(
    public readonly config: BotConfig,
    public readonly dataDir: string = './data'
  ) {
    // Persistente Queue mit automatischem Speichern/Laden
    const queueFile = path.join(this.dataDir, 'queue.json');
    this.queue = new MusicQueue(queueFile);
    this.queue.onQueueChange = () => this.onStatusChange?.();

    this.resolver = new AudioResolver(config.audio.ytdlpPath, this.dataDir);

    // Initialisiert den AudioPlayer mit voiceSender Hook
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
    if (config.audio.filter) {
      this.player.activeFilter = config.audio.filter;
    }

    let consecutiveFailures = 0;
    let lastFailureTime = 0;

    // Automatisch den nächsten Song abspielen oder Auto-DJ aktivieren
    this.player.onTrackEnd = async () => {
      const failedError = this.player.lastPlaybackError;
      this.player.lastPlaybackError = null;
      const currentTrack = this.queue.getCurrent();

      const now = Date.now();
      if (failedError) {
        if (now - lastFailureTime < 12000) {
          consecutiveFailures++;
        } else {
          consecutiveFailures = 1;
        }
        lastFailureTime = now;

        console.error(`[Bot] Fehler bei Track "${currentTrack?.title}":`, failedError);
        await this.broadcastChannel(`❌ [b]Wiedergabefehler bei "${currentTrack?.title || 'Titel'}":[/b] ${failedError.slice(0, 180)}`);

        if (consecutiveFailures >= 3) {
          console.warn('[Bot] Zu viele aufeinanderfolgende Fehler. Breche Wiedergabeschleife ab.');
          await this.broadcastChannel('⚠️ [b]Wiedergabe angehalten:[/b] Mehrere Titel konnten nicht geladen werden. Bitte im Web-Dashboard unter Einstellungen Cookies hinterlegen oder [code]!radio 1live[/code] / [code]!local[/code] nutzen.');
          this.queue.clear();
          this.player.stop();
          return;
        }
      } else {
        consecutiveFailures = 0;
      }

      const next = this.queue.next();
      if (next) {
        await this.broadcastChannel(`🎶 Spiele jetzt nächsten Track: [b]${next.title}[/b]`);
        await this.player.play(next);
      } else if (this.config.bot.autoDj && currentTrack && !currentTrack.isStream) {
        console.log(`[Auto-DJ] Warteschlange leer. Suche ähnliche Titel zu "${currentTrack.title}"...`);
        try {
          const related = await this.resolver.getRelated(currentTrack.url);
          if (related.length > 0) {
            const autoTrack = related[0];
            this.queue.setCurrent(autoTrack);
            this.queue.addMultiple(related.slice(1));
            await this.player.play(autoTrack);
            await this.broadcastChannel(`📻 [b]Auto-DJ[/b]: Spiele empfohlenen Track: [b]${autoTrack.title}[/b]`);
            return;
          }
        } catch (e) {
          console.warn('[Auto-DJ] Fehler beim Laden:', e);
        }
        console.log('[Bot] Warteschlange beendet.');
      } else {
        console.log('[Bot] Warteschlange beendet.');
      }
    };

    this.commandHandler = new CommandHandler(
      this.player,
      this.queue,
      this.resolver,
      config.bot.commandPrefix,
      (targetChannel: string) => this.joinChannel(targetChannel),
      () => this.getChannelUserCount()
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
      } catch (err) {}
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
        this.currentChannelId = selfClient.channelID;
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
    } catch (e) {}
  }

  public async getChannelUserCount(): Promise<number> {
    if (!this.client || this.client.status !== ClientStatus.Connected) return 1;
    try {
      const clients = await listClients(this.client, { timeoutMs: 5_000 });
      return clients.filter(c => c.channelID === this.currentChannelId).length;
    } catch {
      return 1;
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

      let targetCh = channels.find(
        (ch) =>
          ch.name.trim().toLowerCase() === targetLower ||
          String(ch.id) === channelTarget.trim()
      );

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
        this.currentChannelId = targetCh.id;
        if (targetCh.codec !== undefined) {
          this.player.codec = targetCh.codec as Codec;
          console.log(`[Bot] Verwende Channel-Codec: ${targetCh.codec === Codec.OpusVoice ? 'Opus Voice' : 'Opus Music'}`);
        }
        console.log(`[Bot] ✔ Erfolgreich in Channel "${targetCh.name}" gewechselt.`);
        this.onStatusChange?.();
        return true;
      } else {
        console.warn(`[Bot] ❌ Channel "${channelTarget}" nicht gefunden.`);
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
        lastError: this.player.lastPlaybackError,
        filter: this.player.activeFilter,
        packetsSent: this.player.totalPacketsSent,
        bytesSent: this.player.totalBytesSent,
        underruns: this.player.underrunCount
      },
      queue: {
        items: this.queue.getItems(),
        history: this.queue.getHistory().slice(0, 10),
        loopMode: this.queue.loopMode,
        autoDj: this.config.bot.autoDj ?? false
      }
    };
  }
}
