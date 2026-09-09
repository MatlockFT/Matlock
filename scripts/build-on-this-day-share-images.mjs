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
const USER_AGENT = 'MMA-Matlock-OnThisDay-Share/2.1 (+https://mmamatlock.com/on-this-day/)';

const FORMATS = {
  post: { width: 1080, height: 1350, quality: 88 },
  story: { width: 1080, height: 1920, quality: 88 },
  social: { width: 1200, height: 1200, quality: 88 }
};

const INK = '#090909';
const PAPER = '#eee5d2';
const PAPER_DARK = '#d8cdb7';
const RED = '#d51f2b';

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
    if (!line || next.length <= maxChars) { line = next; continue; }
    lines.push(line);
    line = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const used = lines.join(' ').split(' ').filter(Boolean).length;
  if (used < words.length && lines.length) lines[lines.length - 1] = `${lines.at(-1).replace(/[\s,.;:-]+$/, '')}…`;
  return lines;
}

function textTspans(lines, x, y, lineHeight) {
  return lines.map((line, index) => `<tspan x="${x}" y="${Math.round(y + index * lineHeight)}">${escapeXml(line)}</tspan>`).join('');
}

function roughPolygon(x, y, width, height, seed, jitter = 10, points = 10) {
  const random = rng(seed);
  const coords = [];
  coords.push([x, y + (random() - 0.5) * jitter]);
  for (let i = 1; i < points; i += 1) coords.push([x + width * i / points, y + (random() - 0.5) * jitter]);
  coords.push([x + width, y + (random() - 0.5) * jitter]);
  for (let i = 1; i < points; i += 1) coords.push([x + width + (random() - 0.5) * jitter, y + height * i / points]);
  coords.push([x + width + (random() - 0.5) * jitter, y + height]);
  for (let i = points - 1; i > 0; i -= 1) coords.push([x + width * i / points, y + height + (random() - 0.5) * jitter]);
  coords.push([x, y + height + (random() - 0.5) * jitter]);
  for (let i = points - 1; i > 0; i -= 1) coords.push([x + (random() - 0.5) * jitter, y + height * i / points]);
  return coords.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
}

function paperTextureSvg(width, height, seed, intensity = 1) {
  const random = rng(seed ^ 0x6a09e667);
  let marks = '';
  const specks = Math.round((width * height) / 3900 * intensity);
  for (let i = 0; i < specks; i += 1) {
    const dark = random() > 0.42;
    const size = 0.6 + random() * 4.4;
    const alpha = 0.025 + random() * 0.11;
    marks += `<ellipse cx="${(random() * width).toFixed(1)}" cy="${(random() * height).toFixed(1)}" rx="${size.toFixed(1)}" ry="${(size * (0.25 + random())).toFixed(1)}" fill="${dark ? '#000' : '#fff'}" opacity="${alpha.toFixed(3)}"/>`;
  }
  for (let i = 0; i < Math.round(34 * intensity); i += 1) {
    const y = random() * height;
    const x = random() * width * 0.8;
    const len = width * (0.04 + random() * 0.26);
    marks += `<path d="M ${x.toFixed(1)} ${y.toFixed(1)} l ${len.toFixed(1)} ${(random() * 3 - 1.5).toFixed(1)}" stroke="${random() > 0.5 ? '#fff' : '#000'}" stroke-width="${(0.5 + random() * 2).toFixed(1)}" opacity="${(0.03 + random() * 0.08).toFixed(3)}"/>`;
  }
  for (let i = 0; i < 9; i += 1) {
    const y = random() * height;
    marks += `<rect x="0" y="${y.toFixed(1)}" width="${width}" height="${(0.7 + random() * 2.2).toFixed(1)}" fill="#000" opacity="${(0.014 + random() * 0.03).toFixed(3)}"/>`;
  }
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${marks}</svg>`;
}

function halftoneSvg(width, height, opacity = 0.11, step = 9) {
  const r = Math.max(0.8, step * 0.18);
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="dots" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><circle cx="${step / 2}" cy="${step / 2}" r="${r}" fill="#000" opacity="${opacity}"/></pattern></defs><rect width="${width}" height="${height}" fill="url(#dots)"/></svg>`;
}

