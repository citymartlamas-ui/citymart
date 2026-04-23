// Este archivo es requerido por Firebase Messaging en Android
// Redirige al Service Worker principal (sw.js) que contiene toda la lógica
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
    const targetUrl = payload.fcmOptions?.link
        || payload.data?.link
        || payload.notification?.click_action
        || '/';
    const title = payload.notification?.title || "CityMart";

    return self.registration.showNotification(title, {
        body: payload.notification?.body || "",
        icon: '/assets/icons/app-icon-192-v4.png',
        image: payload.notification?.image || undefined,
        badge: '/assets/icons/notification-badge.png',
        vibrate: [200, 100, 200],
        data: { url: targetUrl }
    });
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification.data?.url
        || event.notification.data?.link
        || event.notification.data?.FCM_MSG?.data?.link
        || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if ('navigate' in client) {
                    return client.navigate(targetUrl).then(() => client.focus());
                }
            }
            return clients.openWindow(targetUrl);
        })
    );
});
