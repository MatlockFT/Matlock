(function () {
    const navigation = document.querySelector('[data-article-toc]');
    const toggle = navigation?.querySelector('[data-article-toc-toggle]');
    const panel = navigation?.querySelector('[data-article-toc-panel]');
    const list = navigation?.querySelector('[data-article-toc-list]');
    const article = document.getElementById('article-content');

    if (!navigation || !toggle || !panel || !list || !article) {
        return;
    }

    const mode = navigation.dataset.tocMode || 'sections';
    const allHeadings = Array.from(article.querySelectorAll('h2, h3'));
    const explicitFightHeadings = Array.from(
        article.querySelectorAll('h2.article-fight-heading')
    );
    const matchupPattern = /\b(?:vs\.?|versus)\b/i;

    const fightHeadings = explicitFightHeadings.length
        ? explicitFightHeadings
        : allHeadings.filter((heading) => (
            heading.tagName === 'H2' &&
            matchupPattern.test(heading.textContent || '')
        ));

    const useFightIndex =
        explicitFightHeadings.length > 0 ||
        mode === 'fights' ||
        fightHeadings.length >= 3;

    const headings = useFightIndex
        ? fightHeadings
        : allHeadings;

    if (!headings.length) {
        return;
    }

    const usedIds = new Set();

    const slugify = (value, fallback) => (
        value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || fallback
    );

    headings.forEach((heading, index) => {
        const label = (heading.textContent || '')
            .trim()
            .replace(/\s+/g, ' ');

        let id = heading.id || slugify(label, 'section-' + (index + 1));
        const baseId = id;
        let suffix = 2;

        while (usedIds.has(id) || document.getElementById(id)) {
            if (document.getElementById(id) === heading && !usedIds.has(id)) {
                break;
            }

            id = baseId + '-' + suffix;
            suffix += 1;
        }

        heading.id = id;
        heading.classList.add('article-toc-target');
        usedIds.add(id);

        const item = document.createElement('li');
        const link = document.createElement('a');

        item.dataset.level = heading.tagName.slice(1);
        link.href = '#' + id;
        link.textContent = label;

        link.addEventListener('click', (event) => {
            event.preventDefault();

            const reduceMotion = window.matchMedia(
                '(prefers-reduced-motion: reduce)'
            ).matches;

            setOpen(false);

            window.requestAnimationFrame(() => {
                heading.scrollIntoView({
                    behavior: reduceMotion ? 'auto' : 'smooth',
                    block: 'start'
                });

                if (window.history && window.history.pushState) {
                    window.history.pushState(null, '', '#' + id);
                } else {
                    window.location.hash = id;
                }
            });
        });

        item.append(link);
        list.append(item);
    });

    const setOpen = (open) => {
        toggle.setAttribute('aria-expanded', String(open));
        panel.hidden = !open;
        navigation.classList.toggle('is-open', open);
    };

    toggle.addEventListener('click', () => {
        setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    setOpen(false);
    navigation.hidden = false;
}());
