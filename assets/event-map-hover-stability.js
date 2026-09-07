(() => {
    const page = document.querySelector('[data-event-map]');
    const svg = page?.querySelector('[data-map-svg]');
    const detail = page?.querySelector('[data-event-detail]');
    const detailCard = page?.querySelector('[data-event-detail-card]');
    const clusterCard = page?.querySelector('[data-cluster-card]');
    const eventList = page?.querySelector('[data-event-list]');
    if (!page || !svg || !detail || !detailCard || !clusterCard) return;

    const desktopHover = window.matchMedia('(min-width: 821px) and (hover: hover) and (pointer: fine)');
    let locked = new URLSearchParams(window.location.search).has('event');

    const markerFrom = target => target instanceof Element
        ? target.closest('.event-map-pin-group')
        : null;

    const setPreview = active => {
        if (!desktopHover.matches) active = false;
        detail.dataset.hoverPreview = active ? 'true' : 'false';
    };

    const cardsAreHidden = () => detailCard.hidden && clusterCard.hidden;

    const markLocked = () => {
        locked = true;
        setPreview(false);
    };

    svg.addEventListener('pointerover', event => {
        const marker = markerFrom(event.target);
        if (!marker) return;
        if (event.relatedTarget instanceof Node && marker.contains(event.relatedTarget)) return;
        // With no locked selection, preview as a floating rail so opening it cannot
        // resize the map and move the hovered marker out from under the pointer.
        if (!locked) setPreview(true);
    }, true);

    svg.addEventListener('pointerout', event => {
        const marker = markerFrom(event.target);
        if (!marker) return;
        if (event.relatedTarget instanceof Node && marker.contains(event.relatedTarget)) return;
        if (!locked) setPreview(false);
    }, true);

    svg.addEventListener('focusin', event => {
        if (!markerFrom(event.target) || locked) return;
        setPreview(true);
    }, true);

    svg.addEventListener('focusout', event => {
        if (!markerFrom(event.target) || locked) return;
        setPreview(false);
    }, true);

    // The pointer shim activates a marker on pointerup. Defer the layout switch
    // until that activation has completed, then the normal locked sidebar may
    // take its place without creating a hover feedback loop.
    svg.addEventListener('pointerup', event => {
        if (!markerFrom(event.target)) return;
        queueMicrotask(markLocked);
    }, true);

    svg.addEventListener('keydown', event => {
        if (!markerFrom(event.target)) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        queueMicrotask(markLocked);
    }, true);

    eventList?.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        if (!event.target.closest('.event-map-result')) return;
        queueMicrotask(markLocked);
    }, true);

    detail.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        if (!event.target.closest('.event-map-cluster-event')) return;
        queueMicrotask(markLocked);
    }, true);

    // Filters can clear a selected event. When both detail cards disappear, the
    // next desktop hover should go back to non-reflowing preview mode.
    const observer = new MutationObserver(() => {
        if (cardsAreHidden()) {
            locked = false;
            setPreview(false);
            return;
        }
        if (new URLSearchParams(window.location.search).has('event')) locked = true;
    });
    observer.observe(detailCard, { attributes: true, attributeFilter: ['hidden'] });
    observer.observe(clusterCard, { attributes: true, attributeFilter: ['hidden'] });

    desktopHover.addEventListener?.('change', () => setPreview(false));
    setPreview(false);
})();
