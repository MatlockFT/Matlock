(() => {
    const widget = document.querySelector('[data-on-this-day][data-mode="full"]');
    const list = widget?.querySelector('[data-otd-list]');
    if (!widget || !list || widget.dataset.otdShareBooted === '1') return;
    widget.dataset.otdShareBooted = '1';

    const FORMAT_KEY = 'mma-matlock:otd:share-format';
    const FORMATS = {
        post: { label: 'Instagram Post', shortLabel: 'Post', width: 1080, height: 1350, ratio: '4:5' },
        story: { label: 'Instagram Story', shortLabel: 'Story', width: 1080, height: 1920, ratio: '9:16' },
        social: { label: 'Square Social', shortLabel: 'Square', width: 1200, height: 1200, ratio: '1:1' }
    };

    const isTouchLike = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    const canCopyImage = Boolean(navigator.clipboard?.write && window.ClipboardItem);

    let activeFormat = readSavedFormat();
    let activeEntry = null;
    let modal = null;
    let canvas = null;
    let status = null;
    let formatButtons = [];
    let returnFocus = null;
    let renderToken = 0;
    let renderedBlob = null;
    let renderedFile = null;
    let sourceBitmap = null;
    let sourceBitmapPromise = null;
    let sourceImageFailed = false;
    let cardActionButtons = [];

    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

    function readSavedFormat() {
        try {
            const saved = localStorage.getItem(FORMAT_KEY);
            if (FORMATS[saved]) return saved;
        } catch {}
        return 'post';
    }

    function saveFormat(value) {
        try { localStorage.setItem(FORMAT_KEY, value); } catch {}
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
        const x = values[0] ? Number.parseFloat(values[0]) / 100 : 0.5;
        const y = values[1] ? Number.parseFloat(values[1]) / 100 : 0.5;
        return {
            x: Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5,
            y: Number.isFinite(y) ? Math.max(0, Math.min(1, y)) : 0.5
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
        const caption = `${headline}\n${title}\n${dateLabel}\n\n${link}\n\n#MMA #OnThisDay`;

        return {
            row,
            media,
            title,
            promotion,
            detail,
            imageUrl,
            imageAlt,
            imageCredit,
            imagePosition: imagePositionFromMedia(media),
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
        modal.setAttribute('aria-describedby', 'otd-share-note');
        modal.innerHTML = `
            <div class="otd-share-panel">
                <header class="otd-share-header">
                    <div>
                        <p class="otd-share-kicker">On This Day</p>
                        <h2 id="otd-share-title">Share This Moment</h2>
                    </div>
                    <button type="button" class="otd-share-close" data-otd-share-close aria-label="Close share builder">×</button>
                </header>

                <div class="otd-share-workspace">
                    <section class="otd-share-preview-column" aria-label="Share image preview">
                        <div class="otd-share-preview-meta">
                            <strong data-otd-share-format-label></strong>
                            <span data-otd-share-output-size></span>
                        </div>
                        <div class="otd-share-preview-wrap">
                            <canvas class="otd-share-preview" data-otd-share-canvas aria-label="Generated social share card preview"></canvas>
                        </div>
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
                            <div class="otd-share-platforms" aria-label="Share link on social platforms">
                                <button type="button" data-otd-share-platform="x">X</button>
                                <button type="button" data-otd-share-platform="facebook">Facebook</button>
                                <button type="button" data-otd-share-platform="threads">Threads</button>
                                <button type="button" data-otd-share-platform="reddit">Reddit</button>
                            </div>
                        </div>

                        <p class="otd-share-note" id="otd-share-note" data-otd-share-note></p>
                    </section>
                </div>
            </div>
        `;
        document.body.append(modal);

        canvas = modal.querySelector('[data-otd-share-canvas]');
        status = modal.querySelector('[data-otd-share-status]');
        formatButtons = [...modal.querySelectorAll('[data-otd-share-format]')];
        cardActionButtons = [...modal.querySelectorAll('[data-otd-requires-card]')];

        if (!canCopyImage) modal.querySelector('[data-otd-share-image]')?.remove();

        modal.querySelector('[data-otd-share-close]').addEventListener('click', closeModal);
        modal.addEventListener('click', event => {
            if (event.target === modal) closeModal();
        });

        formatButtons.forEach(button => {
            button.addEventListener('click', () => {
                const next = button.dataset.otdShareFormat;
                if (!FORMATS[next] || next === activeFormat) return;
                activeFormat = next;
                saveFormat(next);
                syncModalState();
                renderCard();
            });
        });

        modal.querySelector('[data-otd-share-download]').addEventListener('click', downloadCard);
        modal.querySelector('[data-otd-share-native]').addEventListener('click', shareCard);
        modal.querySelector('[data-otd-share-instagram]').addEventListener('click', shareToInstagram);
        modal.querySelector('[data-otd-share-caption]').addEventListener('click', async event => {
            if (!activeEntry) return;
            try {
                await copyText(activeEntry.caption);
                flash(event.currentTarget, 'Copied');
                status.textContent = 'Caption copied.';
            } catch {
                flash(event.currentTarget, 'Failed');
            }
        });
        modal.querySelector('[data-otd-share-link]').addEventListener('click', async event => {
            if (!activeEntry) return;
            try {
                await copyText(activeEntry.link);
                flash(event.currentTarget, 'Copied');
                status.textContent = 'Link copied.';
            } catch {
                flash(event.currentTarget, 'Failed');
            }
        });
        modal.querySelector('[data-otd-share-image]')?.addEventListener('click', copyImage);
        modal.querySelectorAll('[data-otd-share-platform]').forEach(button => {
            button.addEventListener('click', () => openPlatform(button.dataset.otdSharePlatform));
        });

        modal.addEventListener('keydown', trapFocus);
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

    function trapFocus(event) {
        if (event.key !== 'Tab' || modal?.hidden) return;
        const focusable = [...modal.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
            .filter(node => !node.hidden && node.getClientRects().length);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function canShareFile(file = renderedFile) {
        if (!navigator.share || !file) return false;
        if (!navigator.canShare) return true;
        try { return navigator.canShare({ files: [file] }); }
        catch { return false; }
    }

    function syncModalState() {
        if (!modal) return;
        const config = FORMATS[activeFormat];
        formatButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.otdShareFormat === activeFormat)));
        modal.querySelector('[data-otd-share-format-label]').textContent = config.label;
        modal.querySelector('[data-otd-share-output-size]').textContent = `${config.width} × ${config.height} JPG`;

        const instagramButton = modal.querySelector('[data-otd-share-instagram]');
        const shareButton = modal.querySelector('[data-otd-share-native]');
        const note = modal.querySelector('[data-otd-share-note]');
        instagramButton.textContent = isTouchLike ? 'Instagram / Stories' : 'Prepare for Instagram';
        shareButton.textContent = navigator.share ? 'Share to apps' : 'Save + copy caption';
        note.textContent = isTouchLike
            ? 'Instagram works through your phone’s share sheet. The caption is copied first, then the JPG is handed to the system so you can choose Instagram, Stories, Messages, Facebook, or another app.'
            : activeFormat === 'story'
                ? 'Desktop Instagram is best for feed posts. For Stories, the most reliable workflow is to download this 9:16 JPG and send it to your phone. Prepare for Instagram downloads the file, copies the caption, and opens Instagram.'
                : 'Prepare for Instagram downloads the JPG, copies the caption, and opens Instagram in a new tab. Upload the downloaded image and paste the caption.';
    }

    function setCardActionsEnabled(enabled) {
        for (const button of cardActionButtons) button.disabled = !enabled;
    }

    function openModal(media) {
        const entry = entryFromMedia(media);
        if (!entry) return;
        ensureModal();
        activeEntry = entry;
        activeFormat = readSavedFormat();
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : media;
        renderedBlob = null;
        renderedFile = null;
        sourceImageFailed = false;
        sourceBitmapPromise = null;
        sourceBitmap?.close?.();
        sourceBitmap = null;
        modal.hidden = false;
        document.documentElement.classList.add('otd-share-open');
        syncModalState();
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
        sourceBitmapPromise = null;
        sourceImageFailed = false;
        sourceBitmap?.close?.();
        sourceBitmap = null;
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

    async function getSourceBitmap() {
        if (sourceBitmap) return sourceBitmap;
        if (sourceImageFailed) return null;
        if (!sourceBitmapPromise) {
            sourceBitmapPromise = fetchBitmap(activeEntry?.imageUrl).then(bitmap => {
                if (bitmap) sourceBitmap = bitmap;
                else sourceImageFailed = true;
                return bitmap;
            });
        }
        return sourceBitmapPromise;
    }

    function drawImageCover(ctx, image, x, y, width, height, position = { x: 0.5, y: 0.5 }) {
        const scale = Math.max(width / image.width, height / image.height);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        const dx = x - (drawWidth - width) * position.x;
        const dy = y - (drawHeight - height) * position.y;
        ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
    }

    function drawImageContained(ctx, image, x, y, width, height, position = { x: 0.5, y: 0.5 }) {
        const scale = Math.min(width / image.width, height / image.height);
        const drawWidth = image.width * scale;
        const drawHeight = image.height * scale;
        const dx = x + (width - drawWidth) * position.x;
        const dy = y + (height - drawHeight) * position.y;
        ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
    }

    function drawImageStage(ctx, image, x, y, width, height, position) {
        ctx.save();
        roundRect(ctx, x, y, width, height, 30);
        ctx.clip();
        ctx.fillStyle = '#111';
        ctx.fillRect(x, y, width, height);

        ctx.save();
        ctx.filter = 'blur(34px) brightness(0.48) saturate(0.82)';
        drawImageCover(ctx, image, x - 34, y - 34, width + 68, height + 68, position);
        ctx.restore();

        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x, y, width, height);

        const inset = Math.max(18, Math.round(width * 0.018));
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.48)';
        ctx.shadowBlur = 28;
        ctx.shadowOffsetY = 10;
        drawImageContained(ctx, image, x + inset, y + inset, width - inset * 2, height - inset * 2, position);
        ctx.restore();
        ctx.restore();
    }

    function drawTextCard(ctx, config, entry, bitmap) {
        const { width: w, height: h } = config;
        const pad = Math.round(w * 0.064);
        const red = '#e31b23';
        const white = '#f7f7f7';
        const muted = '#a6a6a6';

        ctx.fillStyle = '#070707';
        ctx.fillRect(0, 0, w, h);
        const glow = ctx.createRadialGradient(w * 0.78, h * 0.16, 0, w * 0.78, h * 0.16, w * 0.78);
        glow.addColorStop(0, 'rgba(227,27,35,0.12)');
        glow.addColorStop(1, 'rgba(227,27,35,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = red;
        ctx.fillRect(0, 0, w, Math.max(10, Math.round(h * 0.008)));

        ctx.textBaseline = 'top';
        const headlineSize = Math.round(w * (activeFormat === 'story' ? 0.082 : 0.071));
        ctx.font = `700 ${headlineSize}px Gobold, Impact, sans-serif`;
        ctx.fillStyle = white;
        const headlineLines = wrapLines(ctx, entry.headline.toUpperCase(), w - pad * 2, 2);
        let y = pad;
        headlineLines.forEach(line => {
            ctx.fillText(line, pad, y);
            y += headlineSize * 0.91;
        });

        y += Math.round(h * 0.023);
        const imageHeight = activeFormat === 'story' ? Math.round(h * 0.49) : activeFormat === 'post' ? Math.round(h * 0.53) : Math.round(h * 0.47);
        const imageWidth = w - pad * 2;
        if (bitmap) {
            drawImageStage(ctx, bitmap, pad, y, imageWidth, imageHeight, entry.imagePosition);
            if (entry.imageCredit) {
                ctx.font = `600 ${Math.round(w * 0.014)}px Arial, sans-serif`;
                ctx.fillStyle = 'rgba(255,255,255,0.68)';
                ctx.textAlign = 'right';
                ctx.fillText(`Image: ${entry.imageCredit}`, w - pad - 16, y + imageHeight - Math.round(w * 0.031));
                ctx.textAlign = 'left';
            }
        } else {
            ctx.fillStyle = '#111';
            roundRect(ctx, pad, y, imageWidth, imageHeight, 30);
            ctx.fill();
            ctx.strokeStyle = '#242424';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.font = `700 ${Math.round(w * 0.13)}px Gobold, Impact, sans-serif`;
            ctx.fillStyle = '#353535';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(entry.year || 'MMA', w / 2, y + imageHeight / 2);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
        }
        y += imageHeight + Math.round(h * 0.03);

        if (entry.promotion && !entry.title.toLowerCase().startsWith(entry.promotion.toLowerCase())) {
            ctx.font = `700 ${Math.round(w * 0.022)}px Arial, sans-serif`;
            ctx.fillStyle = red;
            ctx.fillText(entry.promotion.toUpperCase(), pad, y);
            y += Math.round(w * 0.039);
        }

        const titleSize = Math.round(w * (activeFormat === 'story' ? 0.061 : 0.054));
        ctx.font = `700 ${titleSize}px Gobold, Impact, sans-serif`;
        ctx.fillStyle = white;
        const titleLines = wrapLines(ctx, entry.title, w - pad * 2, activeFormat === 'story' ? 3 : 2);
        titleLines.forEach(line => {
            ctx.fillText(line, pad, y);
            y += titleSize * 1.02;
        });

        y += Math.round(h * 0.014);
        ctx.font = `600 ${Math.round(w * 0.026)}px Arial, sans-serif`;
        ctx.fillStyle = muted;
        ctx.fillText(entry.dateLabel, pad, y);

        const footerY = h - pad * 0.68;
        ctx.fillStyle = red;
        ctx.fillRect(pad, footerY - Math.round(w * 0.014), Math.round(w * 0.065), 5);
        ctx.font = `700 ${Math.round(w * 0.029)}px Gobold, Impact, sans-serif`;
        ctx.fillStyle = white;
        ctx.fillText('MMA MATLOCK', pad + Math.round(w * 0.079), footerY - Math.round(w * 0.031));
        ctx.font = `600 ${Math.round(w * 0.017)}px Arial, sans-serif`;
        ctx.fillStyle = '#747474';
        ctx.textAlign = 'right';
        ctx.fillText('mmamatlock.com/on-this-day', w - pad, footerY - Math.round(w * 0.023));
        ctx.textAlign = 'left';
    }

    async function renderCard() {
        if (!activeEntry || !canvas) return;
        const token = ++renderToken;
        const config = FORMATS[activeFormat];
        status.textContent = 'Building share image…';
        renderedBlob = null;
        renderedFile = null;
        setCardActionsEnabled(false);

        canvas.width = config.width;
        canvas.height = config.height;
        const ctx = canvas.getContext('2d', { alpha: false });
        try { await document.fonts?.ready; } catch {}
        const bitmap = await getSourceBitmap();
        if (token !== renderToken || !activeEntry) return;

        drawTextCard(ctx, config, activeEntry, bitmap);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
        if (token !== renderToken || !activeEntry) return;
        if (!blob) {
            status.textContent = 'Could not build the share image.';
            return;
        }

        renderedBlob = blob;
        const base = clean(activeEntry.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55) || 'on-this-day';
        renderedFile = new File([blob], `${base}-${activeFormat}.jpg`, { type: 'image/jpeg' });
        setCardActionsEnabled(true);
        syncModalState();
        status.textContent = !bitmap && activeEntry.imageUrl
            ? 'Ready. This source blocks cross-site image export, so the card uses the clean date fallback.'
            : 'Ready to share.';
    }

    async function ensureRendered() {
        if (renderedBlob && renderedFile) return true;
        await renderCard();
        return Boolean(renderedBlob && renderedFile);
    }

    function triggerDownload() {
        if (!renderedBlob || !renderedFile) return false;
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

    async function downloadCard(event) {
        if (!activeEntry || !(await ensureRendered())) return;
        triggerDownload();
        if (event?.currentTarget) flash(event.currentTarget, 'Downloaded');
        status.textContent = `${FORMATS[activeFormat].label} downloaded.`;
    }

    async function shareCard(event) {
        if (!activeEntry || !(await ensureRendered())) return;
        try { await copyText(activeEntry.caption); } catch {}

        if (canShareFile()) {
            try {
                await navigator.share({ files: [renderedFile] });
                if (event?.currentTarget) flash(event.currentTarget, 'Shared');
                status.textContent = 'Caption copied. Image sent to the system share sheet.';
                return;
            } catch (error) {
                if (error?.name === 'AbortError') return;
            }
        }

        triggerDownload();
        if (event?.currentTarget) flash(event.currentTarget, 'Saved');
        status.textContent = 'JPG downloaded and caption copied.';
    }

    async function shareToInstagram(event) {
        if (!activeEntry) return;
        const likelyNative = isTouchLike && navigator.share;
        const instagramTab = likelyNative ? null : window.open('about:blank', '_blank');
        if (!(await ensureRendered())) {
            instagramTab?.close?.();
            return;
        }

        try { await copyText(activeEntry.caption); } catch {}

        if (canShareFile()) {
            try {
                await navigator.share({ files: [renderedFile] });
                if (event?.currentTarget) flash(event.currentTarget, 'Choose Instagram');
                status.textContent = 'Caption copied. Choose Instagram in the share sheet, then paste the caption.';
                return;
            } catch (error) {
                if (error?.name === 'AbortError') return;
            }
        }

        triggerDownload();
        if (instagramTab) instagramTab.location.href = 'https://www.instagram.com/';
        else window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
        if (event?.currentTarget) flash(event.currentTarget, 'Prepared');
        status.textContent = activeFormat === 'story'
            ? 'Story JPG downloaded and caption copied. Instagram opened; phone posting is the most reliable route for Stories.'
            : 'JPG downloaded and caption copied. Instagram opened; upload the file and paste the caption.';
    }

    async function copyImage(event) {
        if (!canCopyImage || !activeEntry || !(await ensureRendered())) return;
        try {
            const pngBlob = new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const item = new ClipboardItem({ 'image/png': pngBlob });
            await navigator.clipboard.write([item]);
            flash(event.currentTarget, 'Copied');
            status.textContent = 'Image copied to the clipboard.';
        } catch {
            flash(event.currentTarget, 'Unavailable');
            status.textContent = 'This browser did not allow image clipboard access. Download the JPG instead.';
        }
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

    const labelShareMedia = event => {
        const media = event.target.closest?.('.otd-entry-media.is-image-ready');
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