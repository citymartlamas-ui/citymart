(() => {
    if (window.__cityMartPwaInit) return;
    window.__cityMartPwaInit = true;

    const CLIENT_ASSET_VERSION = '2026-04-11-premium-fix-1';
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
            forceUpdate: true,
            skipWaiting: true,
            reloadOnActivate: true,
            logErrors: false,
            ...window.CityMartPWAConfig,
            ...options
        };
    }

    function markReloaded() {
        try {
            if (sessionStorage.getItem('sw_refreshed')) return false;
            sessionStorage.setItem('sw_refreshed', '1');
            return true;
        } catch (error) {
            return true;
        }
    }

    function markClientRefresh(version) {
        try {
            const key = `cm_client_refresh_${version}`;
            if (sessionStorage.getItem(key)) return false;
            sessionStorage.setItem(key, '1');
            return true;
        } catch (error) {
            return true;
        }
    }

    async function refreshClientAssetsIfNeeded() {
        try {
            const storedVersion = localStorage.getItem('cm_client_asset_version');
            if (storedVersion === CLIENT_ASSET_VERSION) return false;

            localStorage.setItem('cm_client_asset_version', CLIENT_ASSET_VERSION);
            Object.keys(localStorage)
                .filter((key) => key.startsWith('cm_cache_'))
                .forEach((key) => localStorage.removeItem(key));

            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
                await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
            }

            if ('caches' in window) {
                const cacheKeys = await caches.keys().catch(() => []);
                await Promise.all(
                    cacheKeys
                        .filter((key) => key.startsWith('citymart-'))
                        .map((key) => caches.delete(key).catch(() => false))
                );
            }

            if (markClientRefresh(CLIENT_ASSET_VERSION)) {
                window.location.reload();
                return true;
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
            const reloadPage = () => {
                if (!config.reloadOnActivate) return;
                if (!markReloaded()) return;
                window.location.reload();
            };

            navigator.serviceWorker.addEventListener('controllerchange', reloadPage, { once: true });

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
