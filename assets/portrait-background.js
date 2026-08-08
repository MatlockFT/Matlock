(() => {
    const style = document.createElement('style');
    style.dataset.portraitBackground = 'gripboard-v1';
    style.textContent = `
        /* Loaded after upcoming-events.js so this intentionally replaces its legacy zine/pegboard treatment. */
        .upcoming-event-card .fighter-photo {
            background:
                linear-gradient(rgba(5,5,5,.10), rgba(0,0,0,.22)),
                url('/assets/fighter-gripboard.svg') center / cover no-repeat,
                #0a0a0a !important;
        }

        .upcoming-event-card .fighter-photo::before {
            z-index: 0 !important;
            background:
                radial-gradient(ellipse at 23% 30%, rgba(225,225,225,.055), transparent 30%),
                radial-gradient(ellipse at 78% 69%, rgba(205,205,205,.035), transparent 33%),
                linear-gradient(167deg, transparent 0 28%, rgba(235,235,235,.022) 28.4% 28.8%, transparent 29.2% 71%, rgba(220,220,220,.018) 71.4% 71.8%, transparent 72.2%) !important;
            opacity: .72 !important;
            pointer-events: none;
        }

        .upcoming-event-card .fighter-photo::after {
            position: absolute !important;
            inset: auto 0 0 !important;
            z-index: 2 !important;
            height: 22% !important;
            background: linear-gradient(to top, rgba(0,0,0,.44), transparent) !important;
            opacity: 1 !important;
            content: '';
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
})();
