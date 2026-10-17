// TeamSpeak 6 YouTube Music Bot Web Dashboard Client

const connectionBadge = document.getElementById('connectionBadge');
const connectionText = document.getElementById('connectionText');
const botStatusText = document.getElementById('botStatusText');
const serverText = document.getElementById('serverText');

const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');

const trackTitle = document.getElementById('trackTitle');
const trackMeta = document.getElementById('trackMeta');
const trackThumbnail = document.getElementById('trackThumbnail');
const albumArtPlaceholder = document.getElementById('albumArtPlaceholder');

const progressBarFill = document.getElementById('progressBarFill');
const currentTime = document.getElementById('currentTime');
const totalTime = document.getElementById('totalTime');

const playPauseBtn = document.getElementById('playPauseBtn');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const stopBtn = document.getElementById('stopBtn');

const volumeSlider = document.getElementById('volumeSlider');
const volumeValue = document.getElementById('volumeValue');

const queueCount = document.getElementById('queueCount');
const queueList = document.getElementById('queueList');
const shuffleBtn = document.getElementById('shuffleBtn');
const clearQueueBtn = document.getElementById('clearQueueBtn');

let currentStatus = null;
let ws = null;

// Initialisierung
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Verbunden mit Dashboard Server');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'status') {
        renderStatus(msg.data);
      }
    } catch (e) {
      console.error('[WS] Parse-Fehler:', e);
    }
  };

  ws.onclose = () => {
    console.log('[WS] Verbindung verloren, versuche Reconnect in 2s...');
    setTimeout(initWebSocket, 2000);
  };
}

// Initialer Status per REST holen
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    renderStatus(data);
  } catch (err) {
    console.error('[API] Status-Fehler:', err);
  }
}

// UI Rendern
function renderStatus(status) {
  currentStatus = status;

  // Verbindungs-Badge
  if (status.connected) {
    connectionBadge.classList.add('connected');
    connectionText.textContent = 'Online';
    botStatusText.textContent = `${status.botName} ist auf TeamSpeak aktiv`;
  } else {
    connectionBadge.classList.remove('connected');
    connectionText.textContent = 'Offline';
    botStatusText.textContent = 'Nicht mit TeamSpeak verbunden';
  }

  serverText.textContent = status.server || 'Server';

  // Player Details
  const player = status.player;
  if (player && player.currentTrack) {
    trackTitle.textContent = player.currentTrack.title;
    trackMeta.textContent = `Angefordert von ${player.currentTrack.requestedBy}`;

    if (player.currentTrack.thumbnail) {
      trackThumbnail.src = player.currentTrack.thumbnail;
      trackThumbnail.classList.remove('hidden');
      albumArtPlaceholder.classList.add('hidden');
    } else {
      trackThumbnail.classList.add('hidden');
      albumArtPlaceholder.classList.remove('hidden');
    }

    // Fortschrittsbalken
    const curSec = player.positionSec || 0;
    const durSec = player.currentTrack.durationSec || 0;
    currentTime.textContent = formatTime(curSec);
    totalTime.textContent = formatTime(durSec);

    const percent = durSec > 0 ? Math.min(100, (curSec / durSec) * 100) : 0;
    progressBarFill.style.width = `${percent}%`;

    // Play/Pause Icon
    if (player.isPlaying && !player.isPaused) {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
    } else {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
    }
  } else {
    trackTitle.textContent = 'Keine Wiedergabe';
    trackMeta.textContent = 'Füge Musik über die Suche oder TeamSpeak hinzu';
    trackThumbnail.classList.add('hidden');
    albumArtPlaceholder.classList.remove('hidden');
    progressBarFill.style.width = '0%';
    currentTime.textContent = '00:00';
    totalTime.textContent = '00:00';
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
  }

  // Lautstärke
  if (player && typeof player.volume === 'number') {
    volumeSlider.value = player.volume;
    volumeValue.textContent = `${player.volume}%`;
  }

  // Warteschlange
  renderQueue(status.queue?.items || []);
}

function renderQueue(items) {
  queueCount.textContent = `${items.length} ${items.length === 1 ? 'Titel' : 'Titel'}`;

  if (items.length === 0) {
    queueList.innerHTML = `
      <div class="empty-state">
        <p>Die Warteschlange ist leer.</p>
        <span>Verwende die Suche oben oder nutze <code>!play</code> im TeamSpeak-Chat.</span>
      </div>
    `;
    return;
  }

  queueList.innerHTML = items.map((item, idx) => `
    <div class="queue-item" data-index="${idx}">
      <span class="queue-item-idx">#${idx + 1}</span>
      <div class="queue-item-info">
        <div class="queue-item-title">${escapeHtml(item.title)}</div>
        <div class="queue-item-meta">${formatTime(item.durationSec)} • ${escapeHtml(item.requestedBy)}</div>
      </div>
      <button class="queue-item-remove" onclick="removeQueueItem(${idx})" title="Entfernen">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>
  `).join('');
}

// Zeitformatierung mm:ss
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Event Listeners
searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;

  searchButton.disabled = true;
  searchButton.innerHTML = '<span>Lade...</span>';

  try {
    const res = await fetch('/api/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fehler beim Abspielen');
    searchInput.value = '';
  } catch (err) {
    alert(`Fehler: ${err.message}`);
  } finally {
    searchButton.disabled = false;
    searchButton.innerHTML = '<span>Abspielen</span>';
  }
});

playPauseBtn.addEventListener('click', async () => {
  if (!currentStatus || !currentStatus.player) return;
  const player = currentStatus.player;

  if (player.isPlaying && !player.isPaused) {
    await fetch('/api/pause', { method: 'POST' });
  } else {
    await fetch('/api/resume', { method: 'POST' });
  }
});

nextBtn.addEventListener('click', async () => {
  await fetch('/api/skip', { method: 'POST' });
});

prevBtn.addEventListener('click', async () => {
  await fetch('/api/previous', { method: 'POST' });
});

stopBtn.addEventListener('click', async () => {
  await fetch('/api/stop', { method: 'POST' });
});

volumeSlider.addEventListener('input', (e) => {
  volumeValue.textContent = `${e.target.value}%`;
});

volumeSlider.addEventListener('change', async (e) => {
  const volume = parseInt(e.target.value, 10);
  await fetch('/api/volume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ volume })
  });
});

shuffleBtn.addEventListener('click', async () => {
  await fetch('/api/queue/shuffle', { method: 'POST' });
});

clearQueueBtn.addEventListener('click', async () => {
  await fetch('/api/queue/clear', { method: 'POST' });
});

window.removeQueueItem = async (index) => {
  await fetch(`/api/queue/${index}`, { method: 'DELETE' });
};

// Start
fetchStatus();
initWebSocket();
