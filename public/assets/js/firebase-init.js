// Configuración de Firebase para CityMart
// Conectado al proyecto: usuarios-citymart-lamas

const firebaseConfig = {
    apiKey: "AIzaSyBkx3zTCj-PgOZZ00nWberf5ecut_8Wxpk",
    authDomain: "usuarios-citymart-lamas.firebaseapp.com",
    databaseURL: "https://usuarios-citymart-lamas-default-rtdb.firebaseio.com",
    projectId: "usuarios-citymart-lamas",
    storageBucket: "usuarios-citymart-lamas.appspot.com",
    messagingSenderId: "306842354099",
    appId: "1:306842354099:web:8472903820959f2c858bc6"
};

// Inicializar Firebase (esto se importará en las demás páginas)
// Nota: Usamos la versión CDN para simplicidad en desarrollo web directo
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const firestoreSettings = {
    // Algunas redes WiFi y PWAs móviles fallan con el transporte por defecto de Firestore.
    // Esto prioriza compatibilidad de red sin perder el respaldo offline de la app.
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false
};
const db = initializeFirestore(app, firestoreSettings);
const storage = getStorage(app);
const rtdb = getDatabase(app);

if (typeof window !== 'undefined') {
    window.__CITYMART_FIRESTORE_SETTINGS__ = firestoreSettings;
    window.addEventListener('online', () => console.info('[Firebase] Conexion recuperada.'));
    window.addEventListener('offline', () => console.warn('[Firebase] Sin conexion. Se usara cache local si existe.'));
}

export { app, auth, db, storage, rtdb };
