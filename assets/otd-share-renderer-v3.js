(() => {
    if (window.__otdShareRendererV3) return;
    window.__otdShareRendererV3 = true;

    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    let currentMedia = null;

    document.addEventListener('click', event => {
        const media = event.target.closest?.('.otd-entry-media');
        if (media?.closest('[data-on-this-day][data-mode="full"]')) currentMedia = media;
    }, true);

    document.addEventListener('keydown', event => {
        if (!['Enter', ' '].includes(event.key)) return;
        const media = event.target.closest?.('.otd-entry-media');
        if (media?.closest('[data-on-this-day][data-mode="full"]')) currentMedia = media;
    }, true);

    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

    function readFormat(canvas) {
        if (canvas.height === 1920) return 'story';
        if (canvas.width === 1200 && canvas.height === 1200) return 'social';
        return 'post';
    }

    function dateFromRow(row) {
        const match = /^otd-(\d{4})(\d{2})(\d{2})-/.exec(row?.id || '');
        if (!match) return null;
        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function entryFromMedia(media) {
        const row = media?.closest('.otd-entry');
        if (!row) return null;
        const date = dateFromRow(row);
        const yearText = clean(row.querySelector('.otd-entry-year')?.textContent);
        const year = Number(yearText) || date?.getFullYear() || 0;
        const yearsAgo = year ? Math.max(0, new Date().getFullYear() - year) : 0;
        const title = clean(row.querySelector('.otd-entry-title')?.textContent) || 'MMA history';
        const promotion = clean(row.querySelector('.otd-promotion')?.textContent);
        const image = media.querySelector('img');
        const imageUrl = media.dataset.lightboxSrc || image?.currentSrc || image?.src || '';
        const dateLabel = date
            ? new Intl.DateTimeFormat([], { month: 'long', day: 'numeric', year: 'numeric' }).format(date)
            : yearText;
        const positionValue = image ? (image.style.objectPosition || getComputedStyle(image).objectPosition || '50% 50%') : '50% 50%';
        const positions = String(positionValue).match(/(-?\d+(?:\.\d+)?)%/g) || [];
        return {
            title, promotion, year, yearsAgo, dateLabel, imageUrl,
            imagePosition: {
                x: positions[0] ? Math.max(0, Math.min(1, Number.parseFloat(positions[0]) / 100)) : 0.5,
                y: positions[1] ? Math.max(0, Math.min(1, Number.parseFloat(positions[1]) / 100)) : 0.5
            }
        };
    }

    async function fetchImage(url) {
        if (!url) return null;
        try {
            const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
            if (!response.ok) return null;
            const blob = await response.blob();
            if ('createImageBitmap' in window) return await createImageBitmap(blob);
            return await new Promise((resolve, reject) => {
                const objectUrl = URL.createObjectURL(blob);
                const image = new Image();
                image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
                image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('decode')); };
                image.src = objectUrl;
            });
        } catch { return null; }
    }

    function drawCover(ctx, image, x, y, width, height, position) {
        const scale = Math.max(width / image.width, height / image.height);
        const dw = image.width * scale;
        const dh = image.height * scale;
        ctx.drawImage(image, x - (dw - width) * position.x, y - (dh - height) * position.y, dw, dh);
    }

    function drawContain(ctx, image, x, y, width, height) {
        const scale = Math.min(width / image.width, height / image.height);
        const dw = image.width * scale;
        const dh = image.height * scale;
        ctx.drawImage(image, x + (width - dw) / 2, y + (height - dh) / 2, dw, dh);
    }

    function seedFor(text) {
        let seed = 2166136261;
        for (const char of String(text || 'mma')) { seed ^= char.charCodeAt(0); seed = Math.imul(seed, 16777619); }
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

    function grain(ctx, w, h, seed) {
        const random = rng(seed ^ 0x7f4a);
        ctx.save();
        for (let i = 0; i < 520; i += 1) {
            const light = random() > 0.55;
            ctx.fillStyle = light
                ? `rgba(247,239,221,${0.018 + random() * 0.045})`
                : `rgba(0,0,0,${0.02 + random() * 0.05})`;
            const size = 0.7 + random() * 2;
            ctx.fillRect(random() * w, random() * h, size, size);
        }
        ctx.restore();
    }

    function roughRect(ctx, x, y, width, height, seed, fill) {
        const random = rng(seed);
        const step = Math.max(32, width / 15);
        ctx.beginPath();
        ctx.moveTo(x, y + (random() - 0.5) * 9);
        for (let px = x + step; px < x + width; px += step) ctx.lineTo(px, y + (random() - 0.5) * 13);
        ctx.lineTo(x + width, y + (random() - 0.5) * 9);
        ctx.lineTo(x + width, y + height + (random() - 0.5) * 10);
        for (let px = x + width - step; px > x; px -= step) ctx.lineTo(px, y + height + (random() - 0.5) * 13);
        ctx.lineTo(x, y + height + (random() - 0.5) * 9);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
    }

    function fitFont(ctx, text, maxWidth, start, min, family = 'Gobold, Impact, sans-serif') {
        let size = start;
        while (size > min) {
            ctx.font = `900 ${Math.round(size)}px ${family}`;
            if (ctx.measureText(text).width <= maxWidth) break;
            size -= 2;
        }
        return size;
    }

    function wrap(ctx, text, maxWidth, maxLines) {
        const words = clean(text).split(' ').filter(Boolean);
        const lines = [];
        let line = '';
        for (const word of words) {
            const next = line ? `${line} ${word}` : word;
            if (!line || ctx.measureText(next).width <= maxWidth) { line = next; continue; }
            lines.push(line);
            line = word;
            if (lines.length >= maxLines - 1) break;
        }
        if (line && lines.length < maxLines) lines.push(line);
        return lines;
    }

    function drawBackdrop(ctx, image, entry, w, h, format, seed) {
        ctx.fillStyle = '#060606';
        ctx.fillRect(0, 0, w, h);
        if (!image) {
            const g = ctx.createRadialGradient(w * 0.62, h * 0.42, 0, w * 0.62, h * 0.42, w * 0.8);
            g.addColorStop(0, '#1b1b1b');
            g.addColorStop(1, '#050505');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = 'rgba(255,255,255,0.045)';
            ctx.font = `900 ${Math.round(w * 0.34)}px Gobold, Impact, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(entry.year || 'MMA'), w / 2, h * 0.48);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            return;
        }

        ctx.save();
        ctx.filter = 'blur(28px) brightness(0.43) saturate(0.68) contrast(1.08)';
        drawCover(ctx, image, -36, -36, w + 72, h + 72, entry.imagePosition);
        ctx.restore();
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(0, 0, w, h);

        const aspect = image.width / image.height;
        if (aspect < 0.78) {
            const top = format === 'story' ? h * 0.035 : h * 0.015;
            const reserve = format === 'story' ? h * 0.075 : h * 0.045;
            const side = w * (format === 'story' ? 0.035 : 0.025);
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.68)';
            ctx.shadowBlur = w * 0.045;
            ctx.shadowOffsetY = w * 0.012;
            ctx.filter = 'contrast(1.07) saturate(0.92) brightness(1.01)';
            drawContain(ctx, image, side, top, w - side * 2, h - top - reserve);
            ctx.restore();
        } else {
            ctx.save();
            ctx.filter = 'contrast(1.08) saturate(0.9) brightness(0.98)';
            drawCover(ctx, image, 0, 0, w, h, entry.imagePosition);
            ctx.restore();
        }

        const vignette = ctx.createLinearGradient(0, 0, 0, h);
        vignette.addColorStop(0, 'rgba(0,0,0,0.58)');
        vignette.addColorStop(0.19, 'rgba(0,0,0,0.03)');
        vignette.addColorStop(0.68, 'rgba(0,0,0,0.02)');
        vignette.addColorStop(1, 'rgba(0,0,0,0.84)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, w, h);
        grain(ctx, w, h, seed);
    }

    function drawAnniversary(ctx, entry, w, h, format, seed) {
        const red = '#d12831';
        const paper = '#f0e7d6';
        const pad = w * (format === 'story' ? 0.06 : 0.052);
        const years = entry.yearsAgo > 0 ? `${entry.yearsAgo} ${entry.yearsAgo === 1 ? 'YEAR' : 'YEARS'}` : 'ON THIS DAY';
        const sub = entry.yearsAgo > 0 ? 'AGO TODAY' : 'IN MMA';
        const boxW = w * (format === 'story' ? 0.74 : 0.69);
        const boxH = h * (format === 'story' ? 0.105 : 0.125);
        roughRect(ctx, pad * 0.45, pad * 0.42, boxW, boxH, seed ^ 0x71b, 'rgba(4,4,4,0.82)');

        const x = pad;
        let y = pad * 0.66;
        ctx.textBaseline = 'top';
        const size = fitFont(ctx, years, boxW - pad * 0.7, w * (format === 'story' ? 0.105 : 0.102), w * 0.067);
        ctx.fillStyle = paper;
        ctx.font = `900 ${Math.round(size)}px Gobold, Impact, sans-serif`;
        ctx.fillText(years, x, y);
        const textW = Math.min(ctx.measureText(years).width, boxW - pad * 0.7);
        ctx.fillStyle = red;
        ctx.fillRect(x - 2, y + size * 0.88, textW, Math.max(8, w * 0.008));
        y += size * 0.94;
        ctx.fillStyle = paper;
        ctx.font = `900 ${Math.round(w * (format === 'story' ? 0.05 : 0.048))}px Gobold, Impact, sans-serif`;
        ctx.fillText(sub, x, y);
    }

    function drawTitle(ctx, entry, w, h, format, seed) {
        const paper = '#f0e7d6';
        const red = '#d12831';
        const pad = w * 0.055;
        const bandH = h * (format === 'story' ? 0.17 : format === 'social' ? 0.23 : 0.195);
        const y = h - bandH - h * 0.025;
        roughRect(ctx, 0, y, w, bandH + h * 0.035, seed ^ 0x2c9, 'rgba(3,3,3,0.92)');
        ctx.fillStyle = red;
        ctx.fillRect(pad, y + bandH * 0.1, w * 0.1, Math.max(7, w * 0.007));

        let ty = y + bandH * 0.18;
        ctx.textBaseline = 'top';
        const titleSize = fitFont(ctx, entry.title.toUpperCase(), w - pad * 2, w * (format === 'story' ? 0.062 : 0.059), w * 0.041);
        ctx.font = `900 ${Math.round(titleSize)}px Gobold, Impact, sans-serif`;
        ctx.fillStyle = paper;
        const lines = wrap(ctx, entry.title.toUpperCase(), w - pad * 2, format === 'story' ? 3 : 2);
        for (const line of lines) { ctx.fillText(line, pad, ty); ty += titleSize * 0.98; }

        const metaY = y + bandH - w * 0.047;
        ctx.font = `700 ${Math.round(w * 0.019)}px "Courier New", monospace`;
        ctx.fillStyle = '#b8ad9d';
        ctx.fillText(entry.dateLabel.toUpperCase(), pad, metaY);
        if (entry.promotion) {
            ctx.fillStyle = red;
            ctx.textAlign = 'right';
            ctx.fillText(entry.promotion.toUpperCase(), w - pad, metaY);
            ctx.textAlign = 'left';
        }
    }

    function drawBrand(ctx, w, h, format) {
        const pad = w * 0.055;
        const y = h - h * 0.017 - w * 0.019;
        ctx.textBaseline = 'top';
        ctx.font = `900 ${Math.round(w * 0.017)}px Gobold, Impact, sans-serif`;
        ctx.fillStyle = 'rgba(240,231,214,0.78)';
        ctx.fillText('MMA MATLOCK', pad, y);
        ctx.font = `700 ${Math.round(w * 0.012)}px "Courier New", monospace`;
        ctx.fillStyle = 'rgba(240,231,214,0.45)';
        ctx.textAlign = 'right';
        ctx.fillText(format === 'story' ? '@MMAMATLOCK' : 'MMAMATLOCK.COM', w - pad, y + 2);
        ctx.textAlign = 'left';
    }

    async function render(canvas) {
        const entry = entryFromMedia(currentMedia);
        if (!entry) return;
        const format = readFormat(canvas);
        const w = canvas.width;
        const h = canvas.height;
        const ctx = canvas.getContext('2d', { alpha: false });
        const seed = seedFor(`${entry.title}|${entry.year}|${format}`);
        const image = await fetchImage(entry.imageUrl);
        drawBackdrop(ctx, image, entry, w, h, format, seed);
        drawAnniversary(ctx, entry, w, h, format, seed);
        drawTitle(ctx, entry, w, h, format, seed);
        drawBrand(ctx, w, h, format);
        ctx.strokeStyle = 'rgba(240,231,214,0.28)';
        ctx.lineWidth = Math.max(3, w * 0.0035);
        ctx.strokeRect(w * 0.01, w * 0.01, w * 0.98, h - w * 0.02);
        image?.close?.();
    }

    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
        if (!this.matches?.('[data-otd-share-canvas]') || !currentMedia) {
            return originalToBlob.call(this, callback, type, quality);
        }
        render(this)
            .catch(() => {})
            .finally(() => originalToBlob.call(this, callback, type, quality));
    };
})();