(() => {
    const widget = document.querySelector('[data-on-this-day][data-mode="full"]');
    if (!widget || widget.dataset.otdShareBootstrapBooted === '1') return;
    widget.dataset.otdShareBootstrapBooted = '1';

    const ownUrl = new URL(document.currentScript?.src || '/assets/otd-share-bootstrap.js', location.href);
    let loadPromise = null;
    let failed = false;
    let replaying = false;

    const shareTarget = target => target?.closest?.('[data-otd-share-entry], .otd-entry-media');
    const isReady = () => widget.dataset.otdShareV3Booted === '1';

    function loadShareRuntime() {
        if (isReady()) return Promise.resolve();
        if (loadPromise) return loadPromise;
        loadPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `/assets/otd-share-v3.js${ownUrl.search}`;
            script.async = true;
            script.addEventListener('load', resolve, { once: true });
            script.addEventListener('error', () => reject(new Error('Share runtime failed to load.')), { once: true });
            document.head.append(script);
        }).catch(error => {
            failed = true;
            console.error(error);
        });
        return loadPromise;
    }

    async function intercept(event) {
        const target = shareTarget(event.target);
        if (!target || isReady() || failed || replaying) return;
        if (event.type === 'keydown' && (!target.matches('.otd-entry-media') || !['Enter', ' '].includes(event.key))) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        await loadShareRuntime();
        replaying = true;
        if (event.type === 'keydown') {
            target.dispatchEvent(new KeyboardEvent('keydown', { key: event.key, bubbles: true, cancelable: true }));
        } else {
            target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: window }));
        }
        replaying = false;
    }

    document.addEventListener('click', intercept, true);
    document.addEventListener('keydown', intercept, true);
    document.addEventListener('pointerover', event => {
        if (shareTarget(event.target)) loadShareRuntime();
    }, { capture: true, passive: true });
    document.addEventListener('focusin', event => {
        if (shareTarget(event.target)) loadShareRuntime();
    }, true);
    document.addEventListener('touchstart', event => {
        if (shareTarget(event.target)) loadShareRuntime();
    }, { capture: true, passive: true });
})();
