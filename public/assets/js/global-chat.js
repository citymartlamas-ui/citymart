/**
 * CityMart Global Chat Ã¢â‚¬â€ Ephemeral (24h messages)
 * Uses Firebase Realtime Database for low-latency real-time messaging.
 * Messages auto-expire after 24 hours via client-side filtering + scheduled Cloud Function.
 */

const CHAT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CHAT_MAX_RENDER = 80; // max messages to render at a time
const CHAT_MSG_MAX_LENGTH = 280;
const CHAT_RATE_LIMIT_MS = 1500; // slightly faster rate limit for a snappy feel
const CHAT_IMAGE_MAX_DIMENSION = 800;
const CHAT_IMAGE_MIN_DIMENSION = 220;
const CHAT_IMAGE_TARGET_BYTES = 88 * 1024;
const CHAT_IMAGE_HARD_MAX_BYTES = 100 * 1024;
const CHAT_IMAGE_QUALITY_STEPS = [0.72, 0.66, 0.6, 0.54, 0.48, 0.42];
const CHAT_BAD_WORDS = ['mierda','puta','carajo','verga','pene','culo','sexo','idiota','estupido','pendejo'];
const CHAT_ALLOWED_CITIES = ['lamas', 'tarapoto'];
const CHAT_CITY_FALLBACK = 'lamas';
const CHAT_CITY_STORAGE_KEY = 'citymart_city';
const CHAT_SEEN_STORAGE_PREFIX = 'citymart_chat_seen_';
const CHAT_CITY_LABELS = {
  lamas: 'Lamas',
  tarapoto: 'Tarapoto'
};

let _chatOpen = false;
export { _chatOpen as isChatOpen };
export function openChat() { if (!_chatOpen) toggleChat(); }
export function closeChat() { if (_chatOpen) toggleChat(); }
let _chatUser = null;
let _chatUserData = null;
let _chatUnsubscribeAdded = null;
let _chatUnsubscribeRemoved = null;
let _chatMessages = [];
let _chatLastSendTime = 0;
let _chatUnreadCount = 0;
let _chatInitialized = false;
let _chatInitStarted = false;
let _chatStandalone = false;
let _chatUploadingImage = false;
let _chatListenerStartedAt = 0;
let _chatCity = getCurrentChatCity();
let _chatChannelPath = buildChatPath(_chatCity);
let _chatCitySyncBound = false;
let _chatCityControlsBound = false;
let _chatImageViewerBound = false;

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
function _chatSanitize(text) {
  let clean = String(text || '').trim().slice(0, CHAT_MSG_MAX_LENGTH);
  // Strip HTML
  clean = clean.replace(/<[^>]*>/g, '');
  // Bad words filter
  CHAT_BAD_WORDS.forEach(w => {
    const regex = new RegExp(w, 'gi');
    clean = clean.replace(regex, '*'.repeat(w.length));
  });
  return clean;
}

function _chatTimeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'ahora';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return 'ayer';
}

function _chatEscapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getChatSendIcon() {
  return `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  `;
}

function getChatSpinnerIcon() {
  return `
    <svg class="gc-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
  `;
}

function getChatImagePickerMarkup() {
  return `
    <label id="gc-image-btn" class="gc-image-btn" aria-label="Enviar foto" role="button" tabindex="0" for="gc-image-input">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M14.5 4h-5L8 6H5a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V9a3 3 0 0 0-3-3h-3l-1.5-2Z"/>
        <circle cx="12" cy="13" r="3.5"/>
      </svg>
      <input type="file" id="gc-image-input" class="gc-image-input" accept="image/*,.heic,.heif">
    </label>
  `;
}

function getChatInlineAdMarkup() {
  return '';
}

function createChatComposeMarkup() {
  return `
    <div class="gc-login-prompt" id="gc-login-prompt" style="display:none;">
      <p>Inicia sesi&oacute;n para participar</p>
      <a href="login.html" class="gc-login-btn">Ingresar</a>
    </div>
    <div class="gc-compose gc-compose-shell" id="gc-compose" style="display:none;">
      <div class="gc-compose-row">
        ${getChatImagePickerMarkup()}
        <input type="text" id="gc-input" class="gc-input" placeholder="Escribe un mensaje..." maxlength="${CHAT_MSG_MAX_LENGTH}" autocomplete="off">
        <button id="gc-send-btn" class="gc-send-btn" aria-label="Enviar">
          ${getChatSendIcon()}
        </button>
      </div>
      <div class="gc-upload-status" id="gc-upload-status" aria-live="polite" style="display:none;">
        ${getChatSpinnerIcon()}
        <span>Subiendo...</span>
      </div>
    </div>
  `;
}

