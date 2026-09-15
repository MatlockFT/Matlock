/* Reusable deterministic engine. No browser, network, or language-model dependency. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MatlockMatchmaker = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 2;
  // Eligibility never earns points. These weights measure why the fight makes sense competitively.
  const WEIGHTS = { competitiveLevel: 40, careerDirection: 25, trajectory: 20, experience: 10, timing: 5 };
  const DAY = 86400000;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const pairKey = (a, b) => [a, b].sort().join('|');
  const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const division = (f, ctx) => ctx.overrides?.[f.id]?.division || f.division;
  const rank = (f, ctx) => {
    const d = division(f, ctx);
    if (f.rankings) return f.rankings.find(r => normalize(r.division) === normalize(d))?.rank ?? null;
    return d === f.division ? f.rank : null;
  };
  const history = f => [...(f.history || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const verifiedHistory = f => [...(f.verifiedMeetings || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const hasVerifiedCoverage = f => f.meetingCoverage?.verified === true && f.meetingCoverage?.source === 'UFCStats';
  const invertResult = result => result === 'W' ? 'L' : result === 'L' ? 'W' : result;

  function streak(f) {
    const h = history(f);
    let n = 0;
    for (const bout of h) {
      if (!['W', 'L'].includes(bout.result) || bout.result !== h[0]?.result) break;
      n++;
    }
    return h[0]?.result === 'L' ? -n : n;
  }

  function tier(f, ctx) {
    const r = rank(f, ctx);
    if (r === 0) return 'C';
    if (r !== null) return r <= 5 ? 'T' : r <= 10 ? 'A' : 'B';
    return streak(f) >= 3 ? 'U+' : history(f).length < 3 ? 'D' : 'U';
  }

  function tags(f, ctx) {
    const result = [];
    if (streak(f) >= 3) result.push('RISING');
    if (streak(f) <= -2) result.push('FALLING');
    if (history(f).length <= 1) result.push('NEW TO UFC');
    if (history(f).length >= 15) result.push('VETERAN');
    if (f.formerChampion) result.push('FORMER CHAMP');
    if (tier(f, ctx) === 'U+') result.push('PROSPECT');
    if (f.interim) result.push('INTERIM CHAMPION');
    return result;
  }

  function eventResult(f, ctx) {
    const fromEvent = ctx.event?.bouts?.flatMap(b => b.fighters || []).find(x => x.id === f.id);
    const latest = history(f)[0];
    return latest?.date > (ctx.event?.date || '') ? latest.result : fromEvent?.result || latest?.result;
  }

  function meetingMatches(meeting, opponent) {
    return meeting.opponentId === opponent.id || normalize(meeting.opponentName) === normalize(opponent.name);
  }

  function priorMeetings(a, b) {
    const directVerified = verifiedHistory(a).filter(meeting => meetingMatches(meeting, b)).map(meeting => ({ ...meeting, verified: true }));
    const inverseVerified = verifiedHistory(b).filter(meeting => meetingMatches(meeting, a)).map(meeting => ({ ...meeting, result: invertResult(meeting.result), verified: true }));
    const directCanonical = history(a).filter(h => h.opponentIds?.includes(b.id) || normalize(h.opponentName) === normalize(b.name) || normalize(h.text).includes(normalize(b.name))).map(h => ({ ...h, verified: false }));
    const inverseCanonical = history(b).filter(h => h.opponentIds?.includes(a.id) || normalize(h.opponentName) === normalize(a.name) || normalize(h.text).includes(normalize(a.name))).map(h => ({ ...h, result: invertResult(h.result), verified: false }));
    const found = [...directVerified, ...inverseVerified, ...directCanonical, ...inverseCanonical];
    const deduped = new Map();
    for (const meeting of found) {
      const id = meeting.fightStatsId || `${meeting.date || ''}|${normalize(meeting.opponentName || '')}` || meeting.sourceUrl || JSON.stringify(meeting);
      const existing = deduped.get(id);
      if (!existing || meeting.verified && !existing.verified) deduped.set(id, meeting);
    }
    return [...deduped.values()].sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')));
  }

  function completeResults(f) {
    return hasVerifiedCoverage(f) ? verifiedHistory(f) : history(f);
  }

  function rematchCase(a, b, ctx) {
    const meetings = priorMeetings(a, b);
    const verifiedCoverage = hasVerifiedCoverage(a) && hasVerifiedCoverage(b);
    if (!meetings.length) return { allowed: true, meetings, verifiedCoverage, reason: verifiedCoverage ? 'No prior meeting in the verified fight ledger.' : 'Prior-meeting verification is incomplete.' };
    if (ctx.overrides?.[a.id]?.allowRematch || ctx.overrides?.[b.id]?.allowRematch) return { allowed: true, meetings, verifiedCoverage, reason: 'Rematch explicitly allowed by an override.' };
    if (['D', 'NC'].includes(meetings[0].result)) return { allowed: true, meetings, verifiedCoverage, reason: 'The previous meeting ended in a draw or no contest.' };
    const subsequentWins = f => completeResults(f).filter(h => h.date > meetings[0].date && h.result === 'W').length;
    if (Date.parse(ctx.asOf) - Date.parse(meetings[0].date) > 3 * 365 * DAY && subsequentWins(a) >= 3 && subsequentWins(b) >= 3) return { allowed: true, meetings, verifiedCoverage, reason: 'More than three years apart, with at least three subsequent wins for each fighter.' };
    const series = meetings.filter(meeting => ['W', 'L', 'D', 'NC'].includes(meeting.result));
    if (series.length === 2 && series.some(h => h.result === 'W') && series.some(h => h.result === 'L') && subsequentWins(a) >= 1 && subsequentWins(b) >= 1) return { allowed: true, meetings, verifiedCoverage, reason: 'A 1–1 series, with both fighters winning again since their last meeting.' };
    if (ctx.rematchCases?.[pairKey(a.id, b.id)]) return { allowed: true, meetings, verifiedCoverage, reason: ctx.rematchCases[pairKey(a.id, b.id)] };
    const source = meetings[0].verified ? 'verified fight history' : 'canonical UFC history';
    return { allowed: false, meetings, verifiedCoverage, reason: `Previously fought on ${meetings[0].date} (${source}); no rematch case is currently supported.` };
  }

  function availability(f, ctx) {
    if (!f.active) return 'Not on the verified active roster.';
    if (f.booking) return `Booked${f.booking.opponent ? ' vs ' + f.booking.opponent : ''}: ${f.booking.event} (${f.booking.date}).`;
    if (ctx.overrides?.[f.id]?.unavailable) return `Unavailable: ${ctx.overrides[f.id].unavailable}`;
    if ((ctx.locks || []).some(p => p.a === f.id || p.b === f.id)) return 'Reserved in a locked matchup.';
    if (f.lastFight && Date.parse(ctx.asOf) - Date.parse(f.lastFight) > 730 * DAY) return 'No listed fight in the last two years.';
    if (!division(f, ctx)) return 'Division has not been verified.';
    if (!f.history?.length) return 'Insufficient verified UFC history to assess a next opponent.';
    return null;
  }

  // Retained as a public diagnostic, but V2 pair scoring no longer treats an artificial target range as the decision model.
  function targetRange(a, ctx) {
    const r = rank(a, ctx), result = eventResult(a, ctx);
    if (r === 0) return [1, 5];
    if (r === null) return streak(a) >= 3 ? [12, 20] : [16, 26];
    return result === 'W' ? [Math.max(1, r - (r >= 11 ? 5 : 4)), Math.min(16, r + 1)] : [Math.max(1, r - 1), Math.min(21, r + 5)];
  }

  function competitiveState(f, ctx) {
    const r = rank(f, ctx);
    const s = streak(f);
    const result = eventResult(f, ctx);
    const experience = history(f).length;
    let level;
    if (r === 0) level = 100;
    else if (r !== null) level = clamp(98 - (r - 1) * 2.55, 60, 98);
    else level = clamp(40 + Math.min(experience, 8) * 1.8 + Math.max(0, s) * 3 - Math.max(0, -s) * 3 + (result === 'W' ? 4 : result === 'L' ? -3 : 0) + (f.formerChampion ? 6 : 0), 28, 68);

    let type;
    if (r === 0) type = 'champion';
    else if (r !== null && r <= 5 && result === 'W') type = 'elite-contender';
    else if (r !== null && result === 'L') type = 'ranked-rebound';
    else if (r !== null && s >= 2) type = 'ranked-riser';
    else if (r !== null && r <= 10) type = 'ranked-contender';
    else if (r !== null) type = 'fringe-ranked';
    else if (s >= 3 && experience <= 7) type = 'surging-prospect';
    else if (experience <= 3 && result === 'W') type = 'developing-prospect';
    else if (experience >= 8 && result === 'L') type = 'rebuilding-veteran';
    else if (experience >= 7) type = 'unranked-veteran';
    else if (result === 'L') type = 'rebuilding';
    else type = 'high-end-unranked';

    return { type, level, rank: r, streak: s, result, experience };
  }

  function desiredLevelBand(state) {
    if (state.rank === 0) return [78, 98];
    if (state.result === 'W') return state.streak >= 3 ? [state.level - 3, state.level + 12] : [state.level - 5, state.level + 10];
    if (state.result === 'L') return [state.level - 12, state.level + 4];
    return [state.level - 8, state.level + 8];
  }

  function bandDistance(value, band) {
    if (value < band[0]) return band[0] - value;
    if (value > band[1]) return value - band[1];
    return 0;
  }

  function directionalFit(a, b, ctx) {
    const self = competitiveState(a, ctx);
    const opponent = competitiveState(b, ctx);
    const band = desiredLevelBand(self);
    const distance = bandDistance(opponent.level, band);
    const levelFit = clamp(WEIGHTS.competitiveLevel - distance * 2.5, 0, WEIGHTS.competitiveLevel);

    let direction = 17;
    if (self.result === 'W') {
      if (opponent.level >= self.level - 3 && opponent.level <= self.level + 14) direction = 25;
      else if (opponent.level < self.level - 10) direction = 7;
      else direction = 15;
    } else if (self.result === 'L') {
      if (opponent.level >= self.level - 14 && opponent.level <= self.level + 5) direction = 25;
      else if (opponent.level > self.level + 10) direction = 8;
      else direction = 16;
    } else direction = Math.abs(opponent.level - self.level) <= 10 ? 22 : 14;

    let trajectory = 12;
    if (self.result === 'W' && opponent.result === 'L' && opponent.level >= self.level - 2) trajectory = 20;
    else if (self.result === 'L' && opponent.result === 'W' && opponent.level <= self.level + 8) trajectory = 20;
    else if (self.result === 'W' && opponent.result === 'W') trajectory = Math.abs(opponent.level - self.level) <= 14 ? 18 : 12;
    else if (self.result === 'L' && opponent.result === 'L') trajectory = Math.abs(opponent.level - self.level) <= 14 ? 17 : 10;
    else if (opponent.streak >= 3 && self.result !== 'W') trajectory = 17;

    const experienceGap = Math.abs(self.experience - opponent.experience);
    const experience = experienceGap <= 3 ? 10 : experienceGap <= 6 ? 8 : experienceGap <= 10 ? 5 : 2;
    let timing = 0;
    if (a.lastFight && b.lastFight) {
      const days = Math.abs(Date.parse(a.lastFight) - Date.parse(b.lastFight)) / DAY;
      timing = days <= 120 ? 5 : days <= 240 ? 3 : days <= 365 ? 2 : 1;
    }
    const parts = { competitiveLevel: levelFit, careerDirection: direction, trajectory, experience, timing };
    return { fighter: a, opponent: b, state: self, opponentState: opponent, band, distance, parts, score: Object.values(parts).reduce((sum, value) => sum + value, 0) };
  }

  function matchupCase(a, b, ctx, aFit, bFit) {
    const A = aFit.state, B = bFit.state;
    const levelGap = Math.abs(A.level - B.level);
    let code = 'divisional-sorting';
    let rationale;
    let reasons;

    const champion = A.rank === 0 ? a : B.rank === 0 ? b : null;
    const challenger = champion?.id === a.id ? b : champion ? a : null;
    const challengerState = champion?.id === a.id ? B : champion ? A : null;
    if (champion && challenger && challengerState.rank !== null && challengerState.rank <= 5) {
      code = 'title-case';
      rationale = `${challenger.name} is already in the top contender tier, so ${champion.name} is a defensible next title matchup rather than a rankings detour.`;
      reasons = [`${challenger.name} is ranked #${challengerState.rank}.`, `${champion.name} is the champion.`, 'The pairing keeps the title fight inside the current contender tier.'];
    } else if (A.rank !== null && B.rank !== null && A.rank <= 5 && B.rank <= 5 && A.result === 'W' && B.result === 'W') {
      code = 'title-eliminator';
      rationale = `${a.name} and ${b.name} are both winning inside the top contender tier; pairing them directly clarifies the title queue.`;
      reasons = [`${a.name} is ranked #${A.rank}.`, `${b.name} is ranked #${B.rank}.`, 'Both are coming off wins.'];
    } else if (A.result === 'W' && B.result === 'L' || A.result === 'L' && B.result === 'W') {
      const winner = A.result === 'W' ? a : b;
      const loser = winner.id === a.id ? b : a;
      const winnerState = winner.id === a.id ? A : B;
      const loserState = winner.id === a.id ? B : A;
      if (loserState.level >= winnerState.level - 2) {
        code = loserState.rank !== null && winnerState.rank === null ? 'ranking-opportunity' : 'step-up-vs-rebound';
        rationale = `${winner.name} is coming off a win and is ready for stronger opposition; ${loser.name} is coming off higher or comparable competition, giving ${winner.name} a meaningful step up while giving ${loser.name} a credible rebound fight.`;
        reasons = [`${winner.name} is coming off a win${winnerState.streak > 1 ? ` with a ${winnerState.streak}-fight winning streak` : ''}.`, `${loser.name} is coming off a loss but remains in a ${loserState.rank !== null ? `ranked (#${loserState.rank})` : 'comparable'} competitive tier.`, 'The pairing advances one trajectory without forcing the other fighter into an artificial drop.'];
      }
    }

    if (!rationale && A.result === 'W' && B.result === 'W' && levelGap <= 14) {
      code = A.rank === null && B.rank === null ? 'rising-vs-rising' : 'rankings-progression';
      rationale = `${a.name} and ${b.name} are both moving forward at a similar competitive level. Matching them now separates two upward trajectories and moves the winner toward the next tier.`;
      reasons = ['Both are coming off wins.', `Their competitive-level gap is ${Math.round(levelGap)} points on the engine scale.`, 'Neither fighter has to make an artificial jump or drop for the matchup.'];
    }

    if (!rationale && A.result === 'L' && B.result === 'L' && levelGap <= 14) {
      code = 'rebound-pairing';
      rationale = `${a.name} and ${b.name} are both coming off setbacks at a similar level. This is a logical reset fight that keeps the winner relevant without dropping either fighter too far down the division.`;
      reasons = ['Both are coming off losses.', `Their competitive-level gap is ${Math.round(levelGap)} points on the engine scale.`, 'Both need a credible rebound opportunity.'];
    }

    if (!rationale) {
      const prospect = ['surging-prospect', 'developing-prospect'].includes(A.type) ? a : ['surging-prospect', 'developing-prospect'].includes(B.type) ? b : null;
      const veteran = prospect?.id === a.id && B.experience >= 6 ? b : prospect?.id === b.id && A.experience >= 6 ? a : null;
      if (prospect && veteran) {
        code = 'prospect-test';
        rationale = `${prospect.name} needs a deeper UFC test; ${veteran.name}'s experience and current divisional level make this a credible measuring stick without skipping multiple tiers.`;
        reasons = [`${prospect.name} is classified as a ${prospect.id === a.id ? A.type : B.type}.`, `${veteran.name} has ${veteran.id === a.id ? A.experience : B.experience} canonical UFC bouts.`, 'The competitive-level gap remains inside a defensible range.'];
      }
    }

    if (!rationale) {
      rationale = `${a.name} and ${b.name} occupy a comparable competitive tier, and the matchup would clarify their position in the division without forcing an artificial leap up or down.`;
      reasons = [`${a.name}: ${A.rank === null ? 'unranked' : A.rank === 0 ? 'champion' : `#${A.rank}`}, ${A.result || 'no recent result'} trajectory.`, `${b.name}: ${B.rank === null ? 'unranked' : B.rank === 0 ? 'champion' : `#${B.rank}`}, ${B.result || 'no recent result'} trajectory.`, `Competitive-level gap: ${Math.round(levelGap)}.`];
    }

    return { code, rationale, reasons };
  }

  function evaluatePair(a, b, ctx, manual = false, requireVerified = false) {
    const reject = reason => ({ eligible: false, reason, fighter: b });
    if (a.id === b.id) return reject('A fighter cannot face themselves.');
    if (requireVerified && (!hasVerifiedCoverage(a) || !hasVerifiedCoverage(b))) return reject('Verified canonical fight history is required for automatic recommendations.');
    const unavailable = availability(a, ctx) || availability(b, ctx);
    if (unavailable) return reject(unavailable);
    if (normalize(division(a, ctx)) !== normalize(division(b, ctx))) return reject('Different divisions. Use a division override first.');
    const rematch = rematchCase(a, b, ctx);
    if (!rematch.allowed) return reject(rematch.reason);

    const A = competitiveState(a, ctx), B = competitiveState(b, ctx);
    if (!manual && (A.experience >= 7 && B.experience < 2 || B.experience >= 7 && A.experience < 2)) return reject('Too large a UFC experience gap for an automatic recommendation.');
    if (!manual && ((A.rank === 0 && (B.rank === null || B.rank > 7)) || (B.rank === 0 && (A.rank === null || A.rank > 7)) || (A.rank !== null && B.rank !== null && Math.abs(A.rank - B.rank) > 8) || (A.rank !== null && A.rank < 8 && B.rank === null && B.level < 62) || (B.rank !== null && B.rank < 8 && A.rank === null && A.level < 62))) return reject('Outside a defensible competitive range.');

    const aFit = directionalFit(a, b, ctx);
    const bFit = directionalFit(b, a, ctx);
    const harmonic = aFit.score + bFit.score ? 2 * aFit.score * bFit.score / (aFit.score + bFit.score) : 0;
    const weakerSide = Math.min(aFit.score, bFit.score);
    const balanceGap = Math.abs(aFit.score - bFit.score);
    const score = Math.round(clamp(harmonic * 0.7 + weakerSide * 0.3 - balanceGap * 0.12, 0, 100));
    const caseFile = matchupCase(a, b, ctx, aFit, bFit);
    const sameEvent = ctx.event?.bouts?.flatMap(bout => bout.fighters || []).some(f => f.id === b.id);
    const evidence = [
      ...caseFile.reasons,
      `Two-sided fit: ${a.name} ${Math.round(aFit.score)}/100; ${b.name} ${Math.round(bFit.score)}/100.`,
      `Pair balance: ${balanceGap.toFixed(1)} points; weaker-side fit ${Math.round(weakerSide)}/100.`,
      `Timing: last listed fights ${a.lastFight || 'unknown'} / ${b.lastFight || 'unknown'}${sameEvent ? ' (same card)' : ''}.`,
      rematch.meetings.length ? rematch.reason : 'Freshness passed the verified prior-meeting gate.'
    ];
    return {
      eligible: true,
      fighter: b,
      score,
      pairScore: score,
      parts: { a: aFit.parts, b: bFit.parts, balanceGap: Number(balanceGap.toFixed(2)), weakerSide: Number(weakerSide.toFixed(2)) },
      directional: { a: aFit, b: bFit },
      case: caseFile,
      evidence,
      rationale: caseFile.rationale,
      rematch,
      ambitious: B.rank !== null && A.rank !== null && B.rank < A.rank
    };
  }

  function evaluate(a, b, ctx, manual = false) {
    return evaluatePair(a, b, ctx, manual, false);
  }

  function candidates(a, fighters, ctx) {
    const requireVerified = fighters.some(f => Number(f.historyModelVersion || 0) >= 2);
    return fighters.map(b => evaluatePair(a, b, ctx, false, requireVerified)).filter(r => r.eligible).sort((x, y) => y.score - x.score || x.fighter.id.localeCompare(y.fighter.id));
  }

  function recommendations(a, fighters, ctx) {
    return candidates(a, fighters, ctx).slice(0, 3).map((r, i) => ({ ...r, label: ['Best match', 'Alternative', 'Another option'][i] }));
  }

  function lock(a, b, ctx, manual = false) {
    const match = evaluatePair(a, b, ctx, manual, false);
    if (!match.eligible) throw new Error(match.reason);
    return { a: a.id, b: b.id, score: match.score, rationale: match.rationale, evidence: match.evidence, manual, createdAt: new Date().toISOString() };
  }

  function autoMatch(fighters, ctx, targetIds, limit = 20000) {
    const targets = new Set(targetIds), used = new Set((ctx.locks || []).flatMap(p => [p.a, p.b]));
    const remaining = fighters.filter(f => targets.has(f.id) && !availability(f, ctx));
    const choices = new Map(remaining.map(a => [a.id, candidates(a, fighters, ctx).slice(0, 10).map(r => ({ a: a.id, b: r.fighter.id, score: r.score, rationale: r.rationale, evidence: r.evidence, manual: false, createdAt: new Date().toISOString() }))]));
    remaining.sort((a, b) => choices.get(a.id).length - choices.get(b.id).length || a.id.localeCompare(b.id));
    let best = [], bestValue = -1, visited = 0;
    function search(index, pairs, value) {
      if (++visited > limit) return;
      while (index < remaining.length && used.has(remaining[index].id)) index++;
      if (value + (remaining.length - index) * 2100 < bestValue) return;
      if (index === remaining.length) {
        if (value > bestValue) { bestValue = value; best = pairs.slice(); }
        return;
      }
      const fighter = remaining[index];
      for (const pairing of choices.get(fighter.id)) if (!used.has(pairing.b)) {
        used.add(pairing.a); used.add(pairing.b); pairs.push(pairing);
        search(index + 1, pairs, value + (targets.has(pairing.b) ? 2000 : 1000) + pairing.score);
        pairs.pop(); used.delete(pairing.a); used.delete(pairing.b);
      }
      search(index + 1, pairs, value);
    }
    search(0, [], 0);
    return { pairs: best, searched: Math.min(visited, limit), optimal: false, method: 'Bounded search over ten best two-sided eligible matchups per fighter' };
  }

  function validateBoard(board, data) {
    if (!board || board.version !== VERSION || !data.events.some(e => e.id === board.eventId) || !Array.isArray(board.locks) || board.locks.length > 40) throw new Error('Invalid or unsupported shared board.');
    const known = new Set(data.fighters.map(f => f.id)), used = new Set();
    for (const p of board.locks) {
      if (!known.has(p.a) || !known.has(p.b) || p.a === p.b || used.has(p.a) || used.has(p.b)) throw new Error('Shared board has missing fighters or duplicate bookings.');
      used.add(p.a); used.add(p.b);
    }
    return board;
  }

  return { VERSION, WEIGHTS, pairKey, normalize, division, rank, streak, tier, tags, eventResult, priorMeetings, rematchCase, availability, targetRange, competitiveState, directionalFit, evaluatePair, evaluate, candidates, recommendations, lock, autoMatch, validateBoard };
});
