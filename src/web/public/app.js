// RedTune – TeamSpeak 6 & 3 YouTube Music Bot Web Dashboard Client

const connectionBadge = document.getElementById('connectionBadge');
const connectionText = document.getElementById('connectionText');
const botStatusText = document.getElementById('botStatusText');
const serverText = document.getElementById('serverText');
const userBadge = document.getElementById('userBadge');
const userName = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');
const themeToggleBtn = document.getElementById('themeToggleBtn');

const authOverlay = document.getElementById('authOverlay');
const setupCard = document.getElementById('setupCard');
const setupForm = document.getElementById('setupForm');
const setupUsername = document.getElementById('setupUsername');
const setupPassword = document.getElementById('setupPassword');
const setupPasswordConfirm = document.getElementById('setupPasswordConfirm');
const setupError = document.getElementById('setupError');

const loginCard = document.getElementById('loginCard');
const loginForm = document.getElementById('loginForm');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const loginError = document.getElementById('loginError');

const searchForm = document.getElementById('searchForm');
const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const searchInstantBtn = document.getElementById('searchInstantBtn');
const searchResultsDropdown = document.getElementById('searchResultsDropdown');

const trackTitle = document.getElementById('trackTitle');
const trackMeta = document.getElementById('trackMeta');
const trackThumbnail = document.getElementById('trackThumbnail');
const albumArtPlaceholder = document.getElementById('albumArtPlaceholder');

const progressBarBg = document.getElementById('progressBarBg');
const progressBarFill = document.getElementById('progressBarFill');
const currentTime = document.getElementById('currentTime');
const totalTime = document.getElementById('totalTime');
const visualizerCanvas = document.getElementById('visualizerCanvas');

const playPauseBtn = document.getElementById('playPauseBtn');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const stopBtn = document.getElementById('stopBtn');

const volumeSlider = document.getElementById('volumeSlider');
const volumeValue = document.getElementById('volumeValue');
const volIcon = document.getElementById('volIcon');

const queueCount = document.getElementById('queueCount');
const queueList = document.getElementById('queueList');
const shuffleBtn = document.getElementById('shuffleBtn');
const clearQueueBtn = document.getElementById('clearQueueBtn');
const autoDjCheckbox = document.getElementById('autoDjCheckbox');
const exportQueueBtn = document.getElementById('exportQueueBtn');
const importPlaylistInput = document.getElementById('importPlaylistInput');

const toastContainer = document.getElementById('toastContainer');

let currentStatus = null;
let ws = null;
let authToken = localStorage.getItem('redtune_auth') || '';
let draggedItemIndex = null;

// Toast Benachrichtigungen
function showToast(message, isError = false) {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'toast-error' : ''}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

// Authentifizierter Fetch Helper
async function apiFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    const data = await res.clone().json().catch(() => ({}));
    if (data.setupRequired) {
      showSetupOverlay();
    } else {
      showLoginOverlay();
    }
    throw new Error('Nicht autorisiert');
  }

  return res;
}

// Authentifizierung prüfen
async function checkAuth() {
  try {
    const res = await apiFetch('/api/auth/status');
    const data = await res.json();

    if (data.setupRequired) {
      hideUserBadge();
      showSetupOverlay();
      return;
    }

    if (data.authenticated) {
      hideAuthOverlay();
      showUserBadge(data.user);
      initApp();
    } else {
      hideUserBadge();
      showLoginOverlay();
    }
  } catch (err) {
    console.warn('[Auth] Status-Prüfung:', err.message);
  }
}

function showSetupOverlay() {
  authOverlay.classList.remove('hidden');
  setupCard.classList.remove('hidden');
  loginCard.classList.add('hidden');
}

function showLoginOverlay() {
  authOverlay.classList.remove('hidden');
  setupCard.classList.add('hidden');
  loginCard.classList.remove('hidden');
}

function hideAuthOverlay() {
  authOverlay.classList.add('hidden');
  setupCard.classList.add('hidden');
  loginCard.classList.add('hidden');
}

function showUserBadge(user) {
  if (user && user.username) {
    userName.textContent = user.username;
    userBadge.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
  }
}

function hideUserBadge() {
  userBadge.classList.add('hidden');
  logoutBtn.classList.add('hidden');
}

