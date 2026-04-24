(() => {
    if (window.__cityMartPwaInit) return;
    window.__cityMartPwaInit = true;

    const CLIENT_ASSET_VERSION = '2026-04-24-navigation-lists-1';
    let registrationPromise = null;

    function dispatch(name, detail) {
        try {
            window.dispatchEvent(new CustomEvent(name, { detail }));
        } catch (error) {
            // Ignore CustomEvent issues on very old browsers.
        }
    }

    function getConfig(options = {}) {
        return {
            autoRegister: true,
            swUrl: '/sw.js',
            registerOptions: {
                scope: '/',
                updateViaCache: 'none'
            },
            forceUpdate: false,
            skipWaiting: false,
            reloadOnActivate: false,
            logErrors: false,
            ...window.CityMartPWAConfig,
            ...options
        };
    }

    async function refreshClientAssetsIfNeeded() {
        try {
            const storedVersion = localStorage.getItem('cm_client_asset_version');
            if (storedVersion === CLIENT_ASSET_VERSION) return false;

            localStorage.setItem('cm_client_asset_version', CLIENT_ASSET_VERSION);
            Object.keys(localStorage)
                .filter((key) => key.startsWith('cm_cache_'))
                .forEach((key) => localStorage.removeItem(key));

            if ('caches' in window) {
                setTimeout(() => {
                    caches.keys()
                        .then((cacheKeys) => Promise.all(
                            cacheKeys
                                .filter((key) => key.startsWith('citymart-'))
                                .map((key) => caches.delete(key).catch(() => false))
                        ))
                        .catch(() => { });
                }, 1500);
            }
        } catch (error) {
            // If cleanup fails, continue with the regular registration flow.
        }

        return false;
    }

    function registerCityMartPWA(options = {}) {
        if (!('serviceWorker' in navigator)) {
            return Promise.resolve(null);
        }

        if (registrationPromise) {
            return registrationPromise;
        }

        const config = getConfig(options);

        const runRegistration = () => refreshClientAssetsIfNeeded().then((didRefresh) => {
            if (didRefresh) {
                return new Promise(() => { });
            }

            return navigator.serviceWorker.register(config.swUrl, config.registerOptions);
        }).then((registration) => {
            if (config.reloadOnActivate) {
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    dispatch('citymart:sw-controllerchange', { registration, config });
                }, { once: true });
            }

            if (config.forceUpdate) {
                registration.update().catch(() => { });
            }

            if (config.skipWaiting && registration.waiting) {
                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }

            if (config.skipWaiting) {
                registration.addEventListener('updatefound', () => {
                    const nextWorker = registration.installing;
                    if (!nextWorker) return;

                    nextWorker.addEventListener('statechange', () => {
                        if (nextWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            nextWorker.postMessage({ type: 'SKIP_WAITING' });
                        }
                    });
                });
            }

            dispatch('citymart:sw-ready', { registration, config });
            return registration;
        }).catch((error) => {
            if (config.logErrors) {
                console.error('[PWA] Service worker registration failed:', error);
            }

            dispatch('citymart:sw-error', { error, config });
            throw error;
        });

        if (document.readyState === 'complete') {
            registrationPromise = runRegistration();
        } else {
            registrationPromise = new Promise((resolve, reject) => {
                window.addEventListener('load', () => {
                    runRegistration().then(resolve).catch(reject);
                }, { once: true });
            });
        }

        return registrationPromise;
    }

    window.registerCityMartPWA = registerCityMartPWA;

    const initialConfig = getConfig();
    if (initialConfig.autoRegister !== false) {
        registerCityMartPWA(initialConfig).catch(() => { });
    }
})();
