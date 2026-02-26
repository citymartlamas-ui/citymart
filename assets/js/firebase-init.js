// Configuración de Firebase para CityMart Lamas
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
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const storage = getStorage(app);

export { auth, db, storage };
