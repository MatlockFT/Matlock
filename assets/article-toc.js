(function () {
    const navigations = Array.from(document.querySelectorAll('[data-article-toc]'));
    const article = document.getElementById('article-content');

    if (!navigations.length || !article) return;

    const mode = navigations[0].dataset.tocMode || 'sections';
    const directHeadings = Array.from(article.children).filter((node) => (
        node.tagName === 'H2' || node.tagName === 'H3'
    ));
    const explicitFightHeadings = directHeadings.filter((heading) => (
        heading.tagName === 'H2' && heading.classList.contains('article-fight-heading')
    ));
    const matchupPattern = /\b(?:vs\.?|versus)\b/i;
    const fightHeadings = explicitFightHeadings.length
        ? explicitFightHeadings
        : directHeadings.filter((heading) => (
            heading.tagName === 'H2' && matchupPattern.test(heading.textContent || '')
        ));
    const useFightIndex = explicitFightHeadings.length > 0 || mode === 'fights' || fightHeadings.length >= 3;
    const headings = useFightIndex ? fightHeadings : directHeadings;

    if (!headings.length) return;

    const usedIds = new Set();
    const slugify = (value, fallback) => (
        value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback
    );

    headings.forEach((heading, index) => {
        const label = (heading.textContent || '').trim().replace(/\s+/g, ' ');
        let id = heading.id || slugify(label, 'section-' + (index + 1));
        const baseId = id;
        let suffix = 2;

        while (usedIds.has(id) || document.getElementById(id)) {
            if (document.getElementById(id) === heading && !usedIds.has(id)) break;
            id = baseId + '-' + suffix;
            suffix += 1;
        }

        heading.id = id;
        heading.classList.add('article-toc-target');
        usedIds.add(id);
    });

    const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const goToHeading = (heading) => {
        if (!heading) return;
        heading.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });

        if (window.history && window.history.pushState) {
            window.history.pushState(null, '', '#' + heading.id);
        } else {
            window.location.hash = heading.id;
        }
    };

    const tocLinks = [];

    navigations.forEach((navigation) => {
        const toggle = navigation.querySelector('[data-article-toc-toggle]');
        const panel = navigation.querySelector('[data-article-toc-panel]');
        const list = navigation.querySelector('[data-article-toc-list]');
        if (!toggle || !panel || !list) return;

        list.replaceChildren();

        const setOpen = (open) => {
            toggle.setAttribute('aria-expanded', String(open));
            panel.hidden = !open;
            navigation.classList.toggle('is-open', open);
        };

        headings.forEach((heading) => {
            const item = document.createElement('li');
            const link = document.createElement('a');
            item.dataset.level = heading.tagName.slice(1);
            link.href = '#' + heading.id;
            link.textContent = (heading.textContent || '').trim().replace(/\s+/g, ' ');
            link.dataset.tocTarget = heading.id;

            link.addEventListener('click', (event) => {
                event.preventDefault();
                if (navigation.dataset.tocSurface !== 'floating') setOpen(false);
                window.requestAnimationFrame(() => goToHeading(heading));
            });

            item.append(link);
            list.append(item);
            tocLinks.push(link);
        });

        toggle.addEventListener('click', () => {
            setOpen(toggle.getAttribute('aria-expanded') !== 'true');
        });

        setOpen(navigation.dataset.tocSurface === 'floating');
        navigation.hidden = false;
    });

    const picksRoot = document.querySelector('[data-article-picks]');

    if (picksRoot) {
        const picksToggle = picksRoot.querySelector('[data-article-picks-toggle]');
        const picksPanel = picksRoot.querySelector('[data-article-picks-panel]');
        const picksList = picksRoot.querySelector('[data-article-picks-list]');
        const pickCards = Array.from(article.querySelectorAll('.article-pick-card'));

        const findFightHeading = (card) => {
            const block = card.closest('[data-writer-block="pick"]') || card;
            if (block.parentElement !== article) return null;

            let previous = block.previousElementSibling;
            while (previous) {
                if (fightHeadings.includes(previous)) return previous;
                previous = previous.previousElementSibling;
            }
            return null;
        };

        if (picksToggle && picksPanel && picksList && pickCards.length) {
            picksList.replaceChildren();

            pickCards.forEach((card, index) => {
                const fighter = card.querySelector('.article-pick-card__main strong')?.textContent?.trim() || 'Pick ' + (index + 1);
                const detail = card.querySelector('.article-pick-card__main span')?.textContent?.trim() || '';
                const heading = findFightHeading(card);
                const matchup = heading?.textContent?.trim() || 'Fight ' + (index + 1);

                const item = document.createElement('li');
                const link = document.createElement('a');
                const matchupLabel = document.createElement('span');
                const pickLine = document.createElement('span');
                const fighterName = document.createElement('strong');

                link.href = heading ? '#' + heading.id : '#';
                matchupLabel.className = 'article-picks-matchup';
                matchupLabel.textContent = matchup;
                pickLine.className = 'article-picks-selection';
                fighterName.textContent = fighter;
                pickLine.append(fighterName);

                if (detail) {
                    const method = document.createElement('span');
                    method.textContent = detail;
                    pickLine.append(method);
                }

                link.append(matchupLabel, pickLine);

                if (heading) {
                    link.addEventListener('click', (event) => {
                        event.preventDefault();
                        window.requestAnimationFrame(() => goToHeading(heading));
                    });
                }

                item.append(link);
                picksList.append(item);
            });

            const setPicksOpen = (open) => {
                picksToggle.setAttribute('aria-expanded', String(open));
                picksPanel.hidden = !open;
                picksRoot.classList.toggle('is-open', open);
            };

            picksToggle.addEventListener('click', () => {
                setPicksOpen(picksToggle.getAttribute('aria-expanded') !== 'true');
            });

            setPicksOpen(false);
            picksRoot.hidden = false;
        }
    }

    if (article.dataset.fightGlow === 'true' && fightHeadings.length) {
        const palette = [
            '224,88,104','82,132,224','150,92,210','62,170,128',
            '221,142,62','62,162,184','204,92,150','142,165,70',
            '210,104,66','92,132,184','174,104,194','76,164,138'
        ];

        fightHeadings.forEach((heading, index) => {
            const nextHeading = fightHeadings[index + 1] || null;
            const nodes = [];
            let node = heading;

            while (node && node !== nextHeading) {
                const next = node.nextSibling;
                nodes.push(node);
                node = next;
            }

            let pickIndex = -1;
            nodes.forEach((candidate, candidateIndex) => {
                if (
                    candidate.nodeType === 1 &&
                    (candidate.matches?.('[data-writer-block="pick"]') || candidate.querySelector?.('[data-writer-block="pick"]'))
                ) {
                    pickIndex = candidateIndex;
                }
            });

            const wrapper = document.createElement('section');
            wrapper.className = 'fight-section-ambient';
            wrapper.dataset.fightSection = heading.id;
            wrapper.style.setProperty('--fight-glow-rgb', palette[index % palette.length]);

            heading.before(wrapper);
            nodes.slice(0, pickIndex >= 0 ? pickIndex + 1 : nodes.length).forEach((candidate) => wrapper.append(candidate));
        });
    }


    const floatingNavigation = navigations.find((navigation) => (
        navigation.dataset.tocSurface === 'floating'
    ));
    const floatingRail = floatingNavigation?.closest('.post-rail');
    const readingLayout = floatingNavigation?.closest('.post-reading-layout');

    const syncFloatingNavigation = () => {
        if (!floatingNavigation || !floatingRail || !readingLayout) return;

        const desktop = window.matchMedia('(min-width: 1041px)').matches;

        if (!desktop) {
            floatingNavigation.classList.remove('is-fixed', 'is-bottomed');
            floatingNavigation.style.removeProperty('--toc-fixed-left');
            floatingNavigation.style.removeProperty('--toc-fixed-width');
            floatingNavigation.style.removeProperty('--toc-fixed-top');
            floatingNavigation.style.removeProperty('--toc-bottom-top');
            return;
        }

        const railRect = floatingRail.getBoundingClientRect();
        const layoutRect = readingLayout.getBoundingClientRect();
        const navHeight = floatingNavigation.offsetHeight;
        const rootStyles = getComputedStyle(document.documentElement);
        const fixedRailHeight = parseFloat(
            rootStyles.getPropertyValue('--v3-fixed-rail-height')
        ) || 80;
        const top = fixedRailHeight + 16;
        const bottomLimit = layoutRect.bottom - 16;

        floatingNavigation.style.setProperty('--toc-fixed-left', railRect.left + 'px');
        floatingNavigation.style.setProperty('--toc-fixed-width', railRect.width + 'px');
        floatingNavigation.style.setProperty('--toc-fixed-top', top + 'px');

        if (layoutRect.top >= top) {
            floatingNavigation.classList.remove('is-fixed', 'is-bottomed');
            return;
        }

        if (bottomLimit <= top + navHeight) {
            floatingNavigation.classList.remove('is-fixed');
            floatingNavigation.classList.add('is-bottomed');

            const railTopInLayout = Math.max(
                0,
                readingLayout.scrollHeight - navHeight - 16
            );

            floatingNavigation.style.setProperty(
                '--toc-bottom-top',
                railTopInLayout + 'px'
            );
            return;
        }

        floatingNavigation.classList.remove('is-bottomed');
        floatingNavigation.classList.add('is-fixed');
    };

    const setActiveHeading = () => {
        let current = headings[0];
        headings.forEach((heading) => {
            if (heading.getBoundingClientRect().top <= 150) current = heading;
        });

        tocLinks.forEach((link) => {
            link.classList.toggle('is-active', link.dataset.tocTarget === current.id);
        });
    };

    let scrollFrame = 0;
    const scheduleActiveHeading = () => {
        window.cancelAnimationFrame(scrollFrame);
        scrollFrame = window.requestAnimationFrame(() => {
            setActiveHeading();
            syncFloatingNavigation();
        });
    };

    window.addEventListener('scroll', scheduleActiveHeading, { passive: true });
    window.addEventListener('resize', scheduleActiveHeading, { passive: true });
    window.addEventListener('load', scheduleActiveHeading, { once: true });
    setActiveHeading();
    syncFloatingNavigation();
}());
