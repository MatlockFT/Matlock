import { existsSync, readdirSync, readFileSync, appendFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const reportDir = resolve(process.argv[2] || 'lighthouse-reports');

if (!existsSync(reportDir)) {
    throw new Error(`Lighthouse report directory does not exist: ${reportDir}`);
}

const files = readdirSync(reportDir)
    .filter(name => name.endsWith('.json'))
    .sort();

if (!files.length) {
    throw new Error(`No Lighthouse JSON reports found in ${reportDir}`);
}

const metric = (lhr, id) => lhr.audits?.[id]?.numericValue;
const display = (value, kind = 'ms') => {
    if (!Number.isFinite(value)) return '—';
    if (kind === 'score') return String(Math.round(value * 100));
    if (kind === 'cls') return value.toFixed(3);
    if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
    return `${Math.round(value)} ms`;
};

const rows = files.map(file => {
    const lhr = JSON.parse(readFileSync(resolve(reportDir, file), 'utf8'));
    return {
        page: basename(file, '.json'),
        score: lhr.categories?.performance?.score,
        fcp: metric(lhr, 'first-contentful-paint'),
        lcp: metric(lhr, 'largest-contentful-paint'),
        speedIndex: metric(lhr, 'speed-index'),
        tbt: metric(lhr, 'total-blocking-time'),
        cls: metric(lhr, 'cumulative-layout-shift')
    };
});

const header = '| Page | Perf | FCP | LCP | Speed Index | TBT | CLS |';
const divider = '| --- | ---: | ---: | ---: | ---: | ---: | ---: |';
const body = rows.map(row => [
    `| ${row.page}`,
    display(row.score, 'score'),
    display(row.fcp),
    display(row.lcp),
    display(row.speedIndex),
    display(row.tbt),
    display(row.cls, 'cls')
].join(' | ') + ' |');

const warningRows = rows.filter(row =>
    (Number.isFinite(row.lcp) && row.lcp > 4000) ||
    (Number.isFinite(row.tbt) && row.tbt > 600) ||
    (Number.isFinite(row.cls) && row.cls > 0.25)
);

const summary = [
    '## Mobile Lighthouse baseline',
    '',
    header,
    divider,
    ...body,
    '',
    warningRows.length
        ? `Review suggested: ${warningRows.map(row => row.page).join(', ')}.`
        : 'No page crossed the broad lab warning thresholds (LCP > 4 s, TBT > 600 ms, or CLS > 0.25).',
    '',
    '_Lab measurements are useful for regression tracking. They are not field INP/Core Web Vitals data._',
    ''
].join('\n');

console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
