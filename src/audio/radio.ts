import type { Track } from './queue.js';

export interface RadioStation {
  id: string;
  name: string;
  tagline: string;
  genre: string;
  url: string;
  logo: string;
  color?: string;
}

export const RADIO_STATIONS: RadioStation[] = [
  {
    id: '1live',
    name: '1LIVE',
    tagline: 'Das junge Radio des WDR',
    genre: 'Pop / Charts / Dance',
    url: 'https://wdr-1live-live.icecast.wdr.de/wdr/1live/live/mp3/128/stream.mp3',
    logo: '🔥',
    color: '#e30613'
  },
  {
    id: '1livediggi',
    name: '1LIVE diggi',
    tagline: 'Der digitale Trend-Kanal',
    genre: 'Urban / Hip-Hop / Trends',
    url: 'https://wdr-1live-diggi.icecastssl.wdr.de/wdr/1live/diggi/mp3/128/stream.mp3',
    logo: '💎',
    color: '#8b0000'
  },
  {
    id: 'wdr2',
    name: 'WDR 2',
    tagline: 'Der Sender für den Westen',
    genre: 'Pop / Rock / Info',
    url: 'https://wdr-wdr2-rheinland.icecastssl.wdr.de/wdr/wdr2/rheinland/mp3/128/stream.mp3',
    logo: '📻',
    color: '#004f9f'
  },
  {
    id: 'swr3',
    name: 'SWR3',
    tagline: 'Mehr Hits. Mehr Kicks.',
    genre: 'Top 40 / Pop / Comedy',
    url: 'https://liveradio.swr.de/sw282p3/swr3/play.mp3',
    logo: '⚡',
    color: '#002060'
  },
  {
    id: 'bigfm',
    name: 'bigFM',
    tagline: 'Deutschlands Beats & Urban Radio',
    genre: 'Hip-Hop / R&B / Pop',
    url: 'https://stream.bigfm.de/bigfm-deutschland/mp3-128',
    logo: '🎧',
    color: '#ff6600'
  },
  {
    id: 'ndr2',
    name: 'NDR 2',
    tagline: 'Der Sound des Nordens',
    genre: 'Pop / Rock / Hits',
    url: 'https://icecast.ndr.de/ndr/ndr2/niedersachsen/mp3/128/stream.mp3',
    logo: '🌊',
    color: '#002e7a'
  },
  {
    id: 'antenne',
    name: 'Antenne Bayern',
    tagline: 'Bayerns bester Musikmix',
    genre: 'Current Pop / Hits',
    url: 'https://stream.antenne.de/antenne',
    logo: '⭐',
    color: '#f9b000'
  },
  {
    id: 'technobase',
    name: 'TechnoBase.FM',
    tagline: 'We aRe oNe – Electronic Dance Music',
    genre: 'HandsUp / Dance / Techno',
    url: 'https://mp3.stream.tb-group.fm/tb.mp3',
    logo: '🚀',
    color: '#00ffcc'
  },
  {
    id: 'sunshinelive',
    name: 'sunshine live',
    tagline: 'Electronic Music Radio',
    genre: 'Techno / Trance / EDM',
    url: 'https://stream.sunshine-live.de/live/mp3-192',
    logo: '☀️',
    color: '#ffcc00'
  },
  {
    id: 'radiobob',
    name: 'RADIO BOB!',
    tagline: 'Deutschlands Rockradio',
    genre: 'Rock / Hard Rock / Alternative',
    url: 'https://streams.radiobob.de/bob-live/mp3-192/streams.radiobob.de/',
    logo: '🎸',
    color: '#333333'
  },
  {
    id: 'rockantenne',
    name: 'ROCK ANTENNE',
    tagline: 'Der beste Rock nonstop',
    genre: 'Classic & Modern Rock',
    url: 'https://stream.rockantenne.de/rockantenne/stream/mp3',
    logo: '⚡',
    color: '#d60000'
  },
  {
    id: '80s80s',
    name: '80s80s',
    tagline: 'Real 80s – Die echten Achtziger',
    genre: '80er Jahre Kult & Synthwave',
    url: 'https://streams.80s80s.de/80s80s/mp3-192/',
    logo: '📼',
    color: '#e6007e'
  },
  {
    id: 'kissfm',
    name: '98.8 KISS FM',
    tagline: 'The Beat of Berlin',
    genre: 'Urban / R&B / Dance',
    url: 'https://stream.kissfm.de/kissfm/mp3-128/stream.mp3',
    logo: '💋',
    color: '#e50043'
  },
  {
    id: 'iloveradio',
    name: 'I Love Radio',
    tagline: 'Die besten aktuellen Hits im Loop',
    genre: 'Charts / Top 100',
    url: 'https://streams.ilovemusic.de/iloveradio1.mp3',
    logo: '❤️',
    color: '#ff3366'
  },
  {
    id: 'ilovehardstyle',
    name: 'I Love Hardstyle',
    tagline: 'Harder Styles 24/7',
    genre: 'Hardstyle / Rawstyle / Hardcore',
    url: 'https://streams.ilovemusic.de/iloveradio10.mp3',
    logo: '🔨',
    color: '#ff2200'
  }
];

export function findRadioStation(query: string): RadioStation | undefined {
  const clean = query.trim().toLowerCase().replace(/^radio\s+/i, '').replace(/^!radio\s+/i, '');
  if (!clean) return undefined;

  // 1. Exakter ID-Match
  const byId = RADIO_STATIONS.find(s => s.id === clean);
  if (byId) return byId;

  // 2. Namens- oder ID-Präfix / Normalisierung
  const normalized = clean.replace(/[^a-z0-9]/g, '');
  const byNorm = RADIO_STATIONS.find(s => s.id.replace(/[^a-z0-9]/g, '') === normalized || s.name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized);
  if (byNorm) return byNorm;

  // 3. Teilübereinstimmung
  return RADIO_STATIONS.find(s =>
    s.id.includes(clean) ||
    s.name.toLowerCase().includes(clean) ||
    s.genre.toLowerCase().includes(clean)
  );
}

export function radioStationToTrack(station: RadioStation, requestedBy: string = 'Radio'): Track {
  return {
    id: `radio:${station.id}`,
    title: `📻 ${station.name} (${station.genre})`,
    url: station.url,
    durationSec: 0, // 0 = Live Stream / Endlos
    thumbnail: '',
    requestedBy,
    isStream: true
  };
}
