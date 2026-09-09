import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const OUTPUT_DIR = process.env.OTD_SHARE_OUTPUT_DIR || '.otd-share-cache';
const MANIFEST_PATH = process.env.OTD_SHARE_MANIFEST_PATH || 'assets/data/on-this-day-share-manifest.json';
const PUBLIC_BASE = process.env.OTD_SHARE_PUBLIC_BASE || 'https://raw.githubusercontent.com/MatlockFT/Matlock/otd-share-cache';
const WINDOW_DAYS = Math.max(0, Number(process.env.OTD_SHARE_WINDOW_DAYS || 2));
const MAX_PER_DAY = Math.max(1, Number(process.env.OTD_SHARE_MAX_PER_DAY || 12));
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.OTD_SHARE_CONCURRENCY || 3)));
const USER_AGENT = 'MMA-Matlock-OnThisDay-Share/1.0 (+https://mmamatlock.com/on-this-day/)';

const FORMATS = {
  post: { width: 1080, height: 1350, quality: 86 },
  story: { width: 1080, height: 1920, quality: 86 },
  social: { width: 1200, height: 1200, quality: 86 }
};

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const slug = value => clean(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 90) || 'entry';
const entryAnchor = entry => `otd-${String(entry?.date || '').replace(/-/g, '')}-${slug(entry?.title)}`;
const monthDay = value => String(value || '').slice(5);
const escapeXml = value => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

function hashInt(value) {
  return Number.parseInt(crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 8), 16) >>> 0;
}

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function targetMonthDays(radius) {
  const now = new Date();
  const center = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const days = [];
  for (let offset = -radius; offset <= radius; offset += 1) {
    const date = new Date(center);
    date.setUTCDate(date.getUTCDate() + offset);
    days.push(`${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`);
  }
  return days;
}

function selectEntries(entries) {
  const targets = new Set(targetMonthDays(WINDOW_DAYS));
  const groups = new Map();
  for (const entry of entries) {
    if (!targets.has(monthDay(entry?.date)) || !clean(entry?.title)) continue;
    const key = monthDay(entry.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const picked = [];
  for (const key of targets) {
    const group = groups.get(key) || [];
    group.sort((a, b) =>
      Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)) ||
      Number(b.weight || 0) - Number(a.weight || 0) ||
      String(b.date || '').localeCompare(String(a.date || '')) ||
      String(a.title || '').localeCompare(String(b.title || ''))
    );
    picked.push(...group.slice(0, MAX_PER_DAY));
  }
  return picked;
}

function yearsAgo(entry) {
  const year = Number(String(entry?.date || '').slice(0, 4));
  return year ? Math.max(0, new Date().getUTCFullYear() - year) : 0;
}

function dateLabel(entry) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(entry?.date || ''));
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function wrapApprox(text, maxChars, maxLines = 3) {
  const words = clean(text).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (!line || next.length <= maxChars) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const used = lines.join(' ').split(' ').filter(Boolean).length;
  if (used < words.length && lines.length) {
    lines[lines.length - 1] = `${lines.at(-1).replace(/[\s,.;:-]+$/, '')}…`;
  }
  return lines;
}

function textTspans(lines, x, y, lineHeight) {
  return lines.map((line, index) => `<tspan x="${x}" y="${Math.round(y + index * lineHeight)}">${escapeXml(line)}</tspan>`).join('');
}