function zineBorderSvg(width, height, seed, inset = 20) {
  const outer = roughPolygon(inset, inset, width - inset * 2, height - inset * 2, seed, 12, 20);
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><polygon points="${outer}" fill="none" stroke="${PAPER}" stroke-width="8"/></svg>`;
}

function anniversaryStickerSvg(entry, width, height, seed, compact = false) {
  const age = yearsAgo(entry);
  const words = age > 0 ? `${age === 1 ? 'YEAR' : 'YEARS'} AGO TODAY` : 'ON THIS DAY';
  const x = Math.round(width * 0.045);
  const y = Math.round(height * 0.032);
  const numberW = Math.round(width * (compact ? 0.11 : 0.13));
  const stripW = Math.round(width * (compact ? 0.51 : 0.56));
  const h = Math.round(width * (compact ? 0.088 : 0.097));
  const numberPoly = roughPolygon(x, y, numberW, h, seed ^ 0x5142, 8, 9);
  const stripX = x + numberW - Math.round(width * 0.012);
  const stripPoly = roughPolygon(stripX, y + Math.round(width * 0.012), stripW, h - Math.round(width * 0.018), seed, 8, 11);
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(-1.4 ${x + (numberW + stripW) / 2} ${y + h / 2})">
      <polygon points="${numberPoly}" fill="${RED}"/>
      <polygon points="${stripPoly}" fill="${INK}"/>
      ${age > 0 ? `<text x="${x + numberW / 2}" y="${y + h * 0.77}" text-anchor="middle" fill="${PAPER}" font-family="DejaVu Sans Condensed, DejaVu Sans, sans-serif" font-size="${Math.round(h * 0.76)}" font-weight="900">${age}</text>` : ''}
      <text x="${stripX + Math.round(width * 0.027)}" y="${y + h * 0.67}" fill="${PAPER}" font-family="DejaVu Sans Condensed, DejaVu Sans, sans-serif" font-size="${Math.round(h * 0.38)}" font-weight="900" letter-spacing="1">${escapeXml(words)}</text>
    </g>
  </svg>`;
}

function posterCaptionSvg(entry, formatName, seed) {
  const { width: w, height: h } = FORMATS[formatName];
  const pad = Math.round(w * 0.045);
  const title = clean(entry.title).toUpperCase();
  const date = dateLabel(entry).toUpperCase();
  const promo = clean(entry.promotion).toUpperCase();
  const lines = wrapApprox(title, formatName === 'social' ? 34 : 40, 2);
  const titleSize = Math.round(w * (formatName === 'story' ? 0.038 : 0.041));
  const lineHeight = Math.round(titleSize * 0.94);
  const stripH = Math.round(lineHeight * lines.length + w * 0.045);
  const stripY = h - stripH - Math.round(w * 0.09);
  const stripW = Math.round(w * 0.88);
  const poly = roughPolygon(pad, stripY, stripW, stripH, seed ^ 0x7712, 10, 12);
  const metaY = h - Math.round(w * 0.048);
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(-0.8 ${w / 2} ${stripY + stripH / 2})">
      <polygon points="${poly}" fill="${RED}"/>
      <text fill="${INK}" font-family="DejaVu Sans Condensed, DejaVu Sans, sans-serif" font-size="${titleSize}" font-weight="900">${textTspans(lines, pad + Math.round(w * 0.025), stripY + Math.round(w * 0.055), lineHeight)}</text>
    </g>
    <text x="${pad}" y="${metaY}" fill="${PAPER}" font-family="DejaVu Sans Mono, monospace" font-size="${Math.round(w * 0.017)}" font-weight="700" letter-spacing="1">${escapeXml(date)}</text>
    ${promo ? `<text x="${w - pad}" y="${metaY}" text-anchor="end" fill="${RED}" font-family="DejaVu Sans Mono, monospace" font-size="${Math.round(w * 0.017)}" font-weight="700">${escapeXml(promo)}</text>` : ''}
    <text x="${w - pad}" y="${Math.round(w * 0.052)}" text-anchor="end" fill="${PAPER}" font-family="DejaVu Sans Mono, monospace" font-size="${Math.round(w * 0.016)}" font-weight="700" letter-spacing="2">MMA MATLOCK</text>
  </svg>`;
}

function photoOverlaySvg(entry, formatName, seed) {
  const { width: w, height: h } = FORMATS[formatName];
  const pad = Math.round(w * 0.05);
  const title = clean(entry.title).toUpperCase();
  const date = dateLabel(entry).toUpperCase();
  const lines = wrapApprox(title, formatName === 'story' ? 24 : 28, 3);
  const titleSize = Math.round(w * (formatName === 'story' ? 0.058 : 0.055));
  const lineHeight = Math.round(titleSize * 0.96);
  const stripH = Math.round(lineHeight * lines.length + w * 0.065);
  const y = h - stripH - Math.round(w * 0.07);
  const stripW = Math.round(w * 0.88);
  const paperPoly = roughPolygon(pad, y, stripW, stripH, seed ^ 0x2201, 13, 14);
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <polygon points="${paperPoly}" fill="${PAPER}"/>
    <text fill="${INK}" font-family="DejaVu Sans Condensed, DejaVu Sans, sans-serif" font-size="${titleSize}" font-weight="900">${textTspans(lines, pad + Math.round(w * 0.028), y + Math.round(w * 0.065), lineHeight)}</text>
    <polygon points="${roughPolygon(pad + Math.round(w * 0.02), y + stripH - Math.round(w * 0.03), Math.round(stripW * 0.38), Math.round(w * 0.022), seed ^ 0x8881, 4, 7)}" fill="${RED}"/>
    <text x="${pad}" y="${h - Math.round(w * 0.03)}" fill="${PAPER}" font-family="DejaVu Sans Mono, monospace" font-size="${Math.round(w * 0.017)}" font-weight="700">${escapeXml(date)}</text>
    <text x="${w - pad}" y="${h - Math.round(w * 0.03)}" text-anchor="end" fill="${RED}" font-family="DejaVu Sans Mono, monospace" font-size="${Math.round(w * 0.017)}" font-weight="700">MMA MATLOCK</text>
  </svg>`;
}

