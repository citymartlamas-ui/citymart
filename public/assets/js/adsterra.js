(function () {
    if (window.CityMartAds) return;

    const BANNER_UNITS = {
        mobile: {
            key: '1f309f781031a219f1d5c5f5d56f3085',
            width: 320,
            height: 50,
            src: 'https://www.highperformanceformat.com/1f309f781031a219f1d5c5f5d56f3085/invoke.js'
        },
        desktop: {
            key: '917827ec4822b74ea508c8e08ba2102c',
            width: 468,
            height: 60,
            src: 'https://www.highperformanceformat.com/917827ec4822b74ea508c8e08ba2102c/invoke.js'
        }
    };

    const NATIVE_UNIT = {
        id: 'container-d57dd0ad6d3e272a52d7c9b734b4b618',
        src: 'https://pl29227913.profitablecpmratenetwork.com/d57dd0ad6d3e272a52d7c9b734b4b618/invoke.js'
    };

    function getBannerUnit() {
        return window.matchMedia && window.matchMedia('(min-width: 720px)').matches
            ? BANNER_UNITS.desktop
            : BANNER_UNITS.mobile;
    }

    function buildBannerSlot(id = '') {
        return `<div class="cm-ad-slot cm-ad-slot--banner" data-citymart-ad="banner"${id ? ` data-ad-id="${id}"` : ''}><div class="cm-ad-inner"></div></div>`;
    }

    function buildNativeSlot(id = '') {
        return `<div class="cm-ad-slot cm-ad-slot--native" data-citymart-ad="native"${id ? ` data-ad-id="${id}"` : ''}><div id="${NATIVE_UNIT.id}"></div></div>`;
    }

    function loadBanner(slot) {
        if (!slot || slot.dataset.adLoaded === 'true') return;
        slot.dataset.adLoaded = 'true';

        const inner = slot.querySelector('.cm-ad-inner') || slot;
        const unit = getBannerUnit();
        inner.style.width = `${unit.width}px`;
        inner.style.minHeight = `${unit.height}px`;
        inner.innerHTML = '';

        const frame = document.createElement('iframe');
        frame.title = 'Publicidad';
        frame.width = String(unit.width);
        frame.height = String(unit.height);
        frame.loading = 'lazy';
        frame.referrerPolicy = 'no-referrer-when-downgrade';
        frame.style.border = '0';
        frame.style.display = 'block';
        frame.style.overflow = 'hidden';
        frame.scrolling = 'no';
        frame.srcdoc = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;width:${unit.width}px;height:${unit.height}px;overflow:hidden;background:transparent;}</style></head><body><script>atOptions={'key':'${unit.key}','format':'iframe','height':${unit.height},'width':${unit.width},'params':{}};<\/script><script src="${unit.src}"><\/script></body></html>`;
        inner.appendChild(frame);
    }

    function loadNative(slot) {
        if (!slot || slot.dataset.adLoaded === 'true') return;
        const container = slot.querySelector(`#${NATIVE_UNIT.id}`);
        if (!container) return;

        slot.dataset.adLoaded = 'true';
        const frame = document.createElement('iframe');
        frame.title = 'Publicidad';
        frame.loading = 'lazy';
        frame.referrerPolicy = 'no-referrer-when-downgrade';
        frame.style.width = '100%';
        frame.style.maxWidth = '760px';
        frame.style.minHeight = '140px';
        frame.style.border = '0';
        frame.style.display = 'block';
        frame.scrolling = 'no';
        frame.srcdoc = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent;}</style></head><body><script async data-cfasync="false" src="${NATIVE_UNIT.src}"><\/script><div id="${NATIVE_UNIT.id}"></div></body></html>`;
        container.replaceWith(frame);
    }

    function refresh(root = document) {
        root.querySelectorAll('[data-citymart-ad="banner"]').forEach(loadBanner);
        const nativeSlots = Array.from(root.querySelectorAll('[data-citymart-ad="native"]'));
        nativeSlots.slice(0, 1).forEach(loadNative);
        nativeSlots.slice(1).forEach((slot) => slot.remove());
    }

    window.CityMartAds = {
        bannerHtml: buildBannerSlot,
        nativeHtml: buildNativeSlot,
        refresh
    };

    document.addEventListener('DOMContentLoaded', () => refresh());
})();