function grainSvg(width, height, seed, opacity = 0.055) {
  const random = rng(seed ^ 0x9919a3);
  const count = Math.round((width * height) / 3600);
  let dots = '';
  for (let i = 0; i < count; i += 1) {
    const size = 0.7 + random() * 2.4;
    const alpha = opacity * (0.35 + random() * 0.9);
    const light = random() > 0.56;
    dots += `<rect x="${(random() * width).toFixed(1)}" y="${(random() * height).toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" fill="${light ? '#f3ead8' : '#000'}" opacity="${alpha.toFixed(3)}"/>`;
  }
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${dots}</svg>`;
}

function overlaySvg(entry, formatName, template) {
  const { width: w, height: h } = FORMATS[formatName];
  const age = yearsAgo(entry);
  const anniversary = age > 0 ? `${age} ${age === 1 ? 'YEAR' : 'YEARS'} AGO TODAY` : 'ON THIS DAY';
  const title = clean(entry.title).toUpperCase();
  const promo = clean(entry.promotion).toUpperCase();
  const date = dateLabel(entry).toUpperCase();
  const pad = Math.round(w * 0.055);
  const small = Math.round(w * 0.022);
  const brand = Math.round(w * 0.021);
  const titleSize = Math.round(w * (formatName === 'story' ? 0.067 : formatName === 'social' ? 0.062 : 0.061));
  const titleChars = formatName === 'story' ? 27 : 30;
  const titleLines = wrapApprox(title, titleChars, formatName === 'story' ? 3 : 2);
  const lineHeight = Math.round(titleSize * 0.96);
  const footerHeight = template === 'poster' ? Math.round(h * 0.22) : Math.round(h * (formatName === 'story' ? 0.24 : 0.27));
  const footerY = h - footerHeight;
  const titleY = footerY + Math.round(footerHeight * 0.22);
  const metaY = footerY + footerHeight - Math.round(w * 0.07);
  const kickerY = Math.round(h * 0.045);
  const topBoxWidth = Math.round(w * Math.min(0.78, Math.max(0.46, 0.2 + anniversary.length * 0.018)));

  const titleMarkup = textTspans(titleLines, pad, titleY, lineHeight);
  const posterFooterOpacity = template === 'poster' ? 0.86 : 0.93;

  return `
  <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#050505" stop-opacity="0"/>
        <stop offset="0.35" stop-color="#050505" stop-opacity="0.42"/>
        <stop offset="1" stop-color="#050505" stop-opacity="0.98"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${Math.round(h * 0.52)}" width="${w}" height="${Math.round(h * 0.48)}" fill="url(#bottom)"/>
    <rect x="${pad}" y="${Math.round(kickerY - small * 0.42)}" width="${topBoxWidth}" height="${Math.round(small * 2.15)}" rx="${Math.round(small * 0.36)}" fill="#050505" fill-opacity="0.78"/>
    <rect x="${pad}" y="${Math.round(kickerY + small * 1.24)}" width="${Math.round(topBoxWidth * 0.31)}" height="${Math.max(6, Math.round(w * 0.006))}" fill="#d1252e"/>
    <text x="${Math.round(pad + small * 0.5)}" y="${Math.round(kickerY + small * 0.77)}" fill="#f2ebde" font-family="DejaVu Sans, Arial, sans-serif" font-size="${small}" font-weight="800" letter-spacing="${Math.round(small * 0.06)}">${escapeXml(anniversary)}</text>
    <rect x="0" y="${footerY}" width="${w}" height="${footerHeight}" fill="#060606" fill-opacity="${posterFooterOpacity}"/>
    <rect x="${pad}" y="${Math.round(footerY + footerHeight * 0.12)}" width="${Math.round(w * 0.105)}" height="${Math.max(7, Math.round(w * 0.007))}" fill="#d1252e"/>
    <text fill="#f3ecdf" font-family="DejaVu Sans, Arial, sans-serif" font-size="${titleSize}" font-weight="800">${titleMarkup}</text>
    <text x="${pad}" y="${metaY}" fill="#c3baad" font-family="DejaVu Sans Mono, monospace" font-size="${Math.round(w * 0.0175)}" font-weight="600" letter-spacing="1">${escapeXml(date)}</text>
    ${promo ? `<text x="${w - pad}" y="${metaY}" text-anchor="end" fill="#d1252e" font-family="DejaVu Sans Mono, monospace" font-size="${Math.round(w * 0.0175)}" font-weight="700" letter-spacing="1">${escapeXml(promo)}</text>` : ''}
    <text x="${pad}" y="${h - Math.round(w * 0.024)}" fill="#a79f93" font-family="DejaVu Sans, Arial, sans-serif" font-size="${brand}" font-weight="800" letter-spacing="${Math.round(brand * 0.08)}">MMA MATLOCK</text>
  </svg>`;
}

function noImageSvg(entry, formatName) {
  const { width: w, height: h } = FORMATS[formatName];
  const age = yearsAgo(entry);
  const anniversary = age > 0 ? `${age} ${age === 1 ? 'YEAR' : 'YEARS'} AGO TODAY` : 'ON THIS DAY';
  const year = String(entry?.date || '').slice(0, 4) || 'MMA';
  const title = clean(entry.title).toUpperCase();
  const pad = Math.round(w * 0.07);
  const titleSize = Math.round(w * (formatName === 'story' ? 0.085 : 0.079));
  const lines = wrapApprox(title, formatName === 'story' ? 23 : 25, 4);
  const lineHeight = Math.round(titleSize * 0.96);
  const y = Math.round(h * 0.52 - (lines.length * lineHeight) / 2);
  return `
  <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="g" cx="68%" cy="30%" r="80%"><stop offset="0" stop-color="#262626"/><stop offset="1" stop-color="#060606"/></radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/>
    <text x="${w * 0.5}" y="${h * 0.48}" text-anchor="middle" fill="#fff" fill-opacity="0.055" font-family="DejaVu Sans, Arial, sans-serif" font-size="${Math.round(w * 0.34)}" font-weight="900">${escapeXml(year)}</text>
    <rect x="${pad}" y="${Math.round(h * 0.09)}" width="${Math.round(w * 0.13)}" height="${Math.max(8, Math.round(w * 0.009))}" fill="#d1252e"/>
    <text x="${pad}" y="${Math.round(h * 0.145)}" fill="#f3ecdf" font-family="DejaVu Sans, Arial, sans-serif" font-size="${Math.round(w * 0.046)}" font-weight="800" letter-spacing="2">${escapeXml(anniversary)}</text>
    <text fill="#f3ecdf" font-family="DejaVu Sans, Arial, sans-serif" font-size="${titleSize}" font-weight="900">${textTspans(lines, pad, y, lineHeight)}</text>
    <text x="${pad}" y="${Math.round(h * 0.82)}" fill="#b3aa9d" font-family="DejaVu Sans Mono, monospace" font-size="${Math.round(w * 0.022)}" font-weight="600">${escapeXml(dateLabel(entry).toUpperCase())}</text>
    <text x="${pad}" y="${h - Math.round(w * 0.04)}" fill="#938b80" font-family="DejaVu Sans, Arial, sans-serif" font-size="${Math.round(w * 0.021)}" font-weight="800" letter-spacing="2">MMA MATLOCK</text>
  </svg>`;
}

function sharpPosition(entry) {
  const match = /^(\d{1,3})%\s+(\d{1,3})%$/.exec(String(entry?.imagePosition || ''));
  if (!match) return 'attention';
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (y <= 34) return 'north';
  if (y >= 66) return 'south';
  if (x <= 34) return 'west';
  if (x >= 66) return 'east';
  return 'centre';
}

async function fetchImage(url) {
  if (!/^https:\/\//i.test(String(url || ''))) return null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(25000),
        headers: { 'user-agent': USER_AGENT, accept: 'image/avif,image/webp,image/*,*/*;q=0.8' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const type = response.headers.get('content-type') || '';
      if (!type.startsWith('image/')) throw new Error(`Not an image (${type || 'unknown'})`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 3) {
        console.warn(`Image fetch failed for ${url}: ${error.message}`);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
  return null;
}

async function renderEntry(entry, formatName, imageBuffer) {
  const format = FORMATS[formatName];
  const { width: w, height: h } = format;
  const seed = hashInt(`${entryAnchor(entry)}:${formatName}`);
  if (!imageBuffer) {
    return sharp(Buffer.from(noImageSvg(entry, formatName)))
      .composite([{ input: Buffer.from(grainSvg(w, h, seed, 0.04)), blend: 'soft-light' }])
      .jpeg({ quality: format.quality, mozjpeg: true })
      .toBuffer();
  }

  let metadata;
  try { metadata = await sharp(imageBuffer).rotate().metadata(); }
  catch { metadata = null; }
  const aspect = metadata?.width && metadata?.height ? metadata.width / metadata.height : 1;
  const template = aspect < 0.82 ? 'poster' : 'photo';
  let base;

  if (template === 'poster') {
    const background = await sharp(imageBuffer)
      .rotate()
      .resize(w, h, { fit: 'cover', position: sharpPosition(entry) })
      .blur(Math.max(14, Math.round(w * 0.024)))
      .modulate({ brightness: 0.46, saturation: 0.62 })
      .jpeg({ quality: 88 })
      .toBuffer();
    const maxW = Math.round(w * (formatName === 'story' ? 0.92 : 0.88));
    const maxH = Math.round(h * (formatName === 'story' ? 0.79 : formatName === 'social' ? 0.82 : 0.86));
    const poster = await sharp(imageBuffer)
      .rotate()
      .resize({ width: maxW, height: maxH, fit: 'inside', withoutEnlargement: false })
      .sharpen({ sigma: 0.7 })
      .toBuffer();
    const posterMeta = await sharp(poster).metadata();
    const left = Math.max(0, Math.round((w - posterMeta.width) / 2));
    const top = Math.max(0, Math.round((h - posterMeta.height) / 2 - h * 0.025));
    base = sharp(background).composite([
      { input: Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#000" opacity="0.28"/></svg>`), blend: 'over' },
      { input: poster, left, top, blend: 'over' },
      { input: Buffer.from(overlaySvg(entry, formatName, 'poster')), blend: 'over' },
      { input: Buffer.from(grainSvg(w, h, seed, 0.035)), blend: 'soft-light' }
    ]);
  } else {
    const photo = await sharp(imageBuffer)
      .rotate()
      .resize(w, h, { fit: 'cover', position: sharpPosition(entry) })
      .modulate({ brightness: 0.97, saturation: 0.91 })
      .sharpen({ sigma: 0.75 })
      .jpeg({ quality: 90 })
      .toBuffer();
    base = sharp(photo).composite([
      { input: Buffer.from(overlaySvg(entry, formatName, 'photo')), blend: 'over' },
      { input: Buffer.from(grainSvg(w, h, seed, 0.028)), blend: 'soft-light' }
    ]);
  }

  return base.jpeg({ quality: format.quality, mozjpeg: true }).toBuffer();
}

