import fs from 'node:fs';
import path from 'node:path';
import { Client, generateIdentitySync, parseIdentity, type Identity } from '@honeybbq/teamspeak/client';
import { escape, Codec, ClientStatus } from '@honeybbq/teamspeak';
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

  constructor(
    private readonly config: BotConfig,
    private readonly dataDir: string = './data'
  ) {
    this.queue = new MusicQueue();
    this.resolver = new AudioResolver(config.audio.ytdlpPath);

    // Initialisiert den AudioPlayer mit unserem voiceSender Hook
    this.player = new AudioPlayer(
      (packet: Uint8Array, codec: Codec) => {
        if (this.client?.status === ClientStatus.Connected) {
          try {
            this.client.sendVoice(packet, codec);
          } catch (err) {
            // Voice Buffer Fehler abfangen
          }
        }
      },
      config.audio.ffmpegPath,
      config.audio.ytdlpPath
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
      config.bot.commandPrefix
    );
  }

  async start(): Promise<void> {
    this.identity = this.loadOrGenerateIdentity();
    console.log(`[Bot] TeamSpeak Identity geladen. UID: ${this.identity.uid("sha1")}`);

    const serverAddr = this.config.server.address;
    const nickname = this.config.server.nickname || 'YT Music Bot';

    console.log(`[Bot] Verbinde zu TeamSpeak Server: ${serverAddr}...`);

    this.client = new Client(this.identity, serverAddr, nickname, {
      logger: {
        debug: () => {},
        info: (msg, ...args) => console.log('[TS-Info]', msg, ...args),
        warn: (msg, ...args) => console.warn('[TS-Warn]', msg, ...args),
        error: (msg, ...args) => console.error('[TS-Error]', msg, ...args),
      }
    });

    this.setupEvents();

    try {
      await this.client.connect({ signal: AbortSignal.timeout(25_000) });
      console.log(`[Bot] ✔ Erfolgreich mit TeamSpeak verbunden! Client-ID: ${this.client.clientID}`);

      // Channel beitreten falls konfiguriert
      if (this.config.server.channel) {
        await this.joinChannel(this.config.server.channel, this.config.server.channelPassword);
      }
    } catch (err) {
      console.error('[Bot] Verbindungsfehler:', (err as Error).message);
      throw err;
    }
  }

  private setupEvents(): void {
    if (!this.client) return;

    this.client.on('connected', () => {
      console.log('[Bot] Status: Online');
    });

    this.client.on('disconnected', ({ error, willReconnect }) => {
      console.warn(`[Bot] Verbindung getrennt. Reconnect: ${willReconnect ? 'Ja' : 'Nein'}`, error?.message || '');
      this.player.stop();
    });

    // Chat-Nachrichten verarbeiten
    this.client.on('textMessage', async (msg) => {
      // Ignoriere eigene Nachrichten
      if (msg.invokerID === this.client?.clientID) return;

      console.log(`[Chat] [${msg.invokerName}]: ${msg.message}`);

      const reply = async (text: string) => {
        if (!this.client) return;
        try {
          if (msg.targetMode === 1 /* Private */) {
            await this.client.exec(`sendtextmessage targetmode=1 target=${msg.invokerID} msg=${escape(text)}`);
          } else {
            // Channel Message
            await this.client.exec(`sendtextmessage targetmode=2 msg=${escape(text)}`);
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
        await this.client.exec(`sendtextmessage targetmode=2 msg=${escape(text)}`);
      } catch (err) {
        // Ignorieren falls keine Channel-Schreibrechte
      }
    }
  }

  private async joinChannel(channelTarget: string, password?: string): Promise<void> {
    if (!this.client) return;
    try {
      // Channels abfragen
      const res = await this.client.exec('channellist');
      let targetCid: string | undefined;

      for (const ch of res) {
        if (ch['channel_name']?.toLowerCase() === channelTarget.toLowerCase() || ch['cid'] === channelTarget) {
          targetCid = ch['cid'];
          break;
        }
      }

      if (targetCid) {
        const pwParam = password ? ` channel_password=${escape(password)}` : '';
        await this.client.exec(`clientmove cid=${targetCid} clid=${this.client.clientID}${pwParam}`);
        console.log(`[Bot] In Channel #${targetCid} gewechselt.`);
      } else {
        console.warn(`[Bot] Konnte Zielchannel "${channelTarget}" nicht finden.`);
      }
    } catch (err) {
      console.warn('[Bot] Fehler beim Wechseln in Channel:', (err as Error).message);
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
      botName: this.config.server.nickname,
      server: this.config.server.address,
      uid: this.identity?.uid("sha1"),
      player: {
        isPlaying: this.player.isPlaying,
        isPaused: this.player.isPaused,
        volume: this.player.volume,
        positionSec: this.player.positionSec,
        currentTrack: this.player.currentTrack
      },
      queue: {
        items: this.queue.getItems(),
        loopMode: this.queue.loopMode
      }
    };
  }
}
