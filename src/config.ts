import fs from 'node:fs';
import path from 'node:path';

export interface BotConfig {
  server: {
    address: string;
    password?: string;
    nickname: string;
    channel?: string;
    channelPassword?: string;
  };
  audio: {
    defaultVolume: number;
    ffmpegPath: string;
    ytdlpPath: string;
  };
  web: {
    enabled: boolean;
    port: number;
  };
  bot: {
    commandPrefix: string;
    adminUids: string[];
  };
}

const DEFAULT_CONFIG: BotConfig = {
  server: {
    address: '127.0.0.1:9987',
    password: '',
    nickname: 'RedTune',
    channel: '',
    channelPassword: ''
  },
  audio: {
    defaultVolume: 50,
    ffmpegPath: 'ffmpeg',
    ytdlpPath: 'yt-dlp'
  },
  web: {
    enabled: true,
    port: 58913
  },
  bot: {
    commandPrefix: '!',
    adminUids: []
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
  if (process.env.TEAMSPEAK_ADDR) cfg.server.address = process.env.TEAMSPEAK_ADDR;
  if (process.env.TEAMSPEAK_PASSWORD) cfg.server.password = process.env.TEAMSPEAK_PASSWORD;
  if (process.env.TEAMSPEAK_NICKNAME) cfg.server.nickname = process.env.TEAMSPEAK_NICKNAME;
  if (process.env.TEAMSPEAK_CHANNEL) cfg.server.channel = process.env.TEAMSPEAK_CHANNEL;
  if (process.env.TEAMSPEAK_CHANNEL_PASSWORD) cfg.server.channelPassword = process.env.TEAMSPEAK_CHANNEL_PASSWORD;

  return cfg;
}
