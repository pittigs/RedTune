import type { AudioPlayer } from '../audio/player.js';
import type { MusicQueue } from '../audio/queue.js';
import type { AudioResolver } from '../audio/resolver.js';

export interface CommandContext {
  senderUID: string;
  senderName: string;
  channelId: bigint;
  reply: (text: string) => Promise<void>;
}

export class CommandHandler {
  constructor(
    private readonly player: AudioPlayer,
    private readonly queue: MusicQueue,
    private readonly resolver: AudioResolver,
    private readonly prefix: string = '!'
  ) {}

  async handle(rawMessage: string, ctx: CommandContext): Promise<void> {
    const trimmed = rawMessage.trim();
    if (!trimmed.startsWith(this.prefix)) return;

    const withoutPrefix = trimmed.slice(this.prefix.length).trim();
    const [command, ...args] = withoutPrefix.split(/\s+/);
    const cmd = command.toLowerCase();
    const argText = args.join(' ').trim();

    try {
      switch (cmd) {
        case 'play':
        case 'p':
          await this.cmdPlay(argText, ctx);
          break;

        case 'pause':
          this.player.pause();
          await ctx.reply('⏸ Wiedergabe pausiert.');
          break;

        case 'resume':
        case 'unpause':
          this.player.resume();
          await ctx.reply('▶ Wiedergabe fortgesetzt.');
          break;

        case 'skip':
        case 'next':
        case 's':
          await this.cmdSkip(ctx);
          break;

        case 'prev':
        case 'previous':
          await this.cmdPrevious(ctx);
          break;

        case 'stop':
          this.queue.clear();
          this.player.stop();
          await ctx.reply('⏹ Wiedergabe gestoppt und Warteschlange geleert.');
          break;

        case 'volume':
        case 'vol':
        case 'v':
          await this.cmdVolume(argText, ctx);
          break;

        case 'queue':
        case 'q':
        case 'list':
          await this.cmdQueue(ctx);
          break;

        case 'np':
        case 'nowplaying':
        case 'song':
          await this.cmdNowPlaying(ctx);
          break;

        case 'shuffle':
          this.queue.shuffle();
          await ctx.reply('🔀 Warteschlange gemischt.');
          break;

        case 'loop':
          await this.cmdLoop(argText, ctx);
          break;

        case 'clear':
          this.queue.clear();
          await ctx.reply('🗑 Warteschlange wurde geleert.');
          break;

        case 'help':
        case 'h':
        case 'commands':
          await this.cmdHelp(ctx);
          break;

        default:
          break;
      }
    } catch (err) {
      console.error('[Commands] Fehler bei Befehlsausführung:', cmd, err);
      await ctx.reply(`❌ Fehler: ${(err as Error).message}`);
    }
  }

  private async cmdPlay(query: string, ctx: CommandContext): Promise<void> {
    if (!query) {
      if (this.player.isPaused) {
        this.player.resume();
        await ctx.reply('▶ Wiedergabe fortgesetzt.');
        return;
      }
      await ctx.reply('ℹ Bitte gib einen Songtitel oder YouTube / YouTube Music Link an: `!play <Titel/Link>`');
      return;
    }

    await ctx.reply(`🔍 Suche nach: "${query}"...`);
    const tracks = await this.resolver.resolve(query, ctx.senderName);

    if (tracks.length === 0) {
      await ctx.reply('❌ Kein passender Titel gefunden.');
      return;
    }

    if (tracks.length === 1) {
      const track = tracks[0];
      if (!this.player.isPlaying) {
        this.queue.setCurrent(track);
        await this.player.play(track);
        await ctx.reply(`🎶 Spiele jetzt: **${track.title}** (${this.formatDuration(track.durationSec)})`);
      } else {
        this.queue.add(track);
        await ctx.reply(`➕ Zur Warteschlange hinzugefügt: **${track.title}** (Position: #${this.queue.size()})`);
      }
    } else {
      // Playlist mit mehreren Titeln
      if (!this.player.isPlaying) {
        const first = tracks[0];
        const rest = tracks.slice(1);
        this.queue.setCurrent(first);
        this.queue.addMultiple(rest);
        await this.player.play(first);
        await ctx.reply(`📑 Playlist hinzugefügt (${tracks.length} Titel). Spiele jetzt: **${first.title}**`);
      } else {
        this.queue.addMultiple(tracks);
        await ctx.reply(`📑 ${tracks.length} Titel zur Warteschlange hinzugefügt!`);
      }
    }
  }

