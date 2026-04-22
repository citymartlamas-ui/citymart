import { app, auth, db } from "./firebase-init.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    where
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const PROJECT_ID = app.options.projectId;
const FUNCTIONS_REGION = "us-central1";
const FUNCTIONS_BASE_URL = `https://${FUNCTIONS_REGION}-${PROJECT_ID}.cloudfunctions.net`;
const PERU_OFFSET_MS = 5 * 60 * 60 * 1000;
const LOCAL_PREFIX = "cm_citycash_";
const LOCAL_TTL = {
    ranking: 90 * 1000,
    user: 60 * 1000,
    businesses: 5 * 60 * 1000
};

export const CITYCASH_ACTIONS = [
    {
        key: "register_business",
        amount: 50,
        title: "Registrar negocio",
        eyebrow: "Impulso de arranque",
        copy: "Activa tu escaparate dentro de CityMart y gana una bolsa fuerte para competir desde el primer dia.",
        impact: "Entrada directa al ranking",
        icon: "store",
        ctaLabel: "Crear negocio",
        href: "register_business.html"
    },
    {
        key: "social_wall_post",
        amount: 10,
        title: "Publicar en Muro Social",
        eyebrow: "Comunidad activa",
        copy: "Abre una conversacion real con tu ciudad y suma saldo por aportar movimiento y participacion local.",
        impact: "Mas visibilidad para tu actividad social",
        icon: "messages-square",
        ctaLabel: "Ir al Muro Social",
        href: "community.html"
    },
    {
        key: "marketplace_post",
        amount: 5,
        title: "Publicar en Marketplace",
        eyebrow: "Movimiento rapido",
        copy: "Usa Marketplace 6H para mover demanda real, generar atencion y seguir acumulando saldo util.",
        impact: "Mantente activo frente a tu ciudad",
        icon: "megaphone",
        ctaLabel: "Ir a Marketplace",
        href: "community.html"
    },
    {
        key: "create_promo",
        amount: 30,
        title: "Subir promocion",
        eyebrow: "Empuje comercial",
        copy: "Convierte una oferta en alcance y prepara tu negocio para pelear por los espacios mas vistos del Home.",
        impact: "Mas traccion para destacar",
        icon: "badge-percent",
        ctaLabel: "Subir promocion",
        href: "create_promo.html"
    },
    {
        key: "complete_profile",
        amount: 10,
        title: "Completar perfil",
        eyebrow: "Confianza primero",
        copy: "Nombre, telefono, direccion y bio claros hacen que tu negocio se vea serio y convierta mejor.",
        impact: "Credibilidad que suma visibilidad",
        icon: "id-card",
        ctaLabel: "Completar perfil",
        href: "profile.html"
    },
    {
        key: "invite_friend",
        amount: 40,
        title: "Invitar a un amigo",
        eyebrow: "Crecimiento compartido",
        copy: "Expande la comunidad, comparte tu codigo y desbloquea una de las recompensas mas altas de CityCash.",
        impact: "Mas red, mas oportunidades",
        icon: "user-plus",
        ctaLabel: "Invitar ahora",
        href: "citycash.html?view=earn#invite"
    }
];

export const CITYCASH_SLOT_CONFIG = {
    large: { price: 500, limit: 1, label: "Posicion grande", order: 0 },
    medium: { price: 350, limit: 2, label: "Posicion mediana", order: 1 },
    small: { price: 200, limit: 10, label: "Posicion pequena", order: 2 }
};

export const CITYCASH_PHRASES = [
    {
        eyebrow: "Competencia real",
        title: "La visibilidad no se espera, se conquista.",
        copy: "Cada accion real dentro de CityMart puede empujar tu negocio hacia las zonas mas vistas del Home."
    },
    {
        eyebrow: "Ranking semanal",
        title: "Compra primero y toma ventaja.",
        copy: "Los mejores lugares se ocupan por orden de pago, asi que el movimiento rapido vale mas."
    },
    {
        eyebrow: "Moneda util",
        title: "CityCash convierte actividad en exposicion.",
        copy: "Tu esfuerzo en Marketplace, perfil, promos e invitaciones regresa como presencia visible."
    },
    {
        eyebrow: "Mentalidad de crecimiento",
        title: "Mas exposicion trae mas oportunidades.",
        copy: "Usa tu saldo para destacar el negocio correcto, en la ciudad correcta y en el momento correcto."
    }
];

