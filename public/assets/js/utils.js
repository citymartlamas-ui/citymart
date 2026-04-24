/**
 * CityMart Utilities
 * Reusable functions across the application
 */

(() => {
    let patched = false;

    function patchLucide() {
        if (patched || !window.lucide || typeof window.lucide.createIcons !== 'function') return;

        const originalCreateIcons = window.lucide.createIcons.bind(window.lucide);
        let queued = false;

        function flush() {
            queued = false;
            originalCreateIcons();
        }

        window.runLucideIconsNow = originalCreateIcons;
        window.scheduleLucideIcons = () => {
            if (queued) return;
            queued = true;

            if (typeof window.requestAnimationFrame === 'function') {
                window.requestAnimationFrame(flush);
            } else {
                setTimeout(flush, 16);
            }
        };

        window.lucide.createIcons = window.scheduleLucideIcons;
        patched = true;
    }

    patchLucide();

    if (!patched) {
        window.addEventListener('load', patchLucide, { once: true });
    }
})();

(() => {
    const warmedOrigins = new Set();
    const preferredOrigins = [
        'https://firebasestorage.googleapis.com',
        'https://images.unsplash.com'
    ];

    function appendHint(rel, href, crossOrigin = false) {
        if (!document.head || document.head.querySelector(`link[rel="${rel}"][href="${href}"]`)) return;

        const link = document.createElement('link');
        link.rel = rel;
        link.href = href;

        if (crossOrigin) {
            link.crossOrigin = 'anonymous';
        }

        document.head.appendChild(link);
    }

    function warmOrigin(origin) {
        if (!origin || warmedOrigins.has(origin)) return;
        warmedOrigins.add(origin);
        appendHint('dns-prefetch', origin);
        appendHint('preconnect', origin, true);
    }

    const run = () => preferredOrigins.forEach(warmOrigin);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
        run();
    }
})();

window.normalizeCityValue = function (value, fallback = 'lamas') {
    const normalized = String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

    return normalized || fallback;
};

window.getStoredCity = function (fallback = 'lamas') {
    const normalized = window.normalizeCityValue(
        (() => {
            try {
                return localStorage.getItem('citymart_city');
            } catch (error) {
                return fallback;
            }
        })(),
        fallback
    );

    try {
        if (localStorage.getItem('citymart_city') !== normalized) {
            localStorage.setItem('citymart_city', normalized);
        }
    } catch (error) {
        // Ignore storage write issues.
    }

    return normalized;
};

