import fs from 'node:fs';
import path from 'node:path';

export type AudioFilterPreset = 'normal' | 'bassboost' | 'nightcore' | 'vaporwave' | 'loudnorm';

export interface BotConfig {
  server: {
    address: string;
    password?: string;
    nickname: string;
    channel?: string;
    channelPassword?: string;
    autoUpgradeCodec?: boolean; // Setzt Channel auf Opus Music (5) Quality 10
    autoNickname?: boolean; // Bot benennt sich um: "RedTune | ▶ Titel"
    autoPauseAlone?: boolean; // Pausiert automatisch, wenn Bot alleine im Channel ist
  };
  audio: {
    defaultVolume: number;
    ffmpegPath: string;
    ytdlpPath: string;
    filter?: AudioFilterPreset;
    loudnorm?: boolean; // EBU R128 Lautstärke-Normalisierung
    enableCache?: boolean; // Songs lokal auf Festplatte cachen
  };
  web: {
    enabled: boolean;
    port: number;
    password?: string;
  };
  bot: {
    commandPrefix: string;
    adminUids: string[];
    autoDj?: boolean; // Spielt automatisch ähnliche Tracks wenn Queue leerläuft
    voteSkipThreshold?: number; // Anteil an Votes zum Überspringen (z. B. 0.5 = 50%)
  };
}

const DEFAULT_CONFIG: BotConfig = {
  server: {
    address: '127.0.0.1:9987',
    password: '',
    nickname: 'RedTune',
    channel: '',
    channelPassword: '',
    autoUpgradeCodec: true,
    autoNickname: true,
    autoPauseAlone: true
  },
  audio: {
    defaultVolume: 50,
    ffmpegPath: 'ffmpeg',
    ytdlpPath: 'yt-dlp',
    filter: 'normal',
    loudnorm: false,
    enableCache: true
  },
  web: {
    enabled: true,
    port: 58913,
    password: ''
  },
  bot: {
    commandPrefix: '!',
    adminUids: [],
    autoDj: false,
    voteSkipThreshold: 0.5
  }
};

export function loadConfig(configPath: string): BotConfig {
  let cfg: BotConfig = { ...DEFAULT_CONFIG };
  const resolved = path.resolve(configPath);

  if (fs.existsSync(resolved)) {
    try {
      const raw = fs.readFileSync(resolved, 'utf-8');
      const parsed = JSON.parse(raw);
      cfg = {
        server: { ...DEFAULT_CONFIG.server, ...parsed.server },
        audio: { ...DEFAULT_CONFIG.audio, ...parsed.audio },
        web: { ...DEFAULT_CONFIG.web, ...parsed.web },
        bot: { ...DEFAULT_CONFIG.bot, ...parsed.bot }
      };
    } catch (err) {
      console.error(`[Config] Fehler beim Lesen von ${resolved}:`, err);
    }
  } else {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
  }

  // Umgebungsvariablen für Docker / docker-compose.yml
  const envAddr = process.env.TEAMSPEAK_ADDR?.trim();
  if (envAddr && envAddr !== 'ts.deinedomain.de:9987' && envAddr !== 'DEINE_SERVER_IP_ODER_DOMAIN') {
    cfg.server.address = envAddr;
  }
  if (process.env.TEAMSPEAK_PASSWORD) cfg.server.password = process.env.TEAMSPEAK_PASSWORD;
  if (process.env.TEAMSPEAK_NICKNAME) cfg.server.nickname = process.env.TEAMSPEAK_NICKNAME;
  if (process.env.TEAMSPEAK_CHANNEL) cfg.server.channel = process.env.TEAMSPEAK_CHANNEL;
  if (process.env.TEAMSPEAK_CHANNEL_PASSWORD) cfg.server.channelPassword = process.env.TEAMSPEAK_CHANNEL_PASSWORD;
  if (process.env.WEB_PASSWORD) cfg.web.password = process.env.WEB_PASSWORD;

  return cfg;
}

export function saveConfig(configPath: string, cfg: BotConfig): void {
  const resolved = path.resolve(configPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(cfg, null, 2), 'utf-8');
}