function readCache(key, ttl = LOCAL_TTL.user) {
    try {
        const raw = localStorage.getItem(`${LOCAL_PREFIX}${key}`);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (!parsed || (Date.now() - Number(parsed.timestamp || 0)) > ttl) {
            return null;
        }

        return parsed.data;
    } catch (error) {
        return null;
    }
}

function writeCache(key, data) {
    try {
        localStorage.setItem(`${LOCAL_PREFIX}${key}`, JSON.stringify({
            timestamp: Date.now(),
            data
        }));
    } catch (error) {
        // Ignore storage failures.
    }
}

function dropCache(key) {
    try {
        localStorage.removeItem(`${LOCAL_PREFIX}${key}`);
    } catch (error) {
        // Ignore cache removal failures.
    }
}

function normalizeCityCashText(value = "") {
    return String(value)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

export function normalizeCityCashCity(value = "lamas") {
    const normalized = normalizeCityCashText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return normalized || "lamas";
}

export function getCityCashCityLabel(city = "lamas") {
    const normalized = normalizeCityCashCity(city);
    if (normalized === "lamas") return "Lamas";
    if (normalized === "tarapoto") return "Tarapoto";
    return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1).replace(/_/g, " ") : "tu ciudad";
}

export function buildCityCashWeekWindow(rawNow = new Date()) {
    const now = rawNow instanceof Date ? rawNow : new Date(rawNow);
    const pseudoUtc = new Date(now.getTime() - PERU_OFFSET_MS);
    const dayOfWeek = pseudoUtc.getUTCDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const pseudoWeekStartMs = Date.UTC(
        pseudoUtc.getUTCFullYear(),
        pseudoUtc.getUTCMonth(),
        pseudoUtc.getUTCDate() - diffToMonday,
        0,
        0,
        0,
        0
    );

    const startAt = new Date(pseudoWeekStartMs + PERU_OFFSET_MS);
    const endAt = new Date(startAt.getTime() + (7 * 24 * 60 * 60 * 1000));
    const pseudoStart = new Date(pseudoWeekStartMs);
    const weekKey = `${pseudoStart.getUTCFullYear()}${String(pseudoStart.getUTCMonth() + 1).padStart(2, "0")}${String(pseudoStart.getUTCDate()).padStart(2, "0")}`;

    return { weekKey, startAt, endAt };
}

function getTimestampMs(value) {
    if (!value) return 0;
    if (typeof value.toDate === "function") return value.toDate().getTime();
    if (typeof value.seconds === "number") return value.seconds * 1000;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
}

