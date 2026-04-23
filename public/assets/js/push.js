import { app, db } from './firebase-init.js';
import { getMessaging, getToken, isSupported, onMessage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";
import { doc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const VAPID_KEY = 'BHXe9kkx0f-tgv1tcTciXj8OuW3TZn_5ZWcM1YUBP6kMqUeyaFMeGob3J-HbI4cpN2EOSHWU7Wp7WYubRFWMnCs';
const PUSH_TOKEN_REGISTERED_KEY = 'citymart_push_token_registered';
const PUSH_TOKEN_VALUE_KEY = 'citymart_push_token_value';
const auth = getAuth(app);
let messagingPromise = null;

function showPushToast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
        return;
    }

    if (typeof window.showCityMartToast === 'function') {
        window.showCityMartToast(message, type);
        return;
    }

    console.log(`[Push:${type}] ${message}`);
}

function isStandalonePwa() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function waitForAuthUser(timeoutMs = 3500) {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);

    return new Promise((resolve) => {
        let settled = false;
        let unsubscribe = () => {};
        const finish = (user) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            unsubscribe();
            resolve(user || auth.currentUser || null);
        };
        const timer = setTimeout(() => finish(auth.currentUser), timeoutMs);
        unsubscribe = onAuthStateChanged(auth, finish, () => finish(null));
    });
}

async function getMessagingInstance() {
    if (!messagingPromise) {
        messagingPromise = isSupported().then((supported) => {
            if (!supported) return null;
            return getMessaging(app);
        });
    }

    return messagingPromise;
}

async function getServiceWorkerRegistration() {
    if (!('serviceWorker' in navigator)) {
        throw new Error('service-worker-unavailable');
    }

    if (typeof window.registerCityMartPWA === 'function') {
        await window.registerCityMartPWA().catch(() => null);
    } else {
        await navigator.serviceWorker.register('/sw.js', {
            scope: '/',
            updateViaCache: 'none'
        }).catch(() => null);
    }

    return navigator.serviceWorker.ready;
}

async function requestBrowserNotificationPermission() {
    if (!('Notification' in window)) {
        throw new Error('notifications-unavailable');
    }

    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';

    return Notification.requestPermission();
}

async function savePushToken(currentToken, user) {
    const context = isStandalonePwa() ? 'pwa' : 'browser';
    await setDoc(doc(db, "fcmTokens", currentToken), {
        token: currentToken,
        uid: user.uid,
        email: user.email || "",
        permission: Notification.permission,
        plataforma: navigator.platform || "",
        contexto: context,
        userAgent: navigator.userAgent || "",
        updatedAt: serverTimestamp(),
        fecha: serverTimestamp(),
    }, { merge: true });

    try {
        localStorage.setItem(PUSH_TOKEN_REGISTERED_KEY, 'true');
        localStorage.setItem(PUSH_TOKEN_VALUE_KEY, currentToken);
    } catch (error) {
        // Ignore localStorage failures.
    }
}

export const requestPushPermission = async (options = {}) => {
    const silent = options.silent === true;
    const notify = (message, type = 'info') => {
        if (!silent) showPushToast(message, type);
    };

    try {
        if (!window.isSecureContext) {
            notify("Las notificaciones requieren HTTPS.", "error");
            return false;
        }

        if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
            notify("Este navegador no soporta notificaciones push. Prueba con Chrome actualizado.", "error");
            return false;
        }

        const user = await waitForAuthUser();
        if (!user) {
            notify("Inicia sesion para activar notificaciones en este dispositivo.", "error");
            return false;
        }

        const permission = await requestBrowserNotificationPermission();
        if (permission !== 'granted') {
            notify("No se activaron las notificaciones. Permitelas en los ajustes del navegador.", "error");
            return false;
        }

        const messaging = await getMessagingInstance();
        if (!messaging) {
            notify("Tu navegador no soporta Firebase Push. Prueba con Chrome actualizado.", "error");
            return false;
        }

        const registration = await getServiceWorkerRegistration();
        const currentToken = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: registration
        });

        if (!currentToken) {
            notify("No se pudo obtener el token de notificaciones.", "error");
            return false;
        }

        await savePushToken(currentToken, user);
        notify("Notificaciones activadas en este dispositivo.", "success");
        return true;
    } catch (error) {
        console.error("Error Firebase Push:", error);
        const msg = String(error.message || '');
        const code = String(error.code || '');

        if (code === "messaging/permission-blocked" || msg.includes('permission') || msg.includes('denied')) {
            notify("Notificaciones bloqueadas. Permitelas en los ajustes de Chrome o de la PWA.", "error");
        } else if (code === "messaging/unsupported-browser" || msg.includes('unsupported')) {
            notify("Tu navegador no soporta Push. Prueba con Chrome actualizado.", "error");
        } else if (msg.includes('service-worker') || msg.includes('ServiceWorker') || msg.includes('Failed to register')) {
            notify("Error con el Service Worker. Cierra y abre la PWA, o reinstalala.", "error");
        } else if (code === "permission-denied") {
            notify("No se pudo guardar el dispositivo. Inicia sesion de nuevo e intenta activar.", "error");
        } else {
            notify(`Error al activar notificaciones: ${code || msg.slice(0, 80)}`, "error");
        }
        return false;
    }
};

getMessagingInstance().then((messaging) => {
    if (!messaging) return;

    onMessage(messaging, (payload) => {
        console.log("Notificacion recibida en primer plano:", payload);
        if (Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;

        const title = payload.notification?.title || "CityMart";
        const body = payload.notification?.body || "";
        const url = payload.fcmOptions?.link || payload.data?.link || '/';
        const image = payload.notification?.image || undefined;

        navigator.serviceWorker.ready.then((registration) => {
            registration.showNotification(title, {
                body,
                icon: '/assets/icons/app-icon-192-v4.png',
                image,
                badge: '/assets/icons/notification-badge.png',
                vibrate: [200, 100, 200],
                data: { url }
            });
        }).catch(() => null);
    });
}).catch((error) => {
    console.warn("[Push] Firebase Messaging no disponible:", error);
});
