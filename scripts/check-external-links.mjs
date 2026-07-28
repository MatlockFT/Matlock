import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const htmlPath = resolve(process.argv[2] || '_site/mma-yellowpages.html');
const html = readFileSync(htmlPath, 'utf8');
const urls = [
    ...new Set(
        [...html.matchAll(/\bhref=["'](https?:\/\/[^"'#]+)["']/gi)]
            .map(match => match[1].replaceAll('&amp;', '&'))
    )
];

const failures = [];
const warnings = [];
const queue = [...urls];

async function check(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'MMA-Matlock-Link-Check/1.0'
            }
        });

        if (
            response.status === 404 ||
            response.status === 410 ||
            response.status >= 500
        ) {
            failures.push(`${response.status} ${url}`);
        } else if (!response.ok) {
            warnings.push(`${response.status} ${url}`);
        }
    } catch (error) {
        warnings.push(`${error.name} ${url}`);
    } finally {
        clearTimeout(timeout);
    }
}

async function worker() {
    while (queue.length > 0) {
        await check(queue.shift());
    }
}

await Promise.all(Array.from({ length: 5 }, worker));

for (const warning of warnings) {
    console.warn(`Warning: ${warning}`);
}

if (failures.length > 0) {
    console.error('Broken external links:');

    for (const failure of failures) {
        console.error(`- ${failure}`);
    }

    process.exit(1);
}

console.log(
    `Checked ${urls.length} external links; no confirmed broken destinations.`
);