function resizeChatInlineAds() {
}

function bindChatInlineAdResize() {
}

function ensureChatInlineAdShell(anchorElement) {
}

function initializeChatInlineAds(root = document) {
}

function bindChatComposer() {
  const sendBtn = document.getElementById('gc-send-btn');
  if (sendBtn && !sendBtn.dataset.gcBound) {
    sendBtn.dataset.gcBound = 'true';
    sendBtn.addEventListener('click', sendChatMessage);
  }

  const input = document.getElementById('gc-input');
  if (input && !input.dataset.gcBound) {
    input.dataset.gcBound = 'true';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  const imageBtn = document.getElementById('gc-image-btn');
  const imageInput = document.getElementById('gc-image-input');
  if (imageBtn && imageInput && !imageBtn.dataset.gcBound) {
    imageBtn.dataset.gcBound = 'true';
    imageBtn.addEventListener('click', (event) => {
      event.preventDefault();
      if (_chatUploadingImage) return;

      try {
        if (typeof imageInput.showPicker === 'function') {
          imageInput.showPicker();
        } else {
          imageInput.click();
        }
      } catch (error) {
        imageInput.click();
      }
    });
    imageBtn.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (_chatUploadingImage) return;

      try {
        if (typeof imageInput.showPicker === 'function') {
          imageInput.showPicker();
        } else {
          imageInput.click();
        }
      } catch (error) {
        imageInput.click();
      }
    });
    imageInput.addEventListener('change', handleChatImageSelected);
  }

  bindChatImageViewer();
}

function showChatError(message) {
  if (window.showCityMartToast) {
    window.showCityMartToast(message, 'error');
  } else {
    console.warn('[GlobalChat]', message);
  }
}

function setChatUploadState(isUploading, label = 'Subiendo...') {
  _chatUploadingImage = isUploading;
  const input = document.getElementById('gc-input');
  const sendBtn = document.getElementById('gc-send-btn');
  const imageBtn = document.getElementById('gc-image-btn');
  const imageInput = document.getElementById('gc-image-input');
  const status = document.getElementById('gc-upload-status');

  if (input) input.disabled = isUploading;
  if (sendBtn) sendBtn.disabled = isUploading;
  if (imageInput) imageInput.disabled = isUploading;
  if (imageBtn) {
    imageBtn.classList.toggle('is-disabled', isUploading);
    imageBtn.setAttribute('aria-disabled', isUploading ? 'true' : 'false');
  }
  if (status) {
    status.style.display = isUploading ? 'inline-flex' : 'none';
    const text = status.querySelector('span');
    if (text) text.textContent = label;
  }
}

function getSafeChatImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    const allowedHost = parsed.hostname === 'firebasestorage.googleapis.com' || parsed.hostname.endsWith('.googleapis.com');
    return parsed.protocol === 'https:' && allowedHost ? parsed.href : '';
  } catch (error) {
    return '';
  }
}

