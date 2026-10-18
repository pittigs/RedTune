import type { AudioPlayer } from '../audio/player.js';
import type { MusicQueue } from '../audio/queue.js';
import type { AudioResolver } from '../audio/resolver.js';
import type { AudioFilterPreset } from '../config.js';
import { RADIO_STATIONS, findRadioStation, radioStationToTrack } from '../audio/radio.js';

export interface CommandContext {
  senderUID: string;
  senderName: string;
  channelId: bigint;
  reply: (text: string) => Promise<void>;
}

export class CommandHandler {
  private voteSkips = new Set<string>();

  constructor(
    private readonly player: AudioPlayer,
    private readonly queue: MusicQueue,
    private readonly resolver: AudioResolver,
    private readonly prefix: string = '!',
    public onJoinChannel?: (channel: string) => Promise<boolean>,
    public getChannelUserCount?: () => Promise<number>
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
          await ctx.reply('[b]⏸ Wiedergabe pausiert.[/b]');
          break;

        case 'resume':
        case 'unpause':
          this.player.resume();
          await ctx.reply('[b]▶ Wiedergabe fortgesetzt.[/b]');
          break;

        case 'skip':
        case 'next':
        case 's':
          await this.cmdSkip(ctx);
          break;

        case 'voteskip':
        case 'vs':
          await this.cmdVoteSkip(ctx);
          break;

        case 'prev':
        case 'previous':
          await this.cmdPrevious(ctx);
          break;

        case 'stop':
          this.queue.clear();
          this.player.stop();
          this.voteSkips.clear();
          await ctx.reply('[b]⏹ Wiedergabe gestoppt und Warteschlange geleert.[/b]');
          break;

        case 'seek':
          await this.cmdSeek(argText, ctx);
          break;

        case 'filter':
        case 'fx':
        case 'bassboost':
        case 'nightcore':
          await this.cmdFilter(cmd, argText, ctx);
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

        case 'remove':
        case 'rm':
        case 'del':
          await this.cmdRemove(argText, ctx);
          break;

        case 'np':
        case 'nowplaying':
        case 'song':
          await this.cmdNowPlaying(ctx);
          break;

        case 'shuffle':
          this.queue.shuffle();
          await ctx.reply('[b]🔀 Warteschlange gemischt.[/b]');
          break;

        case 'loop':
          await this.cmdLoop(argText, ctx);
          break;

        case 'clear':
          this.queue.clear();
          await ctx.reply('[b]🗑 Warteschlange wurde geleert.[/b]');
          break;

        case 'search':
        case 'find':
          await this.cmdSearch(argText, ctx);
          break;

        case 'soundboard':
        case 'sb':
        case 'airhorn':
        case 'applause':
        case 'notification':
        case 'rimshot':
          await this.cmdSoundboard(cmd, argText, ctx);
          break;

        case 'radio':
        case 'radios':
          await this.cmdRadio(argText, ctx);
          break;

        case 'local':
        case 'upload':
        case 'uploads':
        case 'files':
          await this.cmdLocal(argText, ctx);
          break;

        case 'join':
        case 'move':
        case 'channel':
          if (!argText) {
            await ctx.reply(`ℹ Bitte gib den Channel-Namen an: [code]${this.prefix}join <Channel-Name>[/code]`);
            return;
          }
          if (this.onJoinChannel) {
            const ok = await this.onJoinChannel(argText);
            if (ok) {
              await ctx.reply(`✔ In Channel [b]"${argText}"[/b] gewechselt.`);
            } else {
              await ctx.reply(`❌ Konnte Channel [b]"${argText}"[/b] nicht finden oder beitreten.`);
            }
          }
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
        await ctx.reply('[b]▶ Wiedergabe fortgesetzt.[/b]');
        return;
      }
      await ctx.reply(`ℹ Bitte gib einen Songtitel oder YouTube / YouTube Music Link an: [code]${this.prefix}play <Titel/Link>[/code]`);
      return;
    }

    await ctx.reply(`🔍 Suche nach: [b]"${query}"[/b]...`);
    const tracks = await this.resolver.resolve(query, ctx.senderName);

    if (tracks.length === 0) {
      await ctx.reply('❌ Kein passender Titel gefunden.');
      return;
    }

    this.voteSkips.clear();

    if (tracks.length === 1) {
      const track = tracks[0];
      if (!this.player.isPlaying) {
        this.queue.setCurrent(track);
        await this.player.play(track);
        await ctx.reply(`🎶 Spiele jetzt: [b]${track.title}[/b] (${this.formatDuration(track.durationSec)})`);
      } else {
        this.queue.add(track);
        await ctx.reply(`➕ Zur Warteschlange hinzugefügt: [b]${track.title}[/b] (Position: #${this.queue.size()})`);
      }
    } else {
      if (!this.player.isPlaying) {
        const first = tracks[0];
        const rest = tracks.slice(1);
        this.queue.setCurrent(first);
        this.queue.addMultiple(rest);
        await this.player.play(first);
        await ctx.reply(`📑 Playlist hinzugefügt (${tracks.length} Titel). Spiele jetzt: [b]${first.title}[/b]`);
      } else {
        this.queue.addMultiple(tracks);
        await ctx.reply(`📑 [b]${tracks.length} Titel[/b] zur Warteschlange hinzugefügt!`);
      }
    }
  }

  private async cmdSkip(ctx: CommandContext): Promise<void> {
    this.voteSkips.clear();
    const next = this.queue.next();
    if (next) {
      await this.player.play(next);
      await ctx.reply(`⏭ Übersprungen. Spiele jetzt: [b]${next.title}[/b]`);
    } else {
      this.player.stop();
      await ctx.reply('⏭ Keine weiteren Titel in der Warteschlange.');
    }
  }

  private async cmdVoteSkip(ctx: CommandContext): Promise<void> {
    if (!this.player.isPlaying || !this.player.currentTrack) {
      await ctx.reply('ℹ Es läuft momentan keine Musik.');
      return;
    }

    this.voteSkips.add(ctx.senderUID);
    const usersInChannel = this.getChannelUserCount ? await this.getChannelUserCount() : 2;
    const needed = Math.max(1, Math.ceil((usersInChannel - 1) * 0.5)); // 50% ohne Bot

    if (this.voteSkips.size >= needed) {
      this.voteSkips.clear();
      const next = this.queue.next();
      if (next) {
        await this.player.play(next);
        await ctx.reply(`🗳 [b]Vote-Skip erfolgreich![/b] Spiele jetzt: [b]${next.title}[/b]`);
      } else {
        this.player.stop();
        await ctx.reply('🗳 [b]Vote-Skip erfolgreich![/b] Warteschlange ist leer.');
      }
    } else {
      await ctx.reply(`🗳 Vote-Skip registriert: [b]${this.voteSkips.size}/${needed}[/b] Stimmen.`);
    }
  }

  private async cmdPrevious(ctx: CommandContext): Promise<void> {
    this.voteSkips.clear();
    const prev = this.queue.previous();
    if (prev) {
      await this.player.play(prev);
      await ctx.reply(`⏮ Gehe zurück zu: [b]${prev.title}[/b]`);
    } else {
      await ctx.reply('ℹ Kein vorheriger Titel in der Historie vorhanden.');
    }
  }

  private async cmdSeek(arg: string, ctx: CommandContext): Promise<void> {
    if (!this.player.isPlaying || !this.player.currentTrack) {
      await ctx.reply('ℹ Es läuft momentan keine Musik.');
      return;
    }

    if (!arg) {
      await ctx.reply(`ℹ Bitte gib die Zielzeit an: [code]${this.prefix}seek 1:30[/code] oder [code]${this.prefix}seek 90[/code]`);
      return;
    }

    let targetSec = 0;
    if (arg.includes(':')) {
      const parts = arg.split(':').map(p => parseInt(p, 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        targetSec = parts[0] * 60 + parts[1];
      }
    } else {
      targetSec = parseInt(arg, 10);
    }

    if (isNaN(targetSec) || targetSec < 0) {
      await ctx.reply('❌ Ungültige Zeitangabe.');
      return;
    }

    await this.player.seek(targetSec);
    await ctx.reply(`⏩ Gespult zu: [b]${this.formatDuration(targetSec)}[/b]`);
  }

  private async cmdFilter(cmd: string, arg: string, ctx: CommandContext): Promise<void> {
    let preset: AudioFilterPreset = 'normal';
    if (cmd === 'bassboost') preset = 'bassboost';
    else if (cmd === 'nightcore') preset = 'nightcore';
    else if (arg === 'bassboost' || arg === 'nightcore' || arg === 'vaporwave' || arg === 'loudnorm' || arg === 'normal') {
      preset = arg as AudioFilterPreset;
    } else {
      await ctx.reply(`ℹ Verfügbare Filter: [code]normal[/code], [code]bassboost[/code], [code]nightcore[/code], [code]vaporwave[/code], [code]loudnorm[/code]`);
      return;
    }

    this.player.setFilter(preset);
    await ctx.reply(`🎛 Audio-Filter aktiviert: [b]${preset}[/b]`);
  }

  private async cmdVolume(arg: string, ctx: CommandContext): Promise<void> {
    if (!arg) {
      await ctx.reply(`🔊 Aktuelle Lautstärke: [b]${this.player.volume}%[/b]`);
      return;
    }
    const val = parseInt(arg, 10);
    if (isNaN(val) || val < 0 || val > 100) {
      await ctx.reply(`ℹ Bitte gib eine Zahl zwischen 0 und 100 an (z. B. [code]${this.prefix}volume 40[/code]).`);
      return;
    }
    this.player.setVolume(val);
    await ctx.reply(`🔊 Lautstärke auf [b]${val}%[/b] gesetzt.`);
  }

  private async cmdQueue(ctx: CommandContext): Promise<void> {
    const current = this.player.currentTrack;
    const items = this.queue.getItems();

    if (!current && items.length === 0) {
      await ctx.reply('ℹ Die Warteschlange ist aktuell leer.');
      return;
    }

    let msg = '[b]📜 Aktuelle Warteschlange:[/b]\n';
    if (current) {
      msg += `▶ [b]Aktuell:[/b] ${current.title} (${this.formatDuration(this.player.positionSec)} / ${this.formatDuration(current.durationSec)})\n`;
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

  private async cmdRemove(arg: string, ctx: CommandContext): Promise<void> {
    const idx = parseInt(arg, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= this.queue.size()) {
      await ctx.reply(`ℹ Bitte gib eine gültige Nummer an: [code]${this.prefix}remove <Nummer>[/code]`);
      return;
    }
    const removed = this.queue.remove(idx);
    if (removed) {
      await ctx.reply(`🗑 Track #${idx + 1} aus der Warteschlange entfernt.`);
    }
  }

  private async cmdNowPlaying(ctx: CommandContext): Promise<void> {
    const current = this.player.currentTrack;
    if (!current) {
      await ctx.reply('ℹ Es läuft momentan keine Musik.');
      return;
    }

    const cur = this.player.positionSec;
    const total = current.durationSec || 1;
    const percent = Math.min(100, Math.max(0, Math.round((cur / total) * 100)));
    const totalBars = 16;
    const filledBars = Math.round((percent / 100) * totalBars);
    const bar = '█'.repeat(filledBars) + '░'.repeat(totalBars - filledBars);

    await ctx.reply(
      `🎶 [b]Aktueller Titel:[/b] ${current.title}\n` +
      `[color=#e50914][b]${bar}[/b][/color] ${this.formatDuration(cur)} / ${this.formatDuration(total)} (${percent}%)\n` +
      `👤 Angeforder von: [b]${current.requestedBy}[/b] | Filter: [b]${this.player.activeFilter}[/b]\n` +
      `🔗 [url=${current.url}]Auf YouTube öffnen[/url]`
    );
  }

  private async cmdLoop(modeArg: string, ctx: CommandContext): Promise<void> {
    const mode = modeArg.toLowerCase();
    if (mode === 'track' || mode === 'song') {
      this.queue.loopMode = 'track';
      await ctx.reply('🔂 [b]Loop-Modus:[/b] Aktueller Titel wird wiederholt.');
    } else if (mode === 'queue' || mode === 'all') {
      this.queue.loopMode = 'queue';
      await ctx.reply('🔁 [b]Loop-Modus:[/b] Gesamte Warteschlange wird wiederholt.');
    } else {
      this.queue.loopMode = 'off';
      await ctx.reply('➡ [b]Loop-Modus:[/b] Ausgeschaltet.');
    }
  }

  private async cmdSearch(query: string, ctx: CommandContext): Promise<void> {
    if (!query) {
      await ctx.reply(`ℹ Bitte gib einen Suchbegriff an: [code]${this.prefix}search <Titel>[/code]`);
      return;
    }
    await ctx.reply(`🔍 Suche nach Top-Ergebnissen für: [b]"${query}"[/b]...`);
    const results = await this.resolver.search(query, 5, ctx.senderName);
    if (results.length === 0) {
      await ctx.reply('❌ Keine Treffer gefunden.');
      return;
    }

    let msg = '[b]🔎 Suchergebnisse:[/b]\n';
    results.forEach((r, i) => {
      msg += `[b]${i + 1}.[/b] ${r.title} (${this.formatDuration(r.durationSec)})\n`;
    });
    msg += `Tipp: Spiele den gewünschten Titel mit [code]${this.prefix}play <Titel>[/code] ab.`;
    await ctx.reply(msg);
  }

  private async cmdSoundboard(cmd: string, arg: string, ctx: CommandContext): Promise<void> {
    let effect: 'airhorn' | 'applause' | 'notification' | 'rimshot' = 'airhorn';
    if (cmd === 'applause') effect = 'applause';
    else if (cmd === 'notification') effect = 'notification';
    else if (cmd === 'rimshot') effect = 'rimshot';
    else if (arg === 'applause' || arg === 'notification' || arg === 'rimshot') effect = arg as any;

    this.player.playSoundEffect(effect);
    await ctx.reply(`📢 Soundboard: [b]${effect}[/b] abgespielt!`);
  }

  private async cmdRadio(stationName: string, ctx: CommandContext): Promise<void> {
    if (!stationName) {
      let list = '📻 [b]Verfügbare Internet-Radiosender:[/b]\n';
      RADIO_STATIONS.forEach(s => {
        list += `• [b]${s.name}[/b] ([code]${this.prefix}radio ${s.id}[/code]) - ${s.genre}\n`;
      });
      list += `Tipp: Du kannst auch direkt [code]${this.prefix}play 1live[/code] oder [code]${this.prefix}radio swr3[/code] eingeben!`;
      await ctx.reply(list);
      return;
    }

    const station = findRadioStation(stationName);
    if (!station) {
      await ctx.reply(`❌ Radiosender [b]"${stationName}"[/b] nicht gefunden. Nutze [code]${this.prefix}radio[/code] für eine Liste.`);
      return;
    }

    const track = radioStationToTrack(station, ctx.senderName);
    this.voteSkips.clear();

    this.queue.setCurrent(track);
    await this.player.play(track);
    await ctx.reply(`📻 Spiele jetzt live: [b]${station.name}[/b] (${station.tagline})`);
  }

  private async cmdLocal(arg: string, ctx: CommandContext): Promise<void> {
    const localManager = this.resolver.localFiles;
    if (!arg) {
      const files = localManager.listFiles();
      if (files.length === 0) {
        await ctx.reply('📁 Keine lokalen Lieder hochgeladen. Nutze das Web-Dashboard zum Hochladen von MP3s/Audio-Dateien!');
        return;
      }
      let list = '📁 [b]Hochgeladene eigene Lieder:[/b]\n';
      files.slice(0, 10).forEach((f, i) => {
        const sizeMb = (f.sizeBytes / (1024 * 1024)).toFixed(1);
        list += `• [b]${i + 1}. ${f.title}[/b] (${sizeMb} MB) -> [code]${this.prefix}play local:${f.filename}[/code]\n`;
      });
      if (files.length > 10) {
        list += `... und ${files.length - 10} weitere im Web-Dashboard.`;
      }
      await ctx.reply(list);
      return;
    }

    const match = localManager.findFile(arg);
    if (!match) {
      await ctx.reply(`❌ Lokale Datei [b]"${arg}"[/b] nicht gefunden. Nutze [code]${this.prefix}local[/code] für die Liste.`);
      return;
    }

    const track = localManager.entryToTrack(match, ctx.senderName);
    this.voteSkips.clear();

    this.queue.setCurrent(track);
    await this.player.play(track);
    await ctx.reply(`🎶 Spiele jetzt eigene Datei: [b]${match.title}[/b]`);
  }

  private async cmdHelp(ctx: CommandContext): Promise<void> {
    const p = this.prefix;
    await ctx.reply(
      `🎵 [b]RedTune – TeamSpeak 6 & 3 YouTube & Radio Music Bot[/b]\n` +
      `• [b]${p}play <Titel/Link/Radio>[/b] ([b]${p}p[/b]) - Musik oder Radio abspielen\n` +
      `• [b]${p}radio [Sender][/b] - Internet-Radiosender (1LIVE, SWR3, TechnoBase etc.)\n` +
      `• [b]${p}local [Name][/b] - Eigene hochgeladene Lieder auflisten / abspielen\n` +
      `• [b]${p}pause[/b] / [b]${p}resume[/b] - Musik anhalten / fortsetzen\n` +
      `• [b]${p}skip[/b] ([b]${p}s[/b]) / [b]${p}voteskip[/b] - Nächster Song / Vote-Skip\n` +
      `• [b]${p}seek <mm:ss>[/b] - Zu Zeitstempel springen\n` +
      `• [b]${p}filter <normal|bassboost|nightcore|vaporwave|loudnorm>[/b] - Audioeffekt\n` +
      `• [b]${p}np[/b] - Zeigt Now Playing mit Fortschrittsbalken\n` +
      `• [b]${p}queue[/b] ([b]${p}q[/b]) - Zeigt die Warteschlange\n` +
      `• [b]${p}volume <0-100>[/b] - Lautstärke anpassen\n` +
      `• [b]${p}shuffle[/b] - Warteschlange mischen\n` +
      `• [b]${p}loop <off|track|queue>[/b] - Wiederholungsmodus\n` +
      `• [b]${p}airhorn[/b] / [b]${p}applause[/b] - Soundboard-Effekte\n` +
      `• [b]${p}join <Channel>[/b] - Bot in Channel bewegen`
    );
  }

  private formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }
}
