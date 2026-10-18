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
    trackMeta.textContent = `Angefordert von ${player.currentTrack.requestedBy}`;

    if (player.currentTrack.thumbnail) {
      trackThumbnail.src = player.currentTrack.thumbnail;
      trackThumbnail.classList.remove('hidden');
      albumArtPlaceholder.classList.add('hidden');
    } else {
      trackThumbnail.classList.add('hidden');
      albumArtPlaceholder.classList.remove('hidden');
    }

    const curSec = player.positionSec || 0;
    const durSec = player.currentTrack.durationSec || 0;
    currentTime.textContent = formatTime(curSec);
    totalTime.textContent = formatTime(durSec);

    const percent = durSec > 0 ? Math.min(100, (curSec / durSec) * 100) : 0;
    progressBarFill.style.width = `${percent}%`;

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

document.querySelectorAll('.modal-close-btn').forEach(btn => {
  btn.addEventListener('click', () => ytModal.classList.add('hidden'));
});

if (ytSettingsBtn) {
  ytSettingsBtn.addEventListener('click', () => {
    ytModal.classList.remove('hidden');
  });
}

// Start
checkAuth();