function bindChatImageViewer() {
  if (_chatImageViewerBound) return;
  _chatImageViewerBound = true;

  document.addEventListener('click', (event) => {
    const imageButton = event.target.closest('[data-chat-image-url]');
    if (imageButton) {
      event.preventDefault();
      openChatImageViewer(imageButton.dataset.chatImageUrl || '');
      return;
    }

    const closeButton = event.target.closest('[data-chat-image-close]');
    const viewer = document.getElementById('gc-image-viewer');
    if (closeButton || (viewer && event.target === viewer)) {
      closeChatImageViewer();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeChatImageViewer();
  });
}

function openChatImageViewer(url) {
  const safeUrl = getSafeChatImageUrl(url);
  if (!safeUrl) return;

  let viewer = document.getElementById('gc-image-viewer');
  if (!viewer) {
    viewer = document.createElement('div');
    viewer.id = 'gc-image-viewer';
    viewer.className = 'gc-image-viewer';
    viewer.innerHTML = `
      <button type="button" class="gc-image-viewer-close" data-chat-image-close aria-label="Cerrar imagen">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <img alt="Foto del chat" loading="eager">
    `;
    document.body.appendChild(viewer);
  }

  const image = viewer.querySelector('img');
  if (image) image.src = safeUrl;
  viewer.classList.add('open');
}

function closeChatImageViewer() {
  const viewer = document.getElementById('gc-image-viewer');
  if (viewer) viewer.classList.remove('open');
}

function normalizeChatCity(value) {
  const normalize = window.normalizeCityValue || ((raw, fallback = CHAT_CITY_FALLBACK) => String(raw || fallback).toLowerCase().trim());
  const normalized = normalize(value, CHAT_CITY_FALLBACK);
  return CHAT_ALLOWED_CITIES.includes(normalized) ? normalized : CHAT_CITY_FALLBACK;
}

function getCurrentChatCity() {
  if (window.getStoredCity) return normalizeChatCity(window.getStoredCity(CHAT_CITY_FALLBACK));

  try {
    return normalizeChatCity(localStorage.getItem(CHAT_CITY_STORAGE_KEY));
  } catch (error) {
    return CHAT_CITY_FALLBACK;
  }
}

function getChatCityLabel(city = _chatCity) {
  return CHAT_CITY_LABELS[normalizeChatCity(city)] || CHAT_CITY_LABELS[CHAT_CITY_FALLBACK];
}

function buildChatPath(city = _chatCity) {
  return `global_chat_by_city/${normalizeChatCity(city)}`;
}

function persistChatCity(city) {
  try {
    localStorage.setItem(CHAT_CITY_STORAGE_KEY, normalizeChatCity(city));
  } catch (error) {
    // Ignore storage failures.
  }
}

function getChatSeenStorageKey(city = _chatCity) {
  return `${CHAT_SEEN_STORAGE_PREFIX}${normalizeChatCity(city)}`;
}

function getChatSeenAt(city = _chatCity) {
  try {
    return Number(localStorage.getItem(getChatSeenStorageKey(city)) || 0) || 0;
  } catch (error) {
    return 0;
  }
}

function markChatCitySeen(city = _chatCity, timestamp = Date.now()) {
  const normalized = normalizeChatCity(city);
  try {
    localStorage.setItem(getChatSeenStorageKey(normalized), String(timestamp));
  } catch (error) {
    // Ignore storage failures.
  }

  if (normalized === _chatCity) {
    _chatUnreadCount = 0;
    updateChatBadge();
  }
}

function clearRenderedMessages() {
  const container = document.getElementById('gc-messages');
  if (container) {
    container.querySelectorAll('.gc-msg').forEach(el => el.remove());
  }

  const emptyState = document.getElementById('gc-empty-state');
  if (emptyState) emptyState.style.display = 'flex';
}

function updateChatCityUI() {
  const label = getChatCityLabel();
  const title = document.getElementById('gc-header-title') || document.querySelector('.gc-header-title');
  const subtitle = document.getElementById('gc-online-label');
  const chip = document.getElementById('gc-city-chip');
  const input = document.getElementById('gc-input');
  const emptyTitle = document.getElementById('gc-empty-title') || document.querySelector('#gc-empty-state p');
  const emptySub = document.getElementById('gc-empty-sub');

  if (title) title.textContent = 'Chat CityMart';
  if (subtitle) subtitle.textContent = `Canal ${label}`;
  if (chip) chip.textContent = label;
  if (input) input.placeholder = `Escribe en ${label}...`;
  if (emptyTitle) emptyTitle.textContent = `Chat de ${label}`;
  if (emptySub) emptySub.textContent = 'Los mensajes desaparecen cada 24 horas.';

  document.documentElement.dataset.chatCity = _chatCity;
  document.body.dataset.chatCity = _chatCity;
  const panel = document.getElementById('global-chat-panel');
  if (panel) panel.dataset.chatCity = _chatCity;
  const container = document.querySelector('.chat-full-container') || document.querySelector('.gc-container');
  if (container) container.dataset.chatCity = _chatCity;

  document.querySelectorAll('button[data-chat-city], [data-chat-city-control][data-chat-city]').forEach((button) => {
    const isActive = normalizeChatCity(button.dataset.chatCity) === _chatCity;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function stopChatListener() {
  if (_chatUnsubscribeAdded) {
    _chatUnsubscribeAdded();
    _chatUnsubscribeAdded = null;
  }

  if (_chatUnsubscribeRemoved) {
    _chatUnsubscribeRemoved();
    _chatUnsubscribeRemoved = null;
  }
}

function setChatCity(city, { persist = false, force = false, startIfOpen = true } = {}) {
  const normalized = normalizeChatCity(city);
  const changed = normalized !== _chatCity;

  if (persist) persistChatCity(normalized);

  if (!changed && !force) {
    updateChatCityUI();
    return _chatCity;
  }

  const wasListening = Boolean(_chatUnsubscribeAdded || _chatUnsubscribeRemoved);
  _chatCity = normalized;
  _chatChannelPath = buildChatPath(_chatCity);
  _chatMessages = [];
  _chatUnreadCount = 0;
  _chatInitialized = false;
  _chatListenerStartedAt = 0;

  stopChatListener();
  clearRenderedMessages();
  updateChatCityUI();
  if (_chatOpen || _chatStandalone) markChatCitySeen(_chatCity);
  updateChatBadge();

  window.dispatchEvent(new CustomEvent('citymart:chat-city-changed', {
    detail: {
      city: _chatCity,
      label: getChatCityLabel(),
      path: _chatChannelPath
    }
  }));

  if (startIfOpen && (wasListening || _chatOpen || _chatStandalone)) {
    startChatListener();
  }

  return _chatCity;
}

function bindChatCityControls() {
  if (_chatCityControlsBound) return;
  _chatCityControlsBound = true;

  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-chat-city], [data-chat-city-control][data-chat-city]');
    if (!button) return;

    event.preventDefault();
    const city = normalizeChatCity(button.dataset.chatCity);

    if (typeof window.switchCity === 'function') {
      window.switchCity(city);
    } else if (window.setStoredCity) {
      window.setStoredCity(city);
    } else {
      persistChatCity(city);
    }

    setChatCity(city, { persist: true });
  });
}

function setupChatCitySync() {
  if (_chatCitySyncBound) return;
  _chatCitySyncBound = true;

  window.addEventListener('citymart:city-changed', (event) => {
    setChatCity(event.detail?.city || getCurrentChatCity());
  });

  window.addEventListener('storage', (event) => {
    if (event.key === CHAT_CITY_STORAGE_KEY) {
      setChatCity(event.newValue || CHAT_CITY_FALLBACK);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      setChatCity(getCurrentChatCity());
    }
  });
}

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ UI Creation Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
function createChatUI() {
  if (document.getElementById('global-chat-panel')) return;

  // Chat Panel (fullscreen overlay on mobile)
  const panel = document.createElement('div');
  panel.id = 'global-chat-panel';
  panel.innerHTML = `
    <div class="gc-container">
      <div class="gc-header">
        <div class="gc-header-left">
          <div class="gc-header-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div>
            <div class="gc-header-title" id="gc-header-title">Chat CityMart</div>
            <div class="gc-header-sub" id="gc-online-label">Comunidad en vivo</div>
          </div>
        </div>
        <div class="gc-header-right">
          <div class="gc-city-chip" id="gc-city-chip">Lamas</div>
          <div class="gc-ttl-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            24h
          </div>
          <button class="gc-close-btn" id="gc-close-btn" aria-label="Cerrar chat">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      ${getChatInlineAdMarkup()}
      <div class="gc-messages" id="gc-messages">
        <div class="gc-empty-state" id="gc-empty-state">
          <div style="font-size: 3rem; margin-bottom: 12px; opacity: 0.8;">&#x1F4AC;</div>
          <p style="font-weight: 800; color: #1e293b; margin-bottom: 4px;">&iexcl;Saluda a tus vecinos!</p>
          <span id="gc-empty-sub" style="font-size: 0.75rem; color: #64748b; font-weight: 500;">Los mensajes desaparecen cada 24 horas.</span>
        </div>
      </div>
      <div class="gc-input-area" id="gc-input-area">
        <div class="gc-login-prompt" id="gc-login-prompt" style="display:none;">
          <p>Inicia sesi&oacute;n para participar</p>
          <a href="login.html" class="gc-login-btn">Ingresar</a>
        </div>
        <div class="gc-compose gc-compose-shell" id="gc-compose" style="display:none;">
          <div class="gc-compose-row">
            ${getChatImagePickerMarkup()}
            <input type="text" id="gc-input" class="gc-input" placeholder="Escribe un mensaje..." maxlength="${CHAT_MSG_MAX_LENGTH}" autocomplete="off">
            <button id="gc-send-btn" class="gc-send-btn" aria-label="Enviar">
              ${getChatSendIcon()}
            </button>
          </div>
          <div class="gc-upload-status" id="gc-upload-status" aria-live="polite" style="display:none;">
            ${getChatSpinnerIcon()}
            <span>Subiendo...</span>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Event listeners
  document.getElementById('gc-close-btn').addEventListener('click', toggleChat);
  bindChatComposer();
  initializeChatInlineAds(panel);

  // Close on backdrop click
  panel.addEventListener('click', (e) => {
    if (e.target === panel) toggleChat();
  });

  updateChatCityUI();
}

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Toggle Chat Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
export function toggleChat() {
  const panel = document.getElementById('global-chat-panel');
  if (!panel) return;

  const opening = !_chatOpen;
  if (opening) {
    setChatCity(getCurrentChatCity(), { startIfOpen: false });
  }

  _chatOpen = opening;
  panel.classList.toggle('open', _chatOpen);
  document.body.style.overflow = _chatOpen ? 'hidden' : '';

  if (_chatOpen) {
    markChatCitySeen(_chatCity);
    updateAuthUI();
    scrollChatToBottom();
    // Focus input after animation
    setTimeout(() => {
      const input = document.getElementById('gc-input');
      if (input && _chatUser) input.focus();
    }, 350);
    setTimeout(resizeChatInlineAds, 120);

    if (!_chatUnsubscribeAdded) {
      startChatListener();
    }
  }
}

function updateAuthUI() {
  const loginPrompt = document.getElementById('gc-login-prompt');
  const compose = document.getElementById('gc-compose');
  if (!loginPrompt || !compose) return;

  if (_chatUser) {
    loginPrompt.style.display = 'none';
    compose.style.display = 'flex';
  } else {
    loginPrompt.style.display = 'flex';
    compose.style.display = 'none';
  }
}

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Chat Badge on Nav Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
function updateChatBadge() {
  const badge = document.getElementById('gc-nav-badge');
  if (!badge) return;

  if (_chatUnreadCount > 0 && !_chatOpen) {
    badge.textContent = _chatUnreadCount > 9 ? '9+' : _chatUnreadCount;
    badge.style.display = 'flex';
  } else {
    badge.textContent = '0';
    badge.style.display = 'none';
  }
}

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Realtime DB Listener Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
async function startChatListener() {
  if (_chatUnsubscribeAdded) return;

  try {
    const { rtdb } = await import('./firebase-init.js');
    const { ref, query, orderByChild, limitToLast, onChildAdded, onChildRemoved } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js');

    _chatChannelPath = buildChatPath(_chatCity);
    const chatRef = ref(rtdb, _chatChannelPath);
    const chatQuery = query(chatRef, orderByChild('timestamp'), limitToLast(CHAT_MAX_RENDER));
    _chatListenerStartedAt = Date.now();

    _chatUnsubscribeAdded = onChildAdded(chatQuery, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      // Check TTL Ã¢â‚¬â€ skip expired
      if (Date.now() - data.timestamp > CHAT_TTL_MS) return;

      const msg = { id: snapshot.key, city: _chatCity, ...data };
      if (normalizeChatCity(msg.city) !== _chatCity) return;

      // Avoid duplicates
      if (_chatMessages.find(m => m.id === msg.id)) return;

      _chatMessages.push(msg);
      _chatMessages.sort((a, b) => a.timestamp - b.timestamp);

      // Keep only recent
      if (_chatMessages.length > CHAT_MAX_RENDER) {
        _chatMessages = _chatMessages.slice(-CHAT_MAX_RENDER);
      }

      renderChatMessages();

      const messageTimestamp = Number(msg.timestamp || 0);
      const isNewRealUnread =
        !_chatOpen &&
        !_chatStandalone &&
        msg.uid !== _chatUser?.uid &&
        messageTimestamp > _chatListenerStartedAt &&
        messageTimestamp > getChatSeenAt(msg.city);

      if (isNewRealUnread) {
        _chatUnreadCount++;
        updateChatBadge();
      }

      if (_chatOpen || _chatStandalone) {
        markChatCitySeen(msg.city, Math.max(Date.now(), messageTimestamp));
      }

      _chatInitialized = true;
    });

    _chatUnsubscribeRemoved = onChildRemoved(chatQuery, (snapshot) => {
      _chatMessages = _chatMessages.filter(m => m.id !== snapshot.key);
      renderChatMessages();
    });

  } catch (err) {
    console.error('[GlobalChat] Listener error:', err);
  }
}

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Render Messages Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
function renderChatMessages() {
  const container = document.getElementById('gc-messages');
  const emptyState = document.getElementById('gc-empty-state');
  if (!container) return;

  // Filter expired client-side
  const now = Date.now();
  const validMessages = _chatMessages.filter(m => now - m.timestamp < CHAT_TTL_MS);

  if (validMessages.length === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    // Remove all message elements
    container.querySelectorAll('.gc-msg').forEach(el => el.remove());
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  // Build HTML
  const currentUid = _chatUser?.uid || '';
  const fragment = document.createDocumentFragment();

  validMessages.forEach(msg => {
    // Check if already rendered
    if (container.querySelector(`[data-msg-id="${msg.id}"]`)) return;

    const isMine = msg.uid === currentUid;
    const isAdmin = msg.role === 'admin';
    const safeImageUrl = getSafeChatImageUrl(msg.imageUrl);
    const messageText = String(msg.text || '').trim();
    if (!messageText && !safeImageUrl) return;
    const bubbleClass = `gc-msg-bubble${safeImageUrl ? ' gc-msg-media-bubble' : ''}${!messageText ? ' gc-msg-image-only' : ''}`;
    const textHtml = messageText ? `<div class="gc-msg-text">${_chatEscapeHtml(messageText)}</div>` : '';
    const imageHtml = safeImageUrl
      ? `<button type="button" class="gc-chat-image-button" data-chat-image-url="${_chatEscapeHtml(safeImageUrl)}" aria-label="Ver foto en pantalla completa"><img src="${_chatEscapeHtml(safeImageUrl)}" alt="Foto enviada en el chat" loading="lazy"></button>`
      : '';

    const div = document.createElement('div');
    div.className = `gc-msg ${isMine ? 'gc-msg-mine' : 'gc-msg-other'} ${isAdmin ? 'gc-msg-admin' : ''}`;
    div.dataset.msgId = msg.id;
    div.innerHTML = `
      ${!isMine ? `
        <div class="gc-msg-avatar">
          ${msg.userAvatar 
            ? `<img src="${_chatEscapeHtml(msg.userAvatar)}" alt="" loading="lazy">`
            : `<span>${_chatEscapeHtml((msg.userName || '?')[0].toUpperCase())}</span>`
          }
        </div>
      ` : ''}
      <div class="gc-msg-content">
        ${!isMine ? `<div class="gc-msg-name">${_chatEscapeHtml(msg.userName || 'AnÃƒÂ³nimo')}${isAdmin ? ' <span class="gc-admin-tag">ADMIN</span>' : ''}</div>` : ''}
        <div class="${bubbleClass}">${textHtml}${imageHtml}</div>
        <div class="gc-msg-time">${_chatTimeAgo(msg.timestamp)}</div>
      </div>
    `;

    fragment.appendChild(div);
  });

  container.appendChild(fragment);
  scrollChatToBottom();
}

function scrollChatToBottom() {
  const container = document.getElementById('gc-messages');
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Send Message Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
async function pushChatMessage({ text = '', imageUrl = '', imagePath = '' }) {
  const { rtdb } = await import('./firebase-init.js');
  const { ref, push } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js');

  const userName = _chatUserData?.nombre || _chatUserData?.displayName || _chatUser.displayName || _chatUser.email?.split('@')[0] || 'Anonimo';
  const userAvatar = _chatUserData?.photoURL || _chatUser.photoURL || '';
  const isAdmin = _chatUser.email === 'admin@gmail.com';
  const city = normalizeChatCity(_chatCity);
  const chatRef = ref(rtdb, buildChatPath(city));
  const payload = {
    uid: _chatUser.uid,
    userName: String(userName).slice(0, 40),
    userAvatar: String(userAvatar).slice(0, 500),
    text: String(text || '').slice(0, CHAT_MSG_MAX_LENGTH),
    city: city,
    timestamp: Date.now(),
    role: isAdmin ? 'admin' : 'user'
  };

  if (imageUrl) payload.imageUrl = String(imageUrl).slice(0, 1200);
  if (imagePath) payload.imagePath = String(imagePath).slice(0, 300);

  await push(chatRef, payload);
}

function loadChatImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('image-decode-failed'));
    };
    image.src = objectUrl;
  });
}

function drawChatImageToCanvas(image, maxDimension) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return canvas;
}

function canvasToWebpBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('webp-encode-failed'));
      }
    }, 'image/webp', quality);
  });
}

async function optimizeChatImage(file) {
  try {
    const image = await loadChatImage(file);
    let maxDimension = CHAT_IMAGE_MAX_DIMENSION;
    let bestBlob = null;
    let bestUnderHardLimit = null;

    while (maxDimension >= CHAT_IMAGE_MIN_DIMENSION) {
      const canvas = drawChatImageToCanvas(image, maxDimension);

      for (const quality of CHAT_IMAGE_QUALITY_STEPS) {
        const blob = await canvasToWebpBlob(canvas, quality);

        if (!bestBlob || blob.size < bestBlob.size) {
          bestBlob = blob;
        }

        if (blob.size <= CHAT_IMAGE_HARD_MAX_BYTES) {
          if (!bestUnderHardLimit || blob.size < bestUnderHardLimit.size) {
            bestUnderHardLimit = blob;
          }

          if (blob.size <= CHAT_IMAGE_TARGET_BYTES) return blob;
        }
      }

      maxDimension = Math.floor(maxDimension * 0.8);
    }

    if (bestUnderHardLimit) return bestUnderHardLimit;

    throw new Error(`optimized-image-too-large:${bestBlob ? bestBlob.size : 0}`);
  } catch (error) {
    console.error('[GlobalChat] Optimization error:', error);
    throw error;
  }
}

async function handleChatImageSelected(event) {
  if (!_chatUser || _chatUploadingImage) return;

  const fileInput = event.currentTarget;
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = '';
  if (!file) return;

  if (!file.type || !file.type.startsWith('image/')) {
    showChatError('Selecciona una imagen valida.');
    return;
  }

  const now = Date.now();
  if (now - _chatLastSendTime < CHAT_RATE_LIMIT_MS) return;
  _chatLastSendTime = now;

  const input = document.getElementById('gc-input');
  const caption = _chatSanitize(input?.value || '');

  try {
    setChatUploadState(true, 'Optimizando foto...');
    const optimized = await optimizeChatImage(file);
    if (!optimized) throw new Error('image-optimization-failed');
    if (optimized.size > CHAT_IMAGE_HARD_MAX_BYTES) throw new Error(`optimized-image-too-large:${optimized.size}`);

    const sizeKb = Math.max(1, Math.round(optimized.size / 1024));
    setChatUploadState(true, `Subiendo foto (${sizeKb} KB)...`);

    const { storage } = await import('./firebase-init.js');
    const { ref: storageRef, uploadBytes, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js');

    const city = normalizeChatCity(_chatCity);
    const safeUid = String(_chatUser.uid || 'user').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'user';
    const filePath = `chat_photos/${city}/${Date.now()}_${safeUid}.webp`;
    const photoRef = storageRef(storage, filePath);

    await uploadBytes(photoRef, optimized, {
      contentType: 'image/webp',
      customMetadata: {
        city,
        uid: _chatUser.uid,
        source: 'global_chat'
      }
    });
    const imageUrl = await getDownloadURL(photoRef);
    await pushChatMessage({ text: caption, imageUrl, imagePath: filePath });

    if (input) input.value = '';
  } catch (err) {
    console.error('[GlobalChat] Image send error:', err);
    const message = String(err?.message || err || '');
    showChatError(message.includes('optimized-image-too-large')
      ? 'No se pudo reducir la foto por debajo de 100 KB. Intenta con otra foto o recortala.'
      : 'Error al enviar la foto');
  } finally {
    setChatUploadState(false);
    if (input) input.focus();
  }
}

async function sendChatMessage() {
  if (!_chatUser || _chatUploadingImage) return;

  const input = document.getElementById('gc-input');
  const sendBtn = document.getElementById('gc-send-btn');
  if (!input) return;

  const text = _chatSanitize(input.value);
  if (!text) return;

  // Rate limit
  const now = Date.now();
  if (now - _chatLastSendTime < CHAT_RATE_LIMIT_MS) {
    return;
  }
  _chatLastSendTime = now;

  // Disable while sending
  input.disabled = true;
  sendBtn.disabled = true;
  const originalBtnHTML = sendBtn.innerHTML;
  sendBtn.innerHTML = getChatSpinnerIcon();

  try {
    const { rtdb } = await import('./firebase-init.js');
    const { ref, push } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js');

    const userName = _chatUserData?.nombre || _chatUserData?.displayName || _chatUser.displayName || _chatUser.email?.split('@')[0] || 'AnÃƒÂ³nimo';
    const userAvatar = _chatUserData?.photoURL || _chatUser.photoURL || '';
    const isAdmin = _chatUser.email === 'admin@gmail.com';

    const city = normalizeChatCity(_chatCity);
    const chatRef = ref(rtdb, buildChatPath(city));
    await push(chatRef, {
      uid: _chatUser.uid,
      userName: String(userName).slice(0, 40),
      userAvatar: String(userAvatar).slice(0, 500),
      text: text,
      city: city,
      timestamp: Date.now(),
      role: isAdmin ? 'admin' : 'user'
    });

    input.value = '';

  } catch (err) {
    console.error('[GlobalChat] Send error:', err);
    if (window.showCityMartToast) {
      window.showCityMartToast('Error al enviar mensaje', 'error');
    }
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    sendBtn.innerHTML = originalBtnHTML;
    input.focus();
  }
}

/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Client-side TTL Cleanup Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
function cleanExpiredMessages() {
  const now = Date.now();
  const before = _chatMessages.length;
  _chatMessages = _chatMessages.filter(m => now - m.timestamp < CHAT_TTL_MS);
  if (_chatMessages.length !== before) {
    renderChatMessages();
  }
}

// Run cleanup every 5 minutes
setInterval(cleanExpiredMessages, 5 * 60 * 1000);


/* Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Initialize Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ */
export function initGlobalChat(auth, rtdb, options = {}) {
  const isStandalone = options.mode === 'standalone';
  if (_chatInitStarted || window.__citymartGlobalChatStarted) return;
  _chatInitStarted = true;
  window.__citymartGlobalChatStarted = true;
  _chatStandalone = isStandalone;
  setupChatCitySync();
  bindChatCityControls();
  setChatCity(getCurrentChatCity(), { force: true, startIfOpen: false });

  if (!isStandalone) {
    // Only create UI and transform buttons if we are NOT on the chat page
    if (!window.location.pathname.includes('chat.html')) {
      createChatUI();
      transformNavButton();
    }
  } else {
    // Standalone mode (for chat.html)
    _chatOpen = true;
    _chatInitialized = true;

    // We expect the containers to be passed or use defaults
    const msgContainer = options.messagesContainer || document.getElementById('gc-messages');
    const inputArea = options.inputContainer || document.getElementById('gc-input-area');
    ensureChatInlineAdShell(msgContainer);

    if (inputArea) {
      inputArea.innerHTML = createChatComposeMarkup();

      bindChatComposer();
    }
    initializeChatInlineAds(document);
  }

  updateChatCityUI();

  // Auth state
  auth.onAuthStateChanged(async (user) => {
    _chatUser = user;
    updateAuthUI();

    if (user) {
      try {
        const { getFirestore, doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
        const db = getFirestore();
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        _chatUserData = userSnap.exists() ? userSnap.data() : null;
      } catch (e) {
        _chatUserData = null;
      }
    } else {
      _chatUserData = null;
    }

    if (isStandalone) updateAuthUI();
  });

  // Start listener
  startChatListener();
}

// Transform the center nav button (+) into the Chat button
function transformNavButton() {
  document.querySelectorAll('.bottom-nav').forEach(nav => {
    const centerLink = nav.querySelector('.nav-item:nth-child(3)');
    if (!centerLink) return;

    // Change to button behavior
    centerLink.removeAttribute('href');
    centerLink.style.cursor = 'pointer';
    centerLink.classList.add('chat-nav-item');
    centerLink.onclick = (e) => {
      e.preventDefault();
      toggleChat();
    };

    const iconDiv = centerLink.querySelector('div');
    if (iconDiv) {
      iconDiv.className = 'main-action';
      // Use a premium chat mark instead of the generic bubble.
      iconDiv.innerHTML = `
        <svg class="gc-nav-chat-icon" width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5.25 6.65A4.15 4.15 0 0 1 9.4 2.5h5.2a4.15 4.15 0 0 1 4.15 4.15v3.7a4.15 4.15 0 0 1-4.15 4.15h-3.52L6.9 18.1c-.62.54-1.6.1-1.6-.72v-2.86A4.15 4.15 0 0 1 3.5 11.1V6.65h1.75Z" fill="rgba(255,255,255,0.2)" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
          <path d="M8.2 8.1h7.6M8.2 11h4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M17.8 15.6l.42.84.93.14-.67.65.16.92-.84-.44-.84.44.16-.92-.67-.65.93-.14.42-.84Z" fill="currentColor"/>
        </svg>
        <div id="gc-nav-badge" class="gc-nav-badge" style="display: none;"></div>
      `;
      // Maintain the premium circle style but with CityMart emerald theme
      iconDiv.style.background = 'linear-gradient(145deg, rgba(5,150,105,0.95), rgba(16,185,129,0.78))';
      iconDiv.style.boxShadow = '0 12px 28px rgba(5, 150, 105, 0.42), inset 0 0 0 1px rgba(255,255,255,0.24)';
    }

    const label = centerLink.querySelector('span');
    if (label) {
      label.textContent = 'Chat';
      label.style.color = '#059669';
      label.style.fontWeight = '800';
    }
  });
  updateChatBadge();
}

window.GlobalChat = {
  init: initGlobalChat,
  open: openChat,
  close: closeChat,
  toggle: toggleChat,
  setCity: (city) => setChatCity(city, { persist: true }),
  getCity: () => _chatCity,
};

window.addEventListener('open-global-chat', openChat);
