import { existsSync, readdirSync, readFileSync, appendFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const reportDir = resolve(process.argv[2] || 'lighthouse-reports');
const limits = {
    score: 0.70,
    lcp: 4000,
    tbt: 700,
    cls: 0.25
};

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

const failuresFor = row => {
    const failures = [];
    if (Number.isFinite(row.score) && row.score < limits.score) failures.push(`Perf ${display(row.score, 'score')} < 70`);
    if (Number.isFinite(row.lcp) && row.lcp > limits.lcp) failures.push(`LCP ${display(row.lcp)} > 4.00 s`);
    if (Number.isFinite(row.tbt) && row.tbt > limits.tbt) failures.push(`TBT ${display(row.tbt)} > 700 ms`);
    if (Number.isFinite(row.cls) && row.cls > limits.cls) failures.push(`CLS ${display(row.cls, 'cls')} > 0.250`);
    return failures;
};

const failingRows = rows
    .map(row => ({ row, failures: failuresFor(row) }))
    .filter(item => item.failures.length);

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

const gateLines = failingRows.length
    ? [
        `Performance gate failed on ${failingRows.length} page${failingRows.length === 1 ? '' : 's'}:`,
        ...failingRows.map(({ row, failures }) => `- ${row}: ${failures.join('; ')}`)
    ]
    : ['Performance gate passed on all audited pages.'];

const summary = [
    '## Mobile Lighthouse baseline',
    '',
    header,
    divider,
    ...body,
    '',
    ...gateLines,
    '',
    'Gate: performance >= 70, LCP <= 4.00 s, TBT <= 700 ms, CLS <= 0.250.',
    '',
    '_Lab measurements are useful for regression tracking. They are not field INP/Core Web Vitals data._',
    ''
].join('\n');

console.log(summary);

if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (failingRows.length) {
    process.exitCode = 1;
}
