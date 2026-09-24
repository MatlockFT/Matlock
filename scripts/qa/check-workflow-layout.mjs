import fs from 'node:fs/promises';
import path from 'node:path';

const workflowDir = '.github/workflows';
const files = (await fs.readdir(workflowDir))
  .filter(name => /\.ya?ml$/i.test(name))
  .sort();
const fileSet = new Set(files);
const failures = [];

const required = [
  'writer-quality.yml',
  'site-browser-quality.yml',
  'update-matchmaker.yml',
  'site-quality.yml'
];

const retired = [
  'writer-auth-quality.yml',
  'writer-production-smoke.yml',
  'mobile-performance.yml',
  'site-visual-smoke.yml',
  'matchmaker-build.yml'
];

for (const name of required) {
  if (!fileSet.has(name)) failures.push(`Missing consolidated workflow: ${name}`);
}
for (const name of retired) {
  if (fileSet.has(name)) failures.push(`Retired workflow still exists: ${name}`);
}

const names = new Map();
for (const file of files) {
  const source = await fs.readFile(path.join(workflowDir, file), 'utf8');
  const match = source.match(/^name:\s*(.+?)\s*$/m);
  if (!match) {
    failures.push(`${file}: workflow is missing a top-level name.`);
    continue;
  }
  const displayName = match[1].trim().replace(/^['"]|['"]$/g, '');
  const owners = names.get(displayName) || [];
  owners.push(file);
  names.set(displayName, owners);
}
for (const [displayName, owners] of names) {
  if (owners.length > 1) failures.push(`Duplicate workflow name "${displayName}": ${owners.join(', ')}`);
}

const pagesConfig = await fs.readFile('.pages.yml', 'utf8').catch(() => '');
for (const match of pagesConfig.matchAll(/^\s*workflow:\s*([^\s#]+)\s*$/gm)) {
  const workflow = match[1].replace(/^['"]|['"]$/g, '');
  if (!fileSet.has(workflow)) failures.push(`.pages.yml references missing workflow: ${workflow}`);
}

if (failures.length) {
  console.error(`Workflow layout check failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log(
  `Workflow layout OK: ${files.length} workflows; Writer, browser quality, and Matchmaker validation are consolidated.`
);
