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
const ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 12000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

async function request(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        return await fetch(url, {
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MMA-Matlock-Link-Check/2.0; +https://mmamatlock.com/)',
                'Accept': 'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
    } finally {
        clearTimeout(timeout);
    }
}

async function check(url) {
    let lastStatus = 0;
    let lastError = null;

    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        try {
            const response = await request(url);
            lastStatus = response.status;
            lastError = null;

            if (response.status === 404 || response.status === 410) {
                failures.push(`${response.status} ${url}`);
                return;
            }

            if (response.ok) return;

            if (!RETRYABLE_STATUS.has(response.status)) {
                warnings.push(`${response.status} ${url}`);
                return;
            }
        } catch (error) {
            lastError = error;
        }

        if (attempt < ATTEMPTS) {
            await sleep(500 * (2 ** (attempt - 1)));
        }
    }

    if (lastStatus) {
        warnings.push(`${lastStatus} after ${ATTEMPTS} attempts ${url}`);
    } else {
        warnings.push(`${lastError?.name || 'RequestError'} after ${ATTEMPTS} attempts ${url}`);
    }
}

async function worker() {
    while (queue.length > 0) {
        const url = queue.shift();
        if (url) await check(url);
    }
}

await Promise.all(Array.from({ length: 5 }, worker));

for (const warning of warnings) {
    console.warn(`Warning: ${warning}`);
}

if (failures.length > 0) {
    console.error('Confirmed broken external links:');

    for (const failure of failures) {
        console.error(`- ${failure}`);
    }

    process.exit(1);
}

console.log(
    `Checked ${urls.length} external links; no confirmed broken destinations (${warnings.length} transient/restricted warning${warnings.length === 1 ? '' : 's'}).`
);
