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
        '/assets/event-map-enhancements.js'
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
        removeWakeListeners();
        loadNext();
    }

    function relevantTarget(target) {
        if (!(target instanceof Element)) return false;
        return Boolean(target.closest(
            '.event-map-stage, [data-near-me], [data-event-list], [data-event-detail]'
        ));
    }

    function wake(event) {
        if (!relevantTarget(event.target)) return;
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        start();
    }

    const wakeEvents = ['pointerdown', 'pointerover', 'focusin', 'keydown'];

    function removeWakeListeners() {
        wakeEvents.forEach(type => page.removeEventListener(type, wake, true));
    }

    wakeEvents.forEach(type => page.addEventListener(type, wake, true));

    // Deep-linked events need poster / matchup enrichment without waiting for input.
    if (new URLSearchParams(window.location.search).has('event')) {
        window.requestAnimationFrame(start);
    }
})();
