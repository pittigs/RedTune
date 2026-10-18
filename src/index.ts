import path from 'node:path';
import { loadConfig } from './config.js';
import { TeamSpeakBot } from './bot/client.js';
import { startWebServer } from './web/server.js';

async function main() {
  console.log('====================================================');
  console.log('   RedTune – TeamSpeak 6 & 3 YouTube Music Bot     ');
  console.log('====================================================\n');

  const configPath = process.env.BOT_CONFIG || './data/config.json';
  const dataDir = path.dirname(configPath);
  const config = loadConfig(configPath);

  console.log(`[Main] Konfiguration aus ${configPath} geladen.`);

  // Bot-Instanz erstellen
  const bot = new TeamSpeakBot(config, dataDir);

  // Web Dashboard starten falls aktiviert
  if (config.web.enabled) {
    startWebServer(bot, config.web.port);
  }

  // Mit TeamSpeak verbinden mit geordneter Reconnect-Schleife
  const connectLoop = async () => {
    while (true) {
      if (!bot.getStatus().connected && !bot.isConnecting) {
        try {
          console.log('[Main] Verbinde zu TeamSpeak...');
          await bot.start();
        } catch (err) {
          console.error('[Main] Verbindungsversuch fehlgeschlagen:', (err as Error).message);
        }
      }
      const delay = bot.getStatus().connected ? 10_000 : 15_000;
      await new Promise((r) => setTimeout(r, delay));
    }
  };

  connectLoop().catch((err) => {
    console.error('[Main] Fehler in Reconnect-Schleife:', err);
  });

  // Graceful Shutdown
  const shutdown = () => {
    console.log('\n[Main] Beende Bot...');
    bot.player.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Main] Schwerwiegender Fehler:', err);
  process.exit(1);
});
