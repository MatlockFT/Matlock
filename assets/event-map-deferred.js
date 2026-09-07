(() => {
    const page = document.querySelector('[data-event-map]');
    if (!page) return;

    const currentScript = document.currentScript;
    let version = '';
    try {
        version = currentScript ? new URL(currentScript.src, window.location.href).search : '';
    } catch {
        version = '';
    }

    const scripts = [
        '/assets/event-map-enhancements.js',
        '/assets/event-map-detail.js'
    ];
    let started = false;

    function loadNext(index = 0) {
        if (index >= scripts.length) return;
        const script = document.createElement('script');
        script.src = `${scripts[index]}${version}`;
        script.async = false;
        script.onload = () => loadNext(index + 1);
        script.onerror = () => loadNext(index + 1);
        document.body.append(script);
    }

    function start() {
        if (started) return;
        started = true;
        loadNext();
    }

    const wakeEvents = ['pointerdown', 'focusin', 'keydown'];
    const wake = () => {
        wakeEvents.forEach(type => page.removeEventListener(type, wake, true));
        start();
    };
    wakeEvents.forEach(type => page.addEventListener(type, wake, true));

    if ('requestIdleCallback' in window) {
        window.requestIdleCallback(start, { timeout: 500 });
    } else {
        window.setTimeout(start, 220);
    }
})();