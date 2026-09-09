import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const OUTPUT_DIR = process.env.OTD_SHARE_OUTPUT_DIR || '.otd-share-cache';
const MANIFEST_PATH = process.env.OTD_SHARE_MANIFEST_PATH || 'assets/data/on-this-day-share-manifest.json';
const PUBLIC_BASE = process.env.OTD_SHARE_PUBLIC_BASE || 'https://raw.githubusercontent.com/MatlockFT/Matlock/otd-share-cache';
const TEXTURE_PATH = process.env.OTD_SHARE_TEXTURE_PATH || 'assets/textures/otd-xerox-paper-v1.webp';
const WINDOW_DAYS = Math.max(0, Number(process.env.OTD_SHARE_WINDOW_DAYS || 2));
const MAX_PER_DAY = Math.max(1, Number(process.env.OTD_SHARE_MAX_PER_DAY || 12));
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.OTD_SHARE_CONCURRENCY || 3)));
const USER_AGENT = 'MMA-Matlock-OnThisDay-Share/3.0 (+https://mmamatlock.com/on-this-day/)';

const FORMATS = {
  post: { width: 1080, height: 1350, quality: 90 },
  story: { width: 1080, height: 1920, quality: 90 },
  social: { width: 1200, height: 1200, quality: 90 }
};

const INK = '#070707';
const PAPER = '#f1eee4';
const PAPER_MID = '#c9c5ba';
const DISPLAY_FONT = 'DejaVu Sans Condensed, Liberation Sans Narrow, Arial Narrow, sans-serif';
const MONO_FONT = 'DejaVu Sans Mono, Liberation Mono, monospace';

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

function compactDate(entry) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(entry?.date || ''));
  return match ? `${match[2]}.${match[3]}.${match[1]}` : '';
}

function balancedWrap(text, maxChars, maxLines = 3) {
  const sourceWords = clean(text).split(' ').filter(Boolean);
  if (!sourceWords.length) return [];

  const capacity = Math.ceil(maxChars * 1.08);
  const words = [...sourceWords];
  let clipped = false;
  while (words.length > 1 && words.join(' ').length > capacity * maxLines) {
    words.pop();
    clipped = true;
  }
  if (clipped) words[words.length - 1] = `${words.at(-1).replace(/[\s,.;:-]+$/, '')}…`;

  const whole = words.join(' ');
  if (whole.length <= maxChars) return [whole];

  const candidates = [];
  const collect = (start, lines) => {
    if (start >= words.length) {
      if (lines.length <= maxLines) candidates.push(lines);
      return;
    }
    if (lines.length >= maxLines) return;
    for (let end = start + 1; end <= words.length; end += 1) {
      const line = words.slice(start, end).join(' ');
      if (line.length > capacity && end > start + 1) break;
      collect(end, [...lines, line]);
    }
  };
  collect(0, []);

  const weakEnd = /^(A|AN|AND|AT|BY|FOR|FROM|IN|OF|ON|OR|THE|TO|VS\.?|WITH)$/i;
  const score = lines => {
    const widths = lines.map(line => line.length);
    const widest = Math.max(...widths);
    let value = lines.length * 14;
    for (const width of widths) {
      value += (widest - width) ** 2;
      if (width > maxChars) value += (width - maxChars) ** 2 * 18;
    }
    const finalWords = lines.at(-1).split(' ').filter(Boolean);
    if (finalWords.length === 1 && words.length > 2) value += 5000;
    if (widths.at(-1) < widest * 0.48) value += 2200;
    lines.slice(0, -1).forEach(line => {
      const finalWord = line.split(' ').at(-1) || '';
      if (/[:;—–-]$/.test(line)) value -= 260;
      if (weakEnd.test(finalWord)) value += 650;
    });
    return value;
  };

  return candidates.sort((a, b) => score(a) - score(b))[0] || [whole];
}

function fitDisplaySize(baseSize, lines, availableWidth, glyphRatio = 0.69) {
  const longest = Math.max(1, ...lines.map(line => line.length));
  return Math.max(Math.round(baseSize * 0.72), Math.min(baseSize, Math.floor(availableWidth / (longest * glyphRatio))));
}

