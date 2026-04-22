/**
 * CityMart Global Chat — Ephemeral (24h messages)
 * Uses Firebase Realtime Database for low-latency real-time messaging.
 * Messages auto-expire after 24 hours via client-side filtering + scheduled Cloud Function.
 */

const CHAT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CHAT_MAX_RENDER = 80; // max messages to render at a time
const CHAT_MSG_MAX_LENGTH = 280;
const CHAT_RATE_LIMIT_MS = 2000; // min interval between sends
const CHAT_BAD_WORDS = ['mierda','puta','carajo','verga','pene','culo','sexo','idiota','estupido','pendejo'];

let _chatOpen = false;
let _chatUser = null;
let _chatUserData = null;
let _chatListener = null;
let _chatMessages = [];
let _chatLastSendTime = 0;
let _chatUnreadCount = 0;
let _chatInitialized = false;

/* ─── Helpers ─── */
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

/* ─── UI Creation ─── */
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div>
            <div class="gc-header-title">Chat CityMart</div>
            <div class="gc-header-sub" id="gc-online-label">Comunidad en vivo</div>
          </div>
        </div>
        <div class="gc-header-right">
          <div class="gc-ttl-badge">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
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
      <div class="gc-messages" id="gc-messages">
        <div class="gc-empty-state" id="gc-empty-state">
          <div class="gc-empty-icon">💬</div>
          <p>Se el primero en iniciar la conversacion</p>
          <span>Los mensajes desaparecen cada 24 horas</span>
        </div>
      </div>
      <div class="gc-input-area" id="gc-input-area">
        <div class="gc-login-prompt" id="gc-login-prompt" style="display:none;">
          <p>Inicia sesion para participar en el chat</p>
          <a href="login.html" class="gc-login-btn">Ingresar</a>
        </div>
        <div class="gc-compose" id="gc-compose" style="display:none;">
          <input type="text" id="gc-input" class="gc-input" placeholder="Escribe un mensaje..." maxlength="${CHAT_MSG_MAX_LENGTH}" autocomplete="off">
          <button id="gc-send-btn" class="gc-send-btn" aria-label="Enviar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Event listeners
  document.getElementById('gc-close-btn').addEventListener('click', toggleChat);
  document.getElementById('gc-send-btn').addEventListener('click', sendChatMessage);
  document.getElementById('gc-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // Close on backdrop click
  panel.addEventListener('click', (e) => {
    if (e.target === panel) toggleChat();
  });
}