function noImageSvg(entry, formatName, seed) {
  const { width: w, height: h } = FORMATS[formatName];
  const age = yearsAgo(entry);
  const anniversary = age > 0 ? `${age} ${age === 1 ? 'YEAR' : 'YEARS'} AGO TODAY` : 'ON THIS DAY';
  const year = String(entry?.date || '').slice(0, 4) || 'MMA';
  const title = clean(entry.title).toUpperCase();
  const lines = wrapApprox(title, formatName === 'story' ? 16 : 19, 4);
  const pad = Math.round(w * 0.06);
  const titleSize = Math.round(w * (formatName === 'story' ? 0.088 : 0.082));
  const lineHeight = Math.round(titleSize * 0.96);
  const startY = Math.round(h * 0.34);
  const random = rng(seed ^ 0x4488);
  let strips = '';
  lines.forEach((line, i) => {
    const y = startY + i * Math.round(lineHeight * 1.18);
    const fill = i % 3 === 1 ? RED : PAPER;
    const textFill = fill === RED ? INK : INK;
    const x = pad + Math.round((random() - 0.5) * w * 0.035);
    const stripW = Math.round(w * (0.78 + random() * 0.13));
    const stripH = Math.round(lineHeight * 1.04);
    strips += `<g transform="rotate(${(-2.1 + random() * 4.2).toFixed(2)} ${w / 2} ${y})"><polygon points="${roughPolygon(x, y - stripH * 0.73, stripW, stripH, seed ^ (0x1111 + i * 771), 12, 12)}" fill="${fill}"/><text x="${x + Math.round(w * 0.025)}" y="${y}" fill="${textFill}" font-family="DejaVu Sans Condensed, DejaVu Sans, sans-serif" font-size="${titleSize}" font-weight="900">${escapeXml(line)}</text></g>`;
  });
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="${INK}"/>
    <text x="${Math.round(w * 0.53)}" y="${Math.round(h * 0.55)}" text-anchor="middle" fill="${PAPER}" opacity="0.055" font-family="DejaVu Sans Condensed, DejaVu Sans, sans-serif" font-size="${Math.round(w * 0.42)}" font-weight="900" transform="rotate(-7 ${w * 0.53} ${h * 0.55})">${escapeXml(year)}</text>
    <polygon points="${roughPolygon(-Math.round(w * 0.08), Math.round(h * 0.12), Math.round(w * 0.82), Math.round(w * 0.09), seed ^ 0x1177, 9, 11)}" fill="${RED}"/>
    <text x="${pad}" y="${Math.round(h * 0.12 + w * 0.061)}" fill="${INK}" font-family="DejaVu Sans Condensed, DejaVu Sans, sans-serif" font-size="${Math.round(w * 0.042)}" font-weight="900">${escapeXml(anniversary)}</text>
    ${strips}
    <polygon points="${roughPolygon(Math.round(w * 0.58), Math.round(h * 0.74), Math.round(w * 0.38), Math.round(w * 0.08), seed ^ 0x9991, 8, 9)}" fill="${PAPER}"/>
    <text x="${Math.round(w * 0.61)}" y="${Math.round(h * 0.74 + w * 0.055)}" fill="${INK}" font-family="DejaVu Sans Mono, monospace" font-size="${Math.round(w * 0.022)}" font-weight="700">${escapeXml(dateLabel(entry).toUpperCase())}</text>
    <text x="${pad}" y="${h - Math.round(w * 0.05)}" fill="${PAPER}" font-family="DejaVu Sans Mono, monospace" font-size="${Math.round(w * 0.021)}" font-weight="700" letter-spacing="2">MMA MATLOCK</text>
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

async function photocopyImage(imageBuffer, width, height, fit, position) {
  return sharp(imageBuffer)
    .rotate()
    .resize(width, height, { fit, position, withoutEnlargement: false })
    .greyscale()
    .normalize()
    .linear(1.19, -10)
    .modulate({ brightness: 1.03 })
    .sharpen({ sigma: 0.9 })
    .tint(PAPER)
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function renderEntry(entry, formatName, imageBuffer) {
  const format = FORMATS[formatName];
  const { width: w, height: h } = format;
  const seed = hashInt(`${entryAnchor(entry)}:${formatName}:zine-v3`);

  if (!imageBuffer) {
    return sharp(Buffer.from(noImageSvg(entry, formatName, seed)))
      .composite([{ input: Buffer.from(paperTextureSvg(w, h, seed, 1.45)), blend: 'soft-light' }])
      .jpeg({ quality: format.quality, mozjpeg: true })
      .toBuffer();
  }

  let metadata;
  try { metadata = await sharp(imageBuffer).rotate().metadata(); }
  catch { metadata = null; }
  const aspect = metadata?.width && metadata?.height ? metadata.width / metadata.height : 1;
  const template = aspect < 0.82 ? 'poster' : 'photo';

  if (template === 'poster') {
    const backdrop = await sharp(imageBuffer)
      .rotate()
      .resize(w, h, { fit: 'cover', position: sharpPosition(entry) })
      .greyscale()
      .normalize()
      .linear(1.08, -14)
      .blur(Math.max(8, Math.round(w * 0.013)))
      .modulate({ brightness: 0.30 })
      .jpeg({ quality: 84 })
      .toBuffer();

    const maxW = Math.round(w * (formatName === 'story' ? 0.91 : formatName === 'social' ? 0.80 : 0.88));
    const maxH = Math.round(h * (formatName === 'story' ? 0.89 : formatName === 'social' ? 0.82 : 0.86));
    const poster = await sharp(imageBuffer)
      .rotate()
      .resize({ width: maxW, height: maxH, fit: 'inside', withoutEnlargement: false })
      .greyscale()
      .normalize()
      .linear(1.16, -8)
      .sharpen({ sigma: 0.9 })
      .tint(PAPER)
      .jpeg({ quality: 92 })
      .toBuffer();
    const posterMeta = await sharp(poster).metadata();
    const left = Math.max(0, Math.round((w - posterMeta.width) / 2));
    const top = Math.max(Math.round(h * 0.055), Math.round((h - posterMeta.height) / 2 - h * 0.01));
    const mattePad = Math.round(w * 0.011);
    const matteW = posterMeta.width + mattePad * 2;
    const matteH = posterMeta.height + mattePad * 2;
    const matte = Buffer.from(`<svg width="${matteW}" height="${matteH}" xmlns="http://www.w3.org/2000/svg"><polygon points="${roughPolygon(mattePad * 0.15, mattePad * 0.15, matteW - mattePad * 0.3, matteH - mattePad * 0.3, seed ^ 0x5511, 10, 20)}" fill="${PAPER}"/></svg>`);

    return sharp(backdrop)
      .composite([
        { input: Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#050505" opacity="0.55"/></svg>`), blend: 'over' },
        { input: Buffer.from(halftoneSvg(w, h, 0.18, 10)), blend: 'multiply' },
        { input: matte, left: Math.max(0, left - mattePad), top: Math.max(0, top - mattePad), blend: 'over' },
        { input: poster, left, top, blend: 'over' },
        { input: Buffer.from(zineBorderSvg(w, h, seed, Math.round(w * 0.018))), blend: 'over' },
        { input: Buffer.from(anniversaryStickerSvg(entry, w, h, seed, formatName === 'social')), blend: 'over' },
        { input: Buffer.from(posterCaptionSvg(entry, formatName, seed)), blend: 'over' },
        { input: Buffer.from(paperTextureSvg(w, h, seed, 1.3)), blend: 'soft-light' }
      ])
      .jpeg({ quality: format.quality, mozjpeg: true })
      .toBuffer();
  }

  const photo = await photocopyImage(imageBuffer, w, h, 'cover', sharpPosition(entry));
  return sharp(photo)
    .composite([
      { input: Buffer.from(halftoneSvg(w, h, 0.15, 9)), blend: 'multiply' },
      { input: Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#000" opacity="0.08"/></svg>`), blend: 'over' },
      { input: Buffer.from(zineBorderSvg(w, h, seed, Math.round(w * 0.018))), blend: 'over' },
      { input: Buffer.from(anniversaryStickerSvg(entry, w, h, seed, true)), blend: 'over' },
      { input: Buffer.from(photoOverlaySvg(entry, formatName, seed)), blend: 'over' },
      { input: Buffer.from(paperTextureSvg(w, h, seed, 1.25)), blend: 'soft-light' }
    ])
    .jpeg({ quality: format.quality, mozjpeg: true })
    .toBuffer();
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
  version: 3,
  renderer: 'sharp-svg-zine-v3',
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

  const record = { id, date: entry.date, title: entry.title, template, formats: {} };
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