  private async cmdSkip(ctx: CommandContext): Promise<void> {
    const next = this.queue.next();
    if (next) {
      await this.player.play(next);
      await ctx.reply(`⏭ Übersprungen. Spiele jetzt: **${next.title}**`);
    } else {
      this.player.stop();
      await ctx.reply('⏭ Keine weiteren Titel in der Warteschlange.');
    }
  }

  private async cmdPrevious(ctx: CommandContext): Promise<void> {
    const prev = this.queue.previous();
    if (prev) {
      await this.player.play(prev);
      await ctx.reply(`⏮ Gehe zurück zu: **${prev.title}**`);
    } else {
      await ctx.reply('ℹ Kein vorheriger Titel in der Historie vorhanden.');
    }
  }

  private async cmdVolume(arg: string, ctx: CommandContext): Promise<void> {
    if (!arg) {
      await ctx.reply(`🔊 Aktuelle Lautstärke: ${this.player.volume}%`);
      return;
    }
    const val = parseInt(arg, 10);
    if (isNaN(val) || val < 0 || val > 100) {
      await ctx.reply('ℹ Bitte gib eine Zahl zwischen 0 und 100 an (z. B. `!volume 40`).');
      return;
    }
    this.player.setVolume(val);
    await ctx.reply(`🔊 Lautstärke auf ${val}% gesetzt.`);
  }

  private async cmdQueue(ctx: CommandContext): Promise<void> {
    const current = this.player.currentTrack;
    const items = this.queue.getItems();

    if (!current && items.length === 0) {
      await ctx.reply('ℹ Die Warteschlange ist aktuell leer.');
      return;
    }

    let msg = '📜 **Aktuelle Warteschlange:**\n';
    if (current) {
      msg += `▶ **Aktuell:** ${current.title} (${this.formatDuration(this.player.positionSec)} / ${this.formatDuration(current.durationSec)})\n`;
    }

    if (items.length > 0) {
      const topItems = items.slice(0, 10);
      topItems.forEach((t, i) => {
        msg += `${i + 1}. ${t.title} [angefordert von ${t.requestedBy}]\n`;
      });
      if (items.length > 10) {
        msg += `... und ${items.length - 10} weitere Titel.`;
      }
    }

    await ctx.reply(msg);
  }

  private async cmdNowPlaying(ctx: CommandContext): Promise<void> {
    const current = this.player.currentTrack;
    if (!current) {
      await ctx.reply('ℹ Es läuft momentan keine Musik.');
      return;
    }
    await ctx.reply(
      `🎶 **Aktueller Titel:** ${current.title}\n` +
      `⏱ Fortschritt: ${this.formatDuration(this.player.positionSec)} / ${this.formatDuration(current.durationSec)}\n` +
      `👤 Angeforder von: ${current.requestedBy}\n` +
      `🔗 Link: ${current.url}`
    );
  }

  private async cmdLoop(modeArg: string, ctx: CommandContext): Promise<void> {
    const mode = modeArg.toLowerCase();
    if (mode === 'track' || mode === 'song') {
      this.queue.loopMode = 'track';
      await ctx.reply('🔂 Loop-Modus: Aktueller Titel wird wiederholt.');
    } else if (mode === 'queue' || mode === 'all') {
      this.queue.loopMode = 'queue';
      await ctx.reply('🔁 Loop-Modus: Gesamte Warteschlange wird wiederholt.');
    } else {
      this.queue.loopMode = 'off';
      await ctx.reply('➡ Loop-Modus: Ausgeschaltet.');
    }
  }

  private async cmdHelp(ctx: CommandContext): Promise<void> {
    const p = this.prefix;
    await ctx.reply(
      `🎵 **TeamSpeak YouTube Music Bot Befehle:**\n` +
      `• \`${p}play <Titel/Link>\` - Musik suchen oder YouTube Music Link abspielen\n` +
      `• \`${p}pause\` / \`${p}resume\` - Musik anhalten / weiterspielen\n` +
      `• \`${p}skip\` / \`${p}prev\` - Nächster / Vorheriger Song\n` +
      `• \`${p}stop\` - Musik anhalten und Liste leeren\n` +
      `• \`${p}volume <0-100>\` - Lautstärke anpassen\n` +
      `• \`${p}queue\` - Warteschlange anzeigen\n` +
      `• \`${p}np\` - Details zum aktuellen Song\n` +
      `• \`${p}shuffle\` - Warteschlange mischen\n` +
      `• \`${p}loop <off|track|queue>\` - Wiederholungsmodus\n` +
      `• \`${p}clear\` - Warteschlange leeren`
    );
  }

  private formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }
}
