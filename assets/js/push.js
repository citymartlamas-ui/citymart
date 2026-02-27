import { app, db } from './firebase-init.js';
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const messaging = getMessaging(app);

// Mensajes cuando la app está ABIERTA
onMessage(messaging, (payload) => {
    console.log("Notificación recibida en primer plano:", payload);
    const title = payload.notification?.title || "CityMart Lamas";
    const body = payload.notification?.body || "";

    // Mostrar notificación nativa incluso en primer plano
    if (Notification.permission === 'granted' && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
            reg.showNotification(title, {
                body: body,
                icon: '/assets/logo.png',
                badge: '/assets/logo.png',
                vibrate: [200, 100, 200],
                data: { url: payload.fcmOptions?.link || '/' }
            });
        });
    }
});

export const requestPushPermission = async () => {
    try {
        // Esperar a que sw.js esté listo (sw.js AHORA tiene Firebase Messaging integrado)
        const registration = await navigator.serviceWorker.ready;
        console.log("SW listo, pidiendo token FCM...");

        const currentToken = await getToken(messaging, {
            vapidKey: 'BHXe9kkx0f-tgv1tcTciXj8OuW3TZn_5ZWcM1YUBP6kMqUeyaFMeGob3J-HbI4cpN2EOSHWU7Wp7WYubRFWMnCs',
            serviceWorkerRegistration: registration
        });

        if (currentToken) {
            console.log("Token FCM:", currentToken);
            await setDoc(doc(db, "fcmTokens", currentToken), {
                token: currentToken,
                fecha: new Date(),
                plataforma: navigator.platform
            }, { merge: true });

            alert("¡Notificaciones activadas con éxito! Recibirás alertas cuando haya noticias nuevas.");
            return true;
        } else {
            alert("No se pudo obtener el token. Verifica los permisos de notificación en los ajustes de tu navegador.");
            return false;
        }
    } catch (error) {
        console.error("Error Firebase Push:", error);
        const msg = error.message || '';
        const code = error.code || '';

        if (code === "messaging/permission-blocked" || msg.includes('permission')) {
            alert("Notificaciones bloqueadas. Ve a Ajustes del navegador > Configuración del sitio > Notificaciones, y permite las de CityMart.");
        } else if (code === "messaging/unsupported-browser" || msg.includes('unsupported')) {
            alert("Tu navegador no soporta Push. Abre la página directamente en Google Chrome (no desde WhatsApp ni Facebook).");
        } else if (msg.includes('service-worker') || msg.includes('ServiceWorker') || msg.includes('Failed to register')) {
            alert("Error con el Service Worker. Borra los datos del sitio en Ajustes de Chrome > Configuración del sitio > usuarios-citymart-lamas.web.app > Borrar datos. Luego vuelve a instalar la app.");
        } else {
            // Mostrar solo los primeros 100 caracteres para no asustar
            const shortMsg = msg.length > 100 ? msg.substring(0, 100) + '...' : msg;
            alert("Error al activar: " + shortMsg + "\n\nCódigo: " + code);
        }
        return false;
    }
};
