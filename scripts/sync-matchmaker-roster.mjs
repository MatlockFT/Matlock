import fs from 'node:fs/promises';
import { reconcileRoster, rosterUrl } from './matchmaker/roster.mjs';
import { validateData } from './matchmaker/validate.mjs';
import { reconcileBookings } from './matchmaker/bookings.mjs';
const file = 'assets/data/matchmaker/current.json';
const before = await fs.readFile(file, 'utf8');
const data = JSON.parse(before);
const response = process.argv[2] ? null : await fetch(rosterUrl, { signal: AbortSignal.timeout(30000) });
if (response && !response.ok) throw new Error(`Roster fetch failed: ${response.status}`);
const roster = response ? await response.json() : JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const overrides = JSON.parse(await fs.readFile('_data/matchmaker-roster-overrides.json', 'utf8'));
const changes = reconcileRoster(data, roster, overrides);
const schedule = JSON.parse(await fs.readFile('_data/upcoming_events.json', 'utf8'));
const bookingChanges = reconcileBookings(data, roster, schedule);
validateData(data);
const after = JSON.stringify(data, null, 2) + '\n';
if (after !== before) {
  data.sources.roster.checkedAt = roster.checkedAt;
  await fs.writeFile(file + '.tmp', JSON.stringify(data, null, 2) + '\n');
  await fs.rename(file + '.tmp', file);
}
console.log(JSON.stringify({ availabilityChanges: changes, bookingChanges, activeFighters: data.coverage.activeFighters, changed: after !== before }, null, 2));
