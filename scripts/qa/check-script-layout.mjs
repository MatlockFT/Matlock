import { execFileSync } from 'node:child_process';
import { posix as path } from 'node:path';
import fs from 'node:fs/promises';

const allowedDomains = new Set([
  'writer',
  'media',
  'matchmaker',
  'news',
  'history',
  'site-data',
  'qa'
]);

const codeExtensions = new Set(['.js', '.mjs', '.cjs']);
const textExtensions = new Set([
  '.js', '.mjs', '.cjs', '.py', '.sh', '.md', '.html', '.css',
  '.yml', '.yaml', '.json', '.txt', '.xml', '.toml'
]);

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function extension(file) {
  const match = String(file).match(/(\.[^.\/]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function resolveImport(sourceFile, specifier, fileSet) {
  const base = path.normalize(path.join(path.dirname(sourceFile), specifier));
  const candidates = [
    base,
    base + '.js',
    base + '.mjs',
    base + '.cjs',
    path.join(base, 'index.js'),
    path.join(base, 'index.mjs'),
    path.join(base, 'index.cjs')
  ];
  return candidates.find(candidate => fileSet.has(candidate)) || '';
}

const files = trackedFiles();
const fileSet = new Set(files);
const failures = [];

const scriptFiles = files.filter(file => file.startsWith('scripts/'));
for (const file of scriptFiles) {
  const remainder = file.slice('scripts/'.length);
  if (!remainder.includes('/')) {
    failures.push(`${file}: Stage 5 does not allow files directly under scripts/.`);
    continue;
  }
  const domain = remainder.split('/')[0];
  if (!allowedDomains.has(domain)) {
    failures.push(`${file}: unknown script domain "${domain}".`);
  }
}

for (const file of scriptFiles.filter(file => codeExtensions.has(extension(file)))) {
  const source = await fs.readFile(file, 'utf8');
  const imports = [
    ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ...source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)
  ].map(match => match[1]).filter(specifier => specifier.startsWith('.'));

  for (const specifier of imports) {
    if (!resolveImport(file, specifier, fileSet)) {
      failures.push(`${file}: relative import "${specifier}" no longer resolves after script organization.`);
    }
  }
}

for (const file of files.filter(file => textExtensions.has(extension(file)))) {
  const source = await fs.readFile(file, 'utf8').catch(() => '');
  const references = [
    ...source.matchAll(/\bscripts\/([A-Za-z0-9_.-]+\.(?:mjs|cjs|js|py))\b/g)
  ];

  for (const match of references) {
    const stalePath = 'scripts/' + match[1];
    failures.push(`${file}: stale pre-Stage-5 script reference "${stalePath}".`);
  }

  const scriptPaths = [
    ...source.matchAll(/\bscripts\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:mjs|cjs|js|py)\b/g)
  ].map(match => match[0]);

  for (const referencedPath of new Set(scriptPaths)) {
    if (!fileSet.has(referencedPath)) {
      failures.push(`${file}: script reference does not resolve: ${referencedPath}.`);
    }
  }
}

if (failures.length) {
  console.error(`Script layout check failed with ${failures.length} issue(s):`);
  failures.forEach(failure => console.error('- ' + failure));
  process.exit(1);
}

console.log(
  `Script layout OK: ${scriptFiles.length} tracked script files across ` +
  `${[...allowedDomains].join(', ')}; no root-level scripts or stale references.`
);
