import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, orderBy, query, limit } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyBkx3zTCj-PgOZZ00nWberf5ecut_8Wxpk",
    authDomain: "usuarios-citymart-lamas.firebaseapp.com",
    projectId: "usuarios-citymart-lamas",
    storageBucket: "usuarios-citymart-lamas.appspot.com",
    messagingSenderId: "306842354099",
    appId: "1:306842354099:web:8472903820959f2c858bc6"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function findMotocars() {
    const q = query(collection(db, "negocio"), orderBy("fecha_registro", "desc"), limit(10));
    const snap = await getDocs(q);
    snap.forEach(doc => {
        const d = doc.data();
        console.log(`- ID: ${doc.id}, Name: ${d.nombre}, Photo: ${d.foto || d.imagen}`);
    });
}

findMotocars().catch(console.error);