window.optimizeRemoteImageUrl = function (url, { width = 960, quality = 76 } = {}) {
    const value = typeof url === 'string' ? url.trim() : '';
    if (!value) return '';
    if (!/^https?:\/\//i.test(value)) return value;

    try {
        const parsed = new URL(value);

        if (parsed.hostname.includes('images.unsplash.com')) {
            parsed.searchParams.set('auto', 'format');
            parsed.searchParams.set('fit', 'crop');
            parsed.searchParams.set('q', String(quality));

            if (width) {
                parsed.searchParams.set('w', String(width));
            }
        }

        return parsed.toString();
    } catch (error) {
        return value;
    }
};

window.pickDisplayImage = function (candidates = [], fallback = 'assets/placeholder.svg', options = {}) {
    const pool = Array.isArray(candidates) ? candidates : [candidates];
    const selected = pool.find((candidate) => typeof candidate === 'string' && candidate.trim());
    const finalUrl = selected || fallback;

    return window.optimizeRemoteImageUrl
        ? window.optimizeRemoteImageUrl(finalUrl, options)
        : finalUrl;
};

window.pickEntityImage = function (entity = {}, fallback = 'assets/placeholder.svg', options = {}) {
    if (!entity || typeof entity !== 'object') {
        return window.pickDisplayImage ? window.pickDisplayImage([], fallback, options) : fallback;
    }

    return window.pickDisplayImage
        ? window.pickDisplayImage([
            entity.foto_thumb,
            entity.imagen_thumb,
            entity.photo_thumb,
            entity.photoURL_thumb,
            entity.foto,
            entity.logo,
            entity.imagen,
            entity.photo,
            entity.photoURL
        ], fallback, options)
        : (
            entity.foto_thumb ||
            entity.imagen_thumb ||
            entity.photo_thumb ||
            entity.photoURL_thumb ||
            entity.foto ||
            entity.logo ||
            entity.imagen ||
            entity.photo ||
            entity.photoURL ||
            fallback
        );
};

window.escapeHtml = window.escapeHtml || function (value = '') {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

window.sanitizePhone = window.sanitizePhone || function (value = '') {
    return String(value || '').replace(/\D/g, '').slice(0, 20);
};

window.sanitizeUrl = window.sanitizeUrl || function (value = '', fallback = '') {
    const url = String(value || '').trim();
    if (!url) return fallback;

    try {
        const parsed = new URL(url, window.location.origin);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.href;
        }
    } catch (error) {
        if (/^(assets\/|\.\/|\.\.\/)/.test(url) && !url.includes('javascript:')) {
            return url;
        }
    }

    return fallback;
};

window.setStoredCity = function (value, fallback = 'lamas') {
    const normalized = window.normalizeCityValue(value, fallback);
    let previous = null;

    try {
        previous = localStorage.getItem('citymart_city');
        localStorage.setItem('citymart_city', normalized);
    } catch (error) {
        // Ignore storage write issues.
    }

    if (previous !== normalized) {
        window.dispatchEvent(new CustomEvent('citymart:city-changed', {
            detail: {
                city: normalized,
                previousCity: previous
            }
        }));
    }

    return normalized;
};

window.normalizeSearchTerm = function (value = '') {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

window.getEntityTimestamp = function (entity = {}) {
    const candidates = [
        entity?.updatedAt,
        entity?.fecha_registro,
        entity?.fechaRegistro,
        entity?.createdAt,
        entity?.fecha_creacion,
        entity?.fecha_publicacion,
        entity?.fecha,
        entity?.timestamp
    ];

    for (const candidate of candidates) {
        if (!candidate) continue;
        if (typeof candidate?.toDate === 'function') return candidate.toDate().getTime();
        if (typeof candidate?.seconds === 'number') return candidate.seconds * 1000;
        if (candidate instanceof Date) return candidate.getTime();
        if (typeof candidate === 'number') return candidate > 9999999999 ? candidate : candidate * 1000;

        if (typeof candidate === 'string') {
            const parsed = Date.parse(candidate);
            if (!Number.isNaN(parsed)) return parsed;
        }
    }

    return 0;
};

(() => {
    const EXPOSURE_PREFIX = 'cm_search_exposure_';

    function getSearchId(item) {
        return String(
            item?.id ||
            item?._id ||
            item?.uid ||
            item?.slug ||
            item?.token ||
            item?.nombre ||
            item?.title ||
            ''
        );
    }

    function getRotationBucket() {
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const day = String(now.getUTCDate()).padStart(2, '0');
        const slot = Math.floor(now.getUTCHours() / 8);
        return `${year}-${month}-${day}-${slot}`;
    }

    function readExposureMap(storageKey) {
        try {
            return JSON.parse(localStorage.getItem(storageKey) || '{}');
        } catch (error) {
            return {};
        }
    }

    function writeExposureMap(storageKey, data) {
        try {
            localStorage.setItem(storageKey, JSON.stringify(data));
        } catch (error) {
            // Ignore storage write failures.
        }
    }

    function getExposureStorageKey({ scope = 'search', city = 'lamas', query = '' } = {}) {
        const safeScope = window.normalizeSearchTerm(scope || 'search') || 'search';
        const safeCity = window.normalizeSearchTerm(city || 'lamas') || 'lamas';
        const safeQuery = window.normalizeSearchTerm(query || '') || 'all';
        return `${EXPOSURE_PREFIX}${getRotationBucket()}|${safeScope}|${safeCity}|${safeQuery}`;
    }

    function hashString(value = '') {
        let hash = 2166136261;

        for (let i = 0; i < value.length; i += 1) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }

        return hash >>> 0;
    }

    function getTokenScore(target, tokens, weight) {
        return tokens.reduce((score, token) => score + (target.includes(token) ? weight : 0), 0);
    }

    window.rankCityMartResults = function (items = [], options = {}) {
        const list = Array.isArray(items) ? items.slice() : [];
        const query = window.normalizeSearchTerm(options.query || '');
        const city = window.normalizeSearchTerm(options.city || (window.getStoredCity ? window.getStoredCity() : 'lamas')) || 'lamas';
        const scope = window.normalizeSearchTerm(options.scope || 'search') || 'search';
        const contextTerms = (options.contextTerms || []).map((term) => window.normalizeSearchTerm(term)).filter(Boolean);
        const tokens = query ? query.split(' ').filter(Boolean) : [];
        const exposureMap = readExposureMap(getExposureStorageKey({ scope, city, query }));
        const rotationBucket = getRotationBucket();

        return list
            .map((item) => {
                const id = String(options.getId ? options.getId(item) : getSearchId(item));
                const title = window.normalizeSearchTerm(options.getTitle ? options.getTitle(item) : (item?.title || item?.nombre || ''));
                const category = window.normalizeSearchTerm(options.getCategory ? options.getCategory(item) : (item?.cat || item?.categoria || ''));
                const description = window.normalizeSearchTerm(options.getDescription ? options.getDescription(item) : (item?.sub || item?.descripcion || ''));
                const extraText = window.normalizeSearchTerm(options.getExtraText ? options.getExtraText(item) : '');
                const label = title || category || id;
                const timestamp = options.getTimestamp ? Number(options.getTimestamp(item) || 0) : window.getEntityTimestamp(item);
                const ageHours = timestamp ? Math.max(0, (Date.now() - timestamp) / 3600000) : 9999;
                const freshnessScore = timestamp ? Math.max(0, 18 - Math.floor(ageHours / 24)) : 0;
                const haystack = [title, category, description, extraText].filter(Boolean).join(' ');
                let relevanceScore = 0;

                if (query) {
                    if (title === query) relevanceScore += 240;
                    else if (title.startsWith(query)) relevanceScore += 170;
                    else if (title.includes(query)) relevanceScore += 120;

                    if (category === query) relevanceScore += 105;
                    else if (category.startsWith(query)) relevanceScore += 80;
                    else if (category.includes(query)) relevanceScore += 55;

                    if (description.includes(query)) relevanceScore += 36;
                    if (extraText.includes(query)) relevanceScore += 20;

                    relevanceScore += getTokenScore(title, tokens, 26);
                    relevanceScore += getTokenScore(category, tokens, 16);
                    relevanceScore += getTokenScore(description, tokens, 10);
                    relevanceScore += getTokenScore(extraText, tokens, 6);
                }

                contextTerms.forEach((term) => {
                    if (title.includes(term)) relevanceScore += 8;
                    if (category.includes(term)) relevanceScore += 10;
                    if (description.includes(term)) relevanceScore += 4;
                });

                const exposureCount = Number(exposureMap[id] || 0);
                const rotationValue = hashString(`${rotationBucket}|${scope}|${city}|${query}|${id}|${label}`) % 1000;

                return {
                    item,
                    id,
                    label,
                    relevanceScore,
                    freshnessScore,
                    exposureCount,
                    rotationValue,
                    haystack
                };
            })
            .sort((a, b) => {
                if (Math.abs(b.relevanceScore - a.relevanceScore) > 14) {
                    return b.relevanceScore - a.relevanceScore;
                }

                if (a.exposureCount !== b.exposureCount) {
                    return a.exposureCount - b.exposureCount;
                }

                if (Math.abs(b.freshnessScore - a.freshnessScore) > 3) {
                    return b.freshnessScore - a.freshnessScore;
                }

                if (a.rotationValue !== b.rotationValue) {
                    return a.rotationValue - b.rotationValue;
                }

                if (a.haystack !== b.haystack) {
                    return a.haystack.localeCompare(b.haystack, 'es');
                }

                return a.label.localeCompare(b.label, 'es');
            })
            .map((entry) => entry.item);
    };

    window.recordCityMartSearchExposure = function (items = [], options = {}) {
        if (!Array.isArray(items) || items.length === 0) return;

        const query = window.normalizeSearchTerm(options.query || '');
        const city = window.normalizeSearchTerm(options.city || (window.getStoredCity ? window.getStoredCity() : 'lamas')) || 'lamas';
        const scope = window.normalizeSearchTerm(options.scope || 'search') || 'search';
        const limit = Math.min(Math.max(Number(options.limit) || 4, 1), items.length);
        const storageKey = getExposureStorageKey({ scope, city, query });
        const exposureMap = readExposureMap(storageKey);

        for (let index = 0; index < limit; index += 1) {
            const id = getSearchId(items[index]);
            if (!id) continue;

            const weight = index === 0 ? 4 : index === 1 ? 3 : index === 2 ? 2 : 1;
            exposureMap[id] = Math.min(99, Number(exposureMap[id] || 0) + weight);
        }

        writeExposureMap(storageKey, exposureMap);
    };
})();

window.showToast = function (message, type = 'success') {
    // Ensure container exists
    let container = document.querySelector('.cm-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'cm-toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `cm-toast ${type}`;

    // Select icon based on type
    let icon = 'check-circle';
    if (type === 'error') icon = 'alert-circle';
    if (type === 'info') icon = 'info';

    const iconEl = document.createElement('i');
    iconEl.setAttribute('data-lucide', icon);
    iconEl.style.width = '18px';
    iconEl.style.height = '18px';

    const messageEl = document.createElement('span');
    messageEl.textContent = String(message ?? '');

    toast.append(iconEl, messageEl);

    container.appendChild(toast);

    // Initialize lucide for the new icon
    if (window.scheduleLucideIcons) {
        window.scheduleLucideIcons();
    } else if (window.lucide) {
        window.lucide.createIcons();
    }

    // Remove from DOM after animation finishes (0.3s in + 2.5s hold + 0.3s out = ~3.1s)
    setTimeout(() => {
        toast.remove();
        // Remove container if empty
        if (container.childNodes.length === 0) {
            container.remove();
        }
    }, 3100);
};

window.compressImage = async function (file, { maxWidth = 1280, maxHeight = 1280, quality = 0.76 } = {}) {
    return new Promise(async (resolve, reject) => {
        let currentFile = file;

        // Soporte para HEIC (comÃºn en iPhones)
        if (file.name.toLowerCase().endsWith('.heic') || file.type === 'image/heic') {
            console.log("Detectado formato HEIC, intentando convertir...");
            if (typeof heic2any !== 'undefined') {
                try {
                    const blob = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.7 });
                    currentFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", { type: "image/jpeg" });
                } catch (e) {
                    console.warn("Fallo conversiÃ³n heic2any, continuando con original:", e);
                }
            } else {
                console.warn("heic2any no estÃ¡ cargado. Se intentarÃ¡ procesar como imagen normal.");
            }
        }

        // Si no es imagen tras intento de conversiÃ³n, resolver original
        if (!currentFile.type.startsWith('image/')) {
            return resolve(currentFile);
        }

        const reader = new FileReader();
        reader.readAsDataURL(currentFile);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width *= maxHeight / height;
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(new File([blob], currentFile.name, { type: 'image/jpeg', lastModified: Date.now() }));
                    } else {
                        reject(new Error('Fallo al comprimir la imagen.'));
                    }
                }, 'image/jpeg', quality);
            };
            img.onerror = () => reject(new Error('Fallo al cargar la imagen para compresiÃ³n. Verifica el formato.'));
        };
        reader.onerror = () => reject(new Error('Fallo al leer el archivo.'));
    });
};