/* ─── Toggle Chat ─── */
function toggleChat() {
  const panel = document.getElementById('global-chat-panel');
  if (!panel) return;

  _chatOpen = !_chatOpen;
  panel.classList.toggle('open', _chatOpen);
  document.body.style.overflow = _chatOpen ? 'hidden' : '';

  if (_chatOpen) {
    _chatUnreadCount = 0;
    updateChatBadge();
    updateAuthUI();
    scrollChatToBottom();
    // Focus input after animation
    setTimeout(() => {
      const input = document.getElementById('gc-input');
      if (input && _chatUser) input.focus();
    }, 350);

    if (!_chatListener) {
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

/* ─── Chat Badge on Nav ─── */
function updateChatBadge() {
  const badge = document.getElementById('gc-nav-badge');
  if (!badge) return;

  if (_chatUnreadCount > 0 && !_chatOpen) {
    badge.textContent = _chatUnreadCount > 9 ? '9+' : _chatUnreadCount;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

/* ─── Realtime DB Listener ─── */
async function startChatListener() {
  if (_chatListener) return;

  try {
    const { rtdb } = await import('./firebase-init.js');
    const { ref, query, orderByChild, limitToLast, onChildAdded, onChildRemoved } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js');

    const chatRef = ref(rtdb, 'global_chat');
    const chatQuery = query(chatRef, orderByChild('timestamp'), limitToLast(CHAT_MAX_RENDER));

    _chatListener = onChildAdded(chatQuery, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      // Check TTL — skip expired
      if (Date.now() - data.timestamp > CHAT_TTL_MS) return;

      const msg = { id: snapshot.key, ...data };

      // Avoid duplicates
      if (_chatMessages.find(m => m.id === msg.id)) return;

      _chatMessages.push(msg);
      _chatMessages.sort((a, b) => a.timestamp - b.timestamp);

      // Keep only recent
      if (_chatMessages.length > CHAT_MAX_RENDER) {
        _chatMessages = _chatMessages.slice(-CHAT_MAX_RENDER);
      }

      renderChatMessages();

      // Unread tracking
      if (!_chatOpen && _chatInitialized) {
        _chatUnreadCount++;
        updateChatBadge();
      }
      _chatInitialized = true;
    });

    onChildRemoved(chatQuery, (snapshot) => {
      _chatMessages = _chatMessages.filter(m => m.id !== snapshot.key);
      renderChatMessages();
    });

  } catch (err) {
    console.error('[GlobalChat] Listener error:', err);
  }
}

/* ─── Render Messages ─── */
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
        ${!isMine ? `<div class="gc-msg-name">${_chatEscapeHtml(msg.userName || 'Anonimo')}${isAdmin ? ' <span class="gc-admin-tag">ADMIN</span>' : ''}</div>` : ''}
        <div class="gc-msg-bubble">${_chatEscapeHtml(msg.text)}</div>
        <div class="gc-msg-time">${_chatTimeAgo(msg.timestamp)}</div>
      </div>
    `;

    // Entrance animation
    div.style.opacity = '0';
    div.style.transform = 'translateY(12px)';
    fragment.appendChild(div);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        div.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        div.style.opacity = '1';
        div.style.transform = 'translateY(0)';
      });
    });
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

/* ─── Send Message ─── */
async function sendChatMessage() {
  if (!_chatUser) return;

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

  try {
    const { rtdb } = await import('./firebase-init.js');
    const { ref, push, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js');

    const userName = _chatUserData?.nombre || _chatUserData?.displayName || _chatUser.displayName || _chatUser.email?.split('@')[0] || 'Anonimo';
    const userAvatar = _chatUserData?.photoURL || _chatUser.photoURL || '';
    const isAdmin = _chatUser.email === 'admin@gmail.com';

    const chatRef = ref(rtdb, 'global_chat');
    await push(chatRef, {
      uid: _chatUser.uid,
      userName: String(userName).slice(0, 40),
      userAvatar: String(userAvatar).slice(0, 500),
      text: text,
      timestamp: Date.now(),
      role: isAdmin ? 'admin' : 'user'
    });

    input.value = '';

  } catch (err) {
    console.error('[GlobalChat] Send error:', err);
    // Show toast if available
    if (window.showCityMartToast) {
      window.showCityMartToast('Error al enviar mensaje', 'error');
    }
  } finally {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

/* ─── Client-side TTL Cleanup ─── */
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

/* ─── Nav Button Transformation ─── */
function transformNavButton() {
  // Find all bottom-nav elements and transform the center "+" button
  document.querySelectorAll('.bottom-nav').forEach(nav => {
    const centerLink = nav.querySelector('.nav-item:nth-child(3)');
    if (!centerLink) return;

    // Replace the link behavior
    centerLink.removeAttribute('href');
    centerLink.style.cursor = 'pointer';
    centerLink.classList.add('chat-nav-item');
    centerLink.onclick = (e) => {
      e.preventDefault();
      toggleChat();
    };

    // Replace the icon and remove label
    const iconDiv = centerLink.querySelector('div');
    if (iconDiv) {
      iconDiv.classList.add('main-action');
      iconDiv.style.background = 'linear-gradient(135deg, #1f6b52, #2d9f78)';
      iconDiv.style.boxShadow = '0 4px 15px rgba(31, 107, 82, 0.4)';
      iconDiv.innerHTML = `
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      `;
    }

    const label = centerLink.querySelector('span');
    if (label) {
      label.style.display = 'none'; // Remove text as requested
    }

    // Add unread badge
    if (!document.getElementById('gc-nav-badge')) {
      const badge = document.createElement('div');
      badge.id = 'gc-nav-badge';
      badge.className = 'gc-nav-badge';
      badge.style.display = 'none';
      if (iconDiv) iconDiv.appendChild(badge);
    }
  });
}

/* ─── Initialize ─── */
export function initGlobalChat(auth, db) {
  createChatUI();
  transformNavButton();

  // Auth state
  auth.onAuthStateChanged(async (user) => {
    _chatUser = user;
    updateAuthUI();

    if (user) {
      // Fetch user data for name/avatar
      try {
        const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        _chatUserData = userSnap.exists() ? userSnap.data() : null;
      } catch (e) {
        _chatUserData = null;
      }
    } else {
      _chatUserData = null;
    }
  });

  // Start listener immediately so we track unreads
  startChatListener();
}
