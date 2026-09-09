(() => {
    const widget = document.querySelector('[data-on-this-day][data-mode="full"]');
    const list = widget?.querySelector('[data-otd-list]');
    if (!widget || !list || widget.dataset.otdShareV3Booted === '1') return;
    widget.dataset.otdShareV3Booted = '1';

    const FORMAT_KEY = 'mma-matlock:otd:share-format';
    const MANIFEST_URL = '/assets/data/on-this-day-share-manifest.json';
    const ASSET_VERSION = new URL(document.currentScript?.src || location.href).searchParams.get('v') || '153';
    const FORMATS = {
        post: { label: 'Instagram Post', width: 1080, height: 1350, ratio: '4:5' },
        story: { label: 'Instagram Story', width: 1080, height: 1920, ratio: '9:16' },
        social: { label: 'Square Social', width: 1200, height: 1200, ratio: '1:1' }
    };

    const isTouchLike = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    const canCopyImage = Boolean(navigator.clipboard?.write && window.ClipboardItem);
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

    let activeFormat = readSavedFormat();
    let activeEntry = null;
    let modal = null;
    let preview = null;
    let status = null;
    let formatButtons = [];
    let cardActionButtons = [];
    let returnFocus = null;
    let renderToken = 0;
    let previewObjectUrl = '';
    let renderedUrl = '';
    let renderedBlob = null;
    let renderedFile = null;
    let manifestPromise = null;
    let displayFontPromise = null;
    let displayFont = null;
    let tapeSourcePromise = null;

    function readSavedFormat() {
        try {
            const value = localStorage.getItem(FORMAT_KEY);
            if (FORMATS[value]) return value;
        } catch {}
        return 'post';
    }

    function saveFormat(value) {
        try { localStorage.setItem(FORMAT_KEY, value); } catch {}
    }

    function dateFromRow(row) {
        const match = /^otd-(\d{4})(\d{2})(\d{2})-/.exec(row?.id || '');
        if (!match) return null;
        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function imagePositionFromMedia(media) {
        const image = media?.querySelector('img');
        if (!image) return { x: 0.5, y: 0.5 };
        const value = image.style.objectPosition || getComputedStyle(image).objectPosition || '50% 50%';
        const values = String(value).match(/(-?\d+(?:\.\d+)?)%/g) || [];
        return {
            x: values[0] ? Math.max(0, Math.min(1, Number.parseFloat(values[0]) / 100)) : 0.5,
            y: values[1] ? Math.max(0, Math.min(1, Number.parseFloat(values[1]) / 100)) : 0.5
        };
    }

    function entryFromMedia(media) {
        const row = media.closest('.otd-entry');
        if (!row) return null;
        const date = dateFromRow(row);
        const yearText = clean(row.querySelector('.otd-entry-year')?.textContent);
        const year = Number(yearText) || date?.getFullYear() || 0;
        const currentYear = new Date().getFullYear();
        const yearsAgo = year ? Math.max(0, currentYear - year) : 0;
        const title = clean(row.querySelector('.otd-entry-title')?.textContent) || 'MMA history';
        const promotion = clean(row.querySelector('.otd-promotion')?.textContent);
        const image = media.querySelector('img');
        const imageUrl = media.dataset.lightboxSrc || image?.currentSrc || image?.src || '';
        const imageCredit = media.dataset.lightboxCredit || clean(media.querySelector('.otd-media-credit')?.textContent);
        const dateLabel = date
            ? new Intl.DateTimeFormat([], { month: 'long', day: 'numeric', year: 'numeric' }).format(date)
            : yearText;
        const headline = yearsAgo > 0
            ? `${yearsAgo} ${yearsAgo === 1 ? 'Year' : 'Years'} Ago Today`
            : 'On This Day';
        const url = new URL(location.href);
        if (date) url.searchParams.set('date', `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
        url.hash = row.id;
        const link = url.href;
        const entry = {
            id: row.id,
            row,
            media,
            title,
            promotion,
            imageUrl,
            imageCredit,
            imagePosition: imagePositionFromMedia(media),
            year,
            yearsAgo,
            dateLabel,
            headline,
            link
        };
        entry.caption = captionForEntry(entry);
        return entry;
    }

    function captionForEntry(entry) {
        const creditLine = entry.imageCredit ? `\nImages: ${entry.imageCredit}` : '';
        return `${entry.headline}\n${entry.title}\n${entry.dateLabel}${creditLine}\n\n${entry.link}\n\n#MMA #OnThisDay`;
    }

    function copyText(value) {
        if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
        const area = document.createElement('textarea');
        area.value = value;
        area.readOnly = true;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        return Promise.resolve();
    }

    function loadManifest() {
        if (!manifestPromise) {
            manifestPromise = fetch(MANIFEST_URL, { cache: 'no-cache' })
                .then(response => response.ok ? response.json() : null)
                .catch(() => null);
        }
        return manifestPromise;
    }

    function revokePreviewObjectUrl() {
        if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = '';
    }

    function setCardActionsEnabled(enabled) {
        for (const button of cardActionButtons) button.disabled = !enabled;
    }

    function ensureModal() {
        if (modal) return;
        modal = document.createElement('div');
        modal.className = 'otd-share-modal';
        modal.hidden = true;
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'otd-share-title');
        modal.innerHTML = `
            <div class="otd-share-panel">
                <header class="otd-share-header">
                    <div><p class="otd-share-kicker">Fight Archive</p><h2 id="otd-share-title">Share This Moment</h2></div>
                    <button type="button" class="otd-share-close" data-otd-share-close aria-label="Close share builder">×</button>
                </header>
                <div class="otd-share-workspace">
                    <section class="otd-share-preview-column" aria-label="Share image preview">
                        <div class="otd-share-preview-meta"><strong data-otd-share-format-label></strong><span data-otd-share-output-size></span></div>
                        <div class="otd-share-preview-wrap"><img class="otd-share-preview" data-otd-share-preview alt="Generated social share card preview"></div>
                        <p class="otd-share-status" data-otd-share-status aria-live="polite"></p>
                    </section>
                    <section class="otd-share-controls" aria-label="Share controls">
                        <div class="otd-share-formats" role="group" aria-label="Share image format">
                            <button type="button" data-otd-share-format="post"><strong>Instagram Post</strong><span>4:5 · 1080×1350</span></button>
                            <button type="button" data-otd-share-format="story"><strong>Instagram Story</strong><span>9:16 · 1080×1920</span></button>
                            <button type="button" data-otd-share-format="social"><strong>Square Social</strong><span>1:1 · 1200×1200</span></button>
                        </div>
                        <div class="otd-share-primary-actions">
                            <button type="button" class="otd-share-action is-primary" data-otd-share-instagram data-otd-requires-card>Instagram</button>
                            <button type="button" class="otd-share-action" data-otd-share-native data-otd-requires-card>Share image</button>
                        </div>
                        <div class="otd-share-actions">
                            <button type="button" class="otd-share-action" data-otd-share-download data-otd-requires-card>Download JPG</button>
                            <button type="button" class="otd-share-action" data-otd-share-caption>Copy caption</button>
                            <button type="button" class="otd-share-action" data-otd-share-image data-otd-requires-card>Copy image</button>
                            <button type="button" class="otd-share-action" data-otd-share-link>Copy link</button>
                        </div>
                        <div class="otd-share-link-block">
                            <span>Share the page link</span>
                            <div class="otd-share-platforms">
                                <button type="button" data-otd-share-platform="x">X</button>
                                <button type="button" data-otd-share-platform="facebook">Facebook</button>
                                <button type="button" data-otd-share-platform="threads">Threads</button>
                                <button type="button" data-otd-share-platform="reddit">Reddit</button>
                            </div>
                        </div>
                        <p class="otd-share-note" data-otd-share-note></p>
                    </section>
                </div>
            </div>`;
        document.body.append(modal);
        preview = modal.querySelector('[data-otd-share-preview]');
        status = modal.querySelector('[data-otd-share-status]');
        formatButtons = [...modal.querySelectorAll('[data-otd-share-format]')];
        cardActionButtons = [...modal.querySelectorAll('[data-otd-requires-card]')];
        if (!canCopyImage) modal.querySelector('[data-otd-share-image]')?.remove();
        modal.querySelector('[data-otd-share-close]').addEventListener('click', closeModal);
        modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
        modal.addEventListener('keydown', trapFocus);
        formatButtons.forEach(button => button.addEventListener('click', () => {
            const next = button.dataset.otdShareFormat;
            if (!FORMATS[next] || next === activeFormat) return;
            activeFormat = next;
            saveFormat(next);
            syncModalState();
            renderPreview();
        }));
        modal.querySelector('[data-otd-share-download]').addEventListener('click', downloadCard);
        modal.querySelector('[data-otd-share-native]').addEventListener('click', shareCard);
        modal.querySelector('[data-otd-share-instagram]').addEventListener('click', shareToInstagram);
        modal.querySelector('[data-otd-share-caption]').addEventListener('click', async event => {
            if (!activeEntry) return;
            try { await copyText(activeEntry.caption); flash(event.currentTarget, 'Copied'); status.textContent = 'Caption copied.'; }
            catch { flash(event.currentTarget, 'Failed'); }
        });
        modal.querySelector('[data-otd-share-link]').addEventListener('click', async event => {
            if (!activeEntry) return;
            try { await copyText(activeEntry.link); flash(event.currentTarget, 'Copied'); status.textContent = 'Link copied.'; }
            catch { flash(event.currentTarget, 'Failed'); }
        });
        modal.querySelector('[data-otd-share-image]')?.addEventListener('click', copyImage);
        modal.querySelectorAll('[data-otd-share-platform]').forEach(button => button.addEventListener('click', () => openPlatform(button.dataset.otdSharePlatform)));
    }

    function syncModalState() {
        if (!modal) return;
        const config = FORMATS[activeFormat];
        formatButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.otdShareFormat === activeFormat)));
        modal.querySelector('[data-otd-share-format-label]').textContent = config.label;
        modal.querySelector('[data-otd-share-output-size]').textContent = `${config.width} × ${config.height} JPG`;
        modal.querySelector('[data-otd-share-instagram]').textContent = isTouchLike ? 'Instagram / Stories' : 'Prepare for Instagram';
        modal.querySelector('[data-otd-share-native]').textContent = navigator.share ? 'Share to apps' : 'Save + copy caption';
        const credit = activeEntry?.imageCredit ? ` Image credit: ${activeEntry.imageCredit}.` : '';
        const note = modal.querySelector('[data-otd-share-note]');
        note.textContent = (isTouchLike
            ? 'The finished JPG goes to your phone’s share sheet. The caption is copied first.'
            : 'Download or copy the finished image. Prepare for Instagram also copies the caption and opens Instagram web.') + credit;
        const sources = Array.isArray(activeEntry?.imageSources) ? activeEntry.imageSources : [];
        const linked = sources.filter(source => source?.credit && /^https:\/\//i.test(source?.sourceUrl || ''));
        if (linked.length) {
            note.append(document.createTextNode(' Sources: '));
            linked.forEach((source, index) => {
                if (index) note.append(document.createTextNode(', '));
                const anchor = document.createElement('a');
                anchor.href = source.sourceUrl;
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
                anchor.textContent = source.credit;
                anchor.style.color = '#e8e8e8';
                note.append(anchor);
            });
            note.append(document.createTextNode('.'));
        }
    }

    function flash(button, label) {
        const original = button.dataset.defaultText || button.textContent;
        button.dataset.defaultText = original;
        button.textContent = label;
        clearTimeout(Number(button.dataset.resetTimer || 0));
        button.dataset.resetTimer = String(setTimeout(() => {
            button.textContent = original;
            delete button.dataset.resetTimer;
        }, 1300));
    }

    function trapFocus(event) {
        if (event.key !== 'Tab' || modal?.hidden) return;
        const focusable = [...modal.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
            .filter(node => !node.hidden && node.getClientRects().length);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    function openModal(media) {
        const entry = entryFromMedia(media);
        if (!entry) return;
        ensureModal();
        activeEntry = entry;
        activeFormat = readSavedFormat();
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : media;
        modal.hidden = false;
        document.documentElement.classList.add('otd-share-open');
        syncModalState();
        modal.querySelector('[data-otd-share-close]').focus({ preventScroll: true });
        renderPreview();
    }

    function closeModal() {
        if (!modal || modal.hidden) return;
        modal.hidden = true;
        document.documentElement.classList.remove('otd-share-open');
        renderToken += 1;
        revokePreviewObjectUrl();
        activeEntry = null;
        renderedUrl = '';
        renderedBlob = null;
        renderedFile = null;
        returnFocus?.focus?.({ preventScroll: true });
        returnFocus = null;
    }

    function escapeXml(value) {
        return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    }

    function textUnits(value) {
        if (displayFont) return displayFont.measureDisplay(String(value || ''), 100) / 100;
        let width = 0;
        for (const character of String(value || '')) {
            if (/\s/.test(character)) width += 0.52;
            else if (/[I1.,'’!:;|]/.test(character)) width += 0.48;
            else if (/[MW@%&#]/.test(character)) width += 1.24;
            else if (/[()\[\]{}/-]/.test(character)) width += 0.72;
            else width += 1;
        }
        return width;
    }

    function balancedWrap(text, maxUnits, maxLines) {
        const sourceWords = clean(text).split(' ').filter(Boolean);
        if (!sourceWords.length) return [];
        const capacity = maxUnits * 1.08;
        const words = [...sourceWords];
        let clipped = false;
        while (words.length > 1 && textUnits(words.join(' ')) > capacity * maxLines) {
            words.pop();
            clipped = true;
        }
        if (clipped) words[words.length - 1] = `${words.at(-1).replace(/[\s,.;:-]+$/, '')}…`;
        const whole = words.join(' ');
        if (textUnits(whole) <= maxUnits) return [whole];

        const candidates = [];
        const collect = (start, lines) => {
            if (start >= words.length) {
                if (lines.length <= maxLines) candidates.push(lines);
                return;
            }
            if (lines.length >= maxLines) return;
            for (let end = start + 1; end <= words.length; end += 1) {
                const line = words.slice(start, end).join(' ');
                if (textUnits(line) > capacity && end > start + 1) break;
                collect(end, [...lines, line]);
            }
        };
        collect(0, []);

        const weakWord = /^(?:A|AN|AND|AT|BY|FOR|FROM|IN|OF|ON|OR|THE|TO|VS\.?|WITH)$/i;
        const colonIndex = words.findIndex(word => /[:;—–]$/.test(word));
        const subtitleStart = colonIndex >= 0 ? colonIndex + 1 : -1;
        const subtitle = subtitleStart > 0 ? words.slice(subtitleStart).join(' ') : '';
        const protectSubtitle = subtitle && textUnits(subtitle) <= maxUnits * 1.03;
        const score = lines => {
            const widths = lines.map(textUnits);
            const widest = Math.max(...widths);
            const target = widths.reduce((sum, width) => sum + width, 0) / widths.length;
            let value = lines.length * 18;
            widths.forEach(width => {
                value += (width - target) ** 2;
                if (width > maxUnits) value += (width - maxUnits) ** 2 * 24;
            });
            const finalWords = lines.at(-1).split(' ').filter(Boolean);
            if (finalWords.length === 1 && words.length > 2) value += 10000;
            if (finalWords.length === 2 && widths.at(-1) < widest * 0.38) value += 2400;
            if (widths.at(-1) < widest * 0.48) value += 3200;
            lines.forEach((line, index) => {
                const lineWords = line.split(' ').filter(Boolean);
                const firstWord = lineWords[0] || '';
                const finalWord = line.split(' ').at(-1) || '';
                if (index < lines.length - 1 && lineWords.length === 1 && !/[:;—–]$/.test(line)) value += 8000;
                if (index > 0 && weakWord.test(firstWord)) value += 900;
                if (index < lines.length - 1 && weakWord.test(finalWord)) value += 1200;
                if (index < lines.length - 1 && /[:;—–]$/.test(line)) value -= 520;
                if (index < lines.length - 1 && /\bVS\.?$/i.test(line)) value += 1600;
            });
            if (protectSubtitle) {
                const subtitleLine = lines.findIndex(line => line.split(' ').includes(words[subtitleStart]));
                if (subtitleLine < 0 || lines.slice(subtitleLine).join(' ') !== subtitle) value += 7200;
            }
            return value;
        };
        return candidates.sort((a, b) => score(a) - score(b))[0] || [whole];
    }

    function tspans(lines, x, y, lineHeight) {
        return lines.map((line, index) => `<tspan x="${x}" y="${Math.round(y + index * lineHeight)}">${escapeXml(line)}</tspan>`).join('');
    }

    async function sourceAsDataUrl(url) {
        if (!url) return null;
        try {
            const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
            if (!response.ok) return null;
            const blob = await response.blob();
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
            });
            let width = 1;
            let height = 1;
            try {
                const bitmap = await createImageBitmap(blob);
                width = bitmap.width;
                height = bitmap.height;
                bitmap.close?.();
            } catch {}
            return { dataUrl, width, height };
        } catch { return null; }
    }

    function buildFallbackSvg(entry, format, source, tapeSource) {
        const { width: w, height: h } = format;
        const pad = Math.round(w * 0.043);
        const ink = '#080808';
        const paper = '#f1eee4';
        const capHeight = displayFont.displayFontMetrics.capHeight / displayFont.displayFontMetrics.unitsPerEm;
        const anniversary = entry.yearsAgo > 0 ? `${entry.yearsAgo} YEARS AGO` : 'ON THIS DAY';
        const available = w * 0.87;
        const title = entry.title.toUpperCase();
        const subtitleSplit = /^(.{1,18}):\s+(.+)$/.exec(title);
        const titleRows = [];
        if (subtitleSplit) {
            titleRows.push({ text: subtitleSplit[1], size: Math.min(w * 0.14, available / textUnits(subtitleSplit[1])) });
            const subtitleSize = w * 0.115;
            const lines = textUnits(subtitleSplit[2]) * w * .085 <= available
                ? [subtitleSplit[2]]
                : balancedWrap(subtitleSplit[2], available / subtitleSize, 2);
            const size = Math.min(subtitleSize, available / Math.max(...lines.map(textUnits)));
            lines.forEach(text => titleRows.push({ text, size }));
        } else {
            const baseSize = w * 0.14;
            const lines = balancedWrap(title, available / baseSize, 3);
            const size = Math.min(baseSize, available / Math.max(...lines.map(textUnits)));
            lines.forEach(text => titleRows.push({ text, size }));
        }
        let rowY = h - w * 0.09;
        for (let index = titleRows.length - 1; index >= 0; index -= 1) {
            titleRows[index].y = rowY;
            rowY -= titleRows[index].size * capHeight + w * 0.035;
        }
        const imageX = Math.round(w * 0.023);
        const imageW = w - imageX * 2;
        const imageY = Math.round(h * 0.085);
        const imageH = Math.round(h - imageY - w * 0.045);
        const isPoster = source && source.width / source.height < 0.82;
        const ripPoints = `${imageX},${imageY + 4} ${w * .34},${imageY} ${w * .68},${imageY + 5} ${w - imageX},${imageY + 1} ${w - imageX - 3},${imageY + imageH} ${w * .57},${imageY + imageH - 4} ${imageX + 2},${imageY + imageH + 2}`;
        const cropX = source?.width && source?.height
            ? imageX + (imageW - imageH * source.width / source.height) / 2
            : imageX;
        const imageMarkup = source
            ? `<polygon points="${ripPoints}" fill="${paper}"/><image href="${source.dataUrl}" x="${imageX}" y="${imageY}" width="${imageW}" height="${imageH}" preserveAspectRatio="xMidYMid slice" opacity=".3" filter="url(#xerox)" clip-path="url(#rip)"/><image href="${source.dataUrl}" x="${isPoster ? Math.min(imageX, cropX) : imageX}" y="${imageY}" width="${isPoster ? Math.max(imageW, imageH * source.width / source.height) : imageW}" height="${imageH}" preserveAspectRatio="xMidYMid ${isPoster ? 'meet' : 'slice'}" filter="url(#xerox)" clip-path="url(#rip)"/>`
            : `<g opacity=".2" transform="rotate(-7 ${w / 2} ${h / 2})">${displayFont.displayTextSvg(String(entry.year || 'MMA'), { x: w / 2, y: imageY + imageH * .57, size: w * .48, fill: paper, anchor: 'middle' })}</g><path d="M ${-w * .1} ${h * .25} L ${w * 1.1} ${h * .17} M ${-w * .1} ${h * .54} L ${w * 1.1} ${h * .46}" stroke="${paper}" stroke-width="${w * .025}" opacity=".2"/>`;
        const tapeMarkup = (x, y, width, height, index) => {
            return tapeSource
                ? `<image href="${tapeSource.dataUrl}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="none" ${index % 2 ? `transform="rotate(180 ${x + width / 2} ${y + height / 2})"` : ''}/>`
                : `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#030303"/>`;
        };
        const titleMarkup = titleRows.map(({ text, size, y }, index) => {
            const x = pad + (index % 2 ? w * .012 : 0);
            const textWidth = displayFont.measureDisplay(text, size);
            const tapeY = y - size * capHeight - w * .0185;
            const tapeH = size * capHeight + w * .0352;
            const angle = [-1.15, .5, -.4][index % 3];
            return `<g transform="rotate(${angle} ${x} ${y})">${tapeMarkup(x - w * .018, tapeY, Math.min(w - x - w * .018, textWidth + w * .045), tapeH, index)}${displayFont.displayTextSvg(text, { x, y, size, fill: paper })}</g>`;
        }).join('');
        const credit = entry.imageCredit ? `IMAGE: ${entry.imageCredit.toUpperCase()}` : 'MMAMATLOCK.COM / FIGHT ARCHIVE';
        const creditSize = Math.min(w * .0105, w * .89 / (Math.max(1, credit.length) * .61));
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
            <defs>
                <clipPath id="rip"><polygon points="${ripPoints}"/></clipPath>
                <filter id="xerox"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope="1.35" intercept="-.12"/><feFuncG type="linear" slope="1.35" intercept="-.12"/><feFuncB type="linear" slope="1.35" intercept="-.12"/></feComponentTransfer></filter>
                <filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="4" seed="19"/><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 .33 .33 .33 0 0"/></filter>
                <linearGradient id="photoShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></linearGradient>
            </defs>
            <rect width="${w}" height="${h}" fill="${ink}"/>
            <rect width="${w}" height="${h}" fill="${paper}" filter="url(#paper)" opacity=".12"/>
            ${imageMarkup}
            <rect x="${imageX}" y="${imageY}" width="${imageW}" height="${imageH}" fill="url(#photoShade)"/>
            <text x="${pad}" y="${w * .028}" fill="${paper}" font-family="monospace" font-size="${w * .013}" font-weight="700" letter-spacing="1.2">${escapeXml(entry.dateLabel.toUpperCase())}</text>
            ${displayFont.displayTextSvg('MMA MATLOCK', { x: w - pad, y: w * .033, size: w * .026, fill: paper, anchor: 'end' })}
            ${tapeMarkup(pad - w * .012, imageY - w * .077, displayFont.measureDisplay(anniversary, w * .05) + w * .035, w * .078, 4)}
            ${displayFont.displayTextSvg(anniversary, { x: pad, y: imageY - w * .013, size: w * .05, fill: paper })}
            <text x="${w - pad}" y="${imageY - w * .014}" text-anchor="end" fill="${paper}" font-family="monospace" font-size="${w * .011}" letter-spacing="1.3">${escapeXml(entry.promotion?.toUpperCase() || 'FIGHT ARCHIVE')}</text>
            ${titleMarkup}
            <text x="${pad}" y="${h - w * .021}" fill="${paper}" opacity=".7" font-family="monospace" font-size="${creditSize}" letter-spacing=".4">${escapeXml(credit)}</text>
        </svg>`;
    }

    async function svgToJpeg(svg, format) {
        const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
        const svgUrl = URL.createObjectURL(svgBlob);
        try {
            const image = new Image();
            image.decoding = 'async';
            image.src = svgUrl;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = format.width;
            canvas.height = format.height;
            const ctx = canvas.getContext('2d', { alpha: false });
            ctx.drawImage(image, 0, 0, format.width, format.height);
            return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.93));
        } finally {
            URL.revokeObjectURL(svgUrl);
        }
    }

    async function renderFallback(entry, format) {
        try {
            if (!displayFontPromise) displayFontPromise = import(`/assets/share-gobold.mjs?v=${encodeURIComponent(ASSET_VERSION)}`);
            if (!tapeSourcePromise) tapeSourcePromise = sourceAsDataUrl(`/assets/textures/otd-gaffer-tape-v1.png?v=${encodeURIComponent(ASSET_VERSION)}`);
            const [source, font, tapeSource] = await Promise.all([sourceAsDataUrl(entry.imageUrl), displayFontPromise, tapeSourcePromise]);
            displayFont = font;
            const svg = buildFallbackSvg(entry, format, source, tapeSource);
            return await svgToJpeg(svg, format);
        } catch {
            displayFontPromise = null;
            return null;
        }
    }

    async function renderPreview() {
        if (!activeEntry || !preview || !status) return;
        const token = ++renderToken;
        revokePreviewObjectUrl();
        renderedUrl = '';
        renderedBlob = null;
        renderedFile = null;
        setCardActionsEnabled(false);
        status.textContent = 'Preparing share image…';
        preview.removeAttribute('src');

        const manifest = await loadManifest();
        if (token !== renderToken || !activeEntry) return;
        const prebuiltRecord = manifest?.entries?.[activeEntry.id];
        const prebuilt = prebuiltRecord?.formats?.[activeFormat];
        if (prebuilt) {
            if (typeof prebuiltRecord.imageCredit === 'string') {
                activeEntry.imageCredit = prebuiltRecord.imageCredit;
                activeEntry.imageSources = prebuiltRecord.imageSources;
                activeEntry.caption = captionForEntry(activeEntry);
                syncModalState();
            }
            renderedUrl = prebuilt;
            preview.src = prebuilt;
            setCardActionsEnabled(true);
            status.textContent = 'Ready.';
            return;
        }

        const blob = await renderFallback(activeEntry, FORMATS[activeFormat]);
        if (token !== renderToken || !activeEntry) return;
        if (!blob) {
            status.textContent = 'Could not build the share image.';
            return;
        }
        renderedBlob = blob;
        const base = clean(activeEntry.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55) || 'on-this-day';
        renderedFile = new File([blob], `${base}-${activeFormat}.jpg`, { type: 'image/jpeg' });
        previewObjectUrl = URL.createObjectURL(blob);
        preview.src = previewObjectUrl;
        setCardActionsEnabled(true);
        status.textContent = 'Ready.';
    }

    async function ensureFile() {
        if (renderedFile && renderedBlob) return true;
        if (!activeEntry || !renderedUrl) return false;
        try {
            const response = await fetch(renderedUrl, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            renderedBlob = await response.blob();
            const base = clean(activeEntry.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55) || 'on-this-day';
            renderedFile = new File([renderedBlob], `${base}-${activeFormat}.jpg`, { type: 'image/jpeg' });
            return true;
        } catch {
            return false;
        }
    }

    function triggerDownload() {
        if (renderedBlob && renderedFile) {
            const url = URL.createObjectURL(renderedBlob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = renderedFile.name;
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1500);
            return true;
        }
        if (renderedUrl) {
            window.open(renderedUrl, '_blank', 'noopener,noreferrer');
            return true;
        }
        return false;
    }

    async function downloadCard(event) {
        if (!activeEntry) return;
        await ensureFile();
        if (!triggerDownload()) return;
        flash(event.currentTarget, 'Downloaded');
        status.textContent = `${FORMATS[activeFormat].label} ready.`;
    }

    function canShareFile() {
        if (!navigator.share || !renderedFile) return false;
        if (!navigator.canShare) return true;
        try { return navigator.canShare({ files: [renderedFile] }); } catch { return false; }
    }

    async function shareCard(event) {
        if (!activeEntry) return;
        try { await copyText(activeEntry.caption); } catch {}
        await ensureFile();
        if (canShareFile()) {
            try {
                await navigator.share({ files: [renderedFile] });
                flash(event.currentTarget, 'Shared');
                status.textContent = 'Caption copied. Image sent to the system share sheet.';
                return;
            } catch (error) { if (error?.name === 'AbortError') return; }
        }
        triggerDownload();
        flash(event.currentTarget, 'Saved');
        status.textContent = 'Image opened/downloaded and caption copied.';
    }

    async function shareToInstagram(event) {
        if (!activeEntry) return;
        const native = isTouchLike && navigator.share;
        const tab = native ? null : window.open('about:blank', '_blank');
        try { await copyText(activeEntry.caption); } catch {}
        await ensureFile();
        if (canShareFile()) {
            try {
                await navigator.share({ files: [renderedFile] });
                flash(event.currentTarget, 'Choose Instagram');
                status.textContent = 'Caption copied. Choose Instagram in the share sheet.';
                return;
            } catch (error) { if (error?.name === 'AbortError') return; }
        }
        triggerDownload();
        if (tab) tab.location.href = 'https://www.instagram.com/';
        else window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
        flash(event.currentTarget, 'Prepared');
        status.textContent = 'Image prepared and caption copied. Instagram opened.';
    }

    async function copyImage(event) {
        if (!canCopyImage || !activeEntry) return;
        if (!(await ensureFile()) || !renderedBlob) {
            flash(event.currentTarget, 'Unavailable');
            return;
        }
        try {
            const bitmap = await createImageBitmap(renderedBlob);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            canvas.getContext('2d').drawImage(bitmap, 0, 0);
            bitmap.close?.();
            const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
            flash(event.currentTarget, 'Copied');
            status.textContent = 'Image copied to the clipboard.';
        } catch {
            flash(event.currentTarget, 'Unavailable');
            status.textContent = 'This browser did not allow image clipboard access.';
        }
    }

    function openPlatform(platform) {
        if (!activeEntry) return;
        const link = activeEntry.link;
        const title = `${activeEntry.headline}: ${activeEntry.title}`;
        const urls = {
            x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(link)}`,
            facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
            threads: `https://www.threads.net/intent/post?text=${encodeURIComponent(activeEntry.caption)}`,
            reddit: `https://www.reddit.com/submit?url=${encodeURIComponent(link)}&title=${encodeURIComponent(title)}`
        };
        if (urls[platform]) window.open(urls[platform], '_blank', 'noopener,noreferrer');
    }

    list.addEventListener('click', event => {
        const media = event.target.closest('.otd-entry-media');
        if (!media || !list.contains(media)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openModal(media);
    }, true);

    list.addEventListener('keydown', event => {
        const media = event.target.closest('.otd-entry-media');
        if (!media || event.target !== media || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openModal(media);
    }, true);

    const labelShareMedia = event => {
        const media = event.target.closest?.('.otd-entry-media');
        if (!media || !list.contains(media)) return;
        const title = clean(media.closest('.otd-entry')?.querySelector('.otd-entry-title')?.textContent) || 'this moment';
        media.setAttribute('aria-label', `Create share image for ${title}`);
    };
    list.addEventListener('focusin', labelShareMedia);
    list.addEventListener('pointerover', labelShareMedia, { passive: true });

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !modal || modal.hidden) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeModal();
    }, true);
})();