window.optimizeUploadImage = async function (file, preset = 'default') {
    const presets = {
        default: { maxWidth: 1280, maxHeight: 1280, quality: 0.76 },
        business: { maxWidth: 1280, maxHeight: 1280, quality: 0.74 },
        gallery: { maxWidth: 1100, maxHeight: 1100, quality: 0.7 },
        promo: { maxWidth: 960, maxHeight: 960, quality: 0.68 },
        news: { maxWidth: 1280, maxHeight: 1280, quality: 0.72 },
        profile: { maxWidth: 720, maxHeight: 720, quality: 0.7 },
        lostfound: { maxWidth: 960, maxHeight: 960, quality: 0.68 },
        communityPost: { maxWidth: 420, maxHeight: 420, quality: 0.6 },
        forumCard: { maxWidth: 420, maxHeight: 420, quality: 0.56 }
    };

    const options = presets[preset] || presets.default;
    return window.compressImage(file, options);
};

// Global polyfill/override for alert if desired (optional, better to call showToast directly)

// Global Chat Loader
(() => {
    function loadGlobalChat() {
        // Prevent loading if we're on a page that shouldn't have chat (optional)
        // e.g. login, signup, admin
        const path = window.location.pathname;
        const excluded = ['/login', '/signup', '/admin', '/forgot-password'];
        if (excluded.some(p => path.includes(p))) return;

        // Load CSS
        if (!document.querySelector('link[href*="global-chat.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'assets/css/global-chat.css?v=20260424-chat-compact-1';
            document.head.appendChild(link);
        }

        const pageAlreadyLoadsChat = Array.from(document.scripts).some((script) => {
            return script.type === 'module' && (
                String(script.src || '').includes('global-chat.js') ||
                String(script.textContent || '').includes('global-chat.js')
            );
        });
        if (pageAlreadyLoadsChat) return;

        if (!window.__citymartGlobalChatLoader) {
            window.__citymartGlobalChatLoader = Promise.all([
                import('./firebase-init.js'),
                import('./global-chat.js?v=20260424-chat-compact-1')
            ]).then(([firebaseInit, globalChat]) => {
                if (typeof globalChat.initGlobalChat === 'function') {
                    globalChat.initGlobalChat(firebaseInit.auth, firebaseInit.rtdb);
                }
            }).catch((error) => {
                console.warn('[GlobalChat] Loader error', error);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadGlobalChat);
    } else {
        loadGlobalChat();
    }
})();
