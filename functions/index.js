const functions = require("firebase-functions/v1");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const sharp = require("sharp");
const path = require("path");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
const BACKFILL_SECRET_PARAM = defineSecret("CITYMART_BACKFILL_SECRET");
const ADMIN_EMAIL = String(
  process.env.CITYMART_ADMIN_EMAIL ||
  "admin@gmail.com"
).trim().toLowerCase();
const APP_BASE_URL = "https://citymart.vip";
const THUMB_WIDTH = 560;
const THUMB_HEIGHT = 560;
const THUMB_QUALITY = 68;
const THUMB_FORMAT = "webp";
const THUMB_CONTENT_TYPE = "image/webp";
const CITYCASH_ACTIONS = {
  register_business: { amount: 50, label: "Registrar negocio" },
  social_wall_post: { amount: 10, label: "Publicar en Muro Social" },
  marketplace_post: { amount: 5, label: "Publicar en Marketplace" },
  create_promo: { amount: 30, label: "Subir promocion" },
  complete_profile: { amount: 10, label: "Completar perfil" },
  invite_friend: { amount: 40, label: "Invitar a un amigo" },
};
const CITYCASH_SLOT_CONFIG = {
  large: { price: 500, limit: 1, label: "Posicion grande", order: 0 },
  medium: { price: 350, limit: 2, label: "Posicion mediana", order: 1 },
  small: { price: 200, limit: 10, label: "Posicion pequena", order: 2 },
};
const CITYCASH_PERU_OFFSET_MS = 5 * 60 * 60 * 1000;
const CITYCASH_DAILY_SPIN_LIMIT = 6;
const CITYCASH_RETENTION_WEEKS = 3;

admin.initializeApp();

function normalizeCityCashKey(value, fallback = "lamas") {
  const normalized = String(value || fallback)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallback;
}

function buildCityCashWeekWindow(rawNow = new Date()) {
  const now = rawNow instanceof Date ? rawNow : new Date(rawNow);
  const pseudoUtc = new Date(now.getTime() - CITYCASH_PERU_OFFSET_MS);
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

  const startAt = new Date(pseudoWeekStartMs + CITYCASH_PERU_OFFSET_MS);
  const endAt = new Date(startAt.getTime() + (7 * 24 * 60 * 60 * 1000));
  const pseudoStart = new Date(pseudoWeekStartMs);
  const weekKey = `${pseudoStart.getUTCFullYear()}${String(pseudoStart.getUTCMonth() + 1).padStart(2, "0")}${String(pseudoStart.getUTCDate()).padStart(2, "0")}`;

  return {
    weekKey,
    startAt,
    endAt,
    startTimestamp: admin.firestore.Timestamp.fromDate(startAt),
    endTimestamp: admin.firestore.Timestamp.fromDate(endAt),
  };
}

function buildCityCashDayWindow(rawNow = new Date()) {
  const now = rawNow instanceof Date ? rawNow : new Date(rawNow);
  const pseudoUtc = new Date(now.getTime() - CITYCASH_PERU_OFFSET_MS);
  const pseudoDayStartMs = Date.UTC(
    pseudoUtc.getUTCFullYear(),
    pseudoUtc.getUTCMonth(),
    pseudoUtc.getUTCDate(),
    0,
    0,
    0,
    0
  );
  const pseudoStart = new Date(pseudoDayStartMs);
  const dayKey = `${pseudoStart.getUTCFullYear()}${String(pseudoStart.getUTCMonth() + 1).padStart(2, "0")}${String(pseudoStart.getUTCDate()).padStart(2, "0")}`;

  return {
    dayKey,
    startedAt: new Date(pseudoDayStartMs + CITYCASH_PERU_OFFSET_MS),
    endsAt: new Date(pseudoDayStartMs + CITYCASH_PERU_OFFSET_MS + (24 * 60 * 60 * 1000)),
  };
}

function buildCityCashClaimId(uid, actionKey, sourceId = "global") {
  return `${normalizeCityCashKey(uid, "uid")}_${normalizeCityCashKey(actionKey, "action")}_${normalizeCityCashKey(sourceId, "global")}`;
}

function setCityCashCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Cache-Control", "no-store");
}

function constantTimeEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getBackfillSecret() {
  return String(process.env.CITYMART_BACKFILL_SECRET || BACKFILL_SECRET_PARAM.value() || "").trim();
}

function requireBackfillSecret(req, res) {
  const expectedSecret = getBackfillSecret();
  if (!expectedSecret) {
    res.status(503).json({ ok: false, error: "maintenance-secret-not-configured" });
    return false;
  }

  const providedSecret = String(req.headers["x-backfill-key"] || "").trim();
  if (!constantTimeEquals(providedSecret, expectedSecret)) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return false;
  }

  return true;
}

async function authenticateCityCashRequest(req, res) {
  setCityCashCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return null;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method-not-allowed" });
    return null;
  }

  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ ok: false, error: "missing-auth-token" });
    return null;
  }

  try {
    const token = authHeader.slice("Bearer ".length).trim();
    return await admin.auth().verifyIdToken(token);
  } catch (error) {
    res.status(401).json({ ok: false, error: "invalid-auth-token" });
    return null;
  }
}

function isCityCashAdmin(decoded) {
  return decoded?.admin === true || String(decoded?.email || "").trim().toLowerCase() === ADMIN_EMAIL;
}

const LEGACY_BUSINESS_OWNER_UID_FIELDS = ["uid", "ownerUid", "ownerId", "claimedBy", "createdBy", "userId"];
const LEGACY_BUSINESS_OWNER_EMAIL_FIELDS = [
  "owner_email_normalized",
  "email_propietario",
  "ownerEmail",
  "owner_email",
  "correo_propietario",
  "claimedEmail",
  "createdByEmail",
];

function normalizeOwnerEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function readFirstNonEmptyString(data = {}, fields = []) {
  for (const field of fields) {
    const value = String(data?.[field] || "").trim();
    if (value) return value;
  }

  return "";
}

function getLegacyBusinessOwnerUid(data = {}) {
  return readFirstNonEmptyString(data, LEGACY_BUSINESS_OWNER_UID_FIELDS);
}

function getLegacyBusinessOwnerEmail(data = {}) {
  return normalizeOwnerEmail(readFirstNonEmptyString(data, LEGACY_BUSINESS_OWNER_EMAIL_FIELDS));
}

function buildLegacyBusinessOwnerPatch({ uid, email, source }) {
  const normalizedEmail = normalizeOwnerEmail(email);

  return {
    uid,
    ownerUid: uid,
    email_propietario: String(email || "").trim(),
    owner_email_normalized: normalizedEmail,
    owner_link_status: "linked",
    owner_link_source: source,
    owner_linked_at: admin.firestore.FieldValue.serverTimestamp(),
  };
}

async function resolveAuthUserByEmail(email, cache = new Map()) {
  const normalizedEmail = normalizeOwnerEmail(email);
  if (!normalizedEmail) return null;

  if (cache.has(normalizedEmail)) {
    return cache.get(normalizedEmail);
  }

  try {
    const userRecord = await admin.auth().getUserByEmail(normalizedEmail);
    cache.set(normalizedEmail, userRecord);
    return userRecord;
  } catch (error) {
    if (error?.code === "auth/user-not-found") {
      cache.set(normalizedEmail, null);
      return null;
    }

    throw error;
  }
}

async function collectLegacyBusinessCandidatesByEmail(email) {
  const db = admin.firestore();
  const normalizedEmail = normalizeOwnerEmail(email);
  const rawEmail = String(email || "").trim();
  const candidateQueries = [
    db.collection("negocio").where("owner_email_normalized", "==", normalizedEmail),
    db.collection("negocio").where("email_propietario", "==", rawEmail),
  ];

  if (normalizedEmail && normalizedEmail !== rawEmail) {
    candidateQueries.push(db.collection("negocio").where("email_propietario", "==", normalizedEmail));
  }

  const settled = await Promise.allSettled(candidateQueries.map((entry) => entry.get()));
  const candidateMap = new Map();

  settled.forEach((result) => {
    if (result.status !== "fulfilled") {
      console.warn("[collectLegacyBusinessCandidatesByEmail] query failed", result.reason);
      return;
    }

    result.value.forEach((docSnap) => {
      candidateMap.set(docSnap.id, docSnap);
    });
  });

  return Array.from(candidateMap.values());
}

async function linkLegacyBusinessesForUser({ uid, email, source = "login_email_exact" }) {
  const normalizedEmail = normalizeOwnerEmail(email);
  if (!uid || !normalizedEmail) {
    return {
      linked: 0,
      alreadyLinked: 0,
      conflicts: 0,
      scanned: 0,
      pendingManualReview: 0,
    };
  }

  const candidates = await collectLegacyBusinessCandidatesByEmail(normalizedEmail);
  let linked = 0;
  let alreadyLinked = 0;
  let conflicts = 0;
  let pendingManualReview = 0;

  for (const docSnap of candidates) {
    const data = docSnap.data() || {};
    const existingUid = getLegacyBusinessOwnerUid(data);
    const ownerEmail = getLegacyBusinessOwnerEmail(data);

    if (ownerEmail !== normalizedEmail) {
      continue;
    }

    if (existingUid && existingUid !== uid) {
      conflicts += 1;
      continue;
    }

    const needsUid = String(data.uid || "").trim() !== uid;
    const needsOwnerUid = String(data.ownerUid || "").trim() !== uid;
    const needsEmail = normalizeOwnerEmail(data.email_propietario) !== normalizedEmail;
    const needsNormalizedEmail = normalizeOwnerEmail(data.owner_email_normalized) !== normalizedEmail;
    const needsStatus = String(data.owner_link_status || "").trim().toLowerCase() !== "linked";

    if (!needsUid && !needsOwnerUid && !needsEmail && !needsNormalizedEmail && !needsStatus) {
      alreadyLinked += 1;
      continue;
    }

    const patch = buildLegacyBusinessOwnerPatch({
      uid,
      email: normalizedEmail,
      source,
    });

    await docSnap.ref.set(patch, { merge: true });

    if (existingUid === uid) {
      alreadyLinked += 1;
    } else {
      linked += 1;
    }
  }

  if (!candidates.length) {
    pendingManualReview = 0;
  }

  return {
    linked,
    alreadyLinked,
    conflicts,
    scanned: candidates.length,
    pendingManualReview,
  };
}

const SECRET_NUMBER_GAME_KEY = "secret_number";
const SECRET_NUMBER_ENTRY_FEE = 5;
const SECRET_NUMBER_MIN_PLAYERS = 2;
const SECRET_NUMBER_MAX_PLAYERS = 5;
const SECRET_NUMBER_RANGE_MIN = 1;
const SECRET_NUMBER_RANGE_MAX = 100;
const SECRET_NUMBER_ROUND_DURATION_MS = 5 * 60 * 1000;

function getSecretNumberGameRef() {
  return admin.firestore().collection("mini_games").doc(SECRET_NUMBER_GAME_KEY);
}

function buildSecretNumberRoundId(now = Date.now()) {
  return `sn_${now}_${crypto.randomBytes(2).toString("hex")}`;
}

function sanitizeSecretNumberGuess(value) {
  const guess = parseInt(value, 10);
  if (!Number.isInteger(guess) || guess < SECRET_NUMBER_RANGE_MIN || guess > SECRET_NUMBER_RANGE_MAX) {
    throw new Error("invalid-secret-number-guess");
  }

  return guess;
}

