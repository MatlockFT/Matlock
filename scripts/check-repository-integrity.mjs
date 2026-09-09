import fs from 'node:fs/promises';

const requiredFiles = [
    '_config.yml',
    '_layouts/default.html',
    'CNAME',
    'index.html',
    'on-this-day.html',
    'assets/base.css',
    'assets/site.js',
    'assets/data/on-this-day.json'
];

const errors = [];
for (const file of requiredFiles) {
    const stats = await fs.stat(file).catch(() => null);
    if (!stats?.isFile() || stats.size === 0) errors.push(`Missing or empty critical file: ${file}`);
}

async function countFiles(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    let count = 0;
    for (const entry of entries) {
        if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '_site') continue;
        count += entry.isDirectory() ? await countFiles(`${directory}/${entry.name}`) : 1;
    }
    return count;
}

const postCount = (await fs.readdir('_posts').catch(() => [])).filter(name => /\.(md|markdown|html)$/i.test(name)).length;
const totalCount = await countFiles('.');
if (postCount < 20) errors.push(`Repository contains only ${postCount} posts; expected at least 20.`);
if (totalCount < 350) errors.push(`Repository contains only ${totalCount} files; expected at least 350.`);

const archive = JSON.parse(await fs.readFile('assets/data/on-this-day.json', 'utf8').catch(() => '{}'));
if (!Array.isArray(archive.entries) || archive.entries.length < 1500) {
    errors.push(`On This Day archive contains ${archive.entries?.length || 0} entries; expected at least 1500.`);
}

if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log(`Repository integrity OK: ${totalCount} files, ${postCount} posts, ${archive.entries.length} history entries.`);
