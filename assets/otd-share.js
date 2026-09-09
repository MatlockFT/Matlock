(() => {
    const widget = document.querySelector('[data-on-this-day][data-mode="full"]');
    const list = widget?.querySelector('[data-otd-list]');
    if (!widget || !list || widget.dataset.otdShareBooted === '1') return;
    widget.dataset.otdShareBooted = '1';

    const FORMATS = {
        post: { label: 'Post', width: 1080, height: 1350 },
        story: { label: 'Story', width: 1080, height: 1920 },
        social: { label: 'Social', width: 1200, height: 1200 }
    };

    let activeFormat = 'post';
    let activeEntry = null;
    let modal = null;
    let canvas = null;
    let status = null;
    let formatButtons = [];
    let returnFocus = null;
    let renderToken = 0;
    let renderedBlob = null;
    let renderedFile = null;

    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

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

    function dateFromRow(row) {
        const match = /^otd-(\d{4})(\d{2})(\d{2})-/.exec(row?.id || '');
        if (!match) return null;
        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        return Number.isNaN(date.getTime()) ? null : date;
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
        const detail = clean(row.querySelector('.otd-entry-detail')?.textContent);
        const image = media.querySelector('img');
        const imageUrl = media.dataset.lightboxSrc || image?.currentSrc || image?.src || '';
        const imageAlt = media.dataset.lightboxAlt || image?.alt || title;
        const imageCredit = media.dataset.lightboxCredit || clean(media.querySelector('.otd-media-credit')?.textContent);
        const link = row.querySelector('[data-otd-entry-link]')?.dataset?.otdEntryLink || (() => {
            const url = new URL(location.href);
            if (date) url.searchParams.set('date', `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
            url.hash = row.id;
            return url.href;
        })();
        const headline = yearsAgo > 0
            ? `${yearsAgo} ${yearsAgo === 1 ? 'Year' : 'Years'} Ago Today`
            : 'On This Day';
        const dateLabel = date
            ? new Intl.DateTimeFormat([], { month: 'long', day: 'numeric', year: 'numeric' }).format(date)
            : yearText;
        const caption = `${headline}: ${title}\n${dateLabel}\n\n${link}\n\n#MMA #OnThisDay`;

        return {
            row,
            media,
            title,
            promotion,
            detail,
            imageUrl,
            imageAlt,
            imageCredit,
            link,
            year,
            yearsAgo,
            headline,
            dateLabel,
            caption
        };
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
                    <div>
                        <p class="otd-share-kicker">On This Day</p>
                        <h2 id="otd-share-title">Share This Moment</h2>
                    </div>
                    <button type="button" class="otd-share-close" data-otd-share-close aria-label="Close share builder">×</button>
                </header>
                <div class="otd-share-formats" role="group" aria-label="Share image format">
                    <button type="button" data-otd-share-format="post" aria-pressed="true">Post <span>4:5</span></button>
                    <button type="button" data-otd-share-format="story" aria-pressed="false">Story <span>9:16</span></button>
                    <button type="button" data-otd-share-format="social" aria-pressed="false">Social <span>1:1</span></button>
                </div>
                <div class="otd-share-preview-wrap">
                    <canvas class="otd-share-preview" data-otd-share-canvas aria-label="Generated social share card preview"></canvas>
                </div>
                <p class="otd-share-status" data-otd-share-status aria-live="polite"></p>
                <div class="otd-share-actions">
                    <button type="button" class="otd-share-action is-primary" data-otd-share-native>Share image</button>
                    <button type="button" class="otd-share-action" data-otd-share-download>Download</button>
                    <button type="button" class="otd-share-action" data-otd-share-caption>Copy caption</button>
                    <button type="button" class="otd-share-action" data-otd-share-link>Copy link</button>
                </div>
                <div class="otd-share-platforms" aria-label="Share link on social platforms">
                    <button type="button" data-otd-share-platform="x">X</button>
                    <button type="button" data-otd-share-platform="facebook">Facebook</button>
                    <button type="button" data-otd-share-platform="threads">Threads</button>
                    <button type="button" data-otd-share-platform="reddit">Reddit</button>
                </div>
                <p class="otd-share-note">On phones, Share image opens the system share sheet so you can choose Instagram, Stories, Facebook, Messages, and other installed apps. Desktop browsers may fall back to downloading the image.</p>
            </div>
        `;
        document.body.append(modal);

        canvas = modal.querySelector('[data-otd-share-canvas]');
        status = modal.querySelector('[data-otd-share-status]');
        formatButtons = [...modal.querySelectorAll('[data-otd-share-format]')];

        modal.querySelector('[data-otd-share-close]').addEventListener('click', closeModal);
        modal.addEventListener('click', event => {
            if (event.target === modal) closeModal();
        });

        formatButtons.forEach(button => {
            button.addEventListener('click', () => {
                const next = button.dataset.otdShareFormat;
                if (!FORMATS[next] || next === activeFormat) return;
                activeFormat = next;
                formatButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
                renderCard();
            });
        });

        modal.querySelector('[data-otd-share-download]').addEventListener('click', downloadCard);
        modal.querySelector('[data-otd-share-native]').addEventListener('click', shareCard);
        modal.querySelector('[data-otd-share-caption]').addEventListener('click', async event => {
            if (!activeEntry) return;
            try {
                await copyText(activeEntry.caption);
                flash(event.currentTarget, 'Copied');
            } catch {
                flash(event.currentTarget, 'Failed');
            }
        });
        modal.querySelector('[data-otd-share-link]').addEventListener('click', async event => {
            if (!activeEntry) return;
            try {
                await copyText(activeEntry.link);
                flash(event.currentTarget, 'Copied');
            } catch {
                flash(event.currentTarget, 'Failed');
            }
        });
        modal.querySelectorAll('[data-otd-share-platform]').forEach(button => {
            button.addEventListener('click', () => openPlatform(button.dataset.otdSharePlatform));
        });
    }

    function flash(button, label) {
        const original = button.dataset.defaultText || button.textContent;
        button.dataset.defaultText = original;
        button.textContent = label;
        clearTimeout(Number(button.dataset.resetTimer || 0));
        const timer = setTimeout(() => {
            button.textContent = original;
            delete button.dataset.resetTimer;
        }, 1300);
        button.dataset.resetTimer = String(timer);
    }

    function openModal(media) {
        const entry = entryFromMedia(media);
        if (!entry) return;
        ensureModal();
        activeEntry = entry;
        activeFormat = 'post';
        formatButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.otdShareFormat === 'post')));
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : media;
        modal.hidden = false;
        document.documentElement.classList.add('otd-share-open');
        modal.querySelector('[data-otd-share-close]').focus({ preventScroll: true });
        renderCard();
    }

    function closeModal() {
        if (!modal || modal.hidden) return;
        modal.hidden = true;
        document.documentElement.classList.remove('otd-share-open');
        activeEntry = null;
        renderedBlob = null;
        renderedFile = null;
        renderToken += 1;
        returnFocus?.focus?.({ preventScroll: true });
        returnFocus = null;
    }

    function roundRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
    }

    function wrapLines(ctx, text, maxWidth, maxLines = 3) {
        const words = clean(text).split(' ').filter(Boolean);
        const lines = [];
        let line = '';
        let consumed = 0;
        for (const word of words) {
            const candidate = line ? `${line} ${word}` : word;
            if (ctx.measureText(candidate).width <= maxWidth || !line) {
                line = candidate;
                consumed += 1;
                continue;
            }
            lines.push(line);
            if (lines.length === maxLines - 1) {
                line = word;
                consumed += 1;
                break;
            }
            line = word;
            consumed += 1;
        }
        if (line && lines.length < maxLines) lines.push(line);
        if (consumed < words.length && lines.length) {
            let last = lines.at(-1);
            while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
            lines[lines.length - 1] = `${last.replace(/[\s,.;:-]+$/, '')}…`;
        }
        return lines;
    }

    async function fetchBitmap(url) {
        if (!url) return null;
        try {
            const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            if ('createImageBitmap' in window) return await createImageBitmap(blob);
            return await new Promise((resolve, reject) => {
                const objectUrl = URL.createObjectURL(blob);
                const image = new Image();
                image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
                image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Image decode failed')); };
                image.src = objectUrl;
            });
        } catch {
            return null;
        }
    }

    function drawImageContained(ctx, image, x, y, width, height) {
        ctx.save();
        roundRect(ctx, x, y, width, height, 26);
        ctx.clip();
        ctx.fillStyle = '#111111';
        ctx.fillRect(x, y, width, height);

        const scale = Math.min(width / image.width, height / image.height);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        const dx = x + (width - drawWidth) / 2;
        const dy = y + (height - drawHeight) / 2;
        ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
        ctx.restore();
    }

    function drawTextCard(ctx, config, entry, bitmap) {
        const { width: w, height: h } = config;
        const pad = Math.round(w * 0.065);
        const red = '#e31b23';
        const white = '#f6f6f6';
        const muted = '#a8a8a8';

        ctx.fillStyle = '#080808';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = red;
        ctx.fillRect(0, 0, w, Math.max(10, Math.round(h * 0.009)));

        const headlineSize = Math.round(w * (activeFormat === 'story' ? 0.085 : 0.073));
        ctx.font = `700 ${headlineSize}px Gobold, Impact, sans-serif`;
        ctx.fillStyle = white;
        ctx.textBaseline = 'top';
        const headlineLines = wrapLines(ctx, entry.headline.toUpperCase(), w - pad * 2, 2);
        let y = pad;
        headlineLines.forEach(line => {
            ctx.fillText(line, pad, y);
            y += headlineSize * 0.92;
        });

        y += Math.round(h * 0.025);
        const imageHeight = activeFormat === 'story' ? Math.round(h * 0.50) : activeFormat === 'post' ? Math.round(h * 0.54) : Math.round(h * 0.49);
        const imageWidth = w - pad * 2;
        if (bitmap) {
            drawImageContained(ctx, bitmap, pad, y, imageWidth, imageHeight);
        } else {
            ctx.fillStyle = '#121212';
            roundRect(ctx, pad, y, imageWidth, imageHeight, 26);
            ctx.fill();
            ctx.strokeStyle = '#262626';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.font = `700 ${Math.round(w * 0.12)}px Gobold, Impact, sans-serif`;
            ctx.fillStyle = '#3b3b3b';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(entry.year || 'MMA', w / 2, y + imageHeight / 2);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
        }
        y += imageHeight + Math.round(h * 0.035);

        const titleSize = Math.round(w * (activeFormat === 'story' ? 0.064 : 0.056));
        ctx.font = `700 ${titleSize}px Gobold, Impact, sans-serif`;
        ctx.fillStyle = white;
        const titleLines = wrapLines(ctx, entry.title, w - pad * 2, activeFormat === 'story' ? 3 : 2);
        titleLines.forEach(line => {
            ctx.fillText(line, pad, y);
            y += titleSize * 1.03;
        });

        y += Math.round(h * 0.018);
        ctx.font = `600 ${Math.round(w * 0.027)}px Arial, sans-serif`;
        ctx.fillStyle = muted;
        ctx.fillText(entry.dateLabel, pad, y);

        const brandY = h - pad * 0.95;
        ctx.fillStyle = red;
        ctx.fillRect(pad, brandY - Math.round(w * 0.018), Math.round(w * 0.07), 5);
        ctx.font = `700 ${Math.round(w * 0.031)}px Gobold, Impact, sans-serif`;
        ctx.fillStyle = white;
        ctx.fillText('MMA MATLOCK', pad + Math.round(w * 0.085), brandY - Math.round(w * 0.032));

        if (entry.imageCredit && bitmap) {
            ctx.font = `500 ${Math.round(w * 0.016)}px Arial, sans-serif`;
            ctx.fillStyle = '#727272';
            ctx.textAlign = 'right';
            ctx.fillText(`Image: ${entry.imageCredit}`, w - pad, brandY - Math.round(w * 0.028));
            ctx.textAlign = 'left';
        }
    }

    async function renderCard() {
        if (!activeEntry || !canvas) return;
        const token = ++renderToken;
        const config = FORMATS[activeFormat];
        status.textContent = 'Building share image…';
        renderedBlob = null;
        renderedFile = null;

        canvas.width = config.width;
        canvas.height = config.height;
        const ctx = canvas.getContext('2d', { alpha: false });
        try { await document.fonts?.ready; } catch {}
        const bitmap = await fetchBitmap(activeEntry.imageUrl);
        if (token !== renderToken || !activeEntry) {
            bitmap?.close?.();
            return;
        }

        drawTextCard(ctx, config, activeEntry, bitmap);
        const usedSourceImage = Boolean(bitmap);
        bitmap?.close?.();

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
        if (token !== renderToken || !activeEntry) return;
        if (!blob) {
            status.textContent = 'Could not build the share image.';
            return;
        }

        renderedBlob = blob;
        const base = clean(activeEntry.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55) || 'on-this-day';
        renderedFile = new File([blob], `${base}-${activeFormat}.jpg`, { type: 'image/jpeg' });
        status.textContent = !usedSourceImage && activeEntry.imageUrl
            ? 'Share card ready. The source image blocks cross-site export, so this version uses the date artwork fallback.'
            : 'Share card ready.';
    }

    async function ensureRendered() {
        if (renderedBlob && renderedFile) return true;
        await renderCard();
        return Boolean(renderedBlob && renderedFile);
    }

    async function downloadCard(event) {
        if (!activeEntry || !(await ensureRendered())) return;
        const url = URL.createObjectURL(renderedBlob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = renderedFile.name;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        if (event?.currentTarget) flash(event.currentTarget, 'Downloaded');
    }

    async function shareCard(event) {
        if (!activeEntry || !(await ensureRendered())) return;
        const payload = {
            title: activeEntry.headline,
            text: activeEntry.caption,
            url: activeEntry.link,
            files: [renderedFile]
        };

        try {
            if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [renderedFile] }))) {
                await navigator.share(payload);
                if (event?.currentTarget) flash(event.currentTarget, 'Shared');
                return;
            }
        } catch (error) {
            if (error?.name === 'AbortError') return;
        }

        await downloadCard(event);
        try { await copyText(activeEntry.caption); } catch {}
        status.textContent = 'Image downloaded and caption copied. Open Instagram or another app and choose the downloaded image.';
    }

    function openPlatform(platform) {
        if (!activeEntry) return;
        const link = activeEntry.link;
        const caption = activeEntry.caption;
        const title = `${activeEntry.headline}: ${activeEntry.title}`;
        const urls = {
            x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(link)}`,
            facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
            threads: `https://www.threads.net/intent/post?text=${encodeURIComponent(caption)}`,
            reddit: `https://www.reddit.com/submit?url=${encodeURIComponent(link)}&title=${encodeURIComponent(title)}`
        };
        const target = urls[platform];
        if (target) window.open(target, '_blank', 'noopener,noreferrer');
    }

    list.addEventListener('click', event => {
        const media = event.target.closest('.otd-entry-media.is-image-ready');
        if (!media || !list.contains(media)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openModal(media);
    }, true);

    list.addEventListener('keydown', event => {
        const media = event.target.closest('.otd-entry-media.is-image-ready');
        if (!media || event.target !== media || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openModal(media);
    }, true);

    list.addEventListener('focusin', event => {
        const media = event.target.closest('.otd-entry-media.is-image-ready');
        if (!media) return;
        const title = clean(media.closest('.otd-entry')?.querySelector('.otd-entry-title')?.textContent) || 'this moment';
        media.setAttribute('aria-label', `Create share image for ${title}`);
    });

    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !modal || modal.hidden) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        closeModal();
    }, true);
})();
