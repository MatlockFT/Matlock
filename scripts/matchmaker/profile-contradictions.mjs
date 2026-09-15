import { key } from './sources/ufc.mjs';

const usefulName = value => {
  const normalized = key(value);
  return normalized.length >= 6 ? normalized : null;
};

function defaultKnownNames(fighter) {
  return [fighter?.name, ...(fighter?.aliases || [])].filter(Boolean).map(value => String(value).replace(/-/g, ' '));
}

function explicitlyNamedOpponents(entry, fighter, fighters, knownNames) {
  const text = key(entry?.text || '');
  if (!text) return [];
  const byId = new Map(fighters.map(candidate => [candidate.id, candidate]));
  const found = new Map();

  for (const id of entry?.opponentIds || []) {
    const candidate = byId.get(id);
    if (!candidate || candidate.id === fighter.id) continue;
    if (knownNames(candidate).some(name => {
      const normalized = usefulName(name);
      return normalized && text.includes(normalized);
    })) found.set(candidate.id, candidate);
  }

  if (!found.size) {
    for (const candidate of fighters) {
      if (!candidate || candidate.id === fighter.id) continue;
      if (knownNames(candidate).some(name => {
        const normalized = usefulName(name);
        return normalized && text.includes(normalized);
      })) found.set(candidate.id, candidate);
      if (found.size > 1) break;
    }
  }
  return [...found.values()];
}

/**
 * A UFC.com profile sentence is not allowed to create a fake history gap when structured records
 * prove the claimed bout could not have happened as written. The contradiction threshold is strict:
 * the prose must explicitly name exactly one canonical opponent, and either the fighter or that
 * opponent must have a structured fight against somebody else on the claimed date.
 */
export function classifyProfileContradictions({ fighter, missing = [], selfMeetings = [], fighters = [], getMeetings, knownNames = defaultKnownNames }) {
  const unresolved = [];
  const contradictions = [];

  for (const entry of missing) {
    const opponents = explicitlyNamedOpponents(entry, fighter, fighters, knownNames);
    if (opponents.length !== 1) {
      unresolved.push(entry);
      continue;
    }
    const opponent = opponents[0];
    const opponentMeetings = typeof getMeetings === 'function' ? getMeetings(opponent.id) || [] : [];
    const selfConflict = selfMeetings.find(meeting => meeting.date === entry.date && meeting.opponentId && meeting.opponentId !== opponent.id);
    const opponentConflict = opponentMeetings.find(meeting => meeting.date === entry.date && meeting.opponentId && meeting.opponentId !== fighter.id);
    const conflict = selfConflict || opponentConflict;
    if (!conflict) {
      unresolved.push(entry);
      continue;
    }

    contradictions.push({
      type: 'profile-contradiction',
      profileDate: entry.date,
      profileResult: entry.result || null,
      claimedOpponentId: opponent.id,
      claimedOpponentName: opponent.name,
      contradictionSide: selfConflict ? 'fighter' : 'claimed-opponent',
      verifiedOpponentName: conflict.opponentName || null,
      verifiedDate: conflict.date,
      source: conflict.source || 'UFCStats',
      sourceUrl: conflict.sourceUrl || null,
      text: entry.text || null
    });
  }

  return { unresolved, contradictions };
}
