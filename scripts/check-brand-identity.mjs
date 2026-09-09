import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const retiredDomain = ['matlock', 'fighttalk', '.com'].join('');
const retiredBrand = ['Matlock', 'Fight', 'Talk'].join(' ');
const retiredCompact = ['Matlock', 'FightTalk'].join('');
const roots = ['.', '.github', '_includes', '_layouts', 'assets', 'scripts'];
const skipDirs = new Set(['.git', '_site', 'node_modules', 'vendor', '_posts', '_data']);
const skipFiles = new Set(['scripts/check-brand-identity.mjs']);
const textExtensions = new Set(['.html', '.md', '.js', '.mjs', '.cjs', '.css', '.scss', '.yml', '.yaml', '.json', '.xml', '.txt']);
const failures = [];
const seen = new Set();

function inspect(path) {
    if (seen.has(path) || skipFiles.has(path)) return;
    seen.add(path);
    let stat;
    try { stat = statSync(path); } catch { return; }
    if (stat.isDirectory()) {
        const name = path.split('/').pop();
        if (skipDirs.has(name)) return;
        for (const entry of readdirSync(path)) inspect(join(path, entry).replaceAll('\\', '/'));
        return;
    }
    const ext = extname(path).toLowerCase();
    if (ext && !textExtensions.has(ext)) return;
    let text;
    try { text = readFileSync(path, 'utf8'); } catch { return; }
    for (const retired of [retiredDomain, retiredBrand, retiredCompact]) {
        if (text.includes(retired)) failures.push(`${path}: contains retired identity ${retired}`);
    }
}

for (const root of roots) inspect(root);

if (failures.length) {
    console.error('Retired MMA Matlock identity references found:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
}

console.log('Brand identity check passed: mmamatlock.com / MMA Matlock only.');
