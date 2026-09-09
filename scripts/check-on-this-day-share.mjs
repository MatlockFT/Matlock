import fs from 'node:fs/promises';

const pagePath = 'on-this-day.html';
const manifestPath = 'assets/data/on-this-day-share-manifest.json';
const runtimePath = 'assets/otd-share-v3.js';
const failures = [];

const [page, runtime, manifestText] = await Promise.all([
  fs.readFile(pagePath, 'utf8'),
  fs.readFile(runtimePath, 'utf8'),
  fs.readFile(manifestPath, 'utf8')
]);

let manifest;
try { manifest = JSON.parse(manifestText); }
catch { failures.push('share manifest must be valid JSON'); manifest = {}; }

if (!page.includes('/assets/otd-share-v3.js')) failures.push('On This Day page must load otd-share-v3.js');
if (page.includes('/assets/otd-share-v2.js')) failures.push('On This Day page must not load the retired otd-share-v2.js');
for (const marker of ['MANIFEST_URL', 'buildFallbackSvg', 'svgToJpeg', 'Instagram Post', 'Instagram Story']) {
  if (!runtime.includes(marker)) failures.push(`otd-share-v3.js missing marker: ${marker}`);
}

if (Number(manifest?.version || 0) < 1) failures.push('share manifest version must be at least 1');
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
    for (const name of ['post', 'story', 'social']) {
      const url = record?.formats?.[name];
      if (typeof url !== 'string' || !/^https:\/\/raw\.githubusercontent\.com\/MatlockFT\/Matlock\/otd-share-cache\//.test(url)) {
        failures.push(`${id}: ${name} must point at the rolling otd-share-cache branch`);
      }
    }
  }
}

if (failures.length) {
  console.error('On This Day share validation failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log(`On This Day share system valid: ${Object.keys(manifest.entries || {}).length} pre-rendered entries; SVG browser fallback present.`);
