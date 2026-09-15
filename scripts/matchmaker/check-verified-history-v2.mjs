import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyProfileContradictions } from './profile-contradictions.mjs';

const evidence = JSON.parse(fs.readFileSync('scripts/matchmaker/verified-history-evidence.json', 'utf8'));
assert.equal(evidence.version, 1, 'Verified-history evidence ledger schema changed unexpectedly');
const tsuruyaEvidence = evidence.supplementalMeetings?.find(row => row.fightStatsId === '58a314edcfe1d23a');
assert(tsuruyaEvidence, 'Rei Tsuruya Road to UFC source gap must remain explicitly sourced');
assert.equal(tsuruyaEvidence.sourceUrl, 'https://ufcstats.com/fight-details/58a314edcfe1d23a');
assert.equal(tsuruyaEvidence.aStatsId, '2f43a3e82661fa99');
assert.equal(tsuruyaEvidence.bStatsId, 'c14a683dac2ebc4c');
assert.equal(tsuruyaEvidence.date, '2024-02-03');
assert.equal(tsuruyaEvidence.competitionClass, 'road-to-ufc');

// A bad UFC.com biography claim must not become a fabricated fight-history row. This fixture mirrors
// the Ravena Oliveira profile problem: the prose claims Juliana Miller on a date when structured
// records prove Miller fought somebody else.
const ravenaFixture = { id: 'ravena-oliveira', name: 'Ravena Oliveira', aliases: [] };
const julianaFixture = { id: 'juliana-miller', name: 'Juliana Miller', aliases: [] };
const carliFixture = { id: 'carli-judice', name: 'Carli Judice', aliases: [] };
const contradictionFixture = classifyProfileContradictions({
  fighter: ravenaFixture,
  missing: [{ date: '2026-02-21', result: 'L', opponentIds: [], text: 'UFC Fight Night (2/21/26) Oliveira was submitted by Juliana Miller via rear-naked choke at 1:38 of the second round' }],
  selfMeetings: [],
  fighters: [ravenaFixture, julianaFixture, carliFixture],
  getMeetings: id => id === 'juliana-miller' ? [{
    date: '2026-02-21', result: 'L', opponentId: 'carli-judice', opponentName: 'Carli Judice',
    source: 'UFCStats', sourceUrl: 'https://ufcstats.com/fight-details/6e78d874097a3d22'
  }] : []
});
assert.equal(contradictionFixture.unresolved.length, 0, 'A provably impossible profile claim should not create a verified-history gap');
assert.equal(contradictionFixture.contradictions.length, 1);
assert.equal(contradictionFixture.contradictions[0].claimedOpponentId, 'juliana-miller');
assert.equal(contradictionFixture.contradictions[0].verifiedOpponentName, 'Carli Judice');
assert.equal(contradictionFixture.contradictions[0].sourceUrl, 'https://ufcstats.com/fight-details/6e78d874097a3d22');

const data = JSON.parse(fs.readFileSync('assets/data/matchmaker/current.json', 'utf8'));
const historyV2 = Number(data.sources?.meetings?.historyModelVersion || 0) >= 2;
if (historyV2) {
  const participants = new Set((data.events || []).flatMap(event => (event.bouts || []).flatMap(bout => (bout.fighters || []).map(fighter => fighter.id))));
  assert.equal(data.coverage?.verifiedParticipantHistories, participants.size, 'Published V2 history must verify every displayed-event fighter');
  assert.equal(data.coverage?.participantHistoriesRequested, participants.size, 'Participant history coverage denominator drifted');
  assert((data.coverage?.verifiedActiveHistoryRatio || 0) >= 0.9, 'Published V2 active-history coverage fell below the hard gate');

  const rei = data.fighters.find(fighter => fighter.name === 'Rei Tsuruya');
  assert(rei, 'Rei Tsuruya must resolve in the Matchmaker roster');
  assert.equal(rei.meetingCoverage?.verified, true, 'Rei Tsuruya history must remain verified');
  const roadMeeting = rei.verifiedMeetings?.find(meeting => meeting.fightStatsId === '58a314edcfe1d23a');
  assert(roadMeeting, 'Rei Tsuruya vs Jiniushiyue Road to UFC fight disappeared from verified history');
  assert.equal(roadMeeting.date, '2024-02-03');
  assert.equal(roadMeeting.competitionClass, 'road-to-ufc');
  assert.equal(roadMeeting.result, 'W');

  const ravena = data.fighters.find(fighter => fighter.name === 'Ravena Oliveira');
  assert(ravena, 'Ravena Oliveira must resolve in the Matchmaker roster');
  assert.equal(ravena.meetingCoverage?.verified, true, 'Ravena Oliveira history must remain verified after rejecting bad profile prose');
  const contradiction = ravena.meetingCoverage?.sourceDiscrepancies?.find(item => item.type === 'profile-contradiction' && item.profileDate === '2026-02-21');
  assert(contradiction, 'Ravena Oliveira bad 2026-02-21 profile claim must remain explicitly recorded as a contradiction');
  assert.equal(contradiction.claimedOpponentName, 'Juliana Miller');
  assert(!ravena.history.some(row => row.date === '2026-02-21'), 'Ravena Oliveira canonical history must not fabricate the false 2026-02-21 Juliana Miller bout');
  const actualMiller = ravena.history.find(row => row.opponentName === 'Juliana Miller');
  assert(actualMiller, 'Ravena Oliveira canonical history must retain the real Juliana Miller fight');
  assert.equal(actualMiller.date, '2026-08-08');

  for (const fighter of data.fighters.filter(fighter => fighter.meetingCoverage?.verified)) {
    for (const meeting of fighter.verifiedMeetings || []) {
      if (!meeting.opponentId) continue;
      const opponent = data.fighters.find(candidate => candidate.id === meeting.opponentId);
      if (!opponent?.meetingCoverage?.verified) continue;
      const inverse = (opponent.verifiedMeetings || []).find(candidate =>
        candidate.opponentId === fighter.id && candidate.date === meeting.date &&
        (meeting.fightStatsId ? candidate.fightStatsId === meeting.fightStatsId : true)
      );
      assert(inverse, `Verified history is not symmetric: ${fighter.name} vs ${opponent.name} on ${meeting.date}`);
      const expected = meeting.result === 'W' ? 'L' : meeting.result === 'L' ? 'W' : meeting.result;
      assert.equal(inverse.result, expected, `Verified history result is not reciprocal: ${fighter.name} vs ${opponent.name} on ${meeting.date}`);
    }
  }
}

console.log(historyV2
  ? `Verified-history V2 checks passed: ${data.coverage.verifiedParticipantHistories}/${data.coverage.participantHistoriesRequested} displayed fighters, Rei source-gap repair, Ravena contradiction rejection, and reciprocal ledgers.`
  : 'Verified-history V2 fixtures passed; published snapshot has not migrated to V2 yet.');
