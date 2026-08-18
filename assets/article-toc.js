/opt/homebrew/Library/Homebrew/cmd/shellenv.sh: line 18: /bin/ps: Operation not permitted
(function () {
    const navigation = document.querySelector('[data-article-toc]');
    const list = navigation?.querySelector('[data-article-toc-list]');
    const article = document.getElementById('article-content');

    if (!navigation || !list || !article) {
        return;
    }

    const headings = Array.from(article.querySelectorAll('h2, h3'));

    if (headings.length < 2) {
        return;
    }

    const usedIds = new Set();

    headings.forEach((heading, index) => {
        let id = heading.id || heading.textContent
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || `section-${index + 1}`;
        const baseId = id;
        let suffix = 2;

        while (usedIds.has(id) || document.getElementById(id)) {
            if (document.getElementById(id) === heading && !usedIds.has(id)) {
                break;
            }

            id = `${baseId}-${suffix}`;
            suffix += 1;
        }

        heading.id = id;
        usedIds.add(id);

        const item = document.createElement('li');
        const link = document.createElement('a');

        item.dataset.level = heading.tagName.slice(1);
        link.href = `#${id}`;
        link.textContent = heading.textContent.trim();
        item.append(link);
        list.append(item);
    });

    navigation.hidden = false;
}());
