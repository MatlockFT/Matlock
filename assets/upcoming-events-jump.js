(() => {
    const params = new URLSearchParams(window.location.search);
    let eventId = params.get('event') || '';

    if (!eventId && window.location.hash.length > 1) {
        try {
            eventId = decodeURIComponent(window.location.hash.slice(1));
        } catch {
            eventId = window.location.hash.slice(1);
        }
    }

    if (!eventId) return;
    const card = document.getElementById(eventId);
    if (!card) return;

    card.style.scrollMarginTop = '118px';

    const jump = () => {
        card.scrollIntoView({ block: 'start', behavior: 'auto' });
    };

    requestAnimationFrame(() => requestAnimationFrame(jump));
    window.addEventListener('load', jump, { once: true });
    window.setTimeout(jump, 280);
})();