// Setup Formular
setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = setupUsername.value.trim();
  const password = setupPassword.value;
  const confirm = setupPasswordConfirm.value;
  setupError.classList.add('hidden');

  if (password !== confirm) {
    setupError.textContent = 'Die Passwörter stimmen nicht überein.';
    setupError.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ersteinrichtung fehlgeschlagen');

    authToken = data.token;
    localStorage.setItem('redtune_auth', authToken);
    hideAuthOverlay();
    showUserBadge(data.user);
    initApp();
    showToast(`Willkommen, ${username}! Administrator-Account eingerichtet.`);
  } catch (err) {
    setupError.textContent = err.message;
    setupError.classList.remove('hidden');
  }
});

// Login Formular
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  loginError.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ungültige Anmeldedaten');

    authToken = data.token;
    localStorage.setItem('redtune_auth', authToken);
    hideAuthOverlay();
    showUserBadge(data.user);
    initApp();
    showToast(`Erfolgreich angemeldet als ${username}.`);
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove('hidden');
  }
});

// Logout
logoutBtn.addEventListener('click', async () => {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {}
  authToken = '';
  localStorage.removeItem('redtune_auth');
  if (ws) ws.close();
  hideUserBadge();
  checkAuth();
});

// App initialisieren
function initApp() {
  fetchStatus();
  initWebSocket();
  initVisualizer();
  initScrubber();
  initFilterButtons();
  initSoundboardButtons();
  initInstantSearch();
  initAutoDj();
  initPlaylistExportImport();
  initThemeSwitcher();
  initKeyboardShortcuts();
}

// WebSocket mit Auth Token
function initWebSocket() {
  if (ws) {
    try { ws.close(); } catch (e) {}
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const tokenParam = authToken ? `?token=${encodeURIComponent(authToken)}` : '';
  const wsUrl = `${protocol}//${window.location.host}${tokenParam}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Verbunden mit RedTune Dashboard');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'status') {
        renderStatus(msg.data);
      } else if (msg.type === 'auth_required') {
        if (msg.setupRequired) {
          showSetupOverlay();
        } else {
          showLoginOverlay();
        }
      }
    } catch (e) {
      console.error('[WS] Parse-Fehler:', e);
    }
  };

  ws.onclose = (event) => {
    if (event.code === 4401) {
      checkAuth();
      return;
    }
    setTimeout(initWebSocket, 2500);
  };
}

// Status per REST holen
async function fetchStatus() {
  try {
    const res = await apiFetch('/api/status');
    const data = await res.json();
    renderStatus(data);
  } catch (err) {
    console.error('[API] Status-Fehler:', err);
  }
}

// UI Rendern
function renderStatus(status) {
  currentStatus = status;

  connectionBadge.classList.add('clickable');
  if (status.connected) {
    connectionBadge.classList.add('connected');
    connectionBadge.classList.remove('connecting');
    connectionText.textContent = 'Online';
    const chInfo = status.currentChannel ? ` (${status.currentChannel})` : '';
    botStatusText.textContent = `${status.botName} ist verbunden${chInfo}`;
  } else if (status.isConnecting) {
    connectionBadge.classList.remove('connected');
    connectionBadge.classList.add('connecting');
    connectionText.textContent = 'Verbinde...';
    botStatusText.textContent = `Verbindungsversuch zu ${status.server || 'TeamSpeak'}...`;
  } else {
    connectionBadge.classList.remove('connected', 'connecting');
    connectionText.textContent = 'Offline';
    botStatusText.textContent = status.lastError 
      ? `Fehler: ${status.lastError}` 
      : 'Nicht verbunden (Klicken zum Einrichten)';
  }

  serverText.textContent = status.server || 'Server';

  const player = status.player;
  if (player && player.currentTrack) {
    trackTitle.textContent = player.currentTrack.title;

    if (player.currentTrack.isStream) {
      trackMeta.innerHTML = `<span class="live-indicator"><span class="live-indicator-dot"></span>LIVE</span> 📻 Internet-Radio • Angefordert von ${escapeHtml(player.currentTrack.requestedBy || 'Dashboard')}`;
      currentTime.textContent = formatTime(player.positionSec || 0);
      totalTime.textContent = 'LIVE';
      progressBarFill.style.width = '100%';
    } else if (player.currentTrack.isLocal) {
      trackMeta.innerHTML = `📁 Eigene Audiodatei • Angefordert von ${escapeHtml(player.currentTrack.requestedBy || 'Dashboard')}`;
      const curSec = player.positionSec || 0;
      const durSec = player.currentTrack.durationSec || 0;
      currentTime.textContent = formatTime(curSec);
      totalTime.textContent = durSec > 0 ? formatTime(durSec) : '--:--';
      const percent = durSec > 0 ? Math.min(100, (curSec / durSec) * 100) : 0;
      progressBarFill.style.width = `${percent}%`;
    } else {
      trackMeta.textContent = `Angefordert von ${player.currentTrack.requestedBy}`;
      const curSec = player.positionSec || 0;
      const durSec = player.currentTrack.durationSec || 0;
      currentTime.textContent = formatTime(curSec);
      totalTime.textContent = formatTime(durSec);
      const percent = durSec > 0 ? Math.min(100, (curSec / durSec) * 100) : 0;
      progressBarFill.style.width = `${percent}%`;
    }

    if (player.currentTrack.thumbnail) {
      trackThumbnail.src = player.currentTrack.thumbnail;
      trackThumbnail.classList.remove('hidden');
      albumArtPlaceholder.classList.add('hidden');
    } else {
      trackThumbnail.classList.add('hidden');
      albumArtPlaceholder.classList.remove('hidden');
    }

    if (player.isPlaying && !player.isPaused) {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
    } else {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
    }

    // Aktiven Filter hervorheben
    if (player.filter) {
      document.querySelectorAll('.filter-chips .chip').forEach(c => {
        c.classList.toggle('active', c.dataset.filter === player.filter);
      });
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

  if (player && typeof player.volume === 'number') {
    volumeSlider.value = player.volume;
    volumeValue.textContent = `${player.volume}%`;
  }

  if (autoDjCheckbox && status.queue) {
    autoDjCheckbox.checked = Boolean(status.queue.autoDj);
  }

  renderQueue(status.queue?.items || []);
}

function renderQueue(items) {
  queueCount.textContent = `${items.length} Titel`;

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
    <div class="queue-item" draggable="true" data-index="${idx}">
      <span class="queue-item-idx" style="cursor: grab;">☰ #${idx + 1}</span>
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

  setupDragAndDrop();
}

// Drag & Drop Queue Reordering
function setupDragAndDrop() {
  const elements = queueList.querySelectorAll('.queue-item');
  elements.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedItemIndex = parseInt(item.dataset.index, 10);
      item.classList.add('dragging');
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      elements.forEach(el => el.classList.remove('drag-over'));
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      item.classList.add('drag-over');
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const targetIndex = parseInt(item.dataset.index, 10);
      if (draggedItemIndex !== null && draggedItemIndex !== targetIndex) {
        try {
          await apiFetch('/api/queue/move', {
            method: 'POST',
            body: JSON.stringify({ fromIndex: draggedItemIndex, toIndex: targetIndex })
          });
          showToast(`Titel verschoben an Position #${targetIndex + 1}.`);
        } catch (err) {
          showToast(err.message, true);
        }
      }
    });
  });
}