function getSecretNumberPlayersOrder(state = {}) {
  return Array.isArray(state.playersOrder) ? state.playersOrder.filter(Boolean) : [];
}

function getSecretNumberPlayerCount(state = {}) {
  return getSecretNumberPlayersOrder(state).length;
}

function buildSecretNumberRoundState({ now = Date.now(), lastResult = null } = {}) {
  return {
    gameKey: SECRET_NUMBER_GAME_KEY,
    status: "open",
    roundId: buildSecretNumberRoundId(now),
    entryFee: SECRET_NUMBER_ENTRY_FEE,
    minPlayers: SECRET_NUMBER_MIN_PLAYERS,
    maxPlayers: SECRET_NUMBER_MAX_PLAYERS,
    numberMin: SECRET_NUMBER_RANGE_MIN,
    numberMax: SECRET_NUMBER_RANGE_MAX,
    pot: 0,
    playerCount: 0,
    playersOrder: [],
    players: {},
    createdAtMs: now,
    closesAtMs: now + SECRET_NUMBER_ROUND_DURATION_MS,
    resolvedAtMs: 0,
    updatedAtMs: now,
    winnerUid: "",
    winnerName: "",
    secretNumber: null,
    lastResult: lastResult || null,
  };
}

function buildSecretNumberReadyState(lastResult = null) {
  return {
    gameKey: SECRET_NUMBER_GAME_KEY,
    status: "ready",
    roundId: "",
    entryFee: SECRET_NUMBER_ENTRY_FEE,
    minPlayers: SECRET_NUMBER_MIN_PLAYERS,
    maxPlayers: SECRET_NUMBER_MAX_PLAYERS,
    numberMin: SECRET_NUMBER_RANGE_MIN,
    numberMax: SECRET_NUMBER_RANGE_MAX,
    pot: 0,
    playerCount: 0,
    players: [],
    closesAtMs: 0,
    createdAtMs: 0,
    updatedAtMs: Date.now(),
    alreadyJoined: false,
    yourGuess: null,
    lastResult: lastResult || null,
  };
}

function buildSecretNumberPlayerProfile({
  uid,
  decoded = {},
  userData = {},
  guess = null,
  joinedAtMs = Date.now(),
  joinOrder = 1,
} = {}) {
  const candidateName = String(
    userData.displayName ||
    userData.nombre ||
    decoded.name ||
    decoded.email ||
    "Jugador CityMart"
  ).trim().slice(0, 40);

  return {
    uid,
    name: candidateName || "Jugador CityMart",
    guess,
    joinedAtMs: Number(joinedAtMs || Date.now()),
    joinOrder: Number(joinOrder || 1),
  };
}

function buildSecretNumberRoundSummary(state = {}, secretNumber = null) {
  return getSecretNumberPlayersOrder(state).map((uid, index) => {
    const player = state.players?.[uid] || {};
    const guess = Number(player.guess || 0);
    const hasValidGuess = Number.isInteger(guess) && guess >= SECRET_NUMBER_RANGE_MIN && guess <= SECRET_NUMBER_RANGE_MAX;
    const distance = secretNumber == null || !hasValidGuess ? null : Math.abs(guess - secretNumber);

    return {
      uid,
      name: String(player.name || "Jugador CityMart").trim().slice(0, 40) || "Jugador CityMart",
      guess: hasValidGuess ? guess : null,
      distance,
      joinOrder: Number(player.joinOrder || index + 1),
      joinedAtMs: Number(player.joinedAtMs || 0),
    };
  });
}

function evaluateSecretNumberRound(state = {}, { now = Date.now(), secretNumber = null } = {}) {
  const playerCount = getSecretNumberPlayerCount(state);
  const pot = Number(state.pot || playerCount * SECRET_NUMBER_ENTRY_FEE);
  const roundId = String(state.roundId || "");

  if (playerCount < SECRET_NUMBER_MIN_PLAYERS) {
    return {
      status: "cancelled",
      playerCount,
      pot,
      winnerUid: "",
      winnerName: "",
      payoutAmount: 0,
      refundUids: getSecretNumberPlayersOrder(state),
      lastResult: {
        roundId,
        status: "cancelled",
        reason: "not_enough_players",
        secretNumber: null,
        winnerUid: "",
        winnerName: "",
        winningGuess: null,
        winningDistance: null,
        pot,
        playerCount,
        resolvedAtMs: now,
        summary: buildSecretNumberRoundSummary(state, null),
      },
    };
  }

  const finalSecretNumber = Number.isInteger(secretNumber)
    ? secretNumber
    : crypto.randomInt(SECRET_NUMBER_RANGE_MIN, SECRET_NUMBER_RANGE_MAX + 1);
  const summary = buildSecretNumberRoundSummary(state, finalSecretNumber)
    .sort((left, right) => {
      const leftDistance = Number(left.distance ?? Number.MAX_SAFE_INTEGER);
      const rightDistance = Number(right.distance ?? Number.MAX_SAFE_INTEGER);
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      return Number(left.joinOrder || 0) - Number(right.joinOrder || 0);
    });
  const winner = summary[0] || null;

  return {
    status: "finished",
    playerCount,
    pot,
    winnerUid: winner?.uid || "",
    winnerName: winner?.name || "",
    payoutAmount: pot,
    refundUids: [],
    lastResult: {
      roundId,
      status: "finished",
      reason: "closest_guess",
      secretNumber: finalSecretNumber,
      winnerUid: winner?.uid || "",
      winnerName: winner?.name || "",
      winningGuess: winner?.guess ?? null,
      winningDistance: winner?.distance ?? null,
      pot,
      playerCount,
      resolvedAtMs: now,
      summary,
    },
  };
}

function buildSecretNumberResolvedState(state = {}, evaluation = {}, { now = Date.now() } = {}) {
  return {
    ...state,
    status: String(evaluation.status || state.status || "finished"),
    playerCount: Number(evaluation.playerCount || getSecretNumberPlayerCount(state)),
    pot: Number(evaluation.pot || state.pot || 0),
    secretNumber: evaluation.lastResult?.secretNumber ?? null,
    winnerUid: String(evaluation.winnerUid || ""),
    winnerName: String(evaluation.winnerName || ""),
    resolvedAtMs: now,
    updatedAtMs: now,
    lastResult: evaluation.lastResult || state.lastResult || null,
  };
}

function applySecretNumberSettlementPreviewToUserData(userData = {}, evaluation = {}, uid = "") {
  const currentBalance = Number(userData.cityCashBalance || 0);
  const currentStats = userData.cityCashStats || {};
  let extraEarned = 0;

  if (Array.isArray(evaluation.refundUids) && evaluation.refundUids.includes(uid)) {
    extraEarned += SECRET_NUMBER_ENTRY_FEE;
  }

  if (String(evaluation.winnerUid || "") === String(uid || "") && Number(evaluation.payoutAmount || 0) > 0) {
    extraEarned += Number(evaluation.payoutAmount || 0);
  }

  if (!extraEarned) {
    return userData;
  }

  return {
    ...userData,
    cityCashBalance: currentBalance + extraEarned,
    cityCashStats: {
      totalEarned: Number(currentStats.totalEarned || 0) + extraEarned,
      totalSpent: Number(currentStats.totalSpent || 0),
    },
  };
}

