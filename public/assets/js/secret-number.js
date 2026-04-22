import { app, auth } from "./firebase-init.js";
import { fetchUserCityCash, invalidateCityCashUserCache } from "./citycash.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const FUNCTIONS_BASE_URL = `https://us-central1-${app.options.projectId}.cloudfunctions.net`;
const ENTRY_FEE = 5;
const MAX_PLAYERS = 5;
const MIN_NUMBER = 1;
const MAX_NUMBER = 100;

function notify(message, tone = "info") {
    if (!message) return;
    if (typeof window.showToast === "function") {
        window.showToast(message, tone);
        return;
    }
    console[tone === "error" ? "error" : "log"](message);
}

function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatCountdown(targetMs = 0) {
    const remaining = Math.max(0, Number(targetMs || 0) - Date.now());
    if (!remaining) return "00:00";

    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function callSecretNumberEndpoint(endpoint, payload = {}) {
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
        throw new Error(data.error || `${endpoint}-failed`);
    }

    return data;
}

function buildPlayerMarkup(players = [], state = {}) {
    if (!Array.isArray(players) || !players.length) {
        return `
            <div class="secret-number-player">
                <strong>La ronda esta vacia</strong>
                <span>El primer jugador la activa y el conteo empieza sin costo extra de sincronizacion.</span>
            </div>
        `;
    }

    const isOpen = state.status === "open";
    return players.map((player) => {
        const roleCopy = player.isCurrentUser
            ? `Tu numero: ${player.guess ?? "--"}`
            : (isOpen ? "Numero reservado" : `Numero: ${player.guess ?? "--"}`);
        const metaCopy = `Turno de entrada #${player.joinOrder || 1} - ${roleCopy}`;

        return `
            <div class="secret-number-player">
                <strong>${escapeHtml(player.name || "Jugador CityMart")}${player.isCurrentUser ? " - Tu" : ""}</strong>
                <span>${escapeHtml(metaCopy)}</span>
            </div>
        `;
    }).join("");
}

function buildResultMarkup(result = null, currentUid = "") {
    if (!result || typeof result !== "object") {
        return {
            title: "Resultado",
            meta: "",
            summary: "",
            list: ""
        };
    }

    if (result.status === "cancelled") {
        return {
            title: "Ronda cancelada",
            meta: result.playerCount ? `${result.playerCount} jugador(es)` : "",
            summary: `<div>La ronda no llego al minimo de 2 jugadores. Las entradas se devolvieron automaticamente.</div>`,
            list: ""
        };
    }

    const winnerName = result.winnerName || "Sin ganador";
    const summary = [
        `<div>Numero secreto: <strong>${result.secretNumber ?? "--"}</strong></div>`,
        `<div>Ganador: <strong>${escapeHtml(winnerName)}${result.winnerUid === currentUid ? " - Tu" : ""}</strong></div>`,
        `<div>Pozo entregado: <strong>${result.pot || 0} CityCash</strong></div>`
    ].join("");

    const list = Array.isArray(result.summary) && result.summary.length
        ? result.summary.map((entry) => {
            const isWinner = entry.uid && entry.uid === result.winnerUid;
            const distanceLabel = entry.distance == null ? "Sin distancia" : `Distancia: ${entry.distance}`;
            return `
                <div class="secret-number-result-item${isWinner ? " is-winner" : ""}">
                    <strong>${escapeHtml(entry.name || "Jugador CityMart")}${entry.uid === currentUid ? " - Tu" : ""}</strong>
                    <span>Numero: ${entry.guess ?? "--"} - ${distanceLabel}</span>
                </div>
            `;
        }).join("")
        : "";

    return {
        title: "Ultimo resultado",
        meta: result.playerCount ? `${result.playerCount} jugador(es)` : "",
        summary,
        list
    };
}

