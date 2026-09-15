import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('assets/data/matchmaker/current.json', 'utf8'));
const participants = new Set((data.events || []).flatMap(event => (event.bouts || []).flatMap(bout => (bout.fighters || []).map(fighter => fighter.id))));
const isProfileUfcBout = entry => /^(?:UFC\b|Noche UFC\b|The Ultimate Fighter\b)/i.test(String(entry?.text || entry?.event || '').trim());

const misses = [];
for (const fighter of data.fighters || []) {
  const profileUfcBouts = (fighter.profileHistory || []).filter(isProfileUfcBout).length;
  const structuredBouts = (fighter.verifiedMeetings || []).length;
  const inPopulation = fighter.active && (profileUfcBouts > 0 || structuredBouts > 0 || participants.has(fighter.id));
  if (!inPopulation || fighter.meetingCoverage?.verified === true) continue;
  misses.push({
    id: fighter.id,
    name: fighter.name,
    division: fighter.division || null,
    record: fighter.record || null,
    profileUfcBouts,
    structuredBouts,
    participant: participants.has(fighter.id),
    identityMethod: fighter.meetingCoverage?.identityMethod || null,
    ufcStatsId: fighter.meetingCoverage?.ufcStatsId || null,
    missingProfileBouts: fighter.meetingCoverage?.missingProfileBouts || [],
    rosterEligibility: fighter.rosterEligibility || null,
    booking: fighter.booking || null
  });
}

console.log(`Unverified active matchmaking histories: ${misses.length}`);
for (const fighter of misses) console.log(JSON.stringify(fighter));