function roughPolygon(x, y, width, height, seed, jitter = 10, points = 12) {
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

function halftoneSvg(width, height, opacity = 0.16, step = 8) {
  const radius = Math.max(0.75, step * 0.19);
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="dots" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><circle cx="${step / 2}" cy="${step / 2}" r="${radius}" fill="#000" opacity="${opacity}"/></pattern></defs><rect width="${width}" height="${height}" fill="url(#dots)"/></svg>`;
}

function xeroxDamageSvg(width, height, seed, light = false) {
  const random = rng(seed ^ 0x19590);
  let marks = '';
  const color = light ? '#fff' : '#000';
  for (let index = 0; index < 34; index += 1) {
    const y = Math.round(random() * height);
    const x = Math.round(random() * width * 0.72);
    const lineWidth = Math.round(width * (0.04 + random() * 0.32));
    marks += `<rect x="${x}" y="${y}" width="${lineWidth}" height="${1 + Math.round(random() * 3)}" fill="${color}" opacity="${(0.025 + random() * 0.065).toFixed(3)}"/>`;
  }
  for (let index = 0; index < 120; index += 1) {
    const radius = 0.6 + random() * 3.2;
    marks += `<circle cx="${(random() * width).toFixed(1)}" cy="${(random() * height).toFixed(1)}" r="${radius.toFixed(1)}" fill="${color}" opacity="${(0.025 + random() * 0.09).toFixed(3)}"/>`;
  }
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${marks}</svg>`;
}

const textureCache = new Map();
async function paperCanvas(width, height) {
  const key = `${width}x${height}:paper`;
  if (!textureCache.has(key)) {
    const inverted = await sharp(TEXTURE_PATH)
      .resize(width, height, { fit: 'cover' })
      .greyscale()
      .negate()
      .png()
      .toBuffer();
    textureCache.set(key, sharp(inverted)
      .linear(0.52, 0)
      .jpeg({ quality: 91, mozjpeg: true })
      .toBuffer());
  }
  return textureCache.get(key);
}

async function textureOverlay(width, height, opacity = 0.18, invert = false) {
  const key = `${width}x${height}:${opacity}:${invert}`;
  if (!textureCache.has(key)) {
    let pipeline = sharp(TEXTURE_PATH).resize(width, height, { fit: 'cover' }).greyscale();
    if (invert) pipeline = pipeline.negate({ alpha: false });
    textureCache.set(key, pipeline.ensureAlpha(opacity).png().toBuffer());
  }
  return textureCache.get(key);
}

function imagePosition(entry) {
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

async function cutoutImage(imageBuffer, width, height, seed, position, angle = 0, poster = false) {
  const edge = Math.max(12, Math.round(Math.min(width, height) * 0.026));
  const inner = roughPolygon(edge, edge, width - edge * 2, height - edge * 2, seed ^ 0x7711, edge * 0.85, 16);
  const outer = roughPolygon(2, 2, width - 4, height - 4, seed ^ 0x2288, edge * 0.72, 17);
  const processed = await sharp(imageBuffer)
    .rotate()
    .resize(width, height, { fit: poster ? 'contain' : 'cover', position, background: PAPER, withoutEnlargement: false })
    .greyscale()
    .normalize()
    .linear(poster ? 1.17 : 1.3, poster ? -9 : -24)
    .sharpen({ sigma: poster ? 0.75 : 1.15 })
    .composite([
      { input: Buffer.from(halftoneSvg(width, height, poster ? 0.10 : 0.18, poster ? 7 : 8)), blend: 'multiply' },
      { input: Buffer.from(xeroxDamageSvg(width, height, seed, true)), blend: 'screen' }
    ])
    .png()
    .toBuffer();
  const mask = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><polygon points="${inner}" fill="#fff"/></svg>`);
  const clipped = await sharp(processed).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const frame = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><polygon points="${outer}" fill="${PAPER}"/><polygon points="${inner}" fill="none" stroke="#050505" stroke-width="3" opacity=".75"/></svg>`);
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: frame }, { input: clipped }])
    .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

