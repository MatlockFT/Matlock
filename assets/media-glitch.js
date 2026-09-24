(() => {
    const hoverCapable = window.matchMedia?.('(hover: hover) and (pointer: fine)');
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!hoverCapable?.matches || reduceMotion?.matches) return;

    const syncCloneGeometry = (source, clone) => {
        const styles = getComputedStyle(source);
        clone.style.objectFit = styles.objectFit;
        clone.style.objectPosition = styles.objectPosition;
        clone.style.borderRadius = styles.borderRadius;
    };

    const decorate = container => {
        if (!container || container.dataset.mmaGlitchReady === 'true') return;

        const source = container.querySelector(':scope > img:not(.mma-glitch-copy)');
        if (!source) return;

        container.dataset.mmaGlitchReady = 'true';
        container.classList.add('mma-glitch-media');

        const red = source.cloneNode(true);
        const cyan = source.cloneNode(true);

        for (const clone of [red, cyan]) {
            clone.removeAttribute('id');
            clone.removeAttribute('alt');
            clone.removeAttribute('srcset');
            clone.src = source.currentSrc || source.src;
            clone.loading = 'lazy';
            clone.fetchPriority = 'low';
            clone.setAttribute('aria-hidden', 'true');
            clone.classList.add('mma-glitch-copy');
            syncCloneGeometry(source, clone);
        }

        red.classList.add('mma-glitch-copy--red');
        cyan.classList.add('mma-glitch-copy--cyan');
        container.append(red, cyan);

        if (source.complete) {
            syncCloneGeometry(source, red);
            syncCloneGeometry(source, cyan);
        } else {
            source.addEventListener('load', () => {
                syncCloneGeometry(source, red);
                syncCloneGeometry(source, cyan);
            }, { once: true });
        }
    };

    const decorateFeaturedFigure = figure => {
        if (!figure || figure.dataset.mmaGlitchReady === 'true') return;
        const image = figure.querySelector(':scope > img');
        if (!image) return;

        const wrapper = document.createElement('span');
        wrapper.className = 'mma-glitch-media post-featured-glitch';
        image.before(wrapper);
        wrapper.append(image);

        figure.dataset.mmaGlitchReady = 'true';
        decorate(wrapper);
    };

    document.querySelectorAll('.post-featured-image').forEach(decorateFeaturedFigure);
})();
