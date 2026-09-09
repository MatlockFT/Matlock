import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { balancedWrap, textUnits } from './share-title-layout.mjs';
import { topMatterSvg, collageMarksSvg, titleAndFooterSvg, noImageSvg } from './share-card-composition.mjs';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const OUTPUT_DIR = process.env.OTD_SHARE_OUTPUT_DIR || '.otd-share-cache';
const MANIFEST_PATH = process.env.OTD_SHARE_MANIFEST_PATH || 'assets/data/on-this-day-share-manifest.json';
const CURATED_SOURCES_PATH = process.env.OTD_SHARE_SOURCES_PATH || 'assets/data/on-this-day-share-sources.json';
const PUBLIC_BASE = process.env.OTD_SHARE_PUBLIC_BASE || 'https://raw.githubusercontent.com/MatlockFT/Matlock/otd-share-cache';
const TEXTURE_PATH = process.env.OTD_SHARE_TEXTURE_PATH || 'assets/textures/otd-xerox-paper-v1.webp';
const WINDOW_DAYS = Math.max(0, Number(process.env.OTD_SHARE_WINDOW_DAYS || 2));
const MAX_PER_DAY = Math.max(1, Number(process.env.OTD_SHARE_MAX_PER_DAY || 12));
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.OTD_SHARE_CONCURRENCY || 3)));
const USER_AGENT = 'MMA-Matlock-OnThisDay-Share/6.0 (+https://mmamatlock.com/on-this-day/)';
const MAX_OFFICIAL_IMAGES = 2;
const SUPPLEMENTAL_POSTER_ROLES = new Set(['event-photo', 'fight-photo']);

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

function fitDisplaySize(baseSize, lines, availableWidth, glyphRatio = 0.69) {
  const longest = Math.max(1, ...lines.map(textUnits));
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

function tagAttribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, 'i'));
  return String(match?.[1] || match?.[2] || match?.[3] || '').replace(/&amp;/gi, '&');
}

