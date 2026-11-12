import assert from 'node:assert/strict';
import { reconcileRoster } from './roster.mjs';
import { buildCanonicalProfileRegistry } from './profile-aliases.mjs';
import { profileStatus } from './sources/ufc.mjs';

const olderNakamuraProfile = { canonicalUrl: 'https://www.ufc.com/athlete/keiichiro-nakamura', name: 'Keiichiro Nakamura', active: true };
const newerNakamuraProfile = { canonicalUrl: 'https://www.ufc.com/athlete/keiichiro-nakamura-0', name: 'Keiichiro Nakamura', active: true };
const otherAthlete = { canonicalUrl: 'https://www.ufc.com/athlete/ollie-schmid', name: 'Ollie Schmid', active: true };
for (const pair of [[olderNakamuraProfile, newerNakamuraProfile], [newerNakamuraProfile, olderNakamuraProfile]]) {
  const canonical = buildCanonicalProfileRegistry([...pair, otherAthlete]);
  assert.equal(canonical.length, 2, 'UFC duplicate profiles must not create duplicate fighters');
  const nakamura = canonical.find(fighter => fighter.id === 'keiichiro-nakamura');
  assert(nakamura && nakamura.active);
  assert.equal(nakamura.source, newerNakamuraProfile.canonicalUrl, 'Use the newer official profile for updates');
  assert(nakamura.aliases.includes('keiichiro-nakamura-0'), 'Completed event links must resolve to the canonical fighter');
  const ids = new Map(canonical.flatMap(fighter => [fighter.id, ...fighter.aliases].map(id => [id, fighter.id])));
  assert.equal(ids.get('keiichiro-nakamura-0'), nakamura.id);
}
assert.throws(() => buildCanonicalProfileRegistry([olderNakamuraProfile, { ...newerNakamuraProfile, name: 'Unrelated Fighter' }]), /Conflicting UFC profile identity/);
assert.throws(() => buildCanonicalProfileRegistry([olderNakamuraProfile, { ...otherAthlete, profileAliases: [olderNakamuraProfile.canonicalUrl] }]), /Conflicting UFC roster alias/);

const now = Date.parse('2026-09-11T05:00:00Z');
const roster = { checkedAt: new Date(now).toISOString(), canonicalFighters: Array.from({ length: 501 }, (_, i) => ({ canonicalUrl: `https://www.ufc.com/athlete/fighter-${i}`, active: true })) };
roster.canonicalFighters[0].profileAliases = ['https://www.ufc.com/athlete/alias'];
const data = { fighters: [{ id: 'alias', active: true }, { id: 'fighter-1', active: true, profileStatus: 'Not Fighting', source: 'https://www.ufc.com/athlete/fighter-1' }], coverage: {} };
assert.equal(profileStatus('<div>Status</div><div>Not Fighting</div>'), 'Not Fighting');
assert.equal(profileStatus('<p>Former opponent retired</p>'), null);
assert.equal(reconcileRoster(data, roster, {}, now).length, 1);
assert.equal(data.fighters[0].active, true, 'Canonical aliases preserve active eligibility');
assert.equal(data.fighters[1].active, false, 'Inactive profile overrides stale active feed');
const unchanged = JSON.stringify(data);
reconcileRoster(data, roster, {}, now);
assert.equal(JSON.stringify(data), unchanged, 'Unchanged sync must not create data churn');
data.fighters[1].profileStatus = 'Active';
reconcileRoster(data, roster, {}, now);
assert.equal(data.fighters[1].active, true, 'A later Active profile permits reactivation');
const overrides = { 'fighter-0': { active: false, reason: 'Confirmed departure', source: 'https://example.com/report', verifiedAt: '2026-09-11' } };
reconcileRoster(data, roster, overrides, now);
assert.equal(data.fighters[0].active, false, 'Overrides follow canonical aliases');
roster.canonicalFighters[0].active = false;
reconcileRoster(data, roster, {}, now);
assert.equal(data.fighters[0].active, false, 'Roster departure removes eligibility');
const before = JSON.stringify(data);
assert.throws(() => reconcileRoster(data, { ...roster, checkedAt: '2026-09-01' }, {}, now));
assert.throws(() => reconcileRoster(data, { ...roster, canonicalFighters: [] }, {}, now));
assert.equal(JSON.stringify(data), before, 'Failed snapshots must not mutate published availability');
console.log('Roster checks passed: aliases, departure, reactivation, overrides, stale feeds, and repeat sync.');