async function callCityCashEndpoint(endpoint, payload = {}) {
    const user = auth.currentUser;
    if (!user) throw new Error("auth-required");

    const token = await user.getIdToken();
    const response = await fetch(`${FUNCTIONS_BASE_URL}/${endpoint}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
        throw new Error(data.error || `citycash-${endpoint}-failed`);
    }

    return data;
}

export function formatCityCashBalance(balance = 0) {
    return `\u{1FA99} ${Number(balance || 0)}`;
}

export function formatCityCashAmount(amount = 0) {
    const value = Number(amount || 0);
    return `${value > 0 ? "+" : ""}${value}`;
}

export function formatCityCashDate(value) {
    const time = typeof value === "number" ? value : getTimestampMs(value);
    if (!time) return "Ahora";
    return new Intl.DateTimeFormat("es-PE", {
        day: "2-digit",
        month: "short"
    }).format(new Date(time));
}

export function showCityCashRewardToast(result) {
    if (!result || !result.awarded || !window.showToast) return;
    window.showToast(`\u{1F389} Ganaste CityCash! +${result.amount} anadidos a tu cuenta`, "success");
}

export function showCityCashSpendToast(result) {
    if (!result || !result.purchased || !window.showToast) return;
    window.showToast(`CityCash usado: -${result.price}. Tu negocio ya entro al ranking.`, "success");
}

export function invalidateCityCashUserCache(uid) {
    if (!uid) return;
    dropCache(`user_${uid}`);
    dropCache(`businesses_${uid}`);
}

export function invalidateCityCashRankingCache() {
    dropCache(`ranking_${buildCityCashWeekWindow().weekKey}`);
}

export async function awardCityCashAction(actionKey, sourceId = "", meta = {}) {
    const result = await callCityCashEndpoint("claimCityCash", { actionKey, sourceId, ...meta });
    if (auth.currentUser?.uid) invalidateCityCashUserCache(auth.currentUser.uid);
    return result;
}

export async function purchaseCityCashRanking({ businessId, slotType, city }) {
    const result = await callCityCashEndpoint("purchaseCityCashRanking", {
        businessId,
        slotType,
        city: normalizeCityCashCity(city)
    });
    if (auth.currentUser?.uid) invalidateCityCashUserCache(auth.currentUser.uid);
    invalidateCityCashRankingCache();
    return result;
}

export async function grantCityCashAdmin({ targetUid = "", amount = 0, label = "Bono administrador", grantKey = "", note = "" } = {}) {
    const result = await callCityCashEndpoint("grantCityCashAdmin", {
        targetUid,
        amount,
        label,
        grantKey,
        note
    });

    const uidToRefresh = targetUid || auth.currentUser?.uid;
    if (uidToRefresh) invalidateCityCashUserCache(uidToRefresh);
    return result;
}

export async function fetchUserCityCash(uid, { force = false } = {}) {
    const cacheKey = `user_${uid}`;
    if (!force) {
        const cached = readCache(cacheKey, LOCAL_TTL.user);
        if (cached) return cached;
    }

    const snapshot = await getDoc(doc(db, "users", uid));
    const data = snapshot.data() || {};
    const stats = data.cityCashStats || {};
    const result = {
        balance: Number(data.cityCashBalance || 0),
        stats: {
            totalEarned: Number(stats.totalEarned || 0),
            totalSpent: Number(stats.totalSpent || 0)
        },
        recent: Array.isArray(data.cityCashRecent) ? data.cityCashRecent.slice(0, 6) : [],
        raw: data
    };

    writeCache(cacheKey, result);
    return result;
}

export async function fetchUserCityCashTransactions(uid, { force = false, limitCount = 6 } = {}) {
    const summary = await fetchUserCityCash(uid, { force });
    return Array.isArray(summary.recent) ? summary.recent.slice(0, limitCount) : [];
}

export async function fetchUserBusinesses(uid, { force = false } = {}) {
    const cacheKey = `businesses_${uid}`;
    if (!force) {
        const cached = readCache(cacheKey, LOCAL_TTL.businesses);
        if (cached) return cached;
    }

    const businessesQuery = query(collection(db, "negocio"), where("uid", "==", uid));
    const snapshot = await getDocs(businessesQuery);
    const items = snapshot.docs
        .map((docSnap) => {
            const data = docSnap.data() || {};
            return {
                id: docSnap.id,
                nombre: data.nombre || "Mi negocio",
                categoria: data.categoria || "Negocio local",
                ciudad: normalizeCityCashCity(data.ciudad || data.provincia || "lamas"),
                image: data.foto_thumb || data.imagen_thumb || data.foto || data.imagen || "assets/placeholder.svg"
            };
        })
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    writeCache(cacheKey, items);
    return items;
}

export async function fetchCurrentCityCashRanking({ force = false } = {}) {
    const weekWindow = buildCityCashWeekWindow();
    const cacheKey = `ranking_${weekWindow.weekKey}`;
    if (!force) {
        const cached = readCache(cacheKey, LOCAL_TTL.ranking);
        if (cached) return cached;
    }

    const snapshot = await getDoc(doc(db, "citycash_weeks", weekWindow.weekKey));
    const data = snapshot.data() || {};
    const result = {
        weekKey: weekWindow.weekKey,
        startAt: weekWindow.startAt,
        endAt: weekWindow.endAt,
        rankings: data.rankings && typeof data.rankings === "object" ? data.rankings : {}
    };

    writeCache(cacheKey, result);
    return result;
}

function buildEmptyBoard() {
    return {
        large: Array.from({ length: CITYCASH_SLOT_CONFIG.large.limit }, () => null),
        medium: Array.from({ length: CITYCASH_SLOT_CONFIG.medium.limit }, () => null),
        small: Array.from({ length: CITYCASH_SLOT_CONFIG.small.limit }, () => null)
    };
}

export function buildCityCashBoard(rankingPayload = {}, city = "lamas") {
    // Si rankingPayload tiene una propiedad .rankings, úsala (soporte para respuesta completa de Firestore)
    const sourceData = (rankingPayload && rankingPayload.rankings && typeof rankingPayload.rankings === 'object')
        ? rankingPayload.rankings
        : rankingPayload;

    const rankings = Array.isArray(sourceData)
        ? { [normalizeCityCashCity(city)]: sourceData }
        : (sourceData && typeof sourceData === "object" ? sourceData : {});

    const normalizedCity = normalizeCityCashCity(city);
    const cityBoard = rankings[normalizedCity] && typeof rankings[normalizedCity] === "object"
        ? rankings[normalizedCity]
        : buildEmptyBoard();

    return {
        large: Array.isArray(cityBoard.large) ? cityBoard.large.slice(0, CITYCASH_SLOT_CONFIG.large.limit) : buildEmptyBoard().large,
        medium: Array.isArray(cityBoard.medium) ? cityBoard.medium.slice(0, CITYCASH_SLOT_CONFIG.medium.limit) : buildEmptyBoard().medium,
        small: Array.isArray(cityBoard.small) ? cityBoard.small.slice(0, CITYCASH_SLOT_CONFIG.small.limit) : buildEmptyBoard().small
    };
}

export function getCityCashAvailability(rankingPayload = {}, city = "lamas") {
    const board = buildCityCashBoard(rankingPayload, city);
    return Object.keys(CITYCASH_SLOT_CONFIG).reduce((acc, key) => {
        const config = CITYCASH_SLOT_CONFIG[key];
        const filled = board[key].filter(Boolean).length;
        acc[key] = {
            filled,
            available: config.limit - filled,
            total: config.limit,
            price: config.price
        };
        return acc;
    }, {});
}

export function getCityCashInvitePayload(user, city = "lamas") {
    const code = String(user?.uid || "citycash").slice(0, 8).toUpperCase();
    const cityLabel = getCityCashCityLabel(city);
    const origin = window.location.origin || "https://citymart.vip";
    const url = `${origin}/signup.html?ref=${encodeURIComponent(code)}`;
    const text = `Unete a CityMart en ${cityLabel}. Usa mi codigo ${code} y descubre negocios, promos y comunidad local. ${url}`;

    return {
        title: "Invitacion CityMart",
        text,
        url,
        code
    };
}

export async function shareCityCashInvite(user, city = "lamas") {
    const payload = getCityCashInvitePayload(user, city);

    if (navigator.share) {
        await navigator.share({
            title: payload.title,
            text: payload.text,
            url: payload.url
        });

        const reward = await awardCityCashAction("invite_friend", payload.code, {
            shareMethod: "native",
            shareConfirmed: true
        });
        return { method: "native", reward, payload, confirmedShare: true };
    }

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${payload.text}\nCodigo: ${payload.code}`);

        const confirmedShare = typeof window !== "undefined" && typeof window.confirm === "function"
            ? window.confirm("Tu invitacion se copio. Confirma solo si ya la compartiste para reclamar el CityCash.")
            : false;

        if (!confirmedShare) {
            return { method: "clipboard", reward: null, payload, copied: true, confirmedShare: false };
        }

        const reward = await awardCityCashAction("invite_friend", payload.code, {
            shareMethod: "clipboard",
            shareConfirmed: true
        });
        return { method: "clipboard", reward, payload, copied: true, confirmedShare: true };
    }

    if (typeof window !== "undefined" && typeof window.prompt === "function") {
        window.prompt("Copia y comparte esta invitacion:", `${payload.text}\nCodigo: ${payload.code}`);
    }

    return { method: "manual", reward: null, payload, confirmedShare: false };
}
