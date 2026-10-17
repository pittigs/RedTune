// RedTune – TeamSpeak 6 YouTube Music Bot Web Dashboard Client

const connectionBadge = document.getElementById('connectionBadge');
const connectionText = document.getElementById('connectionText');
const botStatusText = document.getElementById('botStatusText');
const serverText = document.getElementById('serverText');
const userBadge = document.getElementById('userBadge');
const userName = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');

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
let authToken = localStorage.getItem('redtune_auth') || '';

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
    // Falls Fehler, erneut prüfen ob Setup nötig ist
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      if (data.setupRequired) {
        showSetupOverlay();
        return;
      }
    } catch {}
    showLoginOverlay();
  }
}

function showSetupOverlay() {
  authOverlay.classList.remove('hidden');
  setupCard.classList.remove('hidden');
  loginCard.classList.add('hidden');
  setupError.classList.add('hidden');
  setupUsername.focus();
}

function showLoginOverlay() {
  authOverlay.classList.remove('hidden');
  loginCard.classList.remove('hidden');
  setupCard.classList.add('hidden');
  loginError.classList.add('hidden');
  loginUsername.focus();
}

function hideAuthOverlay() {
  authOverlay.classList.add('hidden');
  setupCard.classList.add('hidden');
  loginCard.classList.add('hidden');
  setupError.classList.add('hidden');
  loginError.classList.add('hidden');
}

function showUserBadge(user) {
  if (user && user.username) {
    userName.textContent = user.username;
    userBadge.classList.remove('hidden');
  }
  logoutBtn.classList.remove('hidden');
}

function hideUserBadge() {
  userBadge.classList.add('hidden');
  logoutBtn.classList.add('hidden');
}

// Setup Formular (Ersteinrichtung)
setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = setupUsername.value.trim();
  const password = setupPassword.value;
  const confirm = setupPasswordConfirm.value;
  setupError.classList.add('hidden');

  if (password !== confirm) {
    setupError.textContent = 'Passwörter stimmen nicht überein.';
    setupError.classList.remove('hidden');
    return;
  }

  if (password.length < 6) {
    setupError.textContent = 'Passwort muss mindestens 6 Zeichen lang sein.';
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
    if (!res.ok) {
      throw new Error(data.error || 'Fehler bei der Registrierung');
    }

    authToken = data.token;
    localStorage.setItem('redtune_auth', authToken);
    hideAuthOverlay();
    showUserBadge(data.user);
    initApp();
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
    if (!res.ok) {
      throw new Error(data.error || 'Ungültige Anmeldedaten');
    }

    authToken = data.token;
    localStorage.setItem('redtune_auth', authToken);
    hideAuthOverlay();
    showUserBadge(data.user);
    initApp();
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
    const res = await apiFetch('/api/play', {
      method: 'POST',
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
    await apiFetch('/api/pause', { method: 'POST' });
  } else {
    await apiFetch('/api/resume', { method: 'POST' });
  }
});

nextBtn.addEventListener('click', async () => {
  await apiFetch('/api/skip', { method: 'POST' });
});

prevBtn.addEventListener('click', async () => {
  await apiFetch('/api/previous', { method: 'POST' });
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
});

clearQueueBtn.addEventListener('click', async () => {
  await apiFetch('/api/queue/clear', { method: 'POST' });
});

window.removeQueueItem = async (index) => {
  await apiFetch(`/api/queue/${index}`, { method: 'DELETE' });
};

// --- YouTube & Cookie Settings Modal ---
const ytModal = document.getElementById('ytModal');
const ytSettingsBtn = document.getElementById('ytSettingsBtn');
const ytCloseBtn = document.getElementById('ytCloseBtn');
const ytStatusBox = document.getElementById('ytStatusBox');
const ytStatusText = document.getElementById('ytStatusText');
const ytCookieForm = document.getElementById('ytCookieForm');
const ytCookieInput = document.getElementById('ytCookieInput');
const ytFeedback = document.getElementById('ytFeedback');
const ytTestBtn = document.getElementById('ytTestBtn');
const ytDeleteBtn = document.getElementById('ytDeleteBtn');

function showYtFeedback(msg, isSuccess = false) {
  ytFeedback.textContent = msg;
  ytFeedback.classList.remove('hidden');
  if (isSuccess) {
    ytFeedback.classList.add('yt-feedback-success');
  } else {
    ytFeedback.classList.remove('yt-feedback-success');
  }
}

async function fetchYtStatus() {
  try {
    const res = await apiFetch('/api/youtube/status');
    const data = await res.json();

    if (data.hasCookies) {
      ytStatusBox.classList.add('active');
      ytStatusText.textContent = `Cookies aktiv (${data.lines} Einträge, ${Math.round(data.size / 1024)} KB)`;
      ytDeleteBtn.classList.remove('hidden');
    } else {
      ytStatusBox.classList.remove('active');
      ytStatusText.textContent = 'Keine Cookies hinterlegt (Client-Bypass aktiv)';
      ytDeleteBtn.classList.add('hidden');
    }
  } catch (err) {
    ytStatusText.textContent = 'Fehler beim Laden des Cookie-Status';
  }
}

if (ytSettingsBtn) {
  ytSettingsBtn.addEventListener('click', () => {
    ytModal.classList.remove('hidden');
    ytFeedback.classList.add('hidden');
    fetchYtStatus();
  });
}

if (ytCloseBtn) {
  ytCloseBtn.addEventListener('click', () => {
    ytModal.classList.add('hidden');
  });
}

if (ytCookieForm) {
  ytCookieForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cookies = ytCookieInput.value.trim();
    if (!cookies) {
      showYtFeedback('Bitte füge den Inhalt deiner cookies.txt ein.', false);
      return;
    }

    try {
      const res = await apiFetch('/api/youtube/cookies', {
        method: 'POST',
        body: JSON.stringify({ cookies })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler beim Speichern');
      showYtFeedback(data.message || 'Cookies gespeichert!', true);
      ytCookieInput.value = '';
      fetchYtStatus();
    } catch (err) {
      showYtFeedback(err.message, false);
    }
  });
}

if (ytTestBtn) {
  ytTestBtn.addEventListener('click', async () => {
    ytTestBtn.disabled = true;
    ytTestBtn.innerHTML = '<span>Prüfe...</span>';
    showYtFeedback('Verbindungstest zu YouTube läuft...', true);

    try {
      const res = await apiFetch('/api/youtube/test', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Test fehlgeschlagen');
      showYtFeedback(data.message, true);
    } catch (err) {
      showYtFeedback(err.message, false);
    } finally {
      ytTestBtn.disabled = false;
      ytTestBtn.innerHTML = '<span>Verbindung testen</span>';
    }
  });
}

if (ytDeleteBtn) {
  ytDeleteBtn.addEventListener('click', async () => {
    if (!confirm('Möchtest du die gespeicherten YouTube Cookies wirklich löschen?')) return;
    try {
      const res = await apiFetch('/api/youtube/cookies', { method: 'DELETE' });
      const data = await res.json();
      showYtFeedback(data.message, true);
      fetchYtStatus();
    } catch (err) {
      showYtFeedback(err.message, false);
    }
  });
}

// Start
checkAuth();
