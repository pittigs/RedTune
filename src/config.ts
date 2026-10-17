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
    nickname: 'YT Music Bot',
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
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    return DEFAULT_CONFIG;
  }

  try {
    const raw = fs.readFileSync(resolved, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      server: { ...DEFAULT_CONFIG.server, ...parsed.server },
      audio: { ...DEFAULT_CONFIG.audio, ...parsed.audio },
      web: { ...DEFAULT_CONFIG.web, ...parsed.web },
      bot: { ...DEFAULT_CONFIG.bot, ...parsed.bot }
    };
  } catch (err) {
    console.error(`[Config] Fehler beim Lesen von ${resolved}:`, err);
    return DEFAULT_CONFIG;
  }
}
