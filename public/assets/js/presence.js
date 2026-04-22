import { rtdb } from './firebase-init.js';
import { ref, onValue, set, onDisconnect, increment, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

/**
 * Sistema de Presencia y Estadísticas en Tiempo Real
 * @author CityMart
 */
export async function initPresence() {
    console.log("%c[Presence] Inicializando...", "color: #10b981; font-weight: bold;");
    
    try {
        if (!rtdb) {
            console.error("[Presence] RTDB no está definido en firebase-init.js");
            return;
        }

        // 1. Manejo de Presencia (Usuarios en Línea)
        const sessionId = Math.random().toString(36).substring(2, 10);
        const myPresenceRef = ref(rtdb, `presence/${sessionId}`);
        
        // Al desconectarse, eliminar este registro
        onDisconnect(myPresenceRef).remove().catch(err => console.warn("[Presence] onDisconnect error:", err));
        
        // Registrar sesión actual
        set(myPresenceRef, { lastSeen: Date.now() }).catch(err => console.error("[Presence] Set presence error:", err));

        // Listener para el contador "En Línea"
        const onlineCountEl = document.getElementById('online-count');
        if (onlineCountEl) {
            onValue(ref(rtdb, 'presence'), (snapshot) => {
                const data = snapshot.val();
                let realCount = 0;
                if (data && typeof data === 'object') {
                    realCount = Object.keys(data).length;
                }
                
                // Aplicar offset +6 y mínimo de 7
                const displayCount = Math.max(7, realCount + 6);
                console.log(`[Presence] Online: ${realCount} reales -> Mostrando: ${displayCount}`);
                onlineCountEl.innerText = displayCount;
            }, (err) => {
                console.warn("[Presence] Online listener error:", err);
                onlineCountEl.innerText = "7";
            });
        }

        // 2. Manejo de Visitas (Totales y Diarias)
        const visitsEl = document.getElementById('total-visits');
        const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local estable

        const statsRef = ref(rtdb, 'stats');
        const updates = {};
        updates['total_visits'] = increment(1);
        updates[`daily_visits/${today}`] = increment(1);

        update(statsRef, updates)
            .then(() => {
                console.log("[Presence] Visita contada para:", today);
            })
            .catch(err => console.error("[Presence] Error escribiendo visitas (Reglas?):", err));

        if (visitsEl) {
            onValue(ref(rtdb, `stats/daily_visits/${today}`), (snapshot) => {
                const count = snapshot.val() || 0;
                if (count >= 1000) {
                    visitsEl.innerText = (count / 1000).toFixed(1) + 'k';
                } else {
                    visitsEl.innerText = count || "1"; // Mostrar al menos 1 si hay alguien viéndolo
                }
            }, (err) => {
                console.warn("[Presence] Visits listener error:", err);
                visitsEl.innerText = "1";
            });
        }

    } catch (error) {
        console.error("[Presence] Critical Failure:", error);
    }
}

// Hacerlo disponible globalmente para scripts que no son módulos
window.initPresence = initPresence;