function topMatterSvg(entry, formatName, seed) {
  const { width: w, height: h } = FORMATS[formatName];
  const age = yearsAgo(entry);
  const anniversary = age > 0 ? `${age} ${age === 1 ? 'YEAR' : 'YEARS'} AGO` : 'ON THIS DAY';
  const year = String(entry?.date || '').slice(0, 4) || 'MMA';
  const pad = Math.round(w * 0.045);
  const barY = Math.round(h * 0.032);
  const barH = Math.round(w * (formatName === 'story' ? 0.12 : 0.105));
  const barW = Math.round(w * (formatName === 'social' ? 0.68 : 0.72));
  const issue = `ARCHIVE / ${monthDay(entry?.date).replace('-', '.') || '00.00'}`;
  const registration = roughPolygon(pad - 7, barY - 3, barW + 14, barH + 6, seed ^ 0x9191, 8, 13);
  const registrationEdge = roughPolygon(pad - 11, barY - 7, barW + 22, barH + 14, seed ^ 0x7272, 10, 13);
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <text x="${w - pad}" y="${Math.round(h * 0.39)}" text-anchor="end" fill="none" stroke="${PAPER}" stroke-width="3" opacity=".2" font-family="${DISPLAY_FONT}" font-size="${Math.round(w * 0.31)}" font-weight="900" transform="rotate(-90 ${w - pad} ${Math.round(h * 0.39)})">${escapeXml(year)}</text>
    <polygon points="${registrationEdge}" fill="${PAPER}" opacity=".92"/>
    <polygon points="${registration}" fill="${INK}"/>
    <text x="${pad + Math.round(w * 0.024)}" y="${barY + Math.round(barH * 0.68)}" fill="${PAPER}" font-family="${DISPLAY_FONT}" font-size="${Math.round(w * 0.055)}" font-weight="900" letter-spacing="1">${escapeXml(anniversary)}</text>
    <text x="${w - pad}" y="${barY + Math.round(barH * 0.45)}" text-anchor="end" fill="${PAPER}" font-family="${MONO_FONT}" font-size="${Math.round(w * 0.015)}" font-weight="700" letter-spacing="1.5">${escapeXml(issue)}</text>
    <text x="${w - pad}" y="${barY + Math.round(barH * 0.73)}" text-anchor="end" fill="${PAPER}" font-family="${MONO_FONT}" font-size="${Math.round(w * 0.015)}" font-weight="700" letter-spacing="1.5">MMA HISTORY</text>
    <path d="M ${pad} ${barY + barH + 16} H ${w - pad}" stroke="${PAPER}" stroke-width="3" stroke-dasharray="22 9 4 9" opacity=".82"/>
  </svg>`;
}

function titleAndFooterSvg(entry, formatName, seed, titleY) {
  const { width: w, height: h } = FORMATS[formatName];
  const pad = Math.round(w * 0.047);
  const title = clean(entry.title).toUpperCase();
  const lines = balancedWrap(title, formatName === 'story' ? 21 : formatName === 'social' ? 24 : 23, 3);
  const baseSize = Math.round(w * (formatName === 'story' ? 0.069 : formatName === 'social' ? 0.068 : 0.064));
  const fontSize = fitDisplaySize(baseSize, lines, w - pad * 2.25, 0.77);
  const lineHeight = Math.round(fontSize * 1.13);
  const random = rng(seed ^ 0x551122);
  let strips = '';
  lines.forEach((line, index) => {
    const y = titleY + index * lineHeight;
    const stripH = Math.round(fontSize * 1.03);
    const estimated = Math.round(line.length * fontSize * 0.73 + w * 0.064);
    const stripW = Math.min(w - pad * 1.12, Math.max(Math.round(w * 0.28), estimated));
    const x = pad + Math.round((random() - 0.5) * w * 0.018);
    const angle = ((random() - 0.5) * 2.2).toFixed(2);
    const polygon = roughPolygon(x, y - Math.round(fontSize * 0.78), stripW, stripH, seed ^ (index * 919 + 0x33), 10, 11);
    const edge = roughPolygon(x - 5, y - Math.round(fontSize * 0.78) - 5, stripW + 10, stripH + 10, seed ^ (index * 727 + 0x91), 12, 11);
    strips += `<g transform="rotate(${angle} ${x + stripW / 2} ${y})"><polygon points="${edge}" fill="${PAPER}" opacity=".94"/><polygon points="${polygon}" fill="${INK}"/><text x="${x + Math.round(w * 0.018)}" y="${y}" fill="${PAPER}" font-family="${DISPLAY_FONT}" font-size="${fontSize}" font-weight="900" letter-spacing="-.5">${escapeXml(line)}</text></g>`;
  });
  const promotion = clean(entry.promotion).toUpperCase();
  const credit = clean(entry.imageCredit);
  const creditLine = credit ? `IMAGE: ${credit.toUpperCase()}` : 'ARCHIVAL IMAGE / SOURCE ON PAGE';
  const footerY = h - Math.round(w * 0.052);
  const creditY = h - Math.round(w * 0.082);
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    ${strips}
    <polygon points="${pad - 16},${creditY - Math.round(w * 0.025)} ${w - pad + 10},${creditY - Math.round(w * 0.019)} ${w - pad + 14},${h} ${pad - 12},${h}" fill="${PAPER}" opacity=".94"/>
    <text x="${pad}" y="${creditY}" fill="${INK}" opacity=".72" font-family="${MONO_FONT}" font-size="${Math.round(w * 0.013)}" font-weight="700" letter-spacing=".7">${escapeXml(creditLine)}</text>
    <path d="M ${pad} ${creditY + 12} H ${w - pad}" stroke="#070707" stroke-width="2"/>
    <text x="${pad}" y="${footerY}" fill="${INK}" font-family="${MONO_FONT}" font-size="${Math.round(w * 0.019)}" font-weight="700" letter-spacing="1.2">${escapeXml(compactDate(entry))}</text>
    ${promotion ? `<text x="${Math.round(w * 0.52)}" y="${footerY}" text-anchor="middle" fill="${INK}" font-family="${MONO_FONT}" font-size="${Math.round(w * 0.018)}" font-weight="700" letter-spacing="1.1">${escapeXml(promotion)}</text>` : ''}
    <g transform="rotate(-1 ${w - pad} ${footerY})"><rect x="${w - pad - Math.round(w * 0.27)}" y="${footerY - Math.round(w * 0.034)}" width="${Math.round(w * 0.27)}" height="${Math.round(w * 0.045)}" fill="${INK}"/><text x="${w - pad - Math.round(w * 0.012)}" y="${footerY - Math.round(w * 0.005)}" text-anchor="end" fill="${PAPER}" font-family="${DISPLAY_FONT}" font-size="${Math.round(w * 0.021)}" font-weight="900" letter-spacing="1.2">MMA MATLOCK</text></g>
  </svg>`;
}

