import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const POLICY_PATH = '.repository-data-policy.json';
const policy = JSON.parse(await fs.readFile(POLICY_PATH, 'utf8'));
const errors = [];

async function listFiles(root) {
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const file = path.posix.join(dir.replaceAll('\\', '/'), entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) out.push(file);
    }
  }
  await walk(root);
  return out.sort();
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) errors.push(label + ' must be a non-empty string.');
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') errors.push(label + ' must be a boolean.');
}

function matches(file, rule) {
  return (rule.paths || []).includes(file) || (rule.prefixes || []).some(prefix => file.startsWith(prefix));
}

function localReference(value) {
  return typeof value === 'string' && !value.includes(':') && (
    value.startsWith('scripts/') ||
    value.startsWith('.github/') ||
    value.startsWith('_layouts/') ||
    value.endsWith('.html') ||
    value.endsWith('.js') ||
    value.endsWith('.mjs') ||
    value.endsWith('.py') ||
    value.endsWith('.md')
  );
}

if (Number(policy.version) !== 1) errors.push('Data policy version must be 1.');
if (Number(policy.modernizationStage) !== 8) errors.push('Data policy modernizationStage must be 8.');

const expectedRoots = {
  buildTime: '_data',
  publicRuntime: 'assets/data',
  temporaryScratch: '.cache',
  generatedMedia: 'assets/generated'
};
for (const [key, value] of Object.entries(expectedRoots)) {
  if (policy.roots?.[key] !== value) errors.push(`roots.${key} must remain ${value}.`);
}

for (const [key, value] of Object.entries({
  preserveExistingPublishedDataPaths: true,
  generatedDoesNotMeanDisposable: true,
  publicRuntimeCachesAreOperationalData: true,
  temporaryScratchMustNotBeTracked: true
})) {
  if (policy.invariants?.[key] !== value) errors.push(`invariants.${key} must remain true.`);
}

const rules = Array.isArray(policy.datasets) ? policy.datasets : [];
if (!rules.length) errors.push('Data policy must define dataset rules.');

const ids = new Set();
for (const rule of rules) {
  requireString(rule.id, 'dataset.id');
  if (ids.has(rule.id)) errors.push('Duplicate dataset id: ' + rule.id);
  ids.add(rule.id);

  if (!['build-time', 'public-runtime'].includes(rule.storage)) {
    errors.push(`${rule.id}: storage must be build-time or public-runtime.`);
  }
  requireString(rule.lifecycle, `${rule.id}.lifecycle`);
  requireString(rule.owner, `${rule.id}.owner`);
  requireBoolean(rule.safeToRegenerate, `${rule.id}.safeToRegenerate`);
  requireBoolean(rule.safeToDeleteFromRepository, `${rule.id}.safeToDeleteFromRepository`);
  requireBoolean(rule.publicContract, `${rule.id}.publicContract`);

  if (!Array.isArray(rule.producers) || !rule.producers.length) errors.push(`${rule.id}: producers must be non-empty.`);
  if (!Array.isArray(rule.consumers) || !rule.consumers.length) errors.push(`${rule.id}: consumers must be non-empty.`);
  if (!(rule.paths?.length || rule.prefixes?.length)) errors.push(`${rule.id}: define paths and/or prefixes.`);

  for (const producer of rule.producers || []) {
    if (!localReference(producer)) continue;
    const stat = await fs.stat(producer).catch(() => null);
    if (!stat) errors.push(`${rule.id}: producer path does not exist: ${producer}`);
  }

  if (rule.publicContract && rule.storage !== 'public-runtime') {
    errors.push(`${rule.id}: publicContract datasets must live in public-runtime storage.`);
  }
  if (rule.publicContract && rule.safeToDeleteFromRepository) {
    errors.push(`${rule.id}: a public contract cannot be marked safe to delete.`);
  }
  if (rule.lifecycle.includes('cache') && rule.safeToDeleteFromRepository) {
    errors.push(`${rule.id}: tracked operational caches are not safe to delete merely because they are caches.`);
  }
}

const buildFiles = await listFiles(expectedRoots.buildTime);
const runtimeFiles = await listFiles(expectedRoots.publicRuntime);
const managedFiles = [...buildFiles, ...runtimeFiles];

for (const file of managedFiles) {
  const matching = rules.filter(rule => matches(file, rule));
  if (matching.length === 0) errors.push('Unclassified managed data file: ' + file);
  if (matching.length > 1) errors.push(`Data file matches multiple rules: ${file} -> ${matching.map(rule => rule.id).join(', ')}`);
  if (matching.length === 1) {
    const expectedStorage = file.startsWith('_data/') ? 'build-time' : 'public-runtime';
    if (matching[0].storage !== expectedStorage) {
      errors.push(`${file}: classified as ${matching[0].storage}, expected ${expectedStorage}.`);
    }
  }
}

const fileSet = new Set(managedFiles);
for (const rule of rules) {
  for (const file of rule.paths || []) {
    if (!fileSet.has(file)) errors.push(`${rule.id}: declared managed path is missing: ${file}`);
  }
  for (const prefix of rule.prefixes || []) {
    if (!managedFiles.some(file => file.startsWith(prefix))) {
      errors.push(`${rule.id}: declared prefix currently matches no managed files: ${prefix}`);
    }
  }
}

const gitignore = await fs.readFile('.gitignore', 'utf8');
for (const entry of policy.scratch?.gitignoreRequired || []) {
  if (!gitignore.split(/\r?\n/).includes(entry)) errors.push('Missing required scratch ignore: ' + entry);
}

const trackedScratch = execFileSync('git', ['ls-files', '--', '.cache/**', '.otd-share-cache/**', '.otd-poster-cache/**', '.otd-event-fallback-snapshot.json'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);
if (trackedScratch.length) errors.push('Temporary scratch data must not be tracked: ' + trackedScratch.join(', '));

const publicContracts = rules.filter(rule => rule.publicContract).length;
const operationalCaches = rules.filter(rule => rule.lifecycle === 'operational-cache').length;

if (errors.length) {
  console.error('Data lifecycle policy check failed:');
  for (const error of errors) console.error('- ' + error);
  process.exit(1);
}

console.log(`Data lifecycle policy OK: ${buildFiles.length} build-time files, ${runtimeFiles.length} public-runtime files, ${rules.length} lifecycle rules, ${publicContracts} public contracts, ${operationalCaches} operational-cache groups.`);
