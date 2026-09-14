import { clean, key } from './sources/ufc.mjs';

const DAY = 86400000;
const dateDistance = (a, b) => {
  const left = Date.parse(a), right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right) ? Math.abs(left - right) / DAY : Infinity;
};
const resultCompatible = (profile, meeting) => !profile?.result || !meeting?.result || profile.result === meeting.result;

function opponentMatch(profile, meeting) {
  if (!profile || !meeting) return false;
  if (meeting.opponentId && Array.isArray(profile.opponentIds) && profile.opponentIds.includes(meeting.opponentId)) return true;
  const opponentKey = key(meeting.opponentName);
  return Boolean(opponentKey && opponentKey.length >= 5 && key(profile.text || '').includes(opponentKey));
}

/**
 * Reconcile fallible UFC.com biography prose against structured UFCStats fight rows.
 *
 * Priority is intentionally evidence based:
 *  1. same opponent + compatible result + nearby date
 *  2. same opponent + compatible result (profile date may be wrong)
 *  3. same opponent even when prose result is wrong (record discrepancy)
 *  4. nearby date + compatible result when opponent text could not be resolved
 *
 * Every structured row may satisfy at most one profile row. This prevents repeated
 * opponents/rematches from being accidentally collapsed onto a single fight.
 */
export function reconcileProfileHistory(profileEntries = [], meetings = [], options = {}) {
  const nearbyDays = Number(options.nearbyDays ?? 2);
  const profiles = profileEntries.filter(entry => entry?.date);
  const unused = new Set(meetings.map((_, index) => index));
  const matches = [];
  const missing = [];
  const discrepancies = [];

  for (const profile of profiles) {
    const candidates = [...unused].map(index => {
      const meeting = meetings[index];
      const opponent = opponentMatch(profile, meeting);
      const resultOk = resultCompatible(profile, meeting);
      const days = dateDistance(profile.date, meeting.date);
      const nearby = days <= nearbyDays;
      let tier = 99;
      if (opponent && resultOk && nearby) tier = 0;
      else if (opponent && resultOk) tier = 1;
      else if (opponent) tier = 2;
      else if (nearby && resultOk) tier = 3;
      return { index, meeting, opponent, resultOk, nearby, days, tier };
    }).filter(candidate => candidate.tier < 99)
      .sort((a, b) => a.tier - b.tier || a.days - b.days || String(a.meeting.sourceUrl).localeCompare(String(b.meeting.sourceUrl)));

    const best = candidates[0];
    if (!best) {
      missing.push(profile);
      continue;
    }

    // Weak date-only matching must be unique. Exact-opponent evidence is strong enough
    // to reconcile source typos even across a large date discrepancy.
    if (best.tier === 3) {
      const equallyPlausible = candidates.filter(candidate => candidate.tier === 3 && Math.abs(candidate.days - best.days) < 0.001);
      if (equallyPlausible.length !== 1) {
        missing.push(profile);
        continue;
      }
    }

    unused.delete(best.index);
    matches.push({ profile, meeting: best.meeting, evidenceTier: best.tier });
    if (profile.date !== best.meeting.date) discrepancies.push({
      type: 'profile-date',
      opponentName: best.meeting.opponentName,
      profileDate: profile.date,
      verifiedDate: best.meeting.date,
      sourceUrl: best.meeting.sourceUrl
    });
    if (profile.result && best.meeting.result && profile.result !== best.meeting.result) discrepancies.push({
      type: 'profile-result',
      opponentName: best.meeting.opponentName,
      profileResult: profile.result,
      verifiedResult: best.meeting.result,
      profileDate: profile.date,
      verifiedDate: best.meeting.date,
      sourceUrl: best.meeting.sourceUrl
    });
  }

  return {
    matches,
    missing,
    discrepancies,
    matchedMeetingIndexes: new Set(matches.map(match => meetings.indexOf(match.meeting)))
  };
}

export function profileOpponentMatches(profile, meeting) {
  return opponentMatch(profile, meeting);
}
