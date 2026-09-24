import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const MAX_ROOT_ASSET_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|webp|gif|avif|svg)$/i;
const VIDEO_EXTENSIONS = /\.(?:mp4|mov|m4v|webm|avi|mkv|mpeg|mpg)$/i;
const ARTICLE_UPLOAD = /^assets\/uploads\/articles\/\d{4}\/(?:0[1-9]|1[0-2])\/[a-z0-9][a-z0-9-]*\/[^/]+\.(?:png|jpe?g|webp|gif|avif|svg)$/i;

const requiredFiles = [
  '_config.yml',
  '_layouts/default.html',
  'CNAME',
  'robots.txt',
  'ads.txt',
  'about.html',
  'contact.html',
  'privacy.html',
  'index.html',
  'on-this-day.html',
  'assets/base.css',
  'assets/site.js',
  'assets/data/on-this-day.json',
  '.repository-policy.json',
  '.repository-data-policy.json',
  '.repository-legacy-media.json',
  '.repository-generated-assets.json'
];

const errors = [];

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .sort();
}

async function countFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '_site') continue;
    count += entry.isDirectory() ? await countFiles(path.join(directory, entry.name)) : 1;
  }
  return count;
}

function normalizeAssetReference(value) {
  const clean = String(value || '').split(/[?#]/, 1)[0].replace(/^\//, '');
  try { return decodeURI(clean); } catch { return clean; }
}

function assetReferences(text) {
  const refs = new Set();
  for (const match of String(text || '').matchAll(/\/assets\/[A-Za-z0-9%._~!$&'()*+,;=@\/-]+/g)) {
    refs.add(normalizeAssetReference(match[0]));
  }
  for (const match of String(text || '').matchAll(/(?:^|[\s"'(=:])(?:assets\/[A-Za-z0-9%._~!$&'()*+,;=@\/-]+)/gm)) {
    const candidate = match[0].replace(/^[\s"'(=:]+/, '');
    refs.add(normalizeAssetReference(candidate));
  }
  return [...refs];
}

const tracked = trackedFiles();
const trackedSet = new Set(tracked);

for (const file of requiredFiles) {
  const stats = await fs.stat(file).catch(() => null);
  if (!stats?.isFile() || stats.size === 0) errors.push(`Missing or empty critical file: ${file}`);
}

const postFiles = tracked.filter(file => /^_posts\/.*\.(?:md|markdown|html)$/i.test(file));
const totalCount = await countFiles('.');
if (postFiles.length < 20) errors.push(`Repository contains only ${postFiles.length} posts; expected at least 20.`);
if (totalCount < 350) errors.push(`Repository contains only ${totalCount} files; expected at least 350.`);

const archive = JSON.parse(await fs.readFile('assets/data/on-this-day.json', 'utf8').catch(() => '{}'));
if (!Array.isArray(archive.entries) || archive.entries.length < 1500) {
  errors.push(`On This Day archive contains ${archive.entries?.length || 0} entries; expected at least 1500.`);
}

const legacyManifest = JSON.parse(await fs.readFile('.repository-legacy-media.json', 'utf8').catch(() => '{}'));
const legacyPaths = Array.isArray(legacyManifest.paths) ? legacyManifest.paths : [];
const legacySet = new Set(legacyPaths);
if (legacyManifest.version !== 1 || legacyManifest.capturedAtStage !== 9) {
  errors.push('Legacy media manifest must be version 1 and capturedAtStage 9.');
}
if (legacySet.size !== legacyPaths.length) errors.push('Legacy media manifest contains duplicate paths.');

const currentLegacyUploads = tracked.filter(file =>
  file.startsWith('assets/uploads/') && !file.startsWith('assets/uploads/articles/')
);
for (const file of currentLegacyUploads) {
  if (!legacySet.has(file)) {
    errors.push(`${file}: new article media may not use the grandfathered flat assets/uploads/ namespace.`);
  }
}
for (const file of legacyPaths) {
  if (!trackedSet.has(file)) {
    errors.push(`Legacy media manifest references a missing path: ${file}. Remove it from the manifest only as part of an intentional cleanup.`);
  }
}

for (const file of tracked.filter(file => file.startsWith('assets/uploads/articles/'))) {
  if (!ARTICLE_UPLOAD.test(file)) {
    errors.push(`${file}: article media must follow assets/uploads/articles/YYYY/MM/article-slug/image.ext.`);
  }
}

for (const file of tracked) {
  if (file.startsWith('assets/') && VIDEO_EXTENSIONS.test(file)) {
    errors.push(`${file}: video media must use the Writer GitHub Release pipeline, not Git history.`);
  }

  if (/^assets\/[^/]+$/i.test(file) && IMAGE_EXTENSIONS.test(file)) {
    const stats = await fs.stat(file).catch(() => null);
    if (stats?.size > MAX_ROOT_ASSET_IMAGE_BYTES) {
      errors.push(`${file}: top-level site image is ${stats.size} bytes; root assets are capped at 3 MiB. Use the appropriate upload/generated hierarchy instead.`);
    }
  }
}

let checkedLocalMediaReferences = 0;
for (const file of postFiles) {
  const text = await fs.readFile(file, 'utf8');
  for (const ref of assetReferences(text)) {
    checkedLocalMediaReferences += 1;
    if (!trackedSet.has(ref)) {
      errors.push(`${file}: references nonexistent local media: /${ref}`);
    }
  }
}

if (errors.length) {
  console.error('Repository integrity failures:');
  for (const error of errors) console.error('- ' + error);
  process.exit(1);
}

console.log(
  `Repository integrity OK: ${totalCount} files, ${postFiles.length} posts, ${archive.entries.length} history entries, ` +
  `${legacyPaths.length} frozen legacy uploads, ${checkedLocalMediaReferences} local article-media references checked.`
);
