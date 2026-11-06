import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const siteRoot = resolve(process.argv[2] || join(root, '_site'));
const errors = [];

const retiredSource = [
  'upcoming-events.html',
  '_includes/fight-card-picker-event.html',
  'assets/upcoming-events.js',
  'assets/upcoming-events-bootstrap.js',
  'assets/upcoming-events-jump.js',
  'assets/upcoming-events-links.js',
  'assets/upcoming-events.css',
  'assets/upcoming-events-v3.css',
  'assets/upcoming-events-layout.css',
  'assets/upcoming-events-portrait-fixes.css',
  'scripts/site-data/ufc/cache-picker-lcp-portrait.mjs',
  '_data/picker_lcp_portrait.json'
];

for (const name of retiredSource) {
  if (existsSync(join(root, name))) errors.push('Retired source file returned: ' + name);
}

if (!existsSync(siteRoot)) {
  console.error('Site build missing: ' + siteRoot);
  process.exit(1);
}

const retiredOutput = [
  'upcoming-events.html',
  'upcoming-events/index.html',
  'assets/upcoming-events.js',
  'assets/upcoming-events-bootstrap.js',
  'assets/upcoming-events-jump.js',
  'assets/upcoming-events-links.js',
  'assets/upcoming-events.css',
  'assets/upcoming-events-v3.css',
  'assets/upcoming-events-layout.css',
  'assets/upcoming-events-portrait-fixes.css'
];
for (const name of retiredOutput) {
  if (existsSync(join(siteRoot, name))) errors.push('Retired page or asset was published: ' + name);
}

const origin = 'https://mmamatlock.com/';
function isRetiredLink(value) {
  try {
    const url = new URL(value, origin);
    return (url.hostname === 'mmamatlock.com' || url.hostname === 'www.mmamatlock.com') &&
      /^\/upcoming-events(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

let htmlCount = 0;
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      inspect(path);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      htmlCount += 1;
      const html = readFileSync(path, 'utf8');
      const name = relative(siteRoot, path).split(sep).join('/');
      const links = /\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi;
      let match;
      while ((match = links.exec(html)) !== null) {
        if (isRetiredLink(match[2])) errors.push(name + ': points to removed Fight Cards route: ' + match[2]);
        if (/^\/assets\/upcoming-events(?:[-.]|\/)/i.test(match[2])) {
          errors.push(name + ': references removed picker asset: ' + match[2]);
        }
      }
      if (/\bdata-detail-picker\b/.test(html)) {
        errors.push(name + ': contains retired Event Map picker control');
      }
    }
  }
}
inspect(siteRoot);

if (errors.length) {
  console.error('Retired Fight Cards regression (' + errors.length + '):\n' + errors.map(s => '- ' + s).join('\n'));
  process.exit(1);
}
console.log('Retired Fight Cards check passed (' + htmlCount + ' HTML files; page, assets, routes, and picker control absent).');
