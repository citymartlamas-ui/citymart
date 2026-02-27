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
