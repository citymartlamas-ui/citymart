/**
 * CityMart Smart Cache System
 * Reduces Firestore reads by caching data in localStorage.
 * Strategy: show cached data immediately, then refresh in background.
 */

const CityCache = (() => {
    const PREFIX = 'cm_cache_';
    const NETWORK_FIRST_KEYS = new Set([
        'negocios',
        'negocios_raw',
        'negocios_turismo',
        'promociones',
        'noticias',
        'resenas'
    ]);

    const TTL = {
        negocios: 5 * 60 * 1000,
        negocios_raw: 5 * 60 * 1000,
        negocios_turismo: 5 * 60 * 1000,
        promociones: 3 * 60 * 1000,
        noticias: 5 * 60 * 1000,
        resenas: 5 * 60 * 1000,
        encuestas: 2 * 60 * 1000,
        default: 3 * 60 * 1000
    };

    function set(key, data) {
        try {
            localStorage.setItem(PREFIX + key, JSON.stringify({
                data,
                timestamp: Date.now()
            }));
        } catch (error) {
            console.warn('[Cache] Storage full, cleaning old entries');
            cleanOldEntries();

            try {
                localStorage.setItem(PREFIX + key, JSON.stringify({
                    data,
                    timestamp: Date.now()
                }));
            } catch (retryError) {
                console.warn('[Cache] Could not save after cleanup');
            }
        }
    }

    function get(key) {
        try {
            const raw = localStorage.getItem(PREFIX + key);
            if (!raw) return null;

            const entry = JSON.parse(raw);
            const ttl = TTL[key] || TTL.default;
            const age = Date.now() - entry.timestamp;

            if (age > ttl) return null;
            return entry.data;
        } catch (error) {
            return null;
        }
    }

    function getStale(key) {
        try {
            const raw = localStorage.getItem(PREFIX + key);
            if (!raw) return null;

            const entry = JSON.parse(raw);
            const ttl = TTL[key] || TTL.default;
            const age = Date.now() - entry.timestamp;

            return {
                data: entry.data,
                fresh: age <= ttl,
                age
            };
        } catch (error) {
            return null;
        }
    }

    function invalidate(key) {
        localStorage.removeItem(PREFIX + key);
    }

    function invalidateAll() {
        Object.keys(localStorage).forEach((key) => {
            if (key.startsWith(PREFIX)) {
                localStorage.removeItem(key);
            }
        });
    }

    function cleanOldEntries() {
        const maxAge = 30 * 60 * 1000;

        Object.keys(localStorage).forEach((key) => {
            if (!key.startsWith(PREFIX)) return;

            try {
                const entry = JSON.parse(localStorage.getItem(key));
                if (Date.now() - entry.timestamp > maxAge) {
                    localStorage.removeItem(key);
                }
            } catch (error) {
                localStorage.removeItem(key);
            }
        });
    }

    function createFingerprint(data) {
        if (Array.isArray(data)) {
            return `${data.length}|${data.map((item) => {
                if (!item || typeof item !== 'object') return String(item);

                const source = item.data && typeof item.data === 'object' ? item.data : item;
                const id = item.id || item._id || source.id || source._id || source.uid || source.token || source.slug || '';
                const label = source.nombre || source.titulo || source.title || source.categoria || source.category || source.estado || source.type || '';
                const stamp = source.updatedAt || source.fecha || source.fecha_registro || source.timestamp || source.fecha_publicacion || source.createdAt || '';
                const mediaSignal = [
                    source.foto_thumb,
                    source.imagen_thumb,
                    source.photo_thumb,
                    source.photoURL_thumb,
                    source.foto,
                    source.imagen,
                    source.photo,
                    source.photoURL
                ].filter(Boolean).join('|');
                const signal = Array.isArray(source.voters)
                    ? source.voters.length
                    : `${source.description || source.content || source.phone || ''}|${mediaSignal}`;

                return `${id}:${label}:${stamp}:${signal}`;
            }).join('|')}`;
        }

        if (data && typeof data === 'object') {
            return Object.keys(data).sort().join('|');
        }

        return String(data);
    }

    function isEmptyArrayData(data) {
        return Array.isArray(data) && data.length === 0;
    }

    async function loadWithCache(cacheKey, fetchFn, renderFn, options = {}) {
        const cached = getStale(cacheKey);
        const cachedFingerprint = cached ? createFingerprint(cached.data) : null;
        const strategy = options.strategy || (NETWORK_FIRST_KEYS.has(cacheKey) ? 'network-first' : 'cache-first');
        const cachedIsEmpty = isEmptyArrayData(cached?.data);
        const renderFallbackOnError = options.renderFallbackOnError !== false;
        const errorFallbackData = Object.prototype.hasOwnProperty.call(options, 'errorFallbackData')
            ? options.errorFallbackData
            : [];

        if (cached && cached.data != null) {
            try {
                renderFn(cached.data);
            } catch (error) {
                console.error(`[Cache] Error rendering ${cacheKey} from cache:`, error);
            }

            if (strategy !== 'network-first' && cached.fresh && !cachedIsEmpty) {
                return cached.data;
            }
        }

        try {
            const freshData = await fetchFn();
            if (freshData == null) {
                return cached ? cached.data : null;
            }

            set(cacheKey, freshData);

            if (!cached || cachedFingerprint !== createFingerprint(freshData)) {
                try {
                    renderFn(freshData);
                } catch (error) {
                    console.error(`[Cache] Error rendering fresh ${cacheKey}:`, error);
                }
            }

            return freshData;
        } catch (error) {
            console.error(`[Cache] ${cacheKey}: fetch failed`, error);

            if (cached) {
                return cached.data;
            }

            if (renderFallbackOnError) {
                try {
                    renderFn(errorFallbackData);
                } catch (renderError) {
                    console.error(`[Cache] Error rendering fallback ${cacheKey}:`, renderError);
                }
            }

            return errorFallbackData;
        }
    }

    function listenWithCache(cacheKey, snapshotSetupFn, transformFn, renderFn) {
        const cached = getStale(cacheKey);
        let isFirstSnapshot = true;
        let lastFingerprint = cached ? createFingerprint(cached.data) : null;

        if (cached) {
            renderFn(cached.data);

            if (cached.fresh) {
                console.log(`[Cache] ${cacheKey}: serving fresh, will listen for updates`);
                isFirstSnapshot = false;
            }
        }

        let lastRender = cached ? Date.now() : 0;
        const minRenderInterval = 2000;

        return snapshotSetupFn((snapshot) => {
            const data = transformFn(snapshot);
            const fingerprint = createFingerprint(data);
            set(cacheKey, data);

            if (!isFirstSnapshot && fingerprint === lastFingerprint) {
                return;
            }

            const now = Date.now();
            if (isFirstSnapshot || (now - lastRender > minRenderInterval)) {
                renderFn(data);
                lastRender = now;
                isFirstSnapshot = false;
                lastFingerprint = fingerprint;
            }
        });
    }

    return {
        set,
        get,
        getStale,
        invalidate,
        invalidateAll,
        loadWithCache,
        listenWithCache,
        TTL
    };
})();

window.CityCache = CityCache;