function applyCityCashDeltaTransaction({
  transaction,
  userRef,
  userData = {},
  txRef,
  uid,
  amount = 0,
  type = "earn",
  actionKey = "",
  label = "",
  sourceId = "",
  sourceType = "",
  meta = {},
} = {}) {
  const currentBalance = Number(userData.cityCashBalance || 0);
  const currentStats = userData.cityCashStats || {};
  const nextBalance = currentBalance + Number(amount || 0);
  const nextStats = {
    totalEarned: Number(currentStats.totalEarned || 0) + (amount > 0 ? Number(amount) : 0),
    totalSpent: Number(currentStats.totalSpent || 0) + (amount < 0 ? Math.abs(Number(amount)) : 0),
  };
  const nextRecentEntry = buildCityCashRecentEntry(txRef.id, {
    type,
    actionKey,
    label,
    amount,
    sourceId,
    sourceType,
  });
  const nextRecent = mergeCityCashRecent(userData.cityCashRecent, nextRecentEntry);

  transaction.set(userRef, {
    cityCashBalance: nextBalance,
    cityCashStats: nextStats,
    cityCashRecent: nextRecent,
    cityCashUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  transaction.set(txRef, {
    uid,
    type,
    actionKey,
    label,
    amount,
    balanceBefore: currentBalance,
    balanceAfter: nextBalance,
    sourceId,
    sourceType,
    meta,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { nextBalance, nextStats, nextRecent };
}

async function settleSecretNumberRoundTransaction({
  transaction,
  db,
  state = {},
  now = Date.now(),
  evaluation = null,
} = {}) {
  const finalEvaluation = evaluation || evaluateSecretNumberRound(state, { now });
  const roundId = String(state.roundId || "");

  if (finalEvaluation.status === "cancelled" && Array.isArray(finalEvaluation.refundUids) && finalEvaluation.refundUids.length) {
    const refundRefs = finalEvaluation.refundUids.map((uid) => db.collection("users").doc(uid));
    const refundSnaps = await Promise.all(refundRefs.map((ref) => transaction.get(ref)));

    refundSnaps.forEach((snap, index) => {
      const uid = finalEvaluation.refundUids[index];
      const txRef = db.collection("citycash_transactions").doc();
      applyCityCashDeltaTransaction({
        transaction,
        userRef: refundRefs[index],
        userData: snap.data() || {},
        txRef,
        uid,
        amount: SECRET_NUMBER_ENTRY_FEE,
        type: "earn",
        actionKey: "secret_number_refund",
        label: "Reembolso Numero Secreto",
        sourceId: roundId,
        sourceType: "secret_number_round",
        meta: {
          roundId,
        },
      });
    });
  }

  if (finalEvaluation.status === "finished" && finalEvaluation.winnerUid && Number(finalEvaluation.payoutAmount || 0) > 0) {
    const winnerRef = db.collection("users").doc(finalEvaluation.winnerUid);
    const winnerSnap = await transaction.get(winnerRef);
    const payoutTxRef = db.collection("citycash_transactions").doc();
    applyCityCashDeltaTransaction({
      transaction,
      userRef: winnerRef,
      userData: winnerSnap.data() || {},
      txRef: payoutTxRef,
      uid: finalEvaluation.winnerUid,
      amount: Number(finalEvaluation.payoutAmount || 0),
      type: "earn",
      actionKey: "secret_number_victory",
      label: "Victoria Numero Secreto",
      sourceId: roundId,
      sourceType: "secret_number_round",
      meta: {
        roundId,
        secretNumber: finalEvaluation.lastResult?.secretNumber ?? null,
        playerCount: Number(finalEvaluation.playerCount || 0),
      },
    });
  }

  return buildSecretNumberResolvedState(state, finalEvaluation, { now });
}

function sanitizeSecretNumberResult(result = null) {
  if (!result || typeof result !== "object") return null;

  return {
    roundId: String(result.roundId || ""),
    status: String(result.status || "finished"),
    reason: String(result.reason || ""),
    secretNumber: result.secretNumber == null ? null : Number(result.secretNumber),
    winnerUid: String(result.winnerUid || ""),
    winnerName: String(result.winnerName || "").trim().slice(0, 40),
    winningGuess: result.winningGuess == null ? null : Number(result.winningGuess),
    winningDistance: result.winningDistance == null ? null : Number(result.winningDistance),
    pot: Number(result.pot || 0),
    playerCount: Number(result.playerCount || 0),
    resolvedAtMs: Number(result.resolvedAtMs || 0),
    summary: Array.isArray(result.summary)
      ? result.summary.map((entry, index) => ({
        uid: String(entry?.uid || ""),
        name: String(entry?.name || "Jugador CityMart").trim().slice(0, 40) || "Jugador CityMart",
        guess: entry?.guess == null ? null : Number(entry.guess),
        distance: entry?.distance == null ? null : Number(entry.distance),
        joinOrder: Number(entry?.joinOrder || index + 1),
        joinedAtMs: Number(entry?.joinedAtMs || 0),
      }))
      : [],
  };
}

function buildSecretNumberPublicState(state = {}, uid = "") {
  if (!state || typeof state !== "object") {
    return buildSecretNumberReadyState();
  }

  const playersOrder = getSecretNumberPlayersOrder(state);
  const isOpenRound = String(state.status || "") === "open";
  const players = playersOrder.map((playerUid, index) => {
    const player = state.players?.[playerUid] || {};
    const guess = Number(player.guess || 0);
    const hasValidGuess = Number.isInteger(guess) && guess >= SECRET_NUMBER_RANGE_MIN && guess <= SECRET_NUMBER_RANGE_MAX;

    return {
      uid: playerUid,
      name: String(player.name || "Jugador CityMart").trim().slice(0, 40) || "Jugador CityMart",
      joinOrder: Number(player.joinOrder || index + 1),
      joinedAtMs: Number(player.joinedAtMs || 0),
      isCurrentUser: String(playerUid) === String(uid || ""),
      hasGuess: hasValidGuess,
      guess: isOpenRound && String(playerUid) !== String(uid || "") ? null : (hasValidGuess ? guess : null),
    };
  });
  const lastResult = sanitizeSecretNumberResult(state.lastResult || null);
  const currentPlayer = uid ? state.players?.[uid] || null : null;

  return {
    gameKey: SECRET_NUMBER_GAME_KEY,
    status: String(state.status || "ready"),
    roundId: String(state.roundId || ""),
    entryFee: SECRET_NUMBER_ENTRY_FEE,
    minPlayers: SECRET_NUMBER_MIN_PLAYERS,
    maxPlayers: SECRET_NUMBER_MAX_PLAYERS,
    numberMin: SECRET_NUMBER_RANGE_MIN,
    numberMax: SECRET_NUMBER_RANGE_MAX,
    playerCount: players.length,
    pot: Number(state.pot || players.length * SECRET_NUMBER_ENTRY_FEE),
    closesAtMs: Number(state.closesAtMs || 0),
    createdAtMs: Number(state.createdAtMs || 0),
    updatedAtMs: Number(state.updatedAtMs || 0),
    alreadyJoined: Boolean(currentPlayer),
    yourGuess: currentPlayer ? Number(currentPlayer.guess || 0) : null,
    players,
    lastResult,
  };
}

function shouldFinalizeSecretNumberState(state = {}, now = Date.now()) {
  return String(state.status || "") === "open" && Number(state.closesAtMs || 0) > 0 && Number(state.closesAtMs || 0) <= now;
}
async function ensureCityCashUserDoc(uid, fallbackData = {}) {
  const userRef = admin.firestore().collection("users").doc(uid);
  const snap = await userRef.get();

  if (!snap.exists) {
    await userRef.set({
      nombre: fallbackData.name || "",
      displayName: fallbackData.name || "",
      email: fallbackData.email || "",
      photoURL: fallbackData.picture || "",
      fechaRegistro: admin.firestore.FieldValue.serverTimestamp(),
      cityCashBalance: 0,
      activityPoints: 0,
      cityCashStats: {
        totalEarned: 0,
        totalSpent: 0,
      },
      cityCashRecent: [],
      cityCashUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } else {
    const data = snap.data() || {};
    const patch = {};
    if (typeof data.cityCashBalance !== "number") patch.cityCashBalance = 0;
    if (!data.cityCashStats || typeof data.cityCashStats !== "object") {
      patch.cityCashStats = { totalEarned: 0, totalSpent: 0 };
    } else {
      patch.cityCashStats = {
        totalEarned: Number(data.cityCashStats.totalEarned || 0),
        totalSpent: Number(data.cityCashStats.totalSpent || 0),
      };
    }
    if (!Array.isArray(data.cityCashRecent)) patch.cityCashRecent = [];
    if (Object.keys(patch).length > 0) {
      patch.cityCashUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
      await userRef.set(patch, { merge: true });
    }
  }

  return userRef;
}

async function getCityCashActionMetadata(uid, actionKey, sourceId) {
  const db = admin.firestore();
  const sourceIdValue = String(sourceId || "").trim();

  if (actionKey === "register_business") {
    if (!sourceIdValue) throw new Error("missing-source-id");
    const businessSnap = await db.collection("negocio").doc(sourceIdValue).get();
    if (!businessSnap.exists) throw new Error("business-not-found");
    const business = businessSnap.data() || {};
    if (business.uid !== uid) throw new Error("forbidden-business");
    return {
      sourceId: businessSnap.id,
      sourceType: "negocio",
      city: normalizeCityCashKey(business.ciudad || business.provincia || "lamas"),
      businessId: businessSnap.id,
      businessName: business.nombre || "Mi negocio",
    };
  }

  if (actionKey === "marketplace_post") {
    if (!sourceIdValue) throw new Error("missing-source-id");
    const postSnap = await db.collection("comunidad_posts").doc(sourceIdValue).get();
    if (!postSnap.exists) throw new Error("marketplace-post-not-found");
    const post = postSnap.data() || {};
    if (post.userId !== uid) throw new Error("forbidden-marketplace-post");
    return {
      sourceId: postSnap.id,
      sourceType: "comunidad_posts",
      city: normalizeCityCashKey(post.ciudad || "lamas"),
      title: post.title || "Marketplace",
    };
  }

  if (actionKey === "social_wall_post") {
    if (!sourceIdValue) throw new Error("missing-source-id");
    const topicSnap = await db.collection("foro_temas").doc(sourceIdValue).get();
    if (!topicSnap.exists) throw new Error("forum-topic-not-found");
    const topic = topicSnap.data() || {};
    if (topic.userId !== uid) throw new Error("forbidden-forum-topic");
    return {
      sourceId: topicSnap.id,
      sourceType: "foro_temas",
      city: normalizeCityCashKey(topic.ciudad || "lamas"),
      title: topic.title || "Muro Social",
    };
  }

  if (actionKey === "create_promo") {
    if (!sourceIdValue) throw new Error("missing-source-id");
    const promoSnap = await db.collection("promociones").doc(sourceIdValue).get();
    if (!promoSnap.exists) throw new Error("promo-not-found");
    const promo = promoSnap.data() || {};
    if (promo.uid_propietario !== uid) throw new Error("forbidden-promo");
    return {
      sourceId: promoSnap.id,
      sourceType: "promociones",
      city: normalizeCityCashKey(promo.ciudad || "lamas"),
      title: promo.titulo || "Promocion",
    };
  }

  if (actionKey === "complete_profile") {
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data() || {};
    const hasName = Boolean(String(userData.displayName || userData.nombre || "").trim());
    const hasPhone = Boolean(String(userData.telefono || userData.phone || "").trim());
    const hasAddress = Boolean(String(userData.direccion || "").trim());
    const hasBio = Boolean(String(userData.bio || "").trim());

    if (!hasName || !hasPhone || !hasAddress || !hasBio) {
      throw new Error("profile-incomplete");
    }

    return {
      sourceId: "profile",
      sourceType: "users",
      title: "Perfil completo",
    };
  }

  if (actionKey === "invite_friend") {
    const shareMethod = normalizeCityCashKey(req.body?.shareMethod || "", "");
    const shareConfirmed = req.body?.shareConfirmed === true;

    if (!shareMethod || (shareMethod !== "native" && !shareConfirmed)) {
      throw new Error("invite-share-not-confirmed");
    }

    return {
      sourceId: sourceIdValue || "invite",
      sourceType: "invite",
      title: "Invitacion compartida",
      shareMethod,
      shareConfirmed,
    };
  }

  throw new Error("unsupported-action");
}

function mapCityCashError(error) {
  const message = String(error?.message || error || "unknown-error");

  if (
    message === "invalid-grant-request" ||
    message === "missing-source-id" ||
    message === "profile-incomplete" ||
    message === "unsupported-action" ||
    message === "invite-share-not-confirmed" ||
    message === "citycash-city-mismatch" ||
    message === "invalid-secret-number-guess"
  ) return 400;

  if (
    message === "admin-required" ||
    message === "forbidden-business" ||
    message === "forbidden-forum-topic" ||
    message === "forbidden-marketplace-post" ||
    message === "forbidden-promo"
  ) return 403;

  if (
    message === "business-not-found" ||
    message === "forum-topic-not-found" ||
    message === "marketplace-post-not-found" ||
    message === "promo-not-found"
  ) return 404;

  if (
    message === "already-claimed" ||
    message === "grant-already-used" ||
    message === "citycash-insufficient-balance" ||
    message === "citycash-slot-unavailable" ||
    message === "secret-number-already-entered"
  ) return 409;

  if (message === "citycash-daily-spin-limit") return 429;

  return 500;
}

function buildCityCashRecentEntry(txId, payload) {
  return {
    id: txId,
    type: payload.type,
    label: payload.label,
    amount: payload.amount,
    actionKey: payload.actionKey,
    sourceId: payload.sourceId,
    sourceType: payload.sourceType,
    createdAtMs: Date.now(),
  };
}

function mergeCityCashRecent(existingEntries = [], nextEntry) {
  const sanitized = Array.isArray(existingEntries) ? existingEntries.filter(Boolean) : [];
  return [nextEntry, ...sanitized]
    .filter((entry, index, arr) => entry?.id && arr.findIndex((item) => item?.id === entry.id) === index)
    .slice(0, 6);
}

function createEmptyCityCashBoard() {
  return {
    large: Array.from({ length: CITYCASH_SLOT_CONFIG.large.limit }, () => null),
    medium: Array.from({ length: CITYCASH_SLOT_CONFIG.medium.limit }, () => null),
    small: Array.from({ length: CITYCASH_SLOT_CONFIG.small.limit }, () => null),
  };
}

function normalizeCityCashWeekRankings(rawRankings = {}) {
  const result = {};
  const source = rawRankings && typeof rawRankings === "object" ? rawRankings : {};

  Object.keys(source).forEach((cityKey) => {
    const cityData = source[cityKey] && typeof source[cityKey] === "object" ? source[cityKey] : {};
    result[cityKey] = {
      large: Array.isArray(cityData.large) ? cityData.large.slice(0, CITYCASH_SLOT_CONFIG.large.limit) : createEmptyCityCashBoard().large,
      medium: Array.isArray(cityData.medium) ? cityData.medium.slice(0, CITYCASH_SLOT_CONFIG.medium.limit) : createEmptyCityCashBoard().medium,
      small: Array.isArray(cityData.small) ? cityData.small.slice(0, CITYCASH_SLOT_CONFIG.small.limit) : createEmptyCityCashBoard().small,
    };

    result[cityKey].large = result[cityKey].large.concat(Array.from({ length: CITYCASH_SLOT_CONFIG.large.limit - result[cityKey].large.length }, () => null));
    result[cityKey].medium = result[cityKey].medium.concat(Array.from({ length: CITYCASH_SLOT_CONFIG.medium.limit - result[cityKey].medium.length }, () => null));
    result[cityKey].small = result[cityKey].small.concat(Array.from({ length: CITYCASH_SLOT_CONFIG.small.limit - result[cityKey].small.length }, () => null));
  });

  return result;
}

function buildDownloadUrl(bucketName, filePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
}

function extractStoragePathFromUrl(rawUrl, bucketName) {
  if (!rawUrl || typeof rawUrl !== "string") return "";

  try {
    const url = new URL(rawUrl);
    if (!/firebasestorage\.googleapis\.com$/i.test(url.hostname)) return "";

    const marker = `/v0/b/${bucketName}/o/`;
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex === -1) return "";

    const encodedPath = url.pathname.slice(markerIndex + marker.length);
    return decodeURIComponent(encodedPath || "").trim();
  } catch (error) {
    return "";
  }
}

async function sendAdminPushNotification({
  title,
  body,
  link = `${APP_BASE_URL}/admin.html`,
  data = {},
}) {
  let adminUser = null;
  try {
    adminUser = await admin.auth().getUserByEmail(ADMIN_EMAIL);
  } catch (error) {
    console.warn("[sendAdminPushNotification] Admin user not found:", error.message);
    return { sent: false, reason: "admin-user-not-found" };
  }

  const db = admin.firestore();
  const tokensSnap = await db.collection("fcmTokens").where("uid", "==", adminUser.uid).get();
  if (tokensSnap.empty) {
    return { sent: false, reason: "admin-without-push-token" };
  }

  const tokens = tokensSnap.docs.map((docSnap) => docSnap.id).filter(Boolean);
  if (!tokens.length) {
    return { sent: false, reason: "admin-without-push-token" };
  }

  return sendPushToTokens(tokens, {
    title,
    body,
    link,
    data,
  });
}

function asPushData(data = {}, link = APP_BASE_URL) {
  return {
    ...Object.keys(data || {}).reduce((acc, key) => {
      acc[key] = String(data[key] ?? "");
      return acc;
    }, {}),
    link,
  };
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function isInvalidMessagingTokenError(errorCode = "") {
  return errorCode === "messaging/invalid-registration-token" ||
    errorCode === "messaging/registration-token-not-registered";
}

async function getAllPushTokens() {
  const snap = await admin.firestore().collection("fcmTokens").get();
  const tokens = [];
  snap.forEach((docSnap) => {
    const token = String(docSnap.id || docSnap.data()?.token || "").trim();
    if (token) tokens.push(token);
  });
  return [...new Set(tokens)];
}

async function deleteInvalidPushTokens(tokens = []) {
  const uniqueTokens = [...new Set(tokens.filter(Boolean))];
  if (!uniqueTokens.length) return;

  const db = admin.firestore();
  await Promise.all(
    uniqueTokens.map((token) => db.collection("fcmTokens").doc(token).delete().catch(() => null))
  );
}

async function sendPushToTokens(tokens = [], {
  title,
  body,
  link = APP_BASE_URL,
  image = "",
  data = {},
} = {}) {
  const uniqueTokens = [...new Set(tokens.filter(Boolean))];
  if (!uniqueTokens.length) {
    return { sent: false, reason: "without-push-tokens", successCount: 0, failureCount: 0 };
  }

  let successCount = 0;
  let failureCount = 0;
  const invalidTokens = [];
  const tokenChunks = chunkArray(uniqueTokens, 500);

  for (const tokenChunk of tokenChunks) {
    const message = {
      notification: {
        title,
        body,
      },
      data: asPushData(data, link),
      webpush: {
        fcmOptions: {
          link,
        },
        notification: {
          icon: `${APP_BASE_URL}/assets/icons/app-icon-192-v4.png`,
          badge: `${APP_BASE_URL}/assets/icons/notification-badge.png`,
          click_action: link,
        },
      },
    };

    if (image) {
      message.notification.image = image;
      message.webpush.notification.image = image;
    }

    const response = await admin.messaging().sendEachForMulticast({
      ...message,
      tokens: tokenChunk,
    });

    successCount += response.successCount;
    failureCount += response.failureCount;
    response.responses.forEach((item, index) => {
      if (item.success) return;

      const errorCode = item.error?.code || "";
      if (isInvalidMessagingTokenError(errorCode)) {
        invalidTokens.push(tokenChunk[index]);
      }
    });
  }

  await deleteInvalidPushTokens(invalidTokens);

  return {
    sent: successCount > 0,
    successCount,
    failureCount,
    invalidTokenCount: invalidTokens.length,
  };
}

async function sendPushToAllSubscribers(payload = {}) {
  const tokens = await getAllPushTokens();
  return sendPushToTokens(tokens, payload);
}

function stripHtml(value = "") {
  return String(value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function truncateText(value = "", maxLength = 120) {
  const text = stripHtml(value);
  return text.length > maxLength ? `${text.substring(0, maxLength - 3)}...` : text;
}

async function updateDocByField(collectionName, fieldName, filePath, payload) {
  const snap = await admin.firestore().collection(collectionName).where(fieldName, "==", filePath).limit(10).get();
  if (snap.empty) return 0;

  const updates = [];
  snap.forEach((doc) => {
    updates.push(doc.ref.set(payload, { merge: true }));
  });
  await Promise.all(updates);
  return updates.length;
}

function getThumbStoragePath(filePath) {
  const fileName = path.basename(filePath);
  const dirName = path.dirname(filePath);
  const thumbFileName = `thumb_${fileName.replace(/\.[^/.]+$/, "")}.${THUMB_FORMAT}`;
  return dirName === "." ? thumbFileName : `${dirName}/${thumbFileName}`;
}

function isProfilePhotoPath(filePath) {
  return /^users\/[^/]+\/profile\.[^/]+$/i.test(filePath);
}

function getThumbUpdateTasks(filePath, thumbUrl, thumbStoragePath) {
  const tasks = [];

  if (filePath.startsWith("promociones/")) {
    tasks.push(updateDocByField("promociones", "imagen_path", filePath, { imagen_thumb: thumbUrl, imagen_thumb_path: thumbStoragePath }));
  } else if (filePath.startsWith("noticias/")) {
    tasks.push(updateDocByField("noticias", "imagen_path", filePath, { imagen_thumb: thumbUrl, imagen_thumb_path: thumbStoragePath }));
  } else if (filePath.startsWith("negocios/")) {
    tasks.push(updateDocByField("negocio", "foto_path", filePath, { foto_thumb: thumbUrl, foto_thumb_path: thumbStoragePath }));
    tasks.push(updateDocByField("negocio", "imagen_path", filePath, { imagen_thumb: thumbUrl, imagen_thumb_path: thumbStoragePath }));
  } else if (filePath.startsWith("lost_found/")) {
    tasks.push(updateDocByField("comunidad_lostfound", "photo_path", filePath, { photo_thumb: thumbUrl, photo_thumb_path: thumbStoragePath }));
  } else if (isProfilePhotoPath(filePath)) {
    const userId = filePath.split("/")[1];
    if (userId) {
      tasks.push(admin.firestore().collection("users").doc(userId).set({ photoURL_thumb: thumbUrl, photo_thumb_path: thumbStoragePath }, { merge: true }));
    }
  }

  return tasks;
}

async function ensureThumbForFile(bucket, filePath) {
  const file = bucket.file(filePath);
  const [metadata] = await file.getMetadata();
  const contentType = metadata.contentType || "";

  if (!contentType.startsWith("image/")) return { skipped: true, reason: "not-image" };
  if (path.basename(filePath).startsWith("thumb_")) return { skipped: true, reason: "thumb" };

  const fileName = path.basename(filePath);
  const thumbStoragePath = getThumbStoragePath(filePath);
  const thumbFile = bucket.file(thumbStoragePath);
  const tempOriginalPath = path.join(os.tmpdir(), `orig_${Date.now()}_${fileName}`);
  const tempThumbPath = path.join(os.tmpdir(), `thumb_${Date.now()}_${path.basename(thumbStoragePath)}`);

  try {
    let token = null;
    const [thumbExists] = await thumbFile.exists();

    if (!thumbExists) {
      await file.download({ destination: tempOriginalPath });

      await sharp(tempOriginalPath)
        .rotate()
        .resize({ width: THUMB_WIDTH, height: THUMB_HEIGHT, fit: "cover", withoutEnlargement: true })
        .webp({ quality: THUMB_QUALITY })
        .toFile(tempThumbPath);

      token = crypto.randomUUID();
      await bucket.upload(tempThumbPath, {
        destination: thumbStoragePath,
        metadata: {
          contentType: THUMB_CONTENT_TYPE,
          metadata: {
            firebaseStorageDownloadTokens: token,
            sourcePath: filePath,
          },
          cacheControl: "public,max-age=31536000",
        },
      });
    }

    const [thumbMeta] = await thumbFile.getMetadata();
    token = token || thumbMeta.metadata?.firebaseStorageDownloadTokens || crypto.randomUUID();

    if (!thumbMeta.metadata?.firebaseStorageDownloadTokens) {
      await thumbFile.setMetadata({
        metadata: {
          ...(thumbMeta.metadata || {}),
          firebaseStorageDownloadTokens: token,
          sourcePath: filePath,
        },
      });
    }

    const thumbUrl = buildDownloadUrl(bucket.name, thumbStoragePath, token);
    await Promise.all(getThumbUpdateTasks(filePath, thumbUrl, thumbStoragePath));
    return { skipped: false, thumbStoragePath };
  } finally {
    if (fs.existsSync(tempOriginalPath)) fs.unlinkSync(tempOriginalPath);
    if (fs.existsSync(tempThumbPath)) fs.unlinkSync(tempThumbPath);
  }
}

exports.generarMiniaturas = functions.storage.object().onFinalize(async (object) => {
  const filePath = object.name;
  const contentType = object.contentType || "";
  const bucketName = object.bucket;

  if (!filePath || !contentType.startsWith("image/")) return null;
  if (path.basename(filePath).startsWith("thumb_")) return null;

  const supportedRoots = ["negocios/", "promociones/", "noticias/", "lost_found/", "users/"];
  if (!supportedRoots.some((prefix) => filePath.startsWith(prefix))) return null;

  const bucket = admin.storage().bucket(bucketName);
  const fileName = path.basename(filePath);
  const dirName = path.dirname(filePath);
  const thumbFileName = `thumb_${fileName.replace(/\.[^/.]+$/, "")}.${THUMB_FORMAT}`;
  const thumbStoragePath = dirName === "." ? thumbFileName : `${dirName}/${thumbFileName}`;
  const tempOriginalPath = path.join(os.tmpdir(), fileName);
  const tempThumbPath = path.join(os.tmpdir(), thumbFileName);

  await bucket.file(filePath).download({ destination: tempOriginalPath });

  await sharp(tempOriginalPath)
    .rotate()
    .resize({ width: THUMB_WIDTH, height: THUMB_HEIGHT, fit: "cover", withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toFile(tempThumbPath);

  const downloadToken = crypto.randomUUID();
  await bucket.upload(tempThumbPath, {
    destination: thumbStoragePath,
    metadata: {
      contentType: THUMB_CONTENT_TYPE,
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
        sourcePath: filePath,
      },
      cacheControl: "public,max-age=31536000",
    },
  });

  const thumbUrl = buildDownloadUrl(bucketName, thumbStoragePath, downloadToken);
  const tasks = [];

  if (filePath.startsWith("promociones/")) {
    tasks.push(updateDocByField("promociones", "imagen_path", filePath, { imagen_thumb: thumbUrl, imagen_thumb_path: thumbStoragePath }));
  } else if (filePath.startsWith("noticias/")) {
    tasks.push(updateDocByField("noticias", "imagen_path", filePath, { imagen_thumb: thumbUrl, imagen_thumb_path: thumbStoragePath }));
  } else if (filePath.startsWith("negocios/")) {
    tasks.push(updateDocByField("negocio", "foto_path", filePath, { foto_thumb: thumbUrl, foto_thumb_path: thumbStoragePath }));
    tasks.push(updateDocByField("negocio", "imagen_path", filePath, { imagen_thumb: thumbUrl, imagen_thumb_path: thumbStoragePath }));
  } else if (filePath.startsWith("lost_found/")) {
    tasks.push(updateDocByField("comunidad_lostfound", "photo_path", filePath, { photo_thumb: thumbUrl, photo_thumb_path: thumbStoragePath }));
  } else if (isProfilePhotoPath(filePath)) {
    const userId = filePath.split("/")[1];
    if (userId) {
      tasks.push(admin.firestore().collection("users").doc(userId).set({ photoURL_thumb: thumbUrl, photo_thumb_path: thumbStoragePath }, { merge: true }));
    }
  }

  await Promise.all(tasks);

  if (fs.existsSync(tempOriginalPath)) fs.unlinkSync(tempOriginalPath);
  if (fs.existsSync(tempThumbPath)) fs.unlinkSync(tempThumbPath);
  return null;
});

exports.notificarNoticiaAprobada = functions.firestore.document("noticias/{noticiaId}").onUpdate(async (change, context) => {
  const dataAnterior = change.before.data();
  const dataNueva = change.after.data();

  if (dataNueva.estado !== "aprobado" || dataAnterior.estado === "aprobado") {
    return null;
  }

  {
    const tituloNoticia = dataNueva.titulo || "Nueva Noticia en CityMart";
    const contenidoBruto = dataNueva.contenido || dataNueva.texto || "Ingresa a la app para descubrir de quÃ© se trata.";

    let cuerpoLimpio = contenidoBruto.replace(/<[^>]+>/g, "").trim();
    cuerpoLimpio = cuerpoLimpio.length > 80 ? cuerpoLimpio.substring(0, 80) + "..." : cuerpoLimpio;

    const imagenLogo = dataNueva.imagen || "https://citymart.vip/assets/logo.png";
    const enlaceNoticia = `https://citymart.vip/news_detail.html?id=${context.params.noticiaId}`;

    try {
      await admin.firestore().collection("alertas").add({
        titulo: tituloNoticia,
        resumen: cuerpoLimpio,
        imagen: imagenLogo,
        enlace: `news_detail.html?id=${context.params.noticiaId}`,
        noticiaId: context.params.noticiaId,
        tipo: "noticia",
        fecha: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (alertaError) {
      console.error("Error guardando alerta interna:", alertaError);
    }

    try {
      await sendPushToAllSubscribers({
        title: `Nueva noticia: ${tituloNoticia}`,
        body: cuerpoLimpio,
        image: imagenLogo,
        link: enlaceNoticia,
        data: {
          tipo: "noticia",
          noticiaId: context.params.noticiaId,
        },
      });
      return null;

      const tokensSnap = await admin.firestore().collection("fcmTokens").get();
      if (tokensSnap.empty) return null;

      const tokensHabilitados = [];
      tokensSnap.forEach((doc) => tokensHabilitados.push(doc.id));
      if (tokensHabilitados.length === 0) return null;

      const mensajeMulticast = {
        notification: {
          title: "🔔 " + tituloNoticia,
          body: cuerpoLimpio,
          image: imagenLogo,
        },
        data: {
          link: enlaceNoticia,
          noticiaId: context.params.noticiaId,
        },
        webpush: {
          fcmOptions: {
            link: enlaceNoticia,
          },
          notification: {
            icon: "https://citymart.vip/assets/logo.png",
            click_action: enlaceNoticia,
          },
        },
        tokens: tokensHabilitados,
      };

      const respuesta = await admin.messaging().sendEachForMulticast(mensajeMulticast);

      if (respuesta.failureCount > 0) {
        const tokensParaBorrar = [];
        respuesta.responses.forEach((resp, index) => {
          if (!resp.success) {
            const errorCode = resp.error.code;
            if (errorCode === "messaging/invalid-registration-token" || errorCode === "messaging/registration-token-not-registered") {
              tokensParaBorrar.push(tokensHabilitados[index]);
            }
          }
        });

        for (const token of tokensParaBorrar) {
          await admin.firestore().collection("fcmTokens").doc(token).delete().catch((e) => console.log("Fallo al borrar token", e));
        }
      }

      return null;
    } catch (error) {
      console.error("Error crÃ­tico enviando notificaciones:", error);
      return null;
    }
  }

  return null;
});

exports.notificarNegocioCreado = functions.firestore.document("negocio/{negocioId}").onCreate(async (snap, context) => {
  const data = snap.data() || {};
  const negocioId = context.params.negocioId;
  const estado = String(data.estado || "aprobado").trim().toLowerCase();

  if (estado !== "aprobado" || data.negociovisible === false) {
    return null;
  }

  const db = admin.firestore();
  const eventRef = db.collection("notification_events").doc(`negocio_created_${negocioId}`);
  const shouldSend = await db.runTransaction(async (transaction) => {
    const eventSnap = await transaction.get(eventRef);
    if (eventSnap.exists) return false;

    transaction.create(eventRef, {
      type: "negocio_created",
      negocioId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "sending",
    });
    return true;
  });

  if (!shouldSend) return null;

  const nombre = truncateText(data.nombre || "Nuevo negocio en CityMart", 80);
  const categoria = truncateText(data.categoria || data.negocio_o_servicio || "negocio", 40);
  const ciudad = truncateText(data.ciudad || data.provincia || "tu ciudad", 40);
  const descripcion = truncateText(data.descripcion || `Nuevo ${categoria} disponible en ${ciudad}.`, 120);
  const image = data.imagen || data.foto || `${APP_BASE_URL}/assets/logo.png`;
  const link = `${APP_BASE_URL}/business_detail.html?id=${negocioId}`;

  try {
    await db.collection("alertas").add({
      titulo: nombre,
      resumen: descripcion,
      imagen: image,
      enlace: `business_detail.html?id=${negocioId}`,
      negocioId,
      tipo: "negocio",
      fecha: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (alertaError) {
    console.error("[notificarNegocioCreado] Error guardando alerta interna:", alertaError);
  }

  try {
    const result = await sendPushToAllSubscribers({
      title: `Nuevo negocio: ${nombre}`,
      body: descripcion,
      image,
      link,
      data: {
        tipo: "negocio",
        negocioId,
      },
    });

    await eventRef.set({
      status: "sent",
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      successCount: Number(result.successCount || 0),
      failureCount: Number(result.failureCount || 0),
      invalidTokenCount: Number(result.invalidTokenCount || 0),
    }, { merge: true });
  } catch (error) {
    console.error("[notificarNegocioCreado] Error enviando push:", error);
    await eventRef.set({
      status: "failed",
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
      error: String(error.message || error).slice(0, 300),
    }, { merge: true });
  }

  return null;
});

exports.limpiarObjetosPerdidosExpirados = functions.pubsub.schedule("every 24 hours").onRun(async () => {
  const now = admin.firestore.Timestamp.now();
  const snap = await admin.firestore()
    .collection("comunidad_lostfound")
    .where("expiresAt", "<=", now)
    .limit(200)
    .get();

  if (snap.empty) return null;

  const bucket = admin.storage().bucket();
  const batch = admin.firestore().batch();
  const deleteFiles = [];

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.photo_path) {
      deleteFiles.push(bucket.file(data.photo_path).delete().catch(() => null));
    }
    if (data.photo_thumb_path) {
      deleteFiles.push(bucket.file(data.photo_thumb_path).delete().catch(() => null));
    }
    batch.delete(docSnap.ref);
  });

  await Promise.all(deleteFiles);
  await batch.commit();
  return null;
});

exports.backfillLegacyThumbnails = functions
  .runWith({ timeoutSeconds: 540, memory: "1GB", secrets: [BACKFILL_SECRET_PARAM] })
  .https.onRequest(async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "method-not-allowed" });
        return;
      }

      if (!requireBackfillSecret(req, res)) return;

      const allowedPrefixes = ["negocios/", "promociones/", "noticias/", "lost_found/", "users/"];
      const prefix = String(req.body?.prefix || req.query.prefix || "");
      if (!allowedPrefixes.includes(prefix)) {
        res.status(400).json({ ok: false, error: "invalid-prefix" });
        return;
      }

      const rawLimit = parseInt(req.body?.limit || req.query.limit || "25", 10);
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 25;
      const pageToken = req.body?.pageToken || req.query.pageToken || undefined;

      const bucket = admin.storage().bucket();
      const [files, nextQuery] = await bucket.getFiles({
        prefix,
        autoPaginate: false,
        maxResults: limit,
        pageToken,
      });

      let processed = 0;
      let skipped = 0;
      const errors = [];

      for (const file of files) {
        try {
          const result = await ensureThumbForFile(bucket, file.name);
          if (result.skipped) skipped += 1;
          else processed += 1;
        } catch (error) {
          errors.push({ file: file.name, error: error.message });
        }
      }

      res.json({
        ok: true,
        prefix,
        processed,
        skipped,
        errors,
        nextPageToken: nextQuery?.pageToken || null,
        hasMore: Boolean(nextQuery?.pageToken),
      });
    } catch (error) {
      console.error("[backfillLegacyThumbnails]", error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

exports.repairBusinessImageDoc = functions
  .runWith({ timeoutSeconds: 540, memory: "1GB", secrets: [BACKFILL_SECRET_PARAM] })
  .https.onRequest(async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "method-not-allowed" });
        return;
      }

      if (!requireBackfillSecret(req, res)) return;

      const businessId = String(req.body?.businessId || req.query.businessId || "").trim();
      if (!businessId) {
        res.status(400).json({ ok: false, error: "missing-business-id" });
        return;
      }

      const bucket = admin.storage().bucket();
      const bucketName = bucket.name;
      const docRef = admin.firestore().collection("negocio").doc(businessId);
      const docSnap = await docRef.get();

      if (!docSnap.exists) {
        res.status(404).json({ ok: false, error: "business-not-found" });
        return;
      }

      const data = docSnap.data() || {};
      const patch = {};
      const pathsToProcess = new Set();

      const fotoPath = (data.foto_path || "").trim() || extractStoragePathFromUrl(data.foto, bucketName);
      const imagenPath = (data.imagen_path || "").trim() || extractStoragePathFromUrl(data.imagen, bucketName);

      if (fotoPath.startsWith("negocios/")) {
        pathsToProcess.add(fotoPath);
        if (fotoPath !== data.foto_path) patch.foto_path = fotoPath;
      }

      if (imagenPath.startsWith("negocios/")) {
        pathsToProcess.add(imagenPath);
        if (imagenPath !== data.imagen_path) patch.imagen_path = imagenPath;
      }

      if (Object.keys(patch).length > 0) {
        await docRef.set(patch, { merge: true });
      }

      const results = [];
      for (const filePath of pathsToProcess) {
        try {
          const outcome = await ensureThumbForFile(bucket, filePath);
          results.push({ filePath, ok: true, ...outcome });
        } catch (error) {
          results.push({ filePath, ok: false, error: error.message });
        }
      }

      const refreshedSnap = await docRef.get();
      const refreshed = refreshedSnap.data() || {};

      res.json({
        ok: true,
        businessId,
        patchedFields: Object.keys(patch),
        processedPaths: results,
        thumbReady: Boolean(refreshed.foto_thumb || refreshed.imagen_thumb),
      });
    } catch (error) {
      console.error("[repairBusinessImageDoc]", error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

exports.deleteStorageFile = functions
  .runWith({ timeoutSeconds: 120, memory: "256MB", secrets: [BACKFILL_SECRET_PARAM] })
  .https.onRequest(async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "method-not-allowed" });
        return;
      }

      if (!requireBackfillSecret(req, res)) return;

      const filePath = String(req.body?.filePath || req.query.filePath || "").trim();
      if (!filePath) {
        res.status(400).json({ ok: false, error: "missing-file-path" });
        return;
      }

      const allowedPrefixes = ["negocios/", "promociones/", "noticias/", "lost_found/", "users/"];
      if (!allowedPrefixes.some((prefix) => filePath.startsWith(prefix))) {
        res.status(400).json({ ok: false, error: "invalid-file-path" });
        return;
      }

      const bucket = admin.storage().bucket();
      await bucket.file(filePath).delete({ ignoreNotFound: true });

      res.json({
        ok: true,
        filePath,
      });
    } catch (error) {
      console.error("[deleteStorageFile]", error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });

exports.claimCityCash = functions
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    const decoded = await authenticateCityCashRequest(req, res);
    if (!decoded) return;

    try {
      const uid = decoded.uid;
      const actionKey = String(req.body?.actionKey || "").trim();
      const actionConfig = CITYCASH_ACTIONS[actionKey];

      if (!actionConfig) {
        res.status(400).json({ ok: false, error: "unsupported-action" });
        return;
      }

      const metadata = await getCityCashActionMetadata(uid, actionKey, req.body?.sourceId);
      const claimId = buildCityCashClaimId(uid, actionKey, metadata.sourceId);
      const db = admin.firestore();
      const userRef = await ensureCityCashUserDoc(uid, decoded);
      const claimRef = db.collection("citycash_action_claims").doc(claimId);
      const txRef = db.collection("citycash_transactions").doc();

      const outcome = await db.runTransaction(async (transaction) => {
        const [userSnap, claimSnap] = await Promise.all([
          transaction.get(userRef),
          transaction.get(claimRef),
        ]);

        if (claimSnap.exists) {
          throw new Error("already-claimed");
        }

        const userData = userSnap.data() || {};
        const currentBalance = Number(userData.cityCashBalance || 0);
        const currentStats = userData.cityCashStats || {};
        const nextBalance = currentBalance + actionConfig.amount;
        const nextRecentEntry = buildCityCashRecentEntry(txRef.id, {
          type: "earn",
          actionKey,
          label: actionConfig.label,
          amount: actionConfig.amount,
          sourceId: metadata.sourceId,
          sourceType: metadata.sourceType,
        });
        const nextStats = {
          totalEarned: Number(currentStats.totalEarned || 0) + actionConfig.amount,
          totalSpent: Number(currentStats.totalSpent || 0),
        };
        const nextRecent = mergeCityCashRecent(userData.cityCashRecent, nextRecentEntry);

        transaction.set(userRef, {
          cityCashBalance: nextBalance,
          cityCashStats: nextStats,
          cityCashRecent: nextRecent,
          cityCashUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        transaction.set(claimRef, {
          uid,
          actionKey,
          amount: actionConfig.amount,
          label: actionConfig.label,
          sourceId: metadata.sourceId,
          sourceType: metadata.sourceType,
          meta: metadata,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        transaction.set(txRef, {
          uid,
          type: "earn",
          actionKey,
          label: actionConfig.label,
          amount: actionConfig.amount,
          balanceBefore: currentBalance,
          balanceAfter: nextBalance,
          sourceId: metadata.sourceId,
          sourceType: metadata.sourceType,
          meta: metadata,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return {
          awarded: true,
          amount: actionConfig.amount,
          balance: nextBalance,
          stats: nextStats,
          recent: nextRecent,
          actionKey,
          label: actionConfig.label,
        };
      });

      res.json({ ok: true, ...outcome });
    } catch (error) {
      const status = mapCityCashError(error);
      res.status(status).json({
        ok: false,
        error: error.message || "claim-failed",
      });
    }
  });

exports.grantCityCashAdmin = functions
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    const decoded = await authenticateCityCashRequest(req, res);
    if (!decoded) return;

    try {
      if (!isCityCashAdmin(decoded)) {
        throw new Error("admin-required");
      }

      const targetUid = String(req.body?.targetUid || decoded.uid || "").trim();
      const amount = Number(req.body?.amount || 0);
      const label = String(req.body?.label || "Bono administrador").trim().slice(0, 90) || "Bono administrador";
      const grantKey = normalizeCityCashKey(req.body?.grantKey || "", "");
      const note = String(req.body?.note || "").trim().slice(0, 160);

      if (!targetUid || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount) || amount > 100000) {
        throw new Error("invalid-grant-request");
      }

      const db = admin.firestore();
      const userRef = await ensureCityCashUserDoc(targetUid, targetUid === decoded.uid ? decoded : {});
      const txRef = db.collection("citycash_transactions").doc();
      const grantRef = grantKey
        ? db.collection("citycash_admin_grants").doc(`${normalizeCityCashKey(targetUid, "uid")}_${grantKey}`)
        : null;

      const outcome = await db.runTransaction(async (transaction) => {
        const userSnap = await transaction.get(userRef);

        if (grantRef) {
          const grantSnap = await transaction.get(grantRef);
          if (grantSnap.exists) {
            throw new Error("grant-already-used");
          }
        }

        const userData = userSnap.data() || {};
        const currentBalance = Number(userData.cityCashBalance || 0);
        const currentStats = userData.cityCashStats || {};
        const nextBalance = currentBalance + amount;
        const nextStats = {
          totalEarned: Number(currentStats.totalEarned || 0) + amount,
          totalSpent: Number(currentStats.totalSpent || 0),
        };
        const nextRecentEntry = buildCityCashRecentEntry(txRef.id, {
          type: "earn",
          actionKey: "admin_grant",
          label,
          amount,
          sourceId: grantKey || `admin_${decoded.uid}`,
          sourceType: "admin_grant",
        });
        const nextRecent = mergeCityCashRecent(userData.cityCashRecent, nextRecentEntry);

        transaction.set(userRef, {
          cityCashBalance: nextBalance,
          cityCashStats: nextStats,
          cityCashRecent: nextRecent,
          cityCashUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        transaction.set(txRef, {
          uid: targetUid,
          type: "earn",
          actionKey: "admin_grant",
          label,
          amount,
          balanceBefore: currentBalance,
          balanceAfter: nextBalance,
          sourceId: grantKey || `admin_${decoded.uid}`,
          sourceType: "admin_grant",
          meta: {
            adminUid: decoded.uid,
            adminEmail: decoded.email || "",
            grantKey,
            note,
          },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        if (grantRef) {
          transaction.set(grantRef, {
            uid: targetUid,
            adminUid: decoded.uid,
            adminEmail: decoded.email || "",
            amount,
            label,
            grantKey,
            note,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        return {
          awarded: true,
          amount,
          balance: nextBalance,
          stats: nextStats,
          recent: nextRecent,
          label,
          targetUid,
        };
      });

      res.json({ ok: true, ...outcome });
    } catch (error) {
      const status = mapCityCashError(error);
      res.status(status).json({
        ok: false,
        error: error.message || "admin-grant-failed",
      });
    }
  });

exports.purchaseCityCashRanking = functions
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    const decoded = await authenticateCityCashRequest(req, res);
    if (!decoded) return;

    try {
      const uid = decoded.uid;
      const businessId = String(req.body?.businessId || "").trim();
      const slotType = normalizeCityCashKey(req.body?.slotType || "", "");
      const requestedCity = normalizeCityCashKey(req.body?.city || "lamas");
      const slotConfig = CITYCASH_SLOT_CONFIG[slotType];

      if (!businessId || !slotConfig) {
        res.status(400).json({ ok: false, error: "invalid-purchase-request" });
        return;
      }

      const db = admin.firestore();
      const userRef = await ensureCityCashUserDoc(uid, decoded);
      const businessRef = db.collection("negocio").doc(businessId);
      const transactionRef = db.collection("citycash_transactions").doc();
      const weekWindow = buildCityCashWeekWindow();
      const weekRef = db.collection("citycash_weeks").doc(weekWindow.weekKey);

      const outcome = await db.runTransaction(async (transaction) => {
        const [userSnap, businessSnap, weekSnap] = await Promise.all([
          transaction.get(userRef),
          transaction.get(businessRef),
          transaction.get(weekRef),
        ]);

        if (!businessSnap.exists) throw new Error("business-not-found");

        const business = businessSnap.data() || {};
        if (business.uid !== uid) throw new Error("forbidden-business");
        const businessCity = normalizeCityCashKey(business.ciudad || business.provincia || requestedCity);
        if (businessCity !== requestedCity) throw new Error("citycash-city-mismatch");

        const userData = userSnap.data() || {};
        const currentBalance = Number(userData.cityCashBalance || 0);
        if (currentBalance < slotConfig.price) {
          throw new Error("citycash-insufficient-balance");
        }

        const weekData = weekSnap.data() || {};
        const rankings = normalizeCityCashWeekRankings(weekData.rankings);
        if (!rankings[requestedCity]) {
          rankings[requestedCity] = createEmptyCityCashBoard();
        }

        const cityBoard = rankings[requestedCity];
        const targetSlots = Array.isArray(cityBoard[slotType]) ? cityBoard[slotType] : createEmptyCityCashBoard()[slotType];
        const firstAvailableIndex = targetSlots.findIndex((item) => !item);
        if (firstAvailableIndex === -1) {
          throw new Error("citycash-slot-unavailable");
        }

        const nextBalance = currentBalance - slotConfig.price;
        const currentStats = userData.cityCashStats || {};
        const slotIndex = firstAvailableIndex + 1;
        const entryPayload = {
          uid,
          businessId,
          businessName: business.nombre || "Mi negocio",
          businessCategory: business.categoria || "Negocio local",
          businessImage: business.foto_thumb || business.imagen_thumb || business.foto || business.imagen || "",
          city: requestedCity,
          slotType,
          slotIndex,
          slotLabel: slotConfig.label,
          price: slotConfig.price,
          slotOrder: slotConfig.order,
          weekKey: weekWindow.weekKey,
          weekStartsAt: weekWindow.startTimestamp,
          weekEndsAt: weekWindow.endTimestamp,
          purchasedAtMs: Date.now(),
        };
        const nextStats = {
          totalEarned: Number(currentStats.totalEarned || 0),
          totalSpent: Number(currentStats.totalSpent || 0) + slotConfig.price,
        };
        cityBoard[slotType] = [...targetSlots];
        cityBoard[slotType][firstAvailableIndex] = entryPayload;
        const nextRecentEntry = buildCityCashRecentEntry(transactionRef.id, {
          type: "spend",
          actionKey: "ranking_purchase",
          label: `Ranking CityCash: ${slotConfig.label}`,
          amount: -slotConfig.price,
          sourceId: `${requestedCity}_${slotType}_${slotIndex}`,
          sourceType: "citycash_ranking",
        });
        const nextRecent = mergeCityCashRecent(userData.cityCashRecent, nextRecentEntry);

        transaction.set(weekRef, {
          weekKey: weekWindow.weekKey,
          startsAt: weekWindow.startTimestamp,
          endsAt: weekWindow.endTimestamp,
          rankings,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        transaction.set(userRef, {
          cityCashBalance: nextBalance,
          cityCashStats: nextStats,
          cityCashRecent: nextRecent,
          cityCashUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        transaction.set(transactionRef, {
          uid,
          type: "spend",
          actionKey: "ranking_purchase",
          label: `Ranking CityCash: ${slotConfig.label}`,
          amount: -slotConfig.price,
          balanceBefore: currentBalance,
          balanceAfter: nextBalance,
          sourceId: `${requestedCity}_${slotType}_${slotIndex}`,
          sourceType: "citycash_ranking",
          meta: {
            businessId,
            businessName: entryPayload.businessName,
            city: requestedCity,
            slotType,
            slotIndex,
            weekKey: weekWindow.weekKey,
          },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return {
          purchased: true,
          balance: nextBalance,
          stats: nextStats,
          recent: nextRecent,
          price: slotConfig.price,
          weekKey: weekWindow.weekKey,
          city: requestedCity,
          slotType,
          slotIndex,
        };
      });

      res.json({ ok: true, ...outcome });
    } catch (error) {
      const status = mapCityCashError(error);
      res.status(status).json({
        ok: false,
        error: error.message || "purchase-failed",
      });
    }
  });

exports.cleanupCityCashHistory = functions.pubsub.schedule("every 24 hours").onRun(async () => {
  const db = admin.firestore();
  const cutoffDate = new Date(Date.now() - (CITYCASH_RETENTION_WEEKS * 7 * 24 * 60 * 60 * 1000));
  const cutoff = admin.firestore.Timestamp.fromDate(cutoffDate);
  const staleWeeks = await db.collection("citycash_weeks").where("endsAt", "<", cutoff).limit(10).get();

  if (staleWeeks.empty) return null;

  const deletions = staleWeeks.docs.map((weekDoc) => db.recursiveDelete(weekDoc.ref));
  await Promise.all(deletions);
  return null;
});

exports.submitPremiumRequest = functions
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    const decoded = await authenticateCityCashRequest(req, res);
    if (!decoded) return;

    try {
      const uid = decoded.uid;
      const businessId = String(req.body?.businessId || "").trim();
      const contactPhone = String(req.body?.contactPhone || "").replace(/\D/g, "").slice(0, 20);

      if (!businessId || !contactPhone) {
        res.status(400).json({ ok: false, error: "invalid-premium-request" });
        return;
      }

      const db = admin.firestore();
      const businessRef = db.collection("negocio").doc(businessId);
      const [businessSnap, userSnap] = await Promise.all([
        businessRef.get(),
        db.collection("users").doc(uid).get(),
      ]);

      if (!businessSnap.exists) {
        res.status(404).json({ ok: false, error: "business-not-found" });
        return;
      }

      const business = businessSnap.data() || {};
      if (String(business.uid || "") !== uid) {
        res.status(403).json({ ok: false, error: "forbidden-business" });
        return;
      }

      const userData = userSnap.data() || {};
      const businessName = String(business.nombre || "Negocio sin nombre").trim();
      const businessCategory = String(business.categoria || "Sin categoria").trim();
      const city = normalizeCityCashKey(business.ciudad || business.provincia || business.ubicacion || "lamas");
      const ownerName = String(
        userData.displayName ||
        userData.nombre ||
        decoded.name ||
        decoded.email ||
        "Usuario CityMart"
      ).trim();
      const ownerEmail = String(decoded.email || userData.email || "").trim();
      const requestRef = db.collection("premium_requests").doc();
      const adminPanelLink = `${APP_BASE_URL}/admin.html`;

      await requestRef.set({
        businessId,
        businessName,
        businessCategory,
        city,
        contactPhone,
        businessPhone: String(business.telefono || business.numerodecontacto || "").replace(/\D/g, "").slice(0, 20),
        ownerUid: uid,
        ownerName,
        ownerEmail,
        premiumActive: business.promocionanuncio === true,
        status: "pending",
        adminPanelLink,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const pushResult = await sendAdminPushNotification({
        title: "Nueva solicitud Premium en CityMart",
        body: `${businessName} · ${businessCategory} · ${contactPhone}`.slice(0, 170),
        link: adminPanelLink,
        data: {
          type: "premium_request",
          requestId: requestRef.id,
          businessId,
          businessName,
          city,
        },
      }).catch((error) => {
        console.error("[submitPremiumRequest] Admin push failed:", error);
        return { sent: false, reason: "push-error" };
      });

      await requestRef.set({
        notification: {
          channel: "push",
          sent: Boolean(pushResult?.sent),
          successCount: Number(pushResult?.successCount || 0),
          failureCount: Number(pushResult?.failureCount || 0),
          reason: String(pushResult?.reason || ""),
          attemptedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      }, { merge: true });

      await db.collection("alertas").add({
        titulo: "Nueva solicitud Premium",
        resumen: `${businessName} · ${contactPhone}`,
        enlace: "admin.html",
        tipo: "premium_request",
        premiumRequestId: requestRef.id,
        businessId,
        fecha: admin.firestore.FieldValue.serverTimestamp(),
      }).catch(() => null);

      res.json({
        ok: true,
        requestId: requestRef.id,
        notificationSent: Boolean(pushResult?.sent),
      });
    } catch (error) {
      console.error("[submitPremiumRequest]", error);
      res.status(500).json({
        ok: false,
        error: error.message || "premium-request-failed",
      });
    }
  });

exports.linkLegacyBusinessesByEmail = functions
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    const decoded = await authenticateCityCashRequest(req, res);
    if (!decoded) return;

    try {
      const uid = String(decoded.uid || "").trim();
      const email = normalizeOwnerEmail(req.body?.email || decoded.email || "");

      if (!uid || !email) {
        res.status(400).json({ ok: false, error: "missing-owner-email" });
        return;
      }

      const outcome = await linkLegacyBusinessesForUser({
        uid,
        email,
        source: "login_email_exact",
      });

      res.json({
        ok: true,
        ...outcome,
      });
    } catch (error) {
      console.error("[linkLegacyBusinessesByEmail]", error);
      res.status(500).json({
        ok: false,
        error: error.message || "legacy-link-failed",
      });
    }
  });

exports.repairLegacyBusinessOwners = functions
  .runWith({ timeoutSeconds: 540, memory: "1GB", secrets: [BACKFILL_SECRET_PARAM] })
  .https.onRequest(async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "method-not-allowed" });
        return;
      }

      if (!requireBackfillSecret(req, res)) return;

      const db = admin.firestore();
      const authCache = new Map();
      const rawLimit = parseInt(req.body?.limit || req.query.limit || "200", 10);
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 400)) : 200;
      const cursor = String(req.body?.cursor || req.query.cursor || "").trim();

      let businessQuery = db
        .collection("negocio")
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(limit);

      if (cursor) {
        businessQuery = businessQuery.startAfter(cursor);
      }

      const snap = await businessQuery.get();
      let linked = 0;
      let alreadyLinked = 0;
      let awaitingOwnerLogin = 0;
      let manualReview = 0;
      let conflicts = 0;
      let updated = 0;

      for (const docSnap of snap.docs) {
        const data = docSnap.data() || {};
        const existingUid = getLegacyBusinessOwnerUid(data);
        const normalizedEmail = getLegacyBusinessOwnerEmail(data);
        const patch = {};
        let shouldWrite = false;

        if (normalizedEmail && normalizeOwnerEmail(data.owner_email_normalized) !== normalizedEmail) {
          patch.owner_email_normalized = normalizedEmail;
          shouldWrite = true;
        }

        if (!normalizedEmail) {
          if (existingUid) {
            const needsUid = String(data.uid || "").trim() !== existingUid;
            const needsOwnerUid = String(data.ownerUid || "").trim() !== existingUid;
            const needsStatus = String(data.owner_link_status || "").trim().toLowerCase() !== "linked";

            if (needsUid) {
              patch.uid = existingUid;
              shouldWrite = true;
            }

            if (needsOwnerUid) {
              patch.ownerUid = existingUid;
              shouldWrite = true;
            }

            if (needsStatus) {
              patch.owner_link_status = "linked";
              patch.owner_link_source = "legacy_owner_field";
              shouldWrite = true;
            }

            alreadyLinked += 1;
          } else {
            if (String(data.owner_link_status || "").trim() !== "manual_review") {
              patch.owner_link_status = "manual_review";
              patch.owner_link_reason = "missing_owner_email";
              shouldWrite = true;
            }
            manualReview += 1;
          }
        } else {
          const userRecord = await resolveAuthUserByEmail(normalizedEmail, authCache);

          if (!userRecord) {
            if (String(data.owner_link_status || "").trim() !== "awaiting_owner_login") {
              patch.owner_link_status = "awaiting_owner_login";
              patch.owner_link_reason = "auth_user_not_found";
              shouldWrite = true;
            }
            awaitingOwnerLogin += 1;
          } else if (existingUid && existingUid !== userRecord.uid) {
            if (String(data.owner_link_status || "").trim() !== "manual_review" || String(data.owner_link_reason || "").trim() !== "email_uid_conflict") {
              patch.owner_link_status = "manual_review";
              patch.owner_link_reason = "email_uid_conflict";
              shouldWrite = true;
            }
            conflicts += 1;
          } else {
            const needsUid = String(data.uid || "").trim() !== userRecord.uid;
            const needsOwnerUid = String(data.ownerUid || "").trim() !== userRecord.uid;
            const needsEmail = normalizeOwnerEmail(data.email_propietario) !== normalizedEmail;
            const needsStatus = String(data.owner_link_status || "").trim().toLowerCase() !== "linked";

            if (needsUid || needsOwnerUid || needsEmail || needsStatus) {
              Object.assign(patch, buildLegacyBusinessOwnerPatch({
                uid: userRecord.uid,
                email: normalizedEmail,
                source: "backfill_email_exact",
              }));
              shouldWrite = true;
            }

            if (existingUid === userRecord.uid && !needsUid) {
              alreadyLinked += 1;
            } else {
              linked += 1;
            }
          }
        }

        if (shouldWrite) {
          await docSnap.ref.set(patch, { merge: true });
          updated += 1;
        }
      }

      res.json({
        ok: true,
        processed: snap.size,
        updated,
        linked,
        alreadyLinked,
        awaitingOwnerLogin,
        manualReview,
        conflicts,
        nextCursor: snap.docs.length ? snap.docs[snap.docs.length - 1].id : null,
        hasMore: snap.size === limit,
      });
    } catch (error) {
      console.error("[repairLegacyBusinessOwners]", error);
      res.status(500).json({
        ok: false,
        error: error.message || "legacy-owner-repair-failed",
      });
    }
  });

exports.getSecretNumberState = functions
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    const decoded = await authenticateCityCashRequest(req, res);
    if (!decoded) return;

    try {
      const uid = String(decoded.uid || "").trim();
      const db = admin.firestore();
      const gameRef = getSecretNumberGameRef();
      let gameSnap = await gameRef.get();

      if (!gameSnap.exists) {
        res.status(200).json({
          ok: true,
          state: buildSecretNumberReadyState(),
        });
        return;
      }

      let state = gameSnap.data() || {};
      const now = Date.now();
      const playerCount = getSecretNumberPlayerCount(state);

      if (shouldFinalizeSecretNumberState(state, now) && playerCount === 0) {
        res.status(200).json({
          ok: true,
          state: buildSecretNumberReadyState(state.lastResult || null),
        });
        return;
      }

      if (shouldFinalizeSecretNumberState(state, now) && playerCount > 0) {
        const secretNumber = crypto.randomInt(SECRET_NUMBER_RANGE_MIN, SECRET_NUMBER_RANGE_MAX + 1);
        await db.runTransaction(async (transaction) => {
          const freshSnap = await transaction.get(gameRef);
          if (!freshSnap.exists) return;

          const freshState = freshSnap.data() || {};
          if (!shouldFinalizeSecretNumberState(freshState, now) || getSecretNumberPlayerCount(freshState) === 0) {
            return;
          }

          const evaluation = evaluateSecretNumberRound(freshState, {
            now,
            secretNumber,
          });
          const settledState = await settleSecretNumberRoundTransaction({
            transaction,
            db,
            state: freshState,
            now,
            evaluation,
          });
          transaction.set(gameRef, settledState, { merge: false });
        });

        gameSnap = await gameRef.get();
        if (!gameSnap.exists) {
          res.status(200).json({
            ok: true,
            state: buildSecretNumberReadyState(),
          });
          return;
        }

        state = gameSnap.data() || {};
      }

      res.status(200).json({
        ok: true,
        state: buildSecretNumberPublicState(state, uid),
      });
    } catch (error) {
      const status = mapCityCashError(error);
      res.status(status).json({
        ok: false,
        error: error.message || "secret-number-state-failed",
      });
    }
  });

exports.playSecretNumber = functions
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    const decoded = await authenticateCityCashRequest(req, res);
    if (!decoded) return;

    try {
      const uid = String(decoded.uid || "").trim();
      const guess = sanitizeSecretNumberGuess(req.body?.guess);
      const now = Date.now();
      const db = admin.firestore();
      const gameRef = getSecretNumberGameRef();
      const userRef = await ensureCityCashUserDoc(uid, decoded);
      const settlementSecretNumber = crypto.randomInt(SECRET_NUMBER_RANGE_MIN, SECRET_NUMBER_RANGE_MAX + 1);
      const entryTxRef = db.collection("citycash_transactions").doc();

      const publicState = await db.runTransaction(async (transaction) => {
        const [gameSnap, userSnap] = await Promise.all([
          transaction.get(gameRef),
          transaction.get(userRef),
        ]);

        let currentState = gameSnap.exists ? (gameSnap.data() || {}) : null;
        let currentUserData = userSnap.data() || {};
        let preservedLastResult = currentState?.lastResult || null;

        if (currentState && shouldFinalizeSecretNumberState(currentState, now)) {
          if (getSecretNumberPlayerCount(currentState) > 0) {
            const evaluation = evaluateSecretNumberRound(currentState, {
              now,
              secretNumber: settlementSecretNumber,
            });
            currentState = await settleSecretNumberRoundTransaction({
              transaction,
              db,
              state: currentState,
              now,
              evaluation,
            });
            currentUserData = applySecretNumberSettlementPreviewToUserData(currentUserData, evaluation, uid);
            preservedLastResult = currentState.lastResult || preservedLastResult;
          }
          currentState = null;
        }

        if (!currentState || String(currentState.status || "") !== "open") {
          currentState = buildSecretNumberRoundState({
            now,
            lastResult: preservedLastResult,
          });
        }

        let currentPlayers = getSecretNumberPlayersOrder(currentState);
        if (currentPlayers.includes(uid)) {
          throw new Error("secret-number-already-entered");
        }

        if (currentPlayers.length >= SECRET_NUMBER_MAX_PLAYERS) {
          const evaluation = evaluateSecretNumberRound(currentState, {
            now,
            secretNumber: settlementSecretNumber,
          });
          currentState = await settleSecretNumberRoundTransaction({
            transaction,
            db,
            state: currentState,
            now,
            evaluation,
          });
          currentUserData = applySecretNumberSettlementPreviewToUserData(currentUserData, evaluation, uid);
          preservedLastResult = currentState.lastResult || preservedLastResult;
          currentState = buildSecretNumberRoundState({
            now,
            lastResult: preservedLastResult,
          });
          currentPlayers = [];
        }

        if (Number(currentUserData.cityCashBalance || 0) < SECRET_NUMBER_ENTRY_FEE) {
          throw new Error("citycash-insufficient-balance");
        }

        const nextPlayersOrder = [...currentPlayers, uid];
        const playerProfile = buildSecretNumberPlayerProfile({
          uid,
          decoded,
          userData: currentUserData,
          guess,
          joinedAtMs: now,
          joinOrder: nextPlayersOrder.length,
        });

        applyCityCashDeltaTransaction({
          transaction,
          userRef,
          userData: currentUserData,
          txRef: entryTxRef,
          uid,
          amount: -SECRET_NUMBER_ENTRY_FEE,
          type: "spend",
          actionKey: "secret_number_entry",
          label: "Entrada Numero Secreto",
          sourceId: currentState.roundId,
          sourceType: "secret_number_round",
          meta: {
            roundId: currentState.roundId,
            guess,
          },
        });

        currentState.players = {
          ...(currentState.players || {}),
          [uid]: playerProfile,
        };
        currentState.playersOrder = nextPlayersOrder;
        currentState.playerCount = nextPlayersOrder.length;
        currentState.pot = Number(currentState.pot || 0) + SECRET_NUMBER_ENTRY_FEE;
        currentState.updatedAtMs = now;

        let responseState = currentState;
        if (nextPlayersOrder.length >= SECRET_NUMBER_MAX_PLAYERS) {
          const evaluation = evaluateSecretNumberRound(currentState, {
            now,
            secretNumber: settlementSecretNumber,
          });
          responseState = await settleSecretNumberRoundTransaction({
            transaction,
            db,
            state: currentState,
            now,
            evaluation,
          });
        }

        transaction.set(gameRef, responseState, { merge: false });
        return buildSecretNumberPublicState(responseState, uid);
      });

      res.status(200).json({
        ok: true,
        state: publicState,
      });
    } catch (error) {
      const status = mapCityCashError(error);
      res.status(status).json({
        ok: false,
        error: error.message || "secret-number-play-failed",
      });
    }
  });

async function recalculateBusinessReviewStats(businessId) {
  const normalizedBusinessId = String(businessId || "").trim();
  if (!normalizedBusinessId) return null;

  const db = admin.firestore();
  const reviewsSnap = await db.collection("resenas")
    .where("negocio_id", "==", normalizedBusinessId)
    .get();
  let total = 0;
  let count = 0;

  reviewsSnap.forEach((docSnap) => {
    const rating = Number(docSnap.data()?.puntuacion || 0);
    if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
      total += rating;
      count += 1;
    }
  });

  const average = count ? Number((total / count).toFixed(2)) : 0;
  await db.collection("negocio").doc(normalizedBusinessId).set({
    promedio_puntuacion: average,
    rating_promedio: average,
    total_resenas: count,
    rating_updated_at: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { businessId: normalizedBusinessId, average, count };
}

exports.syncBusinessReviewStats = functions.firestore
  .document("resenas/{reviewId}")
  .onWrite(async (change) => {
    const beforeBusinessId = change.before.exists ? change.before.data()?.negocio_id : "";
    const afterBusinessId = change.after.exists ? change.after.data()?.negocio_id : "";
    const affectedBusinessIds = Array.from(new Set([beforeBusinessId, afterBusinessId].filter(Boolean)));

    await Promise.all(affectedBusinessIds.map((businessId) => recalculateBusinessReviewStats(businessId)));
    return null;
  });

exports.pruneCityCashTransactions = functions.firestore.document("citycash_transactions/{txId}").onCreate(async (snap) => {
  const data = snap.data() || {};
  const uid = data.uid;
  if (!uid) return null;

  const db = admin.firestore();
  try {
    const snapshot = await db.collection("citycash_transactions")
      .where("uid", "==", uid)
      .orderBy("createdAt", "desc")
      .limit(15)
      .get();

    if (snapshot.size <= 6) return null;

    const toDelete = snapshot.docs.slice(6);
    const batch = db.batch();
    toDelete.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    return null;
  } catch (error) {
    console.error("[pruneCityCashTransactions] Error:", error);
    return null;
  }
});

/**
 * Limpieza automatica del Chat Global
 * Se ejecuta cada hora y elimina mensajes con antiguedad superior a 24 horas.
 */
exports.cleanupGlobalChat = functions.pubsub
  .schedule('every 1 hours')
  .onRun(async (context) => {
    const cutOff = Date.now() - (24 * 60 * 60 * 1000);
    const chatPaths = [
      'global_chat',
      'global_chat_by_city/lamas',
      'global_chat_by_city/tarapoto'
    ];
    
    try {
      for (const path of chatPaths) {
        const chatRef = admin.database().ref(path);
        const oldMessagesQuery = chatRef.orderByChild('timestamp').endAt(cutOff);
        const snapshot = await oldMessagesQuery.once('value');
        const updates = {};

        snapshot.forEach((child) => {
          updates[child.key] = null;
        });

        if (Object.keys(updates).length > 0) {
          await chatRef.update(updates);
          console.log('[cleanupGlobalChat] ' + path + ': se eliminaron ' + Object.keys(updates).length + ' mensajes expirados.');
        }
      }

      const bucket = admin.storage().bucket();
      const [files] = await bucket.getFiles({ prefix: 'chat_photos/' });
      const stalePhotos = files.filter((file) => {
        const createdAt = Date.parse(file.metadata && file.metadata.timeCreated ? file.metadata.timeCreated : '');
        return Number.isFinite(createdAt) && createdAt <= cutOff;
      });

      if (stalePhotos.length > 0) {
        await Promise.all(
          stalePhotos.map((file) => file.delete({ ignoreNotFound: true }).catch((error) => {
            console.warn('[cleanupGlobalChat] No se pudo borrar foto ' + file.name + ':', error.message);
            return null;
          }))
        );
        console.log('[cleanupGlobalChat] chat_photos: se eliminaron ' + stalePhotos.length + ' fotos expiradas.');
      }
      
      return null;
    } catch (error) {
      console.error('[cleanupGlobalChat] Error:', error);
      return null;
    }
  });
