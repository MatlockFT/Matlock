(() => {
    const widget = document.querySelector('[data-on-this-day][data-mode="full"]');
    const list = widget?.querySelector('[data-otd-list]');
    if (!widget || !list || widget.dataset.otdShareV2Booted === '1') return;
    widget.dataset.otdShareV2Booted = '1';

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
        const imageCredit = media.dataset.lightboxCredit || clean(media.querySelector('.otd-media-credit')?.textContent);
        const link = (() => {
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
            row, media, title, promotion, detail, imageUrl, imageCredit,
            imagePosition: imagePositionFromMedia(media), link, year, yearsAgo,
            headline, dateLabel, caption
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
                        <div class="otd-share-preview-meta"><strong data-otd-share-format-label></strong><span data-otd-share-output-size></span></div>
                        <div class="otd-share-preview-wrap"><canvas class="otd-share-preview" data-otd-share-canvas aria-label="Generated social share card preview"></canvas></div>
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
            </div>`;
        document.body.append(modal);

        canvas = modal.querySelector('[data-otd-share-canvas]');
        status = modal.querySelector('[data-otd-share-status]');
        formatButtons = [...modal.querySelectorAll('[data-otd-share-format]')];
        cardActionButtons = [...modal.querySelectorAll('[data-otd-requires-card]')];
        if (!canCopyImage) modal.querySelector('[data-otd-share-image]')?.remove();

        modal.querySelector('[data-otd-share-close]').addEventListener('click', closeModal);
        modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
        formatButtons.forEach(button => button.addEventListener('click', () => {
            const next = button.dataset.otdShareFormat;
            if (!FORMATS[next] || next === activeFormat) return;
            activeFormat = next;
            saveFormat(next);
            syncModalState();
            renderCard();
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
        modal.addEventListener('keydown', trapFocus);
    }

    function flash(button, label) {
        const original = button.dataset.defaultText || button.textContent;
        button.dataset.defaultText = original;
        button.textContent = label;
        clearTimeout(Number(button.dataset.resetTimer || 0));
        const timer = setTimeout(() => { button.textContent = original; delete button.dataset.resetTimer; }, 1300);
        button.dataset.resetTimer = String(timer);
    }

    function trapFocus(event) {
        if (event.key !== 'Tab' || modal?.hidden) return;
        const focusable = [...modal.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
            .filter(node => !node.hidden && node.getClientRects().length);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    function canShareFile(file = renderedFile) {
        if (!navigator.share || !file) return false;
        if (!navigator.canShare) return true;
        try { return navigator.canShare({ files: [file] }); } catch { return false; }
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
            ? 'Caption copied first, then the finished image goes to your phone’s share sheet.'
            : activeFormat === 'story'
                ? 'For Stories on desktop: download the 9:16 JPG, send it to your phone, then post it in Instagram.'
                : 'Downloads the finished JPG, copies the caption, and opens Instagram web.';
    }

    function setCardActionsEnabled(enabled) { for (const button of cardActionButtons) button.disabled = !enabled; }

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

    function wrapLines(ctx, text, maxWidth, maxLines = 3) {
        const words = clean(text).split(' ').filter(Boolean);
        const lines = [];
        let line = '';
        let used = 0;
        for (const word of words) {
            const candidate = line ? `${line} ${word}` : word;
            if (ctx.measureText(candidate).width <= maxWidth || !line) { line = candidate; used += 1; continue; }
            lines.push(line);
            if (lines.length === maxLines - 1) { line = word; used += 1; break; }
            line = word;
            used += 1;
        }
        if (line && lines.length < maxLines) lines.push(line);
        if (used < words.length && lines.length) {
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
        } catch { return null; }
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
        const dw = image.width * scale;
        const dh = image.height * scale;
        ctx.drawImage(image, x - (dw - width) * position.x, y - (dh - height) * position.y, dw, dh);
    }

    function drawImageContain(ctx, image, x, y, width, height) {
        const scale = Math.min(width / image.width, height / image.height);
        const dw = image.width * scale;
        const dh = image.height * scale;
        ctx.drawImage(image, x + (width - dw) / 2, y + (height - dh) / 2, dw, dh);
    }

    function seedFor(text) {
        let seed = 2166136261;
        for (const ch of String(text || 'mma')) { seed ^= ch.charCodeAt(0); seed = Math.imul(seed, 16777619); }
        return seed >>> 0;
    }

    function rng(seed) {
        let s = seed >>> 0;
        return () => {
            s += 0x6D2B79F5;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function jaggedPanel(ctx, x, y, width, height, seed, fill) {
        const random = rng(seed);
        const step = Math.max(22, Math.round(width / 18));
        ctx.beginPath();
        ctx.moveTo(x, y + (random() - 0.5) * 12);
        for (let px = x + step; px < x + width; px += step) ctx.lineTo(px, y + (random() - 0.5) * 18);
        ctx.lineTo(x + width, y + (random() - 0.5) * 12);
        ctx.lineTo(x + width, y + height + (random() - 0.5) * 14);
        for (let px = x + width - step; px > x; px -= step) ctx.lineTo(px, y + height + (random() - 0.5) * 18);
        ctx.lineTo(x, y + height + (random() - 0.5) * 12);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
    }

    function addPhotocopyTexture(ctx, w, h, seed, strength = 1) {
        const random = rng(seed ^ 0x9e3779b9);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (let i = 0; i < Math.round(1400 * strength); i += 1) {
            const a = 0.025 + random() * 0.07;
            ctx.fillStyle = `rgba(255,245,220,${a})`;
            const size = 0.5 + random() * 2.2;
            ctx.fillRect(random() * w, random() * h, size, size);
        }
        ctx.globalCompositeOperation = 'multiply';
        for (let i = 0; i < Math.round(850 * strength); i += 1) {
            ctx.fillStyle = `rgba(0,0,0,${0.03 + random() * 0.09})`;
            const size = 0.6 + random() * 2.7;
            ctx.fillRect(random() * w, random() * h, size, size);
        }
        ctx.globalAlpha = 0.17 * strength;
        ctx.strokeStyle = '#f1e7cf';
        ctx.lineWidth = 1;
        for (let i = 0; i < Math.round(24 * strength); i += 1) {
            const y = random() * h;
            ctx.beginPath();
            ctx.moveTo(random() * w * 0.22, y);
            ctx.lineTo(w - random() * w * 0.12, y + (random() - 0.5) * 4);
            ctx.stroke();
        }
        ctx.restore();
    }

    function addHalftone(ctx, x, y, width, height, seed) {
        const random = rng(seed ^ 0x51f15e);
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        const step = Math.max(10, Math.round(width / 85));
        for (let yy = y + step / 2; yy < y + height; yy += step) {
            for (let xx = x + step / 2; xx < x + width; xx += step) {
                if (random() < 0.42) continue;
                ctx.beginPath();
                ctx.arc(xx, yy, 0.7 + random() * 1.25, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    function drawImageZone(ctx, image, entry, x, y, width, height, seed) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.clip();
        ctx.fillStyle = '#090909';
        ctx.fillRect(x, y, width, height);

        const aspect = image ? image.width / image.height : 1;
        if (image) {
            if (aspect < 0.78) {
                ctx.save();
                ctx.filter = 'grayscale(1) contrast(1.55) brightness(0.58) blur(12px)';
                drawImageCover(ctx, image, x - 12, y - 12, width + 24, height + 24, entry.imagePosition);
                ctx.restore();
                ctx.fillStyle = 'rgba(0,0,0,0.34)';
                ctx.fillRect(x, y, width, height);
                ctx.save();
                ctx.filter = 'grayscale(1) contrast(1.28) brightness(0.96)';
                const inset = Math.round(width * 0.035);
                drawImageContain(ctx, image, x + inset, y + inset, width - inset * 2, height - inset * 2);
                ctx.restore();
            } else {
                ctx.save();
                ctx.filter = 'grayscale(1) contrast(1.42) brightness(0.92)';
                drawImageCover(ctx, image, x, y, width, height, entry.imagePosition);
                ctx.restore();
            }
            addHalftone(ctx, x, y, width, height, seed);
            const grad = ctx.createLinearGradient(0, y, 0, y + height);
            grad.addColorStop(0, 'rgba(0,0,0,0.03)');
            grad.addColorStop(0.74, 'rgba(0,0,0,0.08)');
            grad.addColorStop(1, 'rgba(0,0,0,0.48)');
            ctx.fillStyle = grad;
            ctx.fillRect(x, y, width, height);
        } else {
            ctx.fillStyle = '#111';
            ctx.fillRect(x, y, width, height);
            ctx.font = `900 ${Math.round(width * 0.26)}px Gobold, Impact, sans-serif`;
            ctx.fillStyle = '#292929';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(entry.year || 'MMA'), x + width / 2, y + height / 2);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
        }
        ctx.restore();
    }

    function drawHeadline(ctx, entry, w, x, y, width, seed, story = false) {
        const red = '#c9272e';
        const paper = '#eee6d6';
        const years = entry.yearsAgo > 0 ? `${entry.yearsAgo} ${entry.yearsAgo === 1 ? 'YEAR' : 'YEARS'}` : 'ON THIS DAY';
        const firstSize = Math.round(w * (story ? 0.112 : 0.105));
        const secondSize = Math.round(w * (story ? 0.082 : 0.078));
        ctx.textBaseline = 'top';
        ctx.font = `900 ${firstSize}px Gobold, Impact, sans-serif`;
        ctx.fillStyle = paper;
        ctx.fillText(years, x, y);
        const firstWidth = Math.min(width, ctx.measureText(years).width);
        ctx.fillStyle = red;
        ctx.fillRect(x - 4, y + firstSize * 0.88, Math.max(firstWidth * 0.96, width * 0.38), Math.max(9, Math.round(w * 0.012)));
        ctx.font = `900 ${secondSize}px Gobold, Impact, sans-serif`;
        ctx.fillStyle = paper;
        ctx.fillText(entry.yearsAgo > 0 ? 'AGO TODAY' : 'IN MMA', x, y + firstSize * 0.97);

        const random = rng(seed ^ 0xabc123);
        ctx.save();
        ctx.globalAlpha = 0.2;
        ctx.strokeStyle = paper;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + width * 0.62, y + firstSize * 0.22);
        ctx.lineTo(x + width * (0.92 + random() * 0.05), y + firstSize * 0.22 + (random() - 0.5) * 8);
        ctx.stroke();
        ctx.restore();
    }

    function drawTitleBlock(ctx, entry, w, h, x, y, width, height, seed, story = false) {
        const paper = '#ece2d0';
        const black = '#090909';
        const red = '#c9272e';
        jaggedPanel(ctx, x, y, width, height, seed ^ 0x7129, paper);

        const accentH = Math.max(18, Math.round(h * 0.016));
        jaggedPanel(ctx, x - Math.round(width * 0.02), y + Math.round(height * 0.58), width * 0.92, accentH, seed ^ 0x4391, red);

        const padX = Math.round(width * 0.052);
        let ty = y + Math.round(height * 0.12);
        ctx.fillStyle = black;
        ctx.textBaseline = 'top';
        ctx.font = `900 ${Math.round(w * (story ? 0.052 : 0.049))}px Gobold, Impact, sans-serif`;
        const lines = wrapLines(ctx, entry.title.toUpperCase(), width - padX * 2, story ? 3 : 2);
        const lineHeight = Math.round(w * (story ? 0.055 : 0.052));
        for (const line of lines) { ctx.fillText(line, x + padX, ty); ty += lineHeight; }

        const metaY = y + height - Math.round(height * 0.2);
        ctx.font = `700 ${Math.round(w * 0.019)}px "Courier New", monospace`;
        ctx.fillStyle = '#3b3b3b';
        ctx.fillText(entry.dateLabel, x + padX, metaY);
        if (entry.promotion) {
            ctx.textAlign = 'right';
            ctx.fillStyle = red;
            ctx.fillText(entry.promotion.toUpperCase(), x + width - padX, metaY);
            ctx.textAlign = 'left';
        }
    }

    function drawFooter(ctx, w, h, pad) {
        const paper = '#eee6d6';
        const red = '#c9272e';
        const y = h - Math.round(pad * 0.72);
        ctx.fillStyle = red;
        ctx.fillRect(pad, y - Math.round(w * 0.012), Math.round(w * 0.052), 5);
        ctx.font = `900 ${Math.round(w * 0.024)}px Gobold, Impact, sans-serif`;
        ctx.fillStyle = paper;
        ctx.textBaseline = 'top';
        ctx.fillText('MMA MATLOCK', pad + Math.round(w * 0.064), y - Math.round(w * 0.026));
        ctx.font = `700 ${Math.round(w * 0.014)}px "Courier New", monospace`;
        ctx.fillStyle = '#8c8478';
        ctx.textAlign = 'right';
        ctx.fillText('ON THIS DAY IN MMA', w - pad, y - Math.round(w * 0.019));
        ctx.textAlign = 'left';
    }

    function drawPost(ctx, config, entry, bitmap, seed) {
        const { width: w, height: h } = config;
        const pad = Math.round(w * 0.048);
        ctx.fillStyle = '#080808'; ctx.fillRect(0, 0, w, h);
        drawHeadline(ctx, entry, w, pad, Math.round(h * 0.035), w - pad * 2, seed, false);
        const imageY = Math.round(h * 0.19);
        const imageH = Math.round(h * 0.59);
        drawImageZone(ctx, bitmap, entry, 0, imageY, w, imageH, seed);
        const titleY = Math.round(h * 0.705);
        const titleH = Math.round(h * 0.205);
        drawTitleBlock(ctx, entry, w, h, pad * 0.6, titleY, w - pad * 1.2, titleH, seed, false);
        drawFooter(ctx, w, h, pad);
        addPhotocopyTexture(ctx, w, h, seed, 1);
    }

    function drawStory(ctx, config, entry, bitmap, seed) {
        const { width: w, height: h } = config;
        const pad = Math.round(w * 0.055);
        ctx.fillStyle = '#080808'; ctx.fillRect(0, 0, w, h);
        const imageY = Math.round(h * 0.12);
        const imageH = Math.round(h * 0.62);
        drawImageZone(ctx, bitmap, entry, 0, imageY, w, imageH, seed);
        drawHeadline(ctx, entry, w, pad, Math.round(h * 0.035), w - pad * 2, seed, true);
        const titleY = Math.round(h * 0.69);
        const titleH = Math.round(h * 0.205);
        drawTitleBlock(ctx, entry, w, h, pad * 0.55, titleY, w - pad * 1.1, titleH, seed, true);
        drawFooter(ctx, w, h, pad);
        addPhotocopyTexture(ctx, w, h, seed, 1.12);
    }

    function drawSquare(ctx, config, entry, bitmap, seed) {
        const { width: w, height: h } = config;
        const pad = Math.round(w * 0.045);
        ctx.fillStyle = '#080808'; ctx.fillRect(0, 0, w, h);
        drawHeadline(ctx, entry, w, pad, Math.round(h * 0.035), w - pad * 2, seed, false);
        const imageY = Math.round(h * 0.205);
        const imageH = Math.round(h * 0.55);
        drawImageZone(ctx, bitmap, entry, 0, imageY, w, imageH, seed);
        const titleY = Math.round(h * 0.695);
        const titleH = Math.round(h * 0.205);
        drawTitleBlock(ctx, entry, w, h, pad * 0.55, titleY, w - pad * 1.1, titleH, seed, false);
        drawFooter(ctx, w, h, pad);
        addPhotocopyTexture(ctx, w, h, seed, 0.95);
    }

    function drawCard(ctx, config, entry, bitmap) {
        const seed = seedFor(`${entry.title}|${entry.year}|${activeFormat}`);
        if (activeFormat === 'story') drawStory(ctx, config, entry, bitmap, seed);
        else if (activeFormat === 'social') drawSquare(ctx, config, entry, bitmap, seed);
        else drawPost(ctx, config, entry, bitmap, seed);
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
        drawCard(ctx, config, activeEntry, bitmap);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
        if (token !== renderToken || !activeEntry) return;
        if (!blob) { status.textContent = 'Could not build the share image.'; return; }
        renderedBlob = blob;
        const base = clean(activeEntry.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55) || 'on-this-day';
        renderedFile = new File([blob], `${base}-${activeFormat}.jpg`, { type: 'image/jpeg' });
        setCardActionsEnabled(true);
        syncModalState();
        status.textContent = !bitmap && activeEntry.imageUrl
            ? 'Ready. This source blocks cross-site export, so the share card uses the typography fallback.'
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
            } catch (error) { if (error?.name === 'AbortError') return; }
        }
        triggerDownload();
        if (event?.currentTarget) flash(event.currentTarget, 'Saved');
        status.textContent = 'JPG downloaded and caption copied.';
    }

    async function shareToInstagram(event) {
        if (!activeEntry) return;
        const likelyNative = isTouchLike && navigator.share;
        const instagramTab = likelyNative ? null : window.open('about:blank', '_blank');
        if (!(await ensureRendered())) { instagramTab?.close?.(); return; }
        try { await copyText(activeEntry.caption); } catch {}
        if (canShareFile()) {
            try {
                await navigator.share({ files: [renderedFile] });
                if (event?.currentTarget) flash(event.currentTarget, 'Choose Instagram');
                status.textContent = 'Caption copied. Choose Instagram in the share sheet, then paste the caption.';
                return;
            } catch (error) { if (error?.name === 'AbortError') return; }
        }
        triggerDownload();
        if (instagramTab) instagramTab.location.href = 'https://www.instagram.com/';
        else window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
        if (event?.currentTarget) flash(event.currentTarget, 'Prepared');
        status.textContent = activeFormat === 'story'
            ? 'Story JPG downloaded and caption copied. Send it to your phone for the cleanest Story workflow.'
            : 'JPG downloaded and caption copied. Instagram opened; upload the file and paste the caption.';
    }

    async function copyImage(event) {
        if (!canCopyImage || !activeEntry || !(await ensureRendered())) return;
        try {
            const pngBlob = new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
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
