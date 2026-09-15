import fs from 'node:fs/promises';

const REPORT_PATH = 'assets/data/matchmaker/backtest-report.json';

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function sortedCounts(items, field) {
  const counts = {};
  for (const item of items) {
    const value = item?.[field];
    if (!value) continue;
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

const report = JSON.parse(await fs.readFile(REPORT_PATH, 'utf8'));
if (report?.schemaVersion !== 4 || !Array.isArray(report.caseClassifications)) {
  throw new Error('Expected a v4 Matchmaker historical-universe backtest report.');
}

let reclassified = 0;
for (const item of report.caseClassifications) {
  if (item.classification !== 'coverage-failure') continue;
  const match = String(item.reason || '').match(/^historical-division-mismatch:(.+)$/);
  if (!match || !item.targetDivision || !item.division) continue;
  const historicalOpponentDivision = match[1];
  if (normalize(item.targetDivision) !== normalize(item.division)) continue;
  if (normalize(historicalOpponentDivision) === normalize(item.targetDivision)) continue;

  item.classification = 'future-opponent-division-change';
  item.reason = `actual-opponent-moved-from:${historicalOpponentDivision}:to:${item.targetDivision}`;
  item.actualHistoricalDivision = historicalOpponentDivision;
  item.excludedFromAccuracy = true;
  reclassified++;
}

report.schemaVersion = 5;
report.mode = 'temporal-historical-universe-v5';
report.classifications = sortedCounts(report.caseClassifications, 'classification');
report.reasons = sortedCounts(report.caseClassifications, 'reason');
report.classificationRefinement = {
  opponentDivisionMovesReclassified: reclassified,
  note: 'If the eventual bout stayed in the subject cutoff division but the opponent was historically in another division at the cutoff, the case is classified as a future opponent division change rather than a data-coverage failure.'
};
report.leakageControls = [
  ...(report.leakageControls || []),
  'Opponent-side future division changes are identified only after scoring from the eventual bout weight class; they are excluded from accuracy and never used to alter the candidate ranking.'
];

await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
console.log(`Refined Matchmaker backtest classifications: ${reclassified} opponent-side future division change${reclassified === 1 ? '' : 's'} separated from coverage failures.`);
