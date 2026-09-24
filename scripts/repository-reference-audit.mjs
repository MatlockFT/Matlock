import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const checkMode = args.includes('--check');
const jsonMode = args.includes('--json');
const targets = [];

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--target' && args[i + 1]) {
    targets.push(args[i + 1].replace(/^\.\//, ''));
    i += 1;
  }
}

const textExtensions = new Set([
  '.html', '.md', '.markdown', '.css', '.js', '.mjs', '.cjs', '.json',
  '.yml', '.yaml', '.txt', '.xml', '.toml', '.rb', '.sh'
]);

function trackedFiles() {
  const raw = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return raw.split('\0').filter(Boolean).sort();
}

function isTextFile(file) {
  return textExtensions.has(path.extname(file).toLowerCase()) ||
    ['CNAME', 'Gemfile', 'LICENSE', '.gitignore'].includes(path.basename(file));
}

function frontmatter(text) {
  const match = String(text || '').match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  return match ? match[1] : '';
}

function scalar(block, key) {
  const escaped = key.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp('^' + escaped + ':\\s*(.*?)\\s*$', 'm'));
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

function list(block, key) {
  const lines = block.split('\n');
  const values = [];
  let active = false;

  for (const line of lines) {
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      active = top[1] === key;
      if (active && top[2].trim()) values.push(top[2].trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }

    if (!active) continue;
    const item = line.match(/^\s+-\s+(.+?)\s*$/);
    if (item) values.push(item[1].trim().replace(/^['"]|['"]$/g, ''));
    else if (/^\S/.test(line)) active = false;
  }

  return values;
}

function classify(file) {
  if (file.startsWith('_posts/')) return 'articles';
  if (file.startsWith('assets/uploads/')) return 'article/uploads';
  if (file.startsWith('assets/generated/')) return 'generated assets';
  if (file.startsWith('assets/data/')) return 'runtime data';
  if (file.startsWith('assets/gallery/')) return 'gallery';
  if (file.startsWith('assets/')) return 'site assets';
  if (file.startsWith('scripts/')) return 'automation/scripts';
  if (file.startsWith('.github/')) return 'github automation';
  if (file.startsWith('_netlify-auth/')) return 'writer backend';
  if (file.startsWith('_data/')) return 'jekyll data';
  if (file.startsWith('_layouts/') || file.startsWith('_includes/')) return 'jekyll templates';
  if (file.startsWith('docs/')) return 'documentation';
  if (!file.includes('/') && /\.html$/i.test(file)) return 'root pages';
  if (!file.includes('/')) return 'root support';
  return 'other';
}

function humanBytes(bytes) {
  if (bytes < 1024) return String(bytes) + ' B';
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + ' KiB';
  return (bytes / 1024 ** 2).toFixed(1) + ' MiB';
}

function needlesFor(target, targetText) {
  const needles = new Set([target, '/' + target, path.basename(target)]);

  if (/\.html$/i.test(target)) {
    const permalink = scalar(frontmatter(targetText), 'permalink');
    if (permalink) needles.add(permalink);
  }

  return [...needles].filter(Boolean);
}

function referencesFor(target, targetText, cache) {
  const needles = needlesFor(target, targetText);
  const refs = [];

  for (const [file, text] of cache.entries()) {
    if (file === target) continue;
    const lines = text.split('\n');

    for (let index = 0; index < lines.length; index += 1) {
      if (needles.some(needle => lines[index].includes(needle))) {
        refs.push({
          file,
          line: index + 1,
          text: lines[index].trim().slice(0, 220)
        });
      }
    }
  }

  return refs;
}

const files = trackedFiles();
const fileSet = new Set(files);
const cache = new Map();
const groups = new Map();
let totalBytes = 0;
let rootFiles = 0;
let postCount = 0;

for (const file of files) {
  const stat = await fs.stat(file);
  totalBytes += stat.size;
  if (!file.includes('/')) rootFiles += 1;
  if (file.startsWith('_posts/')) postCount += 1;

  const groupName = classify(file);
  const group = groups.get(groupName) || { files: 0, bytes: 0 };
  group.files += 1;
  group.bytes += stat.size;
  groups.set(groupName, group);

  if (isTextFile(file)) {
    cache.set(file, await fs.readFile(file, 'utf8').catch(() => ''));
  }
}

const rootHtml = files.filter(file => !file.includes('/') && /\.html$/i.test(file));
const migrationPages = rootHtml.filter(file => /(?:-v\d+\.html$|^legacy-.*\.html$)/i.test(file));

const migrationCandidates = migrationPages.map(file => {
  const references = referencesFor(file, cache.get(file) || '', cache);
  return {
    file,
    referenceCount: references.length,
    references: references.slice(0, 12)
  };
});

const permalinkOwners = new Map();
for (const file of rootHtml) {
  const permalink = scalar(frontmatter(cache.get(file) || ''), 'permalink');
  if (!permalink) continue;
  const owners = permalinkOwners.get(permalink) || [];
  owners.push(file);
  permalinkOwners.set(permalink, owners);
}

const duplicatePermalinks = [...permalinkOwners.entries()]
  .filter(([, owners]) => owners.length > 1)
  .map(([permalink, owners]) => ({ permalink, owners }));

const missingAssets = [];
for (const file of rootHtml) {
  const fm = frontmatter(cache.get(file) || '');

  for (const key of ['page_styles', 'page_scripts']) {
    for (const value of list(fm, key)) {
      const clean = value.split(/[?#]/)[0].trim();
      if (!clean.startsWith('/')) continue;
      const localPath = clean.replace(/^\//, '');
      if (!fileSet.has(localPath)) missingAssets.push({ file, key, value });
    }
  }
}

const explicitTargets = targets.map(file => ({
  file,
  exists: fileSet.has(file),
  references: referencesFor(file, cache.get(file) || '', cache)
}));

const summary = {
  trackedFiles: files.length,
  trackedBytes: totalBytes,
  rootFiles,
  posts: postCount,
  groups: [...groups.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.bytes - a.bytes),
  migrationCandidates,
  duplicatePermalinks,
  missingAssets,
  explicitTargets
};

if (jsonMode) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('Repository reference audit');
  console.log('==========================');
  console.log('Tracked files: ' + summary.trackedFiles);
  console.log('Tracked size:  ' + humanBytes(summary.trackedBytes));
  console.log('Root files:    ' + summary.rootFiles);
  console.log('Articles:      ' + summary.posts);
  console.log('');

  console.log('Major groups:');
  for (const item of summary.groups) {
    console.log('  ' + item.name.padEnd(20) + String(item.files).padStart(4) + ' files  ' + humanBytes(item.bytes).padStart(10));
  }

  console.log('');
  console.log('Root migration/legacy candidates:');
  if (!migrationCandidates.length) console.log('  none');

  for (const item of migrationCandidates) {
    console.log('  ' + item.file + ': ' + item.referenceCount + ' inbound text reference(s)');
    for (const ref of item.references.slice(0, 5)) {
      console.log('    - ' + ref.file + ':' + ref.line);
    }
    if (item.referenceCount > 5) console.log('    - ... ' + (item.referenceCount - 5) + ' more');
  }

  if (explicitTargets.length) {
    console.log('');
    console.log('Requested targets:');

    for (const item of explicitTargets) {
      console.log('  ' + item.file + ': ' + (item.exists ? 'tracked' : 'NOT TRACKED') + ', ' + item.references.length + ' reference(s)');
      for (const ref of item.references) {
        console.log('    - ' + ref.file + ':' + ref.line + '  ' + ref.text);
      }
    }
  }

  console.log('');
  console.log('Duplicate root permalinks: ' + duplicatePermalinks.length);
  for (const item of duplicatePermalinks) {
    console.log('  ' + item.permalink + ': ' + item.owners.join(', '));
  }

  console.log('Missing root page_styles/page_scripts assets: ' + missingAssets.length);
  for (const item of missingAssets) {
    console.log('  ' + item.file + ' -> ' + item.value);
  }
}

if (checkMode) {
  const errors = [];

  if (duplicatePermalinks.length) errors.push('Duplicate root permalinks detected.');
  if (missingAssets.length) errors.push('Root pages reference missing page_styles/page_scripts assets.');

  for (const item of explicitTargets) {
    if (!item.exists) errors.push('Requested target is not tracked: ' + item.file);
  }

  if (errors.length) {
    console.error('');
    console.error('Reference audit failed:');
    for (const error of errors) console.error('- ' + error);
    process.exit(1);
  }

  console.log('');
  console.log('Reference audit checks passed.');
}
