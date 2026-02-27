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

  const title = payload.notification?.title || "CityMart Lamas";
  const options = {
    body: payload.notification?.body || "",
    icon: '/assets/logo.png',
    image: payload.notification?.image || undefined,
    badge: '/assets/logo.png',
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
const CACHE_NAME = 'citymart-v20';
const PRE_CACHE_ASSETS = [
  '/',
  '/index.html',
  '/profile.html',
  '/directory.html',
  '/news.html',
  '/assets/style.css',
  '/assets/logo.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
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
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (url.origin === location.origin && (url.pathname.endsWith('.html') || url.pathname.endsWith('.css') || url.pathname.endsWith('.js') || url.pathname === '/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  if (url.href.includes('images.unsplash.com') || url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg)$/)) {
    event.respondWith(
      caches.match(event.request).then((res) => {
        return res || fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        });
      })
    );
    return;
  }
});