export function initSecretNumberGame() {
    try {
        const staleStorageKey = ["citymart", ["city", ["lu", "do"].join("")].join(""), "room"].join("_");
        localStorage.removeItem(staleStorageKey);
    } catch (error) {
        // Ignore stale storage cleanup failures.
    }

    const elements = {
        modal: document.getElementById("secret-number-modal"),
        close: document.getElementById("secret-number-close-btn"),
        status: document.getElementById("secret-number-status"),
        note: document.getElementById("secret-number-note"),
        balance: document.getElementById("secret-number-balance"),
        playerCount: document.getElementById("secret-number-player-count"),
        time: document.getElementById("secret-number-time"),
        input: document.getElementById("secret-number-input"),
        submit: document.getElementById("secret-number-submit-btn"),
        refresh: document.getElementById("secret-number-refresh-btn"),
        roundCopy: document.getElementById("secret-number-round-copy"),
        players: document.getElementById("secret-number-players"),
        resultCard: document.getElementById("secret-number-result-card"),
        resultTitle: document.getElementById("secret-number-result-title"),
        resultMeta: document.getElementById("secret-number-result-meta"),
        resultSummary: document.getElementById("secret-number-result-summary"),
        resultList: document.getElementById("secret-number-result-list")
    };

    if (!elements.modal) return;

    let currentUser = auth.currentUser;
    let latestState = null;
    let countdownInterval = null;
    let deadlineRefreshTimeout = null;
    let modalOpen = false;
    let pending = false;

    const clearTimers = () => {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        if (deadlineRefreshTimeout) {
            clearTimeout(deadlineRefreshTimeout);
            deadlineRefreshTimeout = null;
        }
    };

    const renderResult = (result = null) => {
        const shouldShow = Boolean(result);
        elements.resultCard.style.display = shouldShow ? "block" : "none";
        if (!shouldShow) {
            elements.resultSummary.innerHTML = "";
            elements.resultList.innerHTML = "";
            elements.resultMeta.textContent = "";
            elements.resultTitle.textContent = "Resultado";
            return;
        }

        const markup = buildResultMarkup(result, currentUser?.uid || "");
        elements.resultTitle.textContent = markup.title;
        elements.resultMeta.textContent = markup.meta;
        elements.resultSummary.innerHTML = markup.summary;
        elements.resultList.innerHTML = markup.list;
    };

    const renderLoggedOut = () => {
        latestState = null;
        clearTimers();
        elements.status.dataset.tone = "neutral";
        elements.status.textContent = "Inicia sesion";
        elements.note.textContent = "Necesitas iniciar sesion para entrar a una ronda de Numero Secreto.";
        elements.balance.textContent = "0";
        elements.playerCount.textContent = "0";
        elements.time.textContent = "--";
        elements.roundCopy.textContent = "0 / 5 listos";
        elements.players.innerHTML = `
            <div class="secret-number-player">
                <strong>Acceso protegido</strong>
                <span>Inicia sesion para consultar la ronda y participar con 5 CityCash.</span>
            </div>
        `;
        elements.submit.disabled = false;
        elements.submit.textContent = "Inicia sesion para jugar";
        renderResult(null);
    };

    const renderState = (state = null) => {
        latestState = state;
        clearTimers();

        if (!state) {
            elements.status.dataset.tone = "neutral";
            elements.status.textContent = "Sin datos";
            elements.note.textContent = "No pudimos cargar el estado del juego.";
            elements.playerCount.textContent = "0";
            elements.time.textContent = "--";
            elements.roundCopy.textContent = "0 / 5 listos";
            elements.players.innerHTML = "";
            renderResult(null);
            return;
        }

        const tone = state.status === "open"
            ? "open"
            : state.status === "finished"
                ? "finished"
                : state.status === "cancelled"
                    ? "cancelled"
                    : "neutral";
        const statusCopy = state.status === "open"
            ? "Ronda abierta"
            : state.status === "finished"
                ? "Ronda cerrada"
                : state.status === "cancelled"
                    ? "Ronda cancelada"
                    : "Lista para abrir";

        elements.status.dataset.tone = tone;
        elements.status.textContent = statusCopy;
        elements.playerCount.textContent = String(state.playerCount || 0);
        elements.roundCopy.textContent = `${state.playerCount || 0} / ${state.maxPlayers || MAX_PLAYERS} listos`;
        elements.players.innerHTML = buildPlayerMarkup(state.players || [], state);

        if (state.status === "open" && Number(state.closesAtMs || 0) > Date.now()) {
            elements.time.textContent = formatCountdown(state.closesAtMs);
            countdownInterval = setInterval(() => {
                elements.time.textContent = formatCountdown(state.closesAtMs);
            }, 1000);

            const refreshInMs = Math.max(1500, Number(state.closesAtMs || 0) - Date.now() + 1200);
            deadlineRefreshTimeout = setTimeout(() => {
                if (modalOpen && currentUser) {
                    loadState({ silent: true }).catch(() => null);
                }
            }, refreshInMs);
        } else if (state.status === "open") {
            elements.time.textContent = "00:00";
        } else {
            elements.time.textContent = state.status === "ready" ? "--" : "Cerrada";
        }

        if (!currentUser) {
            elements.submit.disabled = false;
            elements.submit.textContent = "Inicia sesion para jugar";
        } else if (state.status === "open" && state.alreadyJoined) {
            elements.submit.disabled = true;
            elements.submit.textContent = `Ya participas con ${state.yourGuess ?? "--"}`;
        } else {
            elements.submit.disabled = false;
            elements.submit.textContent = state.status === "open"
                ? `Participar con ${ENTRY_FEE} CityCash`
                : `Abrir nueva ronda con ${ENTRY_FEE} CityCash`;
        }

        if (state.status === "open") {
            if (state.alreadyJoined) {
                elements.note.textContent = `Ya estas dentro con el numero ${state.yourGuess ?? "--"}. Usa Actualizar para ver el cierre o el resultado final.`;
            } else if ((state.playerCount || 0) < 2) {
                elements.note.textContent = "La ronda puede cerrarse con minimo 2 jugadores. Si no se llena, igual se revela al vencer el tiempo.";
            } else {
                elements.note.textContent = "La ronda ya tiene el minimo. Si no entran mas jugadores, al vencer el tiempo se revela el numero secreto.";
            }
        } else if (state.status === "finished") {
            elements.note.textContent = "La siguiente ronda se abre cuando alguien vuelva a participar.";
        } else if (state.status === "cancelled") {
            elements.note.textContent = "La ronda no alcanzo el minimo y las entradas se devolvieron automaticamente.";
        } else {
            elements.note.textContent = "La proxima ronda se abre con el primer jugador y evita mantener recursos en segundo plano.";
        }

        renderResult(state.lastResult || null);
    };

    const setBusy = (nextBusy) => {
        pending = Boolean(nextBusy);
        elements.submit.disabled = pending || (latestState?.status === "open" && latestState?.alreadyJoined);
        elements.refresh.disabled = pending;
    };

    const loadBalance = async ({ force = false } = {}) => {
        if (!currentUser?.uid) {
            elements.balance.textContent = "0";
            return;
        }

        try {
            const summary = await fetchUserCityCash(currentUser.uid, { force });
            elements.balance.textContent = String(summary.balance || 0);
        } catch (error) {
            console.warn("[SecretNumber] balance", error);
        }
    };

    const loadState = async ({ silent = false } = {}) => {
        if (!currentUser) {
            renderLoggedOut();
            return;
        }

        if (!silent) setBusy(true);
        try {
            const result = await callSecretNumberEndpoint("getSecretNumberState");
            renderState(result.state || null);
        } catch (error) {
            console.error("[SecretNumber] state", error);
            notify("No se pudo cargar Numero Secreto.", "error");
            renderState(null);
        } finally {
            if (!silent) setBusy(false);
        }
    };

    const openModal = async (show) => {
        modalOpen = Boolean(show);
        elements.modal.style.display = show ? "flex" : "none";
        elements.modal.setAttribute("aria-hidden", String(!show));
        document.body.classList.toggle("secret-number-modal-open", show);

        if (!show) {
            clearTimers();
            return;
        }

        if (!currentUser) {
            renderLoggedOut();
            return;
        }

        await Promise.all([
            loadBalance(),
            loadState()
        ]);
    };

    const handleParticipate = async () => {
        if (!currentUser) {
            window.location.href = "login.html";
            return;
        }

        const guess = Number.parseInt(elements.input.value, 10);
        if (!Number.isInteger(guess) || guess < MIN_NUMBER || guess > MAX_NUMBER) {
            notify("Elige un numero valido entre 1 y 100.", "error");
            elements.input.focus();
            return;
        }

        setBusy(true);
        try {
            const result = await callSecretNumberEndpoint("playSecretNumber", { guess });
            invalidateCityCashUserCache(currentUser.uid);
            await loadBalance({ force: true });
            renderState(result.state || null);
            notify("Tu numero ya quedo registrado.", "success");
        } catch (error) {
            console.error("[SecretNumber] play", error);
            if (error.message === "citycash-insufficient-balance") {
                notify("Necesitas al menos 5 CityCash para entrar.", "error");
            } else if (error.message === "secret-number-already-entered") {
                notify("Ya participas en esta ronda.", "info");
                await loadState({ silent: true });
            } else {
                notify("No se pudo registrar tu numero.", "error");
            }
        } finally {
            setBusy(false);
        }
    };

    elements.close?.addEventListener("click", () => openModal(false));
    elements.refresh?.addEventListener("click", () => loadState());
    elements.submit?.addEventListener("click", handleParticipate);
    elements.input?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            handleParticipate();
        }
    });

    elements.modal?.addEventListener("click", (event) => {
        if (event.target === elements.modal) {
            openModal(false);
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && modalOpen) {
            openModal(false);
        }
    });

    onAuthStateChanged(auth, async (user) => {
        currentUser = user;
        if (!modalOpen) return;
        if (!user) {
            renderLoggedOut();
            return;
        }
        await Promise.all([
            loadBalance({ force: true }),
            loadState({ silent: true })
        ]);
    });

    window.toggleSecretNumberModal = (show) => {
        openModal(Boolean(show));
    };

    const params = new URLSearchParams(window.location.search);
    if (params.get("open") === "ludo") {
        params.delete("open");
        const nextQuery = params.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash || ""}`;
        window.history.replaceState({}, "", nextUrl);
    }

    const openParam = params.get("open");
    if (openParam === "secret-number") {
        openModal(true);
    }
}