function originalUfcImageUrl(value) {
  try {
    const url = new URL(value, 'https://www.ufc.com');
    if (!['ufc.com', 'www.ufc.com'].includes(url.hostname)) return '';
    if (!/\/images\/styles\/event_fight_card_upper_body_of_standing_athlete\/s3\//i.test(url.pathname)) return '';
    url.pathname = url.pathname.replace(/\/images\/styles\/event_fight_card_upper_body_of_standing_athlete\/s3\//i, '/images/');
    url.search = '';
    return url.href;
  } catch {
    return '';
  }
}

async function officialUfcImages(entry) {
  if (clean(entry?.promotion).toUpperCase() !== 'UFC') return [];
  const match = /^UFC\s+(\d+)\b/i.exec(clean(entry?.title));
  if (!match) return [];

  const sourceUrl = `https://www.ufc.com/event/ufc-${match[1]}`;
  try {
    const response = await fetch(sourceUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' }
    });
    if (!response.ok) return [];
    const html = await response.text();
    const images = [];
    const seen = new Set();

    for (const found of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = found[0];
      const imageUrl = originalUfcImageUrl(tagAttribute(tag, 'src') || tagAttribute(tag, 'data-src'));
      if (!imageUrl || seen.has(imageUrl)) continue;
      images.push({ imageUrl, imageCredit: 'UFC', sourceUrl, role: 'official-fighter-cutout' });
      seen.add(imageUrl);
      if (images.length >= MAX_OFFICIAL_IMAGES) break;
    }

    return images;
  } catch {
    return [];
  }
}

async function cutoutImage(imageBuffer, width, height, seed, position, angle = 0, poster = false) {
  const edge = Math.max(5, Math.round(Math.min(width, height) * 0.009));
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

async function subjectSticker(imageBuffer, width, height, seed, angle = 0) {
  const metadata = await sharp(imageBuffer).rotate().metadata();
  if (!metadata.width || !metadata.height) return null;

  const cropHeight = Math.min(metadata.height, Math.round(metadata.width * 2.08));
  const margin = Math.max(10, Math.round(Math.min(width, height) * 0.035));
  let pipeline = sharp(imageBuffer).rotate();
  if (cropHeight < metadata.height) {
    pipeline = pipeline.extract({ left: 0, top: 0, width: metadata.width, height: cropHeight });
  }

  const innerWidth = Math.max(1, width - margin * 2);
  const innerHeight = Math.max(1, height - margin * 2);
  const resized = await pipeline
    .resize(innerWidth, innerHeight, {
      fit: 'contain',
      position: 'north',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false
    })
    .ensureAlpha()
    .png()
    .toBuffer();
  const innerAlpha = await sharp(resized).extractChannel('alpha').png().toBuffer();
  const innerMask = await sharp({ create: { width: innerWidth, height: innerHeight, channels: 3, background: '#ffffff' } })
    .joinChannel(innerAlpha)
    .png()
    .toBuffer();
  const processed = await sharp(resized)
    .greyscale()
    .normalize()
    .linear(1.34, -24)
    .sharpen({ sigma: 1.1 })
    .composite([
      { input: Buffer.from(halftoneSvg(innerWidth, innerHeight, 0.15, 7)), blend: 'multiply' },
      { input: Buffer.from(xeroxDamageSvg(innerWidth, innerHeight, seed, true)), blend: 'screen' }
    ])
    .composite([{ input: innerMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const core = await sharp(processed)
    .extend({
      top: margin,
      bottom: margin,
      left: margin,
      right: margin,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
  const alpha = await sharp(innerAlpha)
    .extend({
      top: margin,
      bottom: margin,
      left: margin,
      right: margin,
      background: '#000000'
    })
    .blur(Math.max(2, margin * 0.38))
    .threshold(8)
    .png()
    .toBuffer();
  const paper = await sharp({ create: { width, height, channels: 3, background: PAPER } })
    .joinChannel(alpha)
    .png()
    .toBuffer();
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: paper }, { input: core }])
    .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

function combinedImageCredit(entry, supplemental = []) {
  return [...new Set([
    clean(entry?.imageCredit),
    ...supplemental.map(image => clean(image?.imageCredit))
  ].filter(Boolean))].join(' + ');
}

async function supplementalLayers(supplemental, formatName, seed) {
  if (!supplemental.length) return [];
  const { width: w, height: h } = FORMATS[formatName];
  const count = Math.min(MAX_OFFICIAL_IMAGES, supplemental.length);
  const specs = count === 1
    ? [{ x: 0.40, y: 0.16, width: 0.60, height: 0.71, angle: 1.2 }]
    : [
        { x: -0.07, y: 0.18, width: 0.60, height: 0.74, angle: -1.2 },
        { x: 0.48, y: 0.16, width: 0.60, height: 0.75, angle: 1.3 }
      ];
  const layers = [];

  for (let index = 0; index < count; index += 1) {
    const spec = specs[index];
    const source = supplemental[index];
  const isEventPhoto = SUPPLEMENTAL_POSTER_ROLES.has(source.role);
    const eventSpec = {
      x: 0.25,
      y: formatName === 'story' ? 0.48 : 0.45,
      width: 0.75,
      height: formatName === 'story' ? 0.29 : 0.35,
      angle: 2.2
    };
    const activeSpec = isEventPhoto ? eventSpec : spec;
    const targetWidth = Math.round(w * activeSpec.width);
    const targetHeight = Math.round(h * activeSpec.height);
    const sticker = isEventPhoto
      ? await cutoutImage(
          source.buffer,
          targetWidth,
          targetHeight,
          seed ^ (0x9119 + index * 1709),
          'north',
          activeSpec.angle,
          false
        )
      : await subjectSticker(
          source.buffer,
          targetWidth,
          targetHeight,
          seed ^ (0x9119 + index * 1709),
          activeSpec.angle
        );
    if (!sticker) continue;
    const metadata = await sharp(sticker).metadata();
    layers.push({
      input: sticker,
      left: Math.max(0, Math.min(w - metadata.width, Math.round(w * activeSpec.x))),
      top: Math.max(0, Math.min(h - metadata.height, Math.round(h * activeSpec.y))),
      blend: 'over'
    });
  }

  return layers;
}


const PHOTO_LAYOUTS = {
  post: { x: 0, y: 75, width: 1080, height: 1210, titleY: 0 },
  story: { x: 0, y: 80, width: 1080, height: 1770, titleY: 0 },
  social: { x: 0, y: 80, width: 1200, height: 1060, titleY: 0 }
};

async function renderPhoto(entry, formatName, imageBuffer, supplemental, seed) {
  const { width: w, height: h, quality } = FORMATS[formatName];
  const layout = PHOTO_LAYOUTS[formatName];
  const angle = ((hashInt(`${seed}:angle`) % 31) - 15) / 10;
  let cutout = await cutoutImage(imageBuffer, layout.width, layout.height, seed, imagePosition(entry), angle, false);
  let cutoutMeta = await sharp(cutout).metadata();
  if (cutoutMeta.width > w || cutoutMeta.height > h) {
    const scale = Math.min(w / cutoutMeta.width, h / cutoutMeta.height);
    cutout = await sharp(cutout)
      .resize(Math.max(1, Math.floor(cutoutMeta.width * scale)), Math.max(1, Math.floor(cutoutMeta.height * scale)), { fit: 'fill' })
      .png()
      .toBuffer();
    cutoutMeta = await sharp(cutout).metadata();
  }
  const left = Math.max(0, Math.round(layout.x - (cutoutMeta.width - layout.width) / 2));
  const top = Math.max(0, Math.round(layout.y - (cutoutMeta.height - layout.height) / 2));
  const base = await paperCanvas(w, h);
  const officialLayers = await supplementalLayers(supplemental, formatName, seed);
  const imageCredit = combinedImageCredit(entry, supplemental);
  return sharp(base)
    .composite([
      { input: await textureOverlay(w, h, 0.12, true), blend: 'screen' },
      { input: Buffer.from(xeroxDamageSvg(w, h, seed, true)), blend: 'screen' },
      { input: Buffer.from(collageMarksSvg(entry, formatName, seed)), blend: 'over' },
      { input: cutout, left, top, blend: 'over' },
      ...officialLayers,
      { input: Buffer.from(topMatterSvg(entry, formatName, seed)), blend: 'over' },
      { input: Buffer.from(titleAndFooterSvg(entry, formatName, seed, layout.titleY, imageCredit)), blend: 'over' }
    ])
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}

async function renderPoster(entry, formatName, imageBuffer, sourceMeta, supplemental, seed) {
  const { width: w, height: h, quality } = FORMATS[formatName];
  const hasSupplemental = supplemental.length > 0;
  const maxW = Math.round(w * 0.94);
  const maxH = Math.round(h * 0.93);
  const scale = Math.min(maxW / sourceMeta.width, maxH / sourceMeta.height);
  const pieceW = Math.max(260, Math.round(sourceMeta.width * scale));
  const pieceH = Math.max(340, Math.round(sourceMeta.height * scale));
  const angle = ((hashInt(`${seed}:poster-angle`) % 25) - 12) / 10;
  const cutout = await cutoutImage(imageBuffer, pieceW, pieceH, seed, imagePosition(entry), angle, true);
  const cutoutMeta = await sharp(cutout).metadata();
  const posterCenterY = Math.round(h * 0.51);
  const posterCenterX = hasSupplemental && supplemental.length === 1 ? w * 0.45 : w * 0.5;
  const left = Math.max(0, Math.round(posterCenterX - cutoutMeta.width / 2));
  const top = Math.max(Math.round(w * 0.064), Math.round(posterCenterY - cutoutMeta.height / 2));
  const titleY = Math.round(h * (formatName === 'story' ? 0.79 : formatName === 'social' ? 0.72 : 0.75));
  const base = await paperCanvas(w, h);
  const officialLayers = await supplementalLayers(supplemental, formatName, seed);
  const imageCredit = combinedImageCredit(entry, supplemental);
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
      { input: Buffer.from(collageMarksSvg(entry, formatName, seed)), blend: 'over' },
      { input: cutout, left, top, blend: 'over' },
      ...officialLayers,
      { input: Buffer.from(topMatterSvg(entry, formatName, seed)), blend: 'over' },
      { input: Buffer.from(titleAndFooterSvg(entry, formatName, seed, titleY, imageCredit)), blend: 'over' }
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

async function renderEntry(entry, formatName, imageBuffer, supplemental) {
  const seed = hashInt(`${entryAnchor(entry)}:${formatName}:gobold-gaffer-v7`);
  if (!imageBuffer) return renderNoImage(entry, formatName, seed);
  let metadata;
  try { metadata = await sharp(imageBuffer).rotate().metadata(); }
  catch { metadata = null; }
  if (!metadata?.width || !metadata?.height) return renderNoImage(entry, formatName, seed);
  const isPoster = metadata.width / metadata.height < 0.82;
  return isPoster
    ? renderPoster(entry, formatName, imageBuffer, metadata, supplemental, seed)
    : renderPhoto(entry, formatName, imageBuffer, supplemental, seed);
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
const curatedSources = JSON.parse(await fs.readFile(CURATED_SOURCES_PATH, 'utf8'));
const entries = selectEntries(Array.isArray(history?.entries) ? history.entries : []);
const generatedAt = new Date().toISOString();
const versionToken = generatedAt.replace(/[^0-9]/g, '').slice(0, 14);

await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
await fs.mkdir(OUTPUT_DIR, { recursive: true });
await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });

const imageCache = new Map();
const manifest = {
  version: 7,
  renderer: 'sharp-gobold-gaffer-v7',
  style: 'poster-event-photo-v1',
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
  const curated = curatedSources?.entries?.[entry.autoKey] || curatedSources?.entries?.[id] || [];
  const discovered = curated.length
    ? curated
    : template === 'photo'
      ? await officialUfcImages(entry)
      : [];
  const eligible = template === 'poster'
    ? discovered.filter(source => SUPPLEMENTAL_POSTER_ROLES.has(source.role))
    : discovered;
  const supplemental = [];
  for (const source of eligible) {
    if (!imageCache.has(source.imageUrl)) imageCache.set(source.imageUrl, fetchImage(source.imageUrl));
    const buffer = await imageCache.get(source.imageUrl);
    if (buffer) supplemental.push({ ...source, buffer });
  }

  if (supplemental.length && template !== 'type') template += '-collage';

  const record = {
    id,
    date: entry.date,
    title: entry.title,
    template,
    imageCredit: combinedImageCredit(entry, supplemental),
    imageSources: supplemental.map(image => ({
      credit: image.imageCredit,
      sourceUrl: image.sourceUrl,
      role: image.role
    })),
    formats: {}
  };

  for (const formatName of Object.keys(FORMATS)) {
    const fileName = `${id}-${formatName}.jpg`;
    const buffer = await renderEntry(entry, formatName, imageBuffer, supplemental);
    const renderedMeta = await sharp(buffer).metadata();
    const expected = FORMATS[formatName];
    if (renderedMeta.width !== expected.width || renderedMeta.height !== expected.height) {
      throw new Error(`${id} ${formatName}: rendered ${renderedMeta.width}x${renderedMeta.height}, expected ${expected.width}x${expected.height}`);
    }
    await fs.writeFile(path.join(OUTPUT_DIR, fileName), buffer);
    record.formats[formatName] = `${PUBLIC_BASE}/${encodeURIComponent(fileName)}?v=${versionToken}`;
  }
  manifest.entries[id] = record;
  console.log(`Rendered ${id} (${template}${supplemental.length ? `, ${supplemental.length} verified supplemental image${supplemental.length === 1 ? '' : 's'}` : ''})`);
});

await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`On This Day share renderer v7: ${entries.length} entries, ${entries.length * Object.keys(FORMATS).length} images, ${targetMonthDays(WINDOW_DAYS).join(', ')}.`);
