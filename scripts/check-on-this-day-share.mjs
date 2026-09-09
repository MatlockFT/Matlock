import fs from 'node:fs/promises';
import { balancedWrap } from './share-title-layout.mjs';

const pagePath = 'on-this-day.html';
const manifestPath = process.env.OTD_SHARE_MANIFEST_PATH || 'assets/data/on-this-day-share-manifest.json';
const runtimePath = 'assets/otd-share-v3.js';
const bootstrapPath = 'assets/otd-share-bootstrap.js';
const texturePath = 'assets/textures/otd-xerox-paper-v1.webp';
const failures = [];

const [page, runtime, bootstrap, manifestText, textureStat] = await Promise.all([
  fs.readFile(pagePath, 'utf8'),
  fs.readFile(runtimePath, 'utf8'),
  fs.readFile(bootstrapPath, 'utf8'),
  fs.readFile(manifestPath, 'utf8'),
  fs.stat(texturePath).catch(() => null)
]);

let manifest;
try { manifest = JSON.parse(manifestText); }
catch { failures.push('share manifest must be valid JSON'); manifest = {}; }

if (!page.includes('/assets/otd-share-bootstrap.js')) failures.push('On This Day page must load the share bootstrap');
if (!bootstrap.includes('/assets/otd-share-v3.js')) failures.push('share bootstrap must lazy-load otd-share-v3.js');
if (page.includes('/assets/otd-share-v2.js')) failures.push('On This Day page must not load the retired otd-share-v2.js');
for (const marker of ['MANIFEST_URL', 'buildFallbackSvg', 'balancedWrap', 'textUnits', 'imageSources', 'svgToJpeg', 'Cut &amp; Paste Archive', 'Instagram Post', 'Instagram Story']) {
  if (!runtime.includes(marker)) failures.push(`otd-share-v3.js missing marker: ${marker}`);
}
if (runtime.includes('function wrapApprox')) failures.push('browser fallback must use balanced title wrapping, not greedy wrapping');

if (!textureStat?.isFile() || textureStat.size < 10000) failures.push('share renderer xerox texture is missing or unexpectedly small');
if (Number(manifest?.version || 0) < 3) failures.push('share manifest version must be at least 3');
if (!['sharp-xerox-cutout-v3', 'sharp-xerox-collage-v4'].includes(manifest?.renderer)) failures.push('share manifest must identify a supported xerox renderer');
if (Number(manifest?.version || 0) >= 4 && manifest?.style !== 'inverse-black-collage-v2') failures.push('v4 share manifest must identify the inverse collage style');
if (manifest?.texture !== '/assets/textures/otd-xerox-paper-v1.webp') failures.push('share manifest must identify the v1 xerox paper texture');
if (!manifest?.formats || typeof manifest.formats !== 'object') failures.push('share manifest formats object is required');
else {
  const expected = { post: [1080, 1350], story: [1080, 1920], social: [1200, 1200] };
  for (const [name, [width, height]] of Object.entries(expected)) {
    const format = manifest.formats[name];
    if (!format || Number(format.width) !== width || Number(format.height) !== height) {
      failures.push(`share manifest ${name} format must be ${width}x${height}`);
    }
  }
}
if (!manifest?.entries || typeof manifest.entries !== 'object' || Array.isArray(manifest.entries)) failures.push('share manifest entries must be an object');
else {
  for (const [id, record] of Object.entries(manifest.entries)) {
    if (!/^otd-\d{8}-/.test(id)) failures.push(`share manifest key is invalid: ${id}`);
    if (record?.id !== id) failures.push(`share manifest record id mismatch: ${id}`);
    if (typeof record?.imageCredit !== 'string') failures.push(`${id}: imageCredit must be a string`);
    if (record?.imageSources !== undefined && !Array.isArray(record.imageSources)) failures.push(`${id}: imageSources must be an array when present`);
    for (const source of Array.isArray(record?.imageSources) ? record.imageSources : []) {
      if (!source?.credit || !/^https:\/\//.test(source?.sourceUrl || '') || !source?.role) failures.push(`${id}: imageSources entries require credit, HTTPS sourceUrl, and role`);
    }
    for (const name of ['post', 'story', 'social']) {
      const url = record?.formats?.[name];
      if (typeof url !== 'string' || !/^https:\/\/raw\.githubusercontent\.com\/MatlockFT\/Matlock\/otd-share-cache\//.test(url)) {
        failures.push(`${id}: ${name} must point at the rolling otd-share-cache branch`);
      }
    }
  }
}

const ufc3Lines = balancedWrap('UFC 3: THE AMERICAN DREAM', 21, 3);
if (ufc3Lines.join('|') !== 'UFC 3:|THE AMERICAN DREAM') failures.push('title wrapper must keep The American Dream together');
const ufc215Lines = balancedWrap('UFC 215: NUNES VS. SHEVCHENKO 2', 23, 3);
if (ufc215Lines.at(-1)?.split(' ').length === 1) failures.push('title wrapper must not create a one-word UFC 215 orphan');

if (failures.length) {
  console.error('On This Day share validation failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log(`On This Day share system valid: ${Object.keys(manifest.entries || {}).length} pre-rendered entries; inverse credited SVG browser fallback present.`);