// Interaktiver Scrubber (Seek)
function initScrubber() {
  if (!progressBarBg) return;
  progressBarBg.addEventListener('click', async (e) => {
    if (!currentStatus?.player?.currentTrack) return;
    const rect = progressBarBg.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const duration = currentStatus.player.currentTrack.durationSec || 0;
    if (duration <= 0) return;

    const targetSec = Math.round(ratio * duration);
    try {
      await apiFetch('/api/seek', {
        method: 'POST',
        body: JSON.stringify({ position: targetSec })
      });
      showToast(`Gespult zu ${formatTime(targetSec)}.`);
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

// Audio Visualizer Canvas
function initVisualizer() {
  if (!visualizerCanvas) return;
  const ctx = visualizerCanvas.getContext('2d');
  const barCount = 32;
  const bars = Array(barCount).fill(4);

  function draw() {
    requestAnimationFrame(draw);
    ctx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);

    const isPlaying = currentStatus?.player?.isPlaying && !currentStatus?.player?.isPaused;
    const volRatio = (currentStatus?.player?.volume || 50) / 100;

    for (let i = 0; i < barCount; i++) {
      if (isPlaying) {
        const target = (Math.sin(Date.now() * 0.005 + i * 0.4) * 0.5 + 0.5) * 32 * volRatio + 3;
        bars[i] += (target - bars[i]) * 0.25;
      } else {
        bars[i] += (2 - bars[i]) * 0.1;
      }

      const barWidth = visualizerCanvas.width / barCount - 2;
      const x = i * (barWidth + 2);
      const h = Math.max(2, bars[i]);
      const y = visualizerCanvas.height - h;

      const grad = ctx.createLinearGradient(0, y, 0, visualizerCanvas.height);
      grad.addColorStop(0, '#ff0033');
      grad.addColorStop(1, '#ff3366');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barWidth, h);
    }
  }

  draw();
}

// Audio-Filter Presets
function initFilterButtons() {
  document.querySelectorAll('.filter-chips .chip').forEach(btn => {
    btn.addEventListener('click', async () => {
      const filter = btn.dataset.filter;
      try {
        await apiFetch('/api/filter', {
          method: 'POST',
          body: JSON.stringify({ filter })
        });
        document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        showToast(`Filter aktiviert: ${filter.toUpperCase()}`);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });
}

// Soundboard Trigger
function initSoundboardButtons() {
  document.querySelectorAll('.soundboard-row .btn-sb').forEach(btn => {
    btn.addEventListener('click', async () => {
      const sound = btn.dataset.sound;
      try {
        await apiFetch('/api/soundboard', {
          method: 'POST',
          body: JSON.stringify({ sound })
        });
        showToast(`📢 Soundboard: ${sound}`);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });
}

// Live-Suche & Vorschau Dropdown
function initInstantSearch() {
  if (!searchInstantBtn || !searchResultsDropdown) return;

  searchInstantBtn.addEventListener('click', async () => {
    const q = searchInput.value.trim();
    if (!q) {
      showToast('Bitte einen Suchbegriff eingeben.', true);
      return;
    }

    searchInstantBtn.disabled = true;
    searchInstantBtn.innerHTML = '<span>Suche...</span>';

    try {
      const res = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Suche fehlgeschlagen');

      if (!data.results || data.results.length === 0) {
        showToast('Keine Treffer gefunden.', true);
        return;
      }

      searchResultsDropdown.innerHTML = data.results.map(r => `
        <div class="search-result-item">
          <img src="${r.thumbnail || ''}" class="search-result-thumb" alt="" />
          <div class="search-result-info">
            <div class="search-result-title">${escapeHtml(r.title)}</div>
            <div class="search-result-duration">${formatTime(r.durationSec)}</div>
          </div>
          <div class="search-result-actions">
            <button class="btn-play-now" onclick="playSearchResult('${escapeHtml(r.url)}')">▶ Abspielen</button>
            <button class="btn-add-queue" onclick="queueSearchResult('${escapeHtml(r.url)}')">+ Queue</button>
          </div>
        </div>
      `).join('');

      searchResultsDropdown.classList.remove('hidden');
    } catch (err) {
      showToast(err.message, true);
    } finally {
      searchInstantBtn.disabled = false;
      searchInstantBtn.innerHTML = '<span>Vorschau</span>';
    }
  });

  // Klick außerhalb schließt das Dropdown
  document.addEventListener('click', (e) => {
    if (!searchForm.contains(e.target) && !searchResultsDropdown.contains(e.target)) {
      searchResultsDropdown.classList.add('hidden');
    }
  });
}

window.playSearchResult = async function(url) {
  try {
    searchResultsDropdown.classList.add('hidden');
    await apiFetch('/api/play', {
      method: 'POST',
      body: JSON.stringify({ query: url })
    });
    showToast('Titel wird abgespielt!');
  } catch (err) {
    showToast(err.message, true);
  }
};

window.queueSearchResult = async function(url) {
  try {
    await apiFetch('/api/play', {
      method: 'POST',
      body: JSON.stringify({ query: url })
    });
    showToast('Zur Warteschlange hinzugefügt!');
  } catch (err) {
    showToast(err.message, true);
  }
};

// Auto-DJ Toggle
function initAutoDj() {
  if (!autoDjCheckbox) return;
  autoDjCheckbox.addEventListener('change', async () => {
    try {
      await apiFetch('/api/autodj', {
        method: 'POST',
        body: JSON.stringify({ enabled: autoDjCheckbox.checked })
      });
      showToast(`Auto-DJ ${autoDjCheckbox.checked ? 'aktiviert 📻' : 'deaktiviert'}.`);
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

// Playlist Export & Import
function initPlaylistExportImport() {
  if (exportQueueBtn) {
    exportQueueBtn.addEventListener('click', () => {
      window.open('/api/queue/export?format=json', '_blank');
      showToast('Warteschlange als JSON exportiert!');
    });
  }

  if (importPlaylistInput) {
    importPlaylistInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const content = JSON.parse(event.target.result);
          const res = await apiFetch('/api/queue/import', {
            method: 'POST',
            body: JSON.stringify({ playlist: content })
          });
          const data = await res.json();
          showToast(`Playlist importiert: ${data.imported} Titel hinzugefügt!`);
        } catch (err) {
          showToast(`Import-Fehler: ${err.message}`, true);
        }
      };
      reader.readAsText(file);
    });
  }
}

// Theme Switcher (Dark, Cyberpunk, OLED, Glass)
function initThemeSwitcher() {
  const themes = ['dark', 'cyberpunk', 'oled', 'glass'];
  const savedTheme = localStorage.getItem('redtune_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'dark';
      const nextIdx = (themes.indexOf(cur) + 1) % themes.length;
      const nextTheme = themes[nextIdx];
      document.documentElement.setAttribute('data-theme', nextTheme);
      localStorage.setItem('redtune_theme', nextTheme);
      showToast(`Design gewechselt zu: ${nextTheme.toUpperCase()}`);
    });
  }
}

// Tastatur-Hotkeys
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (e.code === 'Space') {
      e.preventDefault();
      playPauseBtn.click();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      if (currentStatus?.player?.currentTrack) {
        const cur = currentStatus.player.positionSec || 0;
        apiFetch('/api/seek', { method: 'POST', body: JSON.stringify({ position: cur + 10 }) });
      }
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      if (currentStatus?.player?.currentTrack) {
        const cur = currentStatus.player.positionSec || 0;
        apiFetch('/api/seek', { method: 'POST', body: JSON.stringify({ position: Math.max(0, cur - 10) }) });
      }
    } else if (e.code === 'ArrowUp') {
      e.preventDefault();
      const vol = Math.min(100, (currentStatus?.player?.volume || 50) + 5);
      apiFetch('/api/volume', { method: 'POST', body: JSON.stringify({ volume: vol }) });
    } else if (e.code === 'ArrowDown') {
      e.preventDefault();
      const vol = Math.max(0, (currentStatus?.player?.volume || 50) - 5);
      apiFetch('/api/volume', { method: 'POST', body: JSON.stringify({ volume: vol }) });
    }
  });
}

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

// Standard Button Event Listeners
searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;

  searchButton.disabled = true;
  searchButton.innerHTML = '<span>Lade...</span>';

  try {
    const res = await apiFetch('/api/play', {
      method: 'POST',
      body: JSON.stringify({ query })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fehler beim Abspielen');
    searchInput.value = '';
    showToast(`Track gestartet: ${data.track?.title || query}`);
  } catch (err) {
    if (err.message.includes('Sign in') || err.message.includes('bot') || err.message.includes('Bot-Erkennung') || err.message.includes('Anmeldung')) {
      showToast('YouTube verlangt eine Verifizierung per cookies.txt.', true);
      ytModal.classList.remove('hidden');
    } else {
      showToast(`Fehler: ${err.message}`, true);
    }
  } finally {
    searchButton.disabled = false;
    searchButton.innerHTML = '<span>Abspielen</span>';
  }
});

playPauseBtn.addEventListener('click', async () => {
  if (!currentStatus || !currentStatus.player) return;
  const player = currentStatus.player;

  if (player.isPlaying && !player.isPaused) {
    await apiFetch('/api/pause', { method: 'POST' });
  } else {
    await apiFetch('/api/resume', { method: 'POST' });
  }
});

prevBtn.addEventListener('click', async () => {
  await apiFetch('/api/previous', { method: 'POST' });
});

nextBtn.addEventListener('click', async () => {
  await apiFetch('/api/skip', { method: 'POST' });
});

stopBtn.addEventListener('click', async () => {
  await apiFetch('/api/stop', { method: 'POST' });
});

volumeSlider.addEventListener('input', (e) => {
  volumeValue.textContent = `${e.target.value}%`;
});

volumeSlider.addEventListener('change', async (e) => {
  const volume = parseInt(e.target.value, 10);
  await apiFetch('/api/volume', {
    method: 'POST',
    body: JSON.stringify({ volume })
  });
});

shuffleBtn.addEventListener('click', async () => {
  await apiFetch('/api/queue/shuffle', { method: 'POST' });
  showToast('Warteschlange gemischt!');
});

clearQueueBtn.addEventListener('click', async () => {
  if (confirm('Möchtest du die Warteschlange wirklich leeren?')) {
    await apiFetch('/api/queue/clear', { method: 'POST' });
    showToast('Warteschlange geleert.');
  }
});

window.removeQueueItem = async function(index) {
  await apiFetch(`/api/queue/${index}`, { method: 'DELETE' });
};

// Settings Modal Steuerung (TeamSpeak & YouTube Cookies & Telemetrie)
const ytSettingsBtn = document.getElementById('ytSettingsBtn');
const ytModal = document.getElementById('ytModal');
const tabTsBtn = document.getElementById('tabTsBtn');
const tabYtBtn = document.getElementById('tabYtBtn');
const tabStatsBtn = document.getElementById('tabStatsBtn');
const tabTsContent = document.getElementById('tabTsContent');
const tabYtContent = document.getElementById('tabYtContent');
const tabStatsContent = document.getElementById('tabStatsContent');

const tsSettingsForm = document.getElementById('tsSettingsForm');
const tsAddressInput = document.getElementById('tsAddressInput');
const tsPasswordInput = document.getElementById('tsPasswordInput');
const tsNicknameInput = document.getElementById('tsNicknameInput');
const tsChannelInput = document.getElementById('tsChannelInput');
const tsChannelPasswordInput = document.getElementById('tsChannelPasswordInput');
const tsFeedback = document.getElementById('tsFeedback');
const tsStatusBox = document.getElementById('tsStatusBox');
const tsStatusText = document.getElementById('tsStatusText');

const ytCookieForm = document.getElementById('ytCookieForm');
const ytCookieFileInput = document.getElementById('ytCookieFileInput');
const ytFileLabelText = document.getElementById('ytFileLabelText');
const ytCookieInput = document.getElementById('ytCookieInput');
const ytFeedback = document.getElementById('ytFeedback');
const ytStatusBox = document.getElementById('ytStatusBox');
const ytStatusText = document.getElementById('ytStatusText');
const ytTestBtn = document.getElementById('ytTestBtn');
const ytDeleteBtn = document.getElementById('ytDeleteBtn');

// Telemetrie Werte
const statRam = document.getElementById('statRam');
const statUptime = document.getElementById('statUptime');
const statPackets = document.getElementById('statPackets');
const statUnderruns = document.getElementById('statUnderruns');

if (tabTsBtn && tabYtBtn && tabStatsBtn) {
  tabTsBtn.addEventListener('click', () => {
    tabTsBtn.classList.add('active');
    tabYtBtn.classList.remove('active');
    tabStatsBtn.classList.remove('active');
    tabTsContent.classList.remove('hidden');
    tabYtContent.classList.add('hidden');
    tabStatsContent.classList.add('hidden');
  });

  tabYtBtn.addEventListener('click', () => {
    tabYtBtn.classList.add('active');
    tabTsBtn.classList.remove('active');
    tabStatsBtn.classList.remove('active');
    tabYtContent.classList.remove('hidden');
    tabTsContent.classList.add('hidden');
    tabStatsContent.classList.add('hidden');
  });

  tabStatsBtn.addEventListener('click', async () => {
    tabStatsBtn.classList.add('active');
    tabTsBtn.classList.remove('active');
    tabYtBtn.classList.remove('active');
    tabStatsContent.classList.remove('hidden');
    tabTsContent.classList.add('hidden');
    tabYtContent.classList.add('hidden');
    loadTelemetryStats();
  });
}

async function loadTelemetryStats() {
  try {
    const res = await apiFetch('/api/system/stats');
    const data = await res.json();
    if (statRam) statRam.textContent = `${data.memoryRssMb} MB`;
    if (statUptime) statUptime.textContent = `${Math.floor(data.uptimeSec / 60)} min`;
    if (statPackets) statPackets.textContent = data.packetsSent?.toLocaleString() || '0';
    if (statUnderruns) statUnderruns.textContent = data.underruns || '0';
  } catch (e) {}
}

// --- Internet-Radio Modal Steuerung ---
const radioModal = document.getElementById('radioModal');
const radioModalBtn = document.getElementById('radioModalBtn');
const pillRadioBtn = document.getElementById('pillRadioBtn');
const radioFilterInput = document.getElementById('radioFilterInput');
const radioStationsGrid = document.getElementById('radioStationsGrid');
let radioStations = [];

async function loadRadioStations() {
  if (!radioStationsGrid) return;
  radioStationsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 24px; color: var(--text-muted);">Lade Sender...</div>';
  try {
    const res = await apiFetch('/api/radio/stations');
    const data = await res.json();
    radioStations = data.stations || [];
    renderRadioStations(radioFilterInput?.value || '');
  } catch (err) {
    radioStationsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 24px; color: #ff3b30;">Fehler beim Laden: ${escapeHtml(err.message)}</div>`;
  }
}

function renderRadioStations(filter = '') {
  if (!radioStationsGrid) return;
  const q = filter.trim().toLowerCase();
  const filtered = radioStations.filter(s => 
    s.name.toLowerCase().includes(q) || 
    s.genre.toLowerCase().includes(q) || 
    s.tagline.toLowerCase().includes(q)
  );

  if (filtered.length === 0) {
    radioStationsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 24px; color: var(--text-muted);">Kein Sender gefunden</div>';
    return;
  }

  radioStationsGrid.innerHTML = filtered.map(station => `
    <div class="station-card" style="border-top: 2px solid ${station.color || 'var(--primary)'};">
      <div class="station-top">
        <div class="station-logo" style="background: ${station.color ? station.color + '26' : 'rgba(255,255,255,0.08)'}; color: ${station.color || '#fff'};">
          ${station.logo || '📻'}
        </div>
        <div class="station-details">
          <div class="station-name">${escapeHtml(station.name)}</div>
          <div class="station-genre">${escapeHtml(station.genre)}</div>
        </div>
      </div>
      <div class="station-tagline">${escapeHtml(station.tagline || '')}</div>
      <div class="station-actions">
        <button class="btn-station-play" onclick="playRadioStation('${escapeHtml(station.id)}')">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <span>Live hören</span>
        </button>
        <button class="btn-station-queue" onclick="queueRadioStation('${escapeHtml(station.name)}')">
          <span>+ Queue</span>
        </button>
      </div>
    </div>
  `).join('');
}

window.playRadioStation = async function(stationId) {
  try {
    const res = await apiFetch('/api/radio/play', {
      method: 'POST',
      body: JSON.stringify({ stationId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fehler beim Starten');
    showToast(`📻 Live-Radio gestartet: ${data.station?.name || stationId}`);
    radioModal?.classList.add('hidden');
  } catch (err) {
    showToast(`Fehler: ${err.message}`, true);
  }
};

window.queueRadioStation = async function(stationName) {
  try {
    const res = await apiFetch('/api/play', {
      method: 'POST',
      body: JSON.stringify({ query: stationName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fehler beim Hinzufügen');
    showToast(`📻 ${stationName} zur Warteschlange hinzugefügt!`);
  } catch (err) {
    showToast(`Fehler: ${err.message}`, true);
  }
};

if (radioFilterInput) {
  radioFilterInput.addEventListener('input', (e) => {
    renderRadioStations(e.target.value);
  });
}

if (radioModalBtn) {
  radioModalBtn.addEventListener('click', () => {
    radioModal?.classList.remove('hidden');
    loadRadioStations();
  });
}

if (pillRadioBtn) {
  pillRadioBtn.addEventListener('click', () => {
    radioModal?.classList.remove('hidden');
    loadRadioStations();
  });
}

document.querySelectorAll('.radio-modal-close-btn').forEach(btn => {
  btn.addEventListener('click', () => radioModal?.classList.add('hidden'));
});


// --- Eigene Lieder Upload Modal & Manager ---
const uploadModal = document.getElementById('uploadModal');
const uploadModalBtn = document.getElementById('uploadModalBtn');
const pillUploadBtn = document.getElementById('pillUploadBtn');
const uploadDropzone = document.getElementById('uploadDropzone');
const fileUploadInput = document.getElementById('fileUploadInput');
const uploadProgressContainer = document.getElementById('uploadProgressContainer');
const uploadProgressBar = document.getElementById('uploadProgressBar');
const uploadProgressText = document.getElementById('uploadProgressText');
const uploadedFilesList = document.getElementById('uploadedFilesList');
const uploadedFilesCount = document.getElementById('uploadedFilesCount');

async function loadUploadedFiles() {
  if (!uploadedFilesList) return;
  try {
    const res = await apiFetch('/api/uploads');
    const data = await res.json();
    const files = data.files || [];
    renderUploadedFiles(files);
  } catch (err) {
    uploadedFilesList.innerHTML = `<div class="empty-uploads-state" style="color: #ff3b30;">Fehler: ${escapeHtml(err.message)}</div>`;
  }
}

function renderUploadedFiles(files) {
  if (!uploadedFilesList) return;
  if (uploadedFilesCount) {
    uploadedFilesCount.textContent = `${files.length} Datei${files.length === 1 ? '' : 'en'}`;
  }

  if (files.length === 0) {
    uploadedFilesList.innerHTML = `
      <div class="empty-uploads-state">
        Noch keine Lieder hochgeladen.<br>Ziehe deine MP3- oder WAV-Dateien in das obige Feld!
      </div>
    `;
    return;
  }

  uploadedFilesList.innerHTML = files.map(file => {
    const sizeMb = (file.sizeBytes / (1024 * 1024)).toFixed(1);
    const dateStr = file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString('de-DE') : '';
    return `
      <div class="uploaded-file-item">
        <div class="uploaded-file-info">
          <div class="file-icon">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </div>
          <div class="file-texts">
            <div class="file-title" title="${escapeHtml(file.title)}">${escapeHtml(file.title)}</div>
            <div class="file-sub">${sizeMb} MB ${dateStr ? '• ' + dateStr : ''}</div>
          </div>
        </div>
        <div class="uploaded-file-actions">
          <button class="btn-file-play" onclick="playUploadedFile('${escapeHtml(file.filename)}')">
            Abspielen
          </button>
          <button class="btn-file-delete" onclick="deleteUploadedFile('${escapeHtml(file.filename)}')">
            ✕
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.playUploadedFile = async function(filename) {
  try {
    const res = await apiFetch(`/api/uploads/play/${encodeURIComponent(filename)}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Fehler beim Starten');
    showToast(`Track gestartet: ${data.track?.title || filename}`);
    uploadModal?.classList.add('hidden');
  } catch (err) {
    showToast(`Fehler: ${err.message}`, true);
  }
};

window.deleteUploadedFile = async function(filename) {
  if (!confirm(`Möchtest du "${filename}" wirklich löschen?`)) return;
  try {
    const res = await apiFetch(`/api/uploads/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Fehler beim Löschen');
    showToast('Datei gelöscht');
    loadUploadedFiles();
  } catch (err) {
    showToast(`Fehler: ${err.message}`, true);
  }
};

async function uploadFileList(fileList) {
  if (!fileList || fileList.length === 0) return;
  
  uploadProgressContainer?.classList.remove('hidden');
  let successCount = 0;

  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    if (uploadProgressText) {
      uploadProgressText.textContent = `Lade hoch (${i + 1}/${fileList.length}): ${file.name}...`;
    }
    const percent = Math.round(((i) / fileList.length) * 100);
    if (uploadProgressBar) uploadProgressBar.style.width = `${percent}%`;

    const formData = new FormData();
    formData.append('audio', file);

    try {
      const headers = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers,
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload fehlgeschlagen');
      successCount++;
    } catch (err) {
      showToast(`Fehler bei ${file.name}: ${err.message}`, true);
    }
  }

  if (uploadProgressBar) uploadProgressBar.style.width = '100%';
  if (uploadProgressText) uploadProgressText.textContent = `Fertig! ${successCount} von ${fileList.length} Dateien hochgeladen.`;
  setTimeout(() => {
    uploadProgressContainer?.classList.add('hidden');
    if (uploadProgressBar) uploadProgressBar.style.width = '0%';
  }, 2000);

  showToast(`${successCount} Lied${successCount === 1 ? '' : 'er'} erfolgreich hochgeladen!`);
  loadUploadedFiles();
}

if (uploadDropzone && fileUploadInput) {
  uploadDropzone.addEventListener('click', () => {
    fileUploadInput.click();
  });

  fileUploadInput.addEventListener('change', () => {
    if (fileUploadInput.files && fileUploadInput.files.length > 0) {
      uploadFileList(fileUploadInput.files);
      fileUploadInput.value = '';
    }
  });

  uploadDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadDropzone.classList.add('drag-active');
  });

  uploadDropzone.addEventListener('dragleave', () => {
    uploadDropzone.classList.remove('drag-active');
  });

  uploadDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadDropzone.classList.remove('drag-active');
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      uploadFileList(e.dataTransfer.files);
    }
  });
}

if (uploadModalBtn) {
  uploadModalBtn.addEventListener('click', () => {
    uploadModal?.classList.remove('hidden');
    loadUploadedFiles();
  });
}

if (pillUploadBtn) {
  pillUploadBtn.addEventListener('click', () => {
    uploadModal?.classList.remove('hidden');
    loadUploadedFiles();
  });
}

document.querySelectorAll('.upload-modal-close-btn').forEach(btn => {
  btn.addEventListener('click', () => uploadModal?.classList.add('hidden'));
});

// Einstellungen Modal (TeamSpeak & YouTube Cookies)
document.querySelectorAll('.modal-close-btn').forEach(btn => {
  btn.addEventListener('click', () => ytModal?.classList.add('hidden'));
});

if (ytSettingsBtn) {
  ytSettingsBtn.addEventListener('click', () => {
    ytModal?.classList.remove('hidden');
  });
}

// Klick auf den Hintergrund schließt geöffnete Modale
[radioModal, uploadModal, ytModal].forEach(modal => {
  if (!modal) return;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });
});

// Start
checkAuth();
