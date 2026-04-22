import { app, db } from './firebase-init.js';
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";
import { doc, setDoc, collection, query, where, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const messaging = getMessaging(app);
const auth = getAuth(app);

// Mensajes cuando la app está ABIERTA
onMessage(messaging, (payload) => {
    console.log("Notificación recibida en primer plano:", payload);
    const title = payload.notification?.title || "CityMart";
    const body = payload.notification?.body || "";

    // Mostrar notificación nativa incluso en primer plano
    if (Notification.permission === 'granted' && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => {
            reg.showNotification(title, {
                body: body,
                icon: '/assets/icons/app-icon-192-v4.png',
                badge: '/assets/icons/notification-badge.png',
                vibrate: [200, 100, 200],
                data: { url: payload.fcmOptions?.link || '/' }
            });
        });
    }
});

export const requestPushPermission = async () => {
    try {
        // Esperar a que sw.js esté listo
        const registration = await navigator.serviceWorker.ready;
        console.log("SW listo, pidiendo token FCM...");

        const currentToken = await getToken(messaging, {
            vapidKey: 'BHXe9kkx0f-tgv1tcTciXj8OuW3TZn_5ZWcM1YUBP6kMqUeyaFMeGob3J-HbI4cpN2EOSHWU7Wp7WYubRFWMnCs',
            serviceWorkerRegistration: registration
        });

        if (currentToken) {
            console.log("Token FCM:", currentToken);

            const user = auth.currentUser;
            const uid = user ? user.uid : 'anonymous';

            // Limpiar tokens anteriores de este mismo usuario para evitar duplicados
            // (ej: si tiene Safari + PWA abiertos, solo queda el más reciente)
            if (user) {
                try {
                    const tokensRef = collection(db, "fcmTokens");
                    const q = query(tokensRef, where("uid", "==", uid));
                    const existingTokens = await getDocs(q);
                    const deletePromises = [];
                    existingTokens.forEach(docSnap => {
                        // No borrar si es el mismo token que estamos registrando
                        if (docSnap.id !== currentToken) {
                            deletePromises.push(deleteDoc(doc(db, "fcmTokens", docSnap.id)));
                        }
                    });
                    if (deletePromises.length > 0) {
                        await Promise.all(deletePromises);
                        console.log(`Limpiados ${deletePromises.length} token(s) anteriores del usuario.`);
                    }
                } catch (cleanErr) {
                    console.warn("Error limpiando tokens antiguos:", cleanErr);
                }
            }

            // Guardar el token nuevo (o actualizar si ya existe)
            await setDoc(doc(db, "fcmTokens", currentToken), {
                token: currentToken,
                uid: uid,
                fecha: new Date(),
                plataforma: navigator.platform,
                contexto: window.matchMedia('(display-mode: standalone)').matches ? 'pwa' : 'browser'
            }, { merge: true });

            showToast("¡Notificaciones activadas con éxito! Recibirás alertas cuando haya noticias nuevas.");
            return true;
        } else {
            showToast("No se pudo obtener el token. Verifica los permisos.", "error");
            return false;
        }
    } catch (error) {
        console.error("Error Firebase Push:", error);
        const msg = error.message || '';
        const code = error.code || '';

        if (code === "messaging/permission-blocked" || msg.includes('permission')) {
            showToast("Notificaciones bloqueadas. Por favor permítelas en ajustes.", "error");
        } else if (code === "messaging/unsupported-browser" || msg.includes('unsupported')) {
            showToast("Tu navegador no soporta Push. Prueba con Chrome.", "error");
        } else if (msg.includes('service-worker') || msg.includes('ServiceWorker') || msg.includes('Failed to register')) {
            showToast("Error con el Service Worker. Intenta reinstalar la app.", "error");
        } else {
            const shortMsg = msg.length > 100 ? msg.substring(0, 100) + '...' : msg;
            showToast("Error al activar: " + code, "error");
        }
        return false;
    }
};