function noImageSvg(entry, formatName, seed) {
  const { width: w, height: h } = FORMATS[formatName];
  const pad = Math.round(w * 0.05);
  const year = String(entry?.date || '').slice(0, 4) || 'MMA';
  const title = clean(entry.title).toUpperCase();
  const lines = balancedWrap(title, formatName === 'story' ? 19 : 23, 4);
  const baseTitleSize = Math.round(w * (formatName === 'story' ? 0.092 : 0.084));
  const titleSize = fitDisplaySize(baseTitleSize, lines, w - pad * 2.15, 0.76);
  const lineHeight = Math.round(titleSize * 1.04);
  const titleY = Math.round(h * (formatName === 'story' ? 0.43 : 0.40));
  const blockH = lineHeight * lines.length + Math.round(w * 0.11);
  const paperPoly = roughPolygon(pad * 0.55, titleY - Math.round(w * 0.095), w - pad * 1.1, blockH, seed ^ 0x31337, 20, 16);
  const age = yearsAgo(entry);
  const anniversary = age > 0 ? `${age} ${age === 1 ? 'YEAR' : 'YEARS'} AGO` : 'ON THIS DAY';
  const creditY = h - Math.round(w * 0.082);
  const footerY = h - Math.round(w * 0.05);
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="${INK}"/>
    <text x="${Math.round(w * 0.51)}" y="${Math.round(h * 0.35)}" text-anchor="middle" fill="none" stroke="${PAPER}" stroke-width="4" opacity=".24" font-family="${DISPLAY_FONT}" font-size="${Math.round(w * 0.36)}" font-weight="900" transform="rotate(-6 ${w / 2} ${h * 0.35})">${escapeXml(year)}</text>
    <polygon points="${roughPolygon(pad, Math.round(h * 0.06), Math.round(w * 0.68), Math.round(w * 0.105), seed ^ 0x1177, 12, 12)}" fill="${INK}" stroke="${PAPER}" stroke-width="5"/>
    <text x="${pad + Math.round(w * 0.022)}" y="${Math.round(h * 0.06 + w * 0.072)}" fill="${PAPER}" font-family="${DISPLAY_FONT}" font-size="${Math.round(w * 0.052)}" font-weight="900">${escapeXml(anniversary)}</text>
    <text x="${w - pad}" y="${Math.round(h * 0.09)}" text-anchor="end" fill="${PAPER}" font-family="${MONO_FONT}" font-size="${Math.round(w * 0.017)}" font-weight="700">MMA HISTORY / ${escapeXml(monthDay(entry?.date).replace('-', '.'))}</text>
    <polygon points="${paperPoly}" fill="${INK}" stroke="${PAPER}" stroke-width="6"/>
    <text fill="${PAPER}" font-family="${DISPLAY_FONT}" font-size="${titleSize}" font-weight="900">${lines.map((line, index) => `<tspan x="${pad}" y="${titleY + index * lineHeight}">${escapeXml(line)}</tspan>`).join('')}</text>
    <rect x="${pad}" y="${titleY + lineHeight * lines.length + Math.round(w * 0.035)}" width="${Math.round(w * 0.48)}" height="${Math.round(w * 0.024)}" fill="${PAPER}"/>
    <text x="${pad}" y="${creditY}" fill="${PAPER_MID}" font-family="${MONO_FONT}" font-size="${Math.round(w * 0.014)}" font-weight="700">NO EVENT IMAGE AVAILABLE / TYPE ARCHIVE EDITION</text>
    <path d="M ${pad} ${creditY + 12} H ${w - pad}" stroke="${PAPER}" stroke-width="2"/>
    <text x="${pad}" y="${footerY}" fill="${PAPER}" font-family="${MONO_FONT}" font-size="${Math.round(w * 0.019)}" font-weight="700">${escapeXml(compactDate(entry))}</text>
    <rect x="${w - pad - Math.round(w * 0.27)}" y="${footerY - Math.round(w * 0.033)}" width="${Math.round(w * 0.27)}" height="${Math.round(w * 0.044)}" fill="${PAPER}"/>
    <text x="${w - pad - Math.round(w * 0.012)}" y="${footerY - Math.round(w * 0.005)}" text-anchor="end" fill="${INK}" font-family="${DISPLAY_FONT}" font-size="${Math.round(w * 0.021)}" font-weight="900">MMA MATLOCK</text>
  </svg>`;
}

const PHOTO_LAYOUTS = {
  post: { x: 18, y: 175, width: 1044, height: 720, titleY: 965 },
  story: { x: 18, y: 238, width: 1044, height: 1070, titleY: 1410 },
  social: { x: 18, y: 158, width: 1164, height: 580, titleY: 815 }
};

async function renderPhoto(entry, formatName, imageBuffer, seed) {
  const { width: w, height: h, quality } = FORMATS[formatName];
  const layout = PHOTO_LAYOUTS[formatName];
  const angle = ((hashInt(`${seed}:angle`) % 31) - 15) / 10;
  const cutout = await cutoutImage(imageBuffer, layout.width, layout.height, seed, imagePosition(entry), angle, false);
  const cutoutMeta = await sharp(cutout).metadata();
  const left = Math.max(0, Math.round(layout.x - (cutoutMeta.width - layout.width) / 2));
  const top = Math.max(0, Math.round(layout.y - (cutoutMeta.height - layout.height) / 2));
  const base = await paperCanvas(w, h);
  return sharp(base)
    .composite([
      { input: await textureOverlay(w, h, 0.12, true), blend: 'screen' },
      { input: Buffer.from(xeroxDamageSvg(w, h, seed, true)), blend: 'screen' },
      { input: Buffer.from(topMatterSvg(entry, formatName, seed)), blend: 'over' },
      { input: cutout, left, top, blend: 'over' },
      { input: Buffer.from(titleAndFooterSvg(entry, formatName, seed, layout.titleY)), blend: 'over' }
    ])
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

async function renderPoster(entry, formatName, imageBuffer, sourceMeta, seed) {
  const { width: w, height: h, quality } = FORMATS[formatName];
  const maxW = Math.round(w * (formatName === 'story' ? 0.72 : 0.67));
  const maxH = Math.round(h * (formatName === 'story' ? 0.69 : formatName === 'social' ? 0.63 : 0.67));
  const scale = Math.min(maxW / sourceMeta.width, maxH / sourceMeta.height);
  const pieceW = Math.max(260, Math.round(sourceMeta.width * scale));
  const pieceH = Math.max(340, Math.round(sourceMeta.height * scale));
  const angle = ((hashInt(`${seed}:poster-angle`) % 25) - 12) / 10;
  const cutout = await cutoutImage(imageBuffer, pieceW, pieceH, seed, imagePosition(entry), angle, true);
  const cutoutMeta = await sharp(cutout).metadata();
  const posterCenterY = Math.round(h * (formatName === 'story' ? 0.43 : 0.40));
  const left = Math.max(0, Math.round((w - cutoutMeta.width) / 2));
  const top = Math.max(Math.round(h * 0.13), Math.round(posterCenterY - cutoutMeta.height / 2));
  const titleY = Math.round(h * (formatName === 'story' ? 0.79 : formatName === 'social' ? 0.73 : 0.76));
  const base = await paperCanvas(w, h);
  const ghost = await sharp(imageBuffer)
    .rotate()
    .resize(w, h, { fit: 'cover', position: imagePosition(entry) })
    .greyscale()
    .normalize()
    .threshold(150)
    .negate({ alpha: false })
    .ensureAlpha(0.11)
    .png()
    .toBuffer();
  return sharp(base)
    .composite([
      { input: ghost, blend: 'screen' },
      { input: await textureOverlay(w, h, 0.12, true), blend: 'screen' },
      { input: Buffer.from(xeroxDamageSvg(w, h, seed, true)), blend: 'screen' },
      { input: Buffer.from(topMatterSvg(entry, formatName, seed)), blend: 'over' },
      { input: cutout, left, top, blend: 'over' },
      { input: Buffer.from(titleAndFooterSvg(entry, formatName, seed, titleY)), blend: 'over' }
    ])
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

async function renderNoImage(entry, formatName, seed) {
  const { width: w, height: h, quality } = FORMATS[formatName];
  return sharp(Buffer.from(noImageSvg(entry, formatName, seed)))
    .composite([
      { input: await textureOverlay(w, h, 0.26, true), blend: 'screen' },
      { input: Buffer.from(xeroxDamageSvg(w, h, seed, true)), blend: 'screen' }
    ])
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

async function renderEntry(entry, formatName, imageBuffer) {
  const seed = hashInt(`${entryAnchor(entry)}:${formatName}:xerox-cutout-v3`);
  if (!imageBuffer) return renderNoImage(entry, formatName, seed);
  let metadata;
  try { metadata = await sharp(imageBuffer).rotate().metadata(); }
  catch { metadata = null; }
  if (!metadata?.width || !metadata?.height) return renderNoImage(entry, formatName, seed);
  const isPoster = metadata.width / metadata.height < 0.82;
  return isPoster
    ? renderPoster(entry, formatName, imageBuffer, metadata, seed)
    : renderPhoto(entry, formatName, imageBuffer, seed);
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

await fs.access(TEXTURE_PATH);
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
  renderer: 'sharp-xerox-cutout-v3',
  style: 'inverse-black-paper-v1',
  generatedAt,
  publicBase: PUBLIC_BASE,
  windowDays: WINDOW_DAYS,
  maxPerDay: MAX_PER_DAY,
  texture: '/assets/textures/otd-xerox-paper-v1.webp',
  formats: Object.fromEntries(Object.entries(FORMATS).map(([name, config]) => [name, { width: config.width, height: config.height }])),
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
      const metadata = await sharp(imageBuffer).rotate().metadata();
      template = metadata?.width && metadata?.height && metadata.width / metadata.height < 0.82 ? 'poster' : 'photo';
    } catch {}
  }

  const record = {
    id,
    date: entry.date,
    title: entry.title,
    template,
    imageCredit: clean(entry.imageCredit),
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
console.log(`On This Day share renderer v3: ${entries.length} entries, ${entries.length * Object.keys(FORMATS).length} images, ${targetMonthDays(WINDOW_DAYS).join(', ')}.`);