async function mapLimit(items, limit, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await worker(items[current], current);
    }
  });
  await Promise.all(workers);
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const entries = selectEntries(Array.isArray(history?.entries) ? history.entries : []);
const generatedAt = new Date().toISOString();
const versionToken = generatedAt.replace(/[^0-9]/g, '').slice(0, 14);

await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
await fs.mkdir(OUTPUT_DIR, { recursive: true });
await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });

const imageCache = new Map();
const manifest = {
  version: 1,
  renderer: 'sharp-svg-archive-v1',
  generatedAt,
  publicBase: PUBLIC_BASE,
  windowDays: WINDOW_DAYS,
  maxPerDay: MAX_PER_DAY,
  formats: Object.fromEntries(Object.entries(FORMATS).map(([name, cfg]) => [name, { width: cfg.width, height: cfg.height }])),
  entries: {}
};

await mapLimit(entries, CONCURRENCY, async entry => {
  const id = entryAnchor(entry);
  let imageBuffer = null;
  if (entry.imageUrl) {
    if (!imageCache.has(entry.imageUrl)) imageCache.set(entry.imageUrl, fetchImage(entry.imageUrl));
    imageBuffer = await imageCache.get(entry.imageUrl);
  }

  let template = 'type';
  if (imageBuffer) {
    try {
      const meta = await sharp(imageBuffer).rotate().metadata();
      template = meta?.width && meta?.height && meta.width / meta.height < 0.82 ? 'poster' : 'photo';
    } catch {}
  }

  const record = {
    id,
    date: entry.date,
    title: entry.title,
    template,
    formats: {}
  };

  for (const formatName of Object.keys(FORMATS)) {
    const fileName = `${id}-${formatName}.jpg`;
    const buffer = await renderEntry(entry, formatName, imageBuffer);
    const renderedMeta = await sharp(buffer).metadata();
    const expected = FORMATS[formatName];
    if (renderedMeta.width !== expected.width || renderedMeta.height !== expected.height) {
      throw new Error(`${id} ${formatName}: rendered ${renderedMeta.width}x${renderedMeta.height}, expected ${expected.width}x${expected.height}`);
    }
    await fs.writeFile(path.join(OUTPUT_DIR, fileName), buffer);
    record.formats[formatName] = `${PUBLIC_BASE}/${encodeURIComponent(fileName)}?v=${versionToken}`;
  }
  manifest.entries[id] = record;
  console.log(`Rendered ${id} (${template})`);
});

await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`On This Day share renderer: ${entries.length} entries, ${entries.length * Object.keys(FORMATS).length} images, ${targetMonthDays(WINDOW_DAYS).join(', ')}.`);
