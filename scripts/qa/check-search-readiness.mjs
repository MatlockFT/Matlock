import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] || '_site');
const failures = [];
const warnings = [];
const SITE = 'https://mmamatlock.com';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(path);
  }
  return out;
}

function publicPath(file) {
  let rel = relative(root, file).split(sep).join('/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return '/' + rel.slice(0, -'index.html'.length);
  return '/' + rel;
}

function attrValue(tag, name) {
  const rx = new RegExp('\\b' + name + '=["\\\']([^"\\\']+)["\\\']', 'i');
  const m = String(tag || '').match(rx);
  return m ? m[1].trim() : '';
}

function canonical(html) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  const tag = tags.find(value => /\brel=["']canonical["']/i.test(value));
  return attrValue(tag, 'href');
}

function description(html) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const tag = tags.find(value => /\bname=["']description["']/i.test(value));
  return attrValue(tag, 'content');
}

function robots(html) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  const tag = tags.find(value => /\bname=["']robots["']/i.test(value));
  return attrValue(tag, 'content').toLowerCase();
}

if (!existsSync(root)) {
  console.error('Built site not found: ' + root);
  process.exit(1);
}

for (const required of ['robots.txt', 'sitemap.xml', 'ads.txt', 'about/index.html', 'contact/index.html', 'privacy/index.html']) {
  if (!existsSync(join(root, required))) failures.push('Missing built file: ' + required);
}

const sitemapPath = join(root, 'sitemap.xml');
const sitemap = existsSync(sitemapPath) ? readFileSync(sitemapPath, 'utf8') : '';
const sitemapUrls = new Set();
for (const match of sitemap.matchAll(new RegExp('<loc>(https://mmamatlock\\.com[^<]*)</loc>', 'g'))) {
  sitemapUrls.add(match[1]);
}

const robotsText = existsSync(join(root, 'robots.txt')) ? readFileSync(join(root, 'robots.txt'), 'utf8') : '';
if (!/User-agent:\s*\*/i.test(robotsText) || !/Allow:\s*\//i.test(robotsText)) failures.push('robots.txt must allow normal crawling');
if (!new RegExp('Sitemap:\\s*https://mmamatlock\\.com/sitemap\\.xml', 'i').test(robotsText)) failures.push('robots.txt must advertise the canonical sitemap');

const adsText = existsSync(join(root, 'ads.txt')) ? readFileSync(join(root, 'ads.txt'), 'utf8').trim() : '';
const expectedAds = 'google.com, pub-5948515643609166, DIRECT, f08c47fec0942fa0';
if (adsText !== expectedAds) failures.push('ads.txt does not contain the expected AdSense seller authorization');

let indexableCount = 0;
let postLikeCount = 0;

for (const file of walk(root)) {
  const html = readFileSync(file, 'utf8');
  const path = publicPath(file);
  if (/http-equiv=["']refresh["']/i.test(html)) continue;

  const noindex = robots(html).includes('noindex');
  const url = SITE + (path === '/' ? '/' : path);
  const inSitemap = sitemapUrls.has(url);

  if (noindex) {
    if (inSitemap) failures.push(path + ': noindex page appears in sitemap');
    if (/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/i.test(html)) {
      failures.push(path + ': noindex page still loads AdSense');
    }
    continue;
  }

  indexableCount += 1;
  if (/^\/\d{4}\/\d{2}\/\d{2}\//.test(path)) postLikeCount += 1;

  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || '';
  const desc = description(html);
  const canon = canonical(html);

  if (!title) failures.push(path + ': missing title');
  if (!desc) failures.push(path + ': missing meta description');
  if (!canon) failures.push(path + ': missing canonical URL');
  else if (!canon.startsWith(SITE + '/')) failures.push(path + ': canonical points outside canonical host: ' + canon);

  const h1s = (html.match(/<h1\b/gi) || []).length;
  if (h1s === 0) warnings.push(path + ': no H1 found');
  if (h1s > 1) warnings.push(path + ': multiple H1 elements found (' + h1s + ')');

  if (!inSitemap && path !== '/404.html') warnings.push(path + ': indexable HTML page is not in sitemap');
}

for (const requiredUrl of [SITE + '/', SITE + '/about/', SITE + '/contact/', SITE + '/privacy/']) {
  if (!sitemapUrls.has(requiredUrl)) failures.push('Sitemap missing trust/core URL: ' + requiredUrl);
}

if (sitemapUrls.has(SITE + '/write/')) failures.push('/write/ must not appear in sitemap');
if (postLikeCount < 20) warnings.push('Only ' + postLikeCount + ' dated article pages were detected in the built site');

for (const warning of warnings) console.warn('Warning: ' + warning);

if (failures.length) {
  console.error('Search readiness failures:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('Search readiness OK: ' + indexableCount + ' indexable HTML pages, ' + sitemapUrls.size + ' sitemap URLs, ' + postLikeCount + ' dated articles.');
