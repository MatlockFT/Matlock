import { existsSync, readdirSync, readFileSync, appendFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const reportDir = resolve(process.argv[2] || 'lighthouse-reports');
const limits = {
    score: 0.70,
    lcp: 4000,
    tbtTarget: 700,
    tbtHard: 1200,
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

const median = values => {
    const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!finite.length) return undefined;
    const middle = Math.floor(finite.length / 2);
    return finite.length % 2
        ? finite[middle]
        : (finite[middle - 1] + finite[middle]) / 2;
};

const samples = files.map(file => {
    const lhr = JSON.parse(readFileSync(resolve(reportDir, file), 'utf8'));
    const rawPage = basename(file, '.json');
    const page = rawPage.replace(/-\\d+$/, '');
    return {
        page,
        score: lhr.categories?.performance?.score,
        fcp: metric(lhr, 'first-contentful-paint'),
        lcp: metric(lhr, 'largest-contentful-paint'),
        speedIndex: metric(lhr, 'speed-index'),
        tbt: metric(lhr, 'total-blocking-time'),
        cls: metric(lhr, 'cumulative-layout-shift')
    };
});

const grouped = new Map();
for (const sample of samples) {
    if (!grouped.has(sample.page)) grouped.set(sample.page, []);
    grouped.get(sample.page).push(sample);
}

const rows = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([page, pageSamples]) => ({
        page,
        samples: pageSamples.length,
        score: median(pageSamples.map(sample => sample.score)),
        fcp: median(pageSamples.map(sample => sample.fcp)),
        lcp: median(pageSamples.map(sample => sample.lcp)),
        speedIndex: median(pageSamples.map(sample => sample.speedIndex)),
        tbt: median(pageSamples.map(sample => sample.tbt)),
        cls: median(pageSamples.map(sample => sample.cls))
    }));

const failuresFor = row => {
    const failures = [];
    if (Number.isFinite(row.score) && row.score < limits.score) failures.push(`Perf ${display(row.score, 'score')} < 70`);
    if (Number.isFinite(row.lcp) && row.lcp > limits.lcp) failures.push(`LCP ${display(row.lcp)} > 4.00 s`);
    if (Number.isFinite(row.tbt) && row.tbt > limits.tbtHard) failures.push(`TBT ${display(row.tbt)} > ${display(limits.tbtHard)} hard ceiling`);
    if (Number.isFinite(row.cls) && row.cls > limits.cls) failures.push(`CLS ${display(row.cls, 'cls')} > 0.250`);
    return failures;
};

const warningsFor = row => {
    const warnings = [];
    if (Number.isFinite(row.tbt) && row.tbt > limits.tbtTarget && row.tbt <= limits.tbtHard) {
        warnings.push(`TBT ${display(row.tbt)} is above the ${display(limits.tbtTarget)} target`);
    }
    return warnings;
};

const failingRows = rows
    .map(row => ({ row, failures: failuresFor(row) }))
    .filter(item => item.failures.length);
const warningRows = rows
    .map(row => ({ row, warnings: warningsFor(row) }))
    .filter(item => item.warnings.length);

const header = '| Page | Samples | Perf | FCP | LCP | Speed Index | TBT | CLS |';
const divider = '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |';
const body = rows.map(row => [
    `| ${row.page}`,
    String(row.samples),
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
        ...failingRows.map(({ row, failures }) => `- ${row.page}: ${failures.join('; ')}`)
    ]
    : ['Performance gate passed on all audited pages.'];

const warningLines = warningRows.length
    ? [
        '',
        `Performance target warning on ${warningRows.length} page${warningRows.length === 1 ? '' : 's'}:`,
        ...warningRows.map(({ row, warnings }) => `- ${row.page}: ${warnings.join('; ')}`)
    ]
    : [];

const summary = [
    '## Mobile Lighthouse baseline',
    '',
    header,
    divider,
    ...body,
    '',
    ...gateLines,
    ...warningLines,
    '',
    'Gate uses the median of three mobile Lighthouse samples per page: performance >= 70, LCP <= 4.00 s, TBT <= 1.20 s hard ceiling (700 ms target), CLS <= 0.250.',
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
