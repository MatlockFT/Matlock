import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../..');
const GENERATED_ROOT = path.join(ROOT, 'assets', 'generated');
const MANIFEST_PATH = path.join(ROOT, '.repository-generated-assets.json');

async function listFiles(directory) {
  const output = [];
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(absolute));
    else if (entry.isFile()) output.push(absolute);
  }
  return output.sort();
}

function relative(file) {
  return path.relative(ROOT, file).replaceAll('\\', '/');
}

function gitBlobSha(file) {
  return execFileSync('git', ['hash-object', relative(file)], {
    cwd: ROOT,
    encoding: 'utf8'
  }).trim();
}

export async function buildGeneratedIntegrityManifest() {
  const files = await listFiles(GENERATED_ROOT);
  const entries = {};
  for (const file of files) entries[relative(file)] = gitBlobSha(file);
  return {
    version: 1,
    root: 'assets/generated',
    hashAlgorithm: 'git-blob-sha1',
    generatedBy: 'npm run optimize:images',
    files: entries
  };
}

export async function writeGeneratedIntegrityManifest() {
  const manifest = await buildGeneratedIntegrityManifest();
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Generated integrity manifest updated: ${Object.keys(manifest.files).length} files.`);
  return manifest;
}

export async function checkGeneratedIntegrityManifest() {
  const errors = [];
  const expected = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  const actual = await buildGeneratedIntegrityManifest();

  if (expected.version !== 1) errors.push('Generated integrity manifest version must be 1.');
  if (expected.root !== 'assets/generated') errors.push('Generated integrity root must remain assets/generated.');
  if (expected.hashAlgorithm !== 'git-blob-sha1') errors.push('Generated integrity hashAlgorithm must remain git-blob-sha1.');

  const expectedFiles = expected.files && typeof expected.files === 'object' ? expected.files : {};
  const actualFiles = actual.files;
  const expectedPaths = Object.keys(expectedFiles).sort();
  const actualPaths = Object.keys(actualFiles).sort();

  for (const file of actualPaths) {
    if (!(file in expectedFiles)) errors.push(`Generated file is missing from integrity manifest: ${file}`);
    else if (expectedFiles[file] !== actualFiles[file]) errors.push(`Generated file changed without regeneration: ${file}`);
  }
  for (const file of expectedPaths) {
    if (!(file in actualFiles)) errors.push(`Integrity manifest references missing generated file: ${file}`);
  }

  if (errors.length) {
    console.error('Generated asset integrity failures:');
    for (const error of errors) console.error('- ' + error);
    process.exitCode = 1;
    return false;
  }

  console.log(`Generated asset integrity OK: ${actualPaths.length} generated files match the regeneration manifest.`);
  return true;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.argv.includes('--write')) await writeGeneratedIntegrityManifest();
  else await checkGeneratedIntegrityManifest();
}
