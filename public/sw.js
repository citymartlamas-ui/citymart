// ========== FIREBASE CLOUD MESSAGING ==========
importScripts("https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBkx3zTCj-PgOZZ00nWberf5ecut_8Wxpk",
  authDomain: "usuarios-citymart-lamas.firebaseapp.com",
  projectId: "usuarios-citymart-lamas",
  storageBucket: "usuarios-citymart-lamas.appspot.com",
  messagingSenderId: "306842354099",
  appId: "1:306842354099:web:8472903820959f2c858bc6"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Push recibido en background:', JSON.stringify(payload));

  // Extraer la URL de todos los lugares posibles
  const targetUrl = payload.fcmOptions?.link
    || payload.data?.link
    || payload.notification?.click_action
    || '/';

  const title = payload.notification?.title || "CityMart";
  const options = {
    body: payload.notification?.body || "",
    icon: '/assets/icons/app-icon-192-v4.png',
    image: payload.notification?.image || undefined,
    badge: '/assets/icons/notification-badge.png',
    vibrate: [200, 100, 200],
    data: { url: targetUrl }
  };
  return self.registration.showNotification(title, options);
});

// Click en notificación -> abrir la URL de la noticia
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Click en notificación, data:', event.notification.data);
  event.notification.close();

  const targetUrl = event.notification.data?.url
    || event.notification.data?.link
    || event.notification.data?.FCM_MSG?.data?.link
    || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Si ya hay una ventana abierta, navegar ahí
      for (const client of windowClients) {
        if ('navigate' in client) {
          return client.navigate(targetUrl).then(() => client.focus());
        }
      }
      // Si no, abrir ventana nueva
      return clients.openWindow(targetUrl);
    })
  );
});

// ========== PWA CACHE ==========
const CACHE_NAME = 'citymart-v70';
const PRE_CACHE_ASSETS = [
  '/index.html',
  '/manifest.json',
  '/assets/style.css',
  '/assets/logo.png',
  '/assets/placeholder.svg',
  '/assets/default-avatar.svg',
  '/assets/icons/app-icon-192-v4.png',
  '/assets/icons/app-icon-512-v4.png',
  '/assets/icons/apple-touch-icon-v4.png',
  '/assets/icons/notification-badge.png',
  '/assets/js/firebase-init.js',
  '/assets/js/utils.js',
  '/assets/js/cache.js',
  '/assets/js/pwa-init.js',
  '/assets/js/presence.js'
];

function getDocumentCacheCandidates(pathname) {
  if (!pathname || pathname === '/') {
    return ['/', '/index.html'];
  }

  const cleanedPath = pathname.replace(/\/+$/, '') || '/';
  const candidates = [cleanedPath];

  if (cleanedPath.endsWith('.html')) {
    candidates.push(cleanedPath.replace(/\.html$/i, ''));
  } else {
    candidates.push(`${cleanedPath}.html`);
  }

  return [...new Set(candidates)];
}

async function matchFirstCachedDocument(pathname) {
  const candidates = getDocumentCacheCandidates(pathname);

  for (const candidate of candidates) {
    const response = await caches.match(candidate);
    if (response) return response;
  }

  return caches.match('/index.html');
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRE_CACHE_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map((key) => {
        if (key !== CACHE_NAME) return caches.delete(key);
      })
    )).then(() => {
      // Forzar que todos los clientes usen este SW inmediatamente
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const acceptHeader = event.request.headers.get('accept') || '';

  // NUNCA interceptar llamadas a Firebase/Google APIs
  const bypassDomains = [
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'firebaseinstallations.googleapis.com',
    'fcmregistrations.googleapis.com',
    'www.googleapis.com',
    'apis.google.com',
    'www.gstatic.com',
    'firebase.googleapis.com',
    'cloudfunctions.net',
    'unpkg.com',
    'pagead2.googlesyndication.com',
    'googleads.g.doubleclick.net',
    'cdn.jsdelivr.net'
  ];
  if (bypassDomains.some(d => url.hostname.includes(d) || url.hostname.endsWith(d))) {
    return;
  }

  const isLocalDocumentRequest =
    url.origin === location.origin &&
    (
      event.request.mode === 'navigate' ||
      event.request.destination === 'document' ||
      acceptHeader.includes('text/html')
    );

  if (isLocalDocumentRequest) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }).catch(() => matchFirstCachedDocument(url.pathname))
    );
    return;
  }

  if (url.origin === location.origin && (url.pathname.endsWith('.css') || url.pathname.endsWith('.js'))) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        }).catch(() => caches.match(event.request).then((cached) => cached || caches.match(url.pathname)))
    );
    return;
  }

  const isImageRequest =
    event.request.destination === 'image' ||
    url.hostname.includes('images.unsplash.com') ||
    url.hostname.includes('firebasestorage.googleapis.com') && !url.pathname.match(/\.(mp4|webm|ogg|mov)$/i) && !url.href.includes('.mp4');

  // Excluir videos explícitamente del cache del SW para permitir Range Requests
  const isVideoRequest = event.request.destination === 'video' || url.pathname.match(/\.(mp4|webm|ogg|mov)$/i) || url.href.includes('.mp4');

  if (isVideoRequest) return; // Dejar que el navegador lo maneje normal (necesario para streaming)

  if (isImageRequest) {
    event.respondWith(
      caches.match(event.request).then((res) => {
        if (res) return res; // Si está en caché, devolver INMEDIATAMENTE

        return fetch(event.request).then((response) => {
          if (!response || response.status !== 200) return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        }).catch(() => {
          console.warn('[SW/Cache] Imagen falló y no hay cache');
          return new Response(''); // Evitar error de red que rompe el render
        });
      })
    );
    return;
  }
});

