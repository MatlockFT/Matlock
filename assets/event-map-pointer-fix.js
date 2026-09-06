(() => {
    const page = document.querySelector('[data-event-map]');
    const svg = page?.querySelector('[data-map-svg]');
    if (!svg) return;

    let pressedMarker = null;
    let startX = 0;
    let startY = 0;
    let moved = false;
    let suppressClickUntil = 0;

    const markerFrom = target => target instanceof Element
        ? target.closest('.event-map-pin-group')
        : null;

    const activateMarker = marker => {
        if (!marker?.isConnected) return;
        try { marker.focus({ preventScroll: true }); } catch (_) { marker.focus(); }
        marker.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            bubbles: false,
            cancelable: true
        }));
    };

    svg.addEventListener('pointerdown', event => {
        const marker = markerFrom(event.target);
        if (!marker) return;

        pressedMarker = marker;
        startX = event.clientX;
        startY = event.clientY;
        moved = false;

        // Do not let D3 begin a map-pan gesture when the user is pressing a pin.
        event.stopPropagation();
    }, true);

    svg.addEventListener('pointermove', event => {
        if (!pressedMarker) return;
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > 8) moved = true;
    }, true);

    svg.addEventListener('pointerup', event => {
        if (!pressedMarker) return;

        const marker = markerFrom(event.target);
        const shouldActivate = !moved && marker === pressedMarker;
        const selectedMarker = pressedMarker;
        pressedMarker = null;
        moved = false;

        event.preventDefault();
        event.stopPropagation();
        suppressClickUntil = performance.now() + 700;

        if (shouldActivate) activateMarker(selectedMarker);
    }, true);

    svg.addEventListener('pointercancel', () => {
        pressedMarker = null;
        moved = false;
    }, true);

    // Browsers still synthesize a click after pointerup. Keep that click from
    // reaching the SVG background handler, which clears the selected event.
    svg.addEventListener('click', event => {
        const marker = markerFrom(event.target);
        if (!marker) return;

        event.preventDefault();
        event.stopPropagation();

        // Keyboard/mouse environments that did not emit Pointer Events still
        // get a direct activation fallback here.
        if (performance.now() > suppressClickUntil) activateMarker(marker);
    }, true);
})();
