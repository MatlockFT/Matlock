/* Reusable deterministic engine. No browser, network, or language-model dependency. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MatlockMatchmaker = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1;
  const WEIGHTS = { hierarchy: 30, trajectory: 20, availability: 15, freshness: 15, progression: 10, timing: 5, story: 5 };
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
  const history = f => [...(f.history || [])].sort((a, b) => b.date.localeCompare(a.date));
  function streak(f) { const h = history(f); let n = 0; for (const bout of h) { if (!['W', 'L'].includes(bout.result) || bout.result !== h[0]?.result) break; n++; } return h[0]?.result === 'L' ? -n : n; }
  function tier(f, ctx) { const r = rank(f, ctx); if (r === 0) return 'C'; if (r !== null) return r <= 5 ? 'T' : r <= 10 ? 'A' : 'B'; return streak(f) >= 3 ? 'U+' : history(f).length < 3 ? 'D' : 'U'; }
  function tags(f, ctx) { const tags = []; if (streak(f) >= 3) tags.push('RISING'); if (streak(f) <= -2) tags.push('FALLING'); if (history(f).length <= 1) tags.push('NEW TO UFC'); if (history(f).length >= 15) tags.push('VETERAN'); if (f.formerChampion) tags.push('FORMER CHAMP'); if (tier(f, ctx) === 'U+') tags.push('PROSPECT'); if (f.interim) tags.push('INTERIM CHAMPION'); return tags; }
  function eventResult(f, ctx) { const fromEvent = ctx.event?.bouts.flatMap(b => b.fighters).find(x => x.id === f.id); const latest = history(f)[0]; return latest?.date > (ctx.event?.date || '') ? latest.result : fromEvent?.result || latest?.result; }
  function priorMeetings(a, b) {
    const found = [...history(a).filter(h => h.opponentIds?.includes(b.id) || normalize(h.text).includes(normalize(b.name))), ...history(b).filter(h => h.opponentIds?.includes(a.id) || normalize(h.text).includes(normalize(a.name)))];
    return [...new Map(found.map(h => [h.date, h])).values()].sort((x, y) => y.date.localeCompare(x.date));
  }
  function rematchCase(a, b, ctx) {
    const meetings = priorMeetings(a, b);
    if (!meetings.length) return { allowed: true, meetings, reason: 'No previous meeting found in listed UFC histories.' };
    if (ctx.overrides?.[a.id]?.allowRematch || ctx.overrides?.[b.id]?.allowRematch) return { allowed: true, meetings, reason: 'Rematch explicitly allowed by your board override.' };
    if (['D', 'NC'].includes(meetings[0].result)) return { allowed: true, meetings, reason: 'The previous meeting ended in a draw or no contest.' };
    const subsequentWins = f => history(f).filter(h => h.date > meetings[0].date && h.result === 'W').length;
    if (Date.parse(ctx.asOf) - Date.parse(meetings[0].date) > 3 * 365 * DAY && subsequentWins(a) >= 3 && subsequentWins(b) >= 3) return { allowed: true, meetings, reason: 'More than three years apart, with at least three subsequent wins for each fighter.' };
    const series = history(a).filter(h => h.opponentIds?.includes(b.id));
    if (series.length === 2 && series.some(h => h.result === 'W') && series.some(h => h.result === 'L') && subsequentWins(a) >= 1 && subsequentWins(b) >= 1) return { allowed: true, meetings, reason: 'A 1–1 series, with both fighters winning again since their last meeting.' };
    if (ctx.rematchCases?.[pairKey(a.id, b.id)]) return { allowed: true, meetings, reason: ctx.rematchCases[pairKey(a.id, b.id)] };
    return { allowed: false, meetings, reason: `Previously fought on ${meetings[0].date}; needs a documented rematch case or your override.` };
  }
  function availability(f, ctx) {
    if (!f.active) return 'Not on the verified active roster.';
    if (f.booking) return `Booked${f.booking.opponent ? " vs " + f.booking.opponent : ""}: ${f.booking.event} (${f.booking.date}).`;
    if (ctx.overrides?.[f.id]?.unavailable) return `Unavailable: ${ctx.overrides[f.id].unavailable}`;
    if ((ctx.locks || []).some(p => p.a === f.id || p.b === f.id)) return 'Reserved in a locked matchup.';
    if (f.lastFight && Date.parse(ctx.asOf) - Date.parse(f.lastFight) > 730 * DAY) return 'No listed fight in the last two years.';
    if (!division(f, ctx)) return 'Division has not been verified.';
    if (!f.history?.length) return 'Insufficient listed UFC history to assess a next opponent.';
    return null;
  }
  function targetRange(a, ctx) {
    const r = rank(a, ctx), result = eventResult(a, ctx);
    if (r === 0) return [1, 5];
    if (r === null) return streak(a) >= 3 ? [12, 20] : [16, 26];
    return result === 'W' ? [Math.max(1, r - (r >= 11 ? 5 : 4)), Math.min(16, r + 1)] : [Math.max(1, r - 1), Math.min(21, r + 5)];
  }
  function evaluate(a, b, ctx, manual = false) {
    const reject = reason => ({ eligible: false, reason, fighter: b });
    if (a.id === b.id) return reject('A fighter cannot face themselves.');
    const unavailable = availability(a, ctx) || availability(b, ctx); if (unavailable) return reject(unavailable);
    if (normalize(division(a, ctx)) !== normalize(division(b, ctx))) return reject('Different divisions. Use a division override first.');
    const rematch = rematchCase(a, b, ctx); if (!rematch.allowed) return reject(rematch.reason);
    const ar = rank(a, ctx), br = rank(b, ctx), range = targetRange(a, ctx);
    if (!manual && (history(a).length >= 7 && history(b).length < 2 || history(b).length >= 7 && history(a).length < 2)) return reject('Too large a UFC experience gap for an automatic recommendation.');
    const effective = br ?? (streak(b) >= 3 ? 17 : history(b).length < 3 ? 24 : 20);
    if (!manual && ((ar === 0 && (br === null || br > 7)) || (br === 0 && (ar === null || ar > 7)) || (ar !== null && br !== null && Math.abs(ar - br) > 8) || (ar !== null && ar < 10 && br === null))) return reject('Outside a defensible competitive range.');
    const distance = effective < range[0] ? range[0] - effective : effective > range[1] ? effective - range[1] : 0;
    const sameEvent = ctx.event?.bouts.flatMap(b => b.fighters).some(f => f.id === b.id);
    const as = streak(a), bs = streak(b), sameResult = eventResult(a, ctx) === eventResult(b, ctx);
    const titleClaim = ar === 0 ? clamp((16 - (br ?? 16)) / 15 * 10 + Math.max(0, bs) * 2, 0, 20) : null;
    const parts = {
      hierarchy: clamp(30 - distance * 5, 0, 30),
      trajectory: titleClaim ?? clamp(12 + (sameResult ? 4 : 0) + Math.max(0, bs) * 1.5 - (bs < -1 ? 5 : 0), 0, 20),
      availability: 15,
      freshness: rematch.meetings.length ? 4 : 15,
      progression: clamp(10 - distance * 2, 0, 10),
      timing: a.lastFight && b.lastFight ? clamp(5 - Math.abs(Date.parse(a.lastFight) - Date.parse(b.lastFight)) / DAY / 90, 0, 5) : 0,
      story: sameEvent ? 5 : a.formerChampion || b.formerChampion ? 3 : 0
    };
    const evidence = [
      ar === 0 ? `Title claim: ${br === null ? 'unranked' : '#' + br}, ${bs > 0 ? bs + ' consecutive listed wins' : 'no current listed winning streak'}.` : `${eventResult(a, ctx) === 'W' ? 'After a win, prioritize upward progression' : 'Prioritize a comparable next test'}; target ${range[0] <= 15 ? '#' + range[0] : 'unranked'}–${range[1] <= 15 ? '#' + range[1] : 'unranked'}.`,
      `${b.name}: ${br === 0 ? 'champion' : br === null ? 'unranked' : '#' + br} in ${division(b, ctx)}; ${bs > 0 ? bs + ' listed wins in a row' : bs < 0 ? Math.abs(bs) + ' listed losses in a row' : 'trajectory unknown'}.`,
      'Active roster confirmed; no booking found in the collected schedule.', rematch.reason,
      sameEvent ? 'Same event: closely aligned turnaround and a natural post-card pairing.' : `Last listed fights: ${a.lastFight || 'unknown'} / ${b.lastFight || 'unknown'}.`,
      'UFC profile histories may omit bouts. No detected rematch is not proof of a first meeting.'
    ];
    if (!a.history?.length || !b.history?.length) evidence.push('Limited history: trajectory and previous-meeting checks have incomplete evidence.');
    const score = Math.round(Object.values(parts).reduce((sum, n) => sum + n, 0));
    const rationale = ar === 0 ? `${b.name} has a title case at #${br}, with ${Math.max(bs, 0)} consecutive listed wins${rematch.meetings.length ? ' and an allowed rematch case' : ' and no previous meeting found'}.` : `${b.name} offers ${distance === 0 ? 'a natural' : 'a more ambitious'} next step${sameEvent ? ' after competing on the same card' : ''}${rematch.meetings.length ? ', with an explicit rematch case' : ', with no previous meeting found'}.`;
    return { eligible: true, fighter: b, score, parts, evidence, rationale, rematch, ambitious: br !== null && ar !== null && br < ar };
  }
  function candidates(a, fighters, ctx) { return fighters.map(b => evaluate(a, b, ctx)).filter(r => r.eligible).sort((a, b) => b.score - a.score || a.fighter.id.localeCompare(b.fighter.id)); }
  function recommendations(a, fighters, ctx) {
    const all = candidates(a, fighters, ctx), selected = all.slice(0, 2);
    const swing = all.slice(2).find(r => r.ambitious) || all[2]; if (swing) selected.push(swing);
    return selected.map((r, i) => ({ ...r, label: ['Best match', 'Alternative', 'Swing fight'][i] }));
  }
  function lock(a, b, ctx, manual = false) {
    const match = evaluate(a, b, ctx, manual); if (!match.eligible) throw new Error(match.reason);
    return { a: a.id, b: b.id, score: match.score, rationale: match.rationale, evidence: match.evidence, manual, createdAt: new Date().toISOString() };
  }
  function autoMatch(fighters, ctx, targetIds, limit = 20000) {
    const targets = new Set(targetIds), used = new Set((ctx.locks || []).flatMap(p => [p.a, p.b]));
    const remaining = fighters.filter(f => targets.has(f.id) && !availability(f, ctx));
    const choices = new Map(remaining.map(a => [a.id, candidates(a, fighters, ctx).slice(0, 10).map(r => ({ a: a.id, b: r.fighter.id, score: r.score, rationale: r.rationale, evidence: r.evidence, manual: false, createdAt: new Date().toISOString() }))]));
    remaining.sort((a, b) => choices.get(a.id).length - choices.get(b.id).length || a.id.localeCompare(b.id));
    let best = [], bestValue = -1, visited = 0;
    // Maximize covered event participants first, then summed quality. Same-card pairs cover two.
    function search(index, pairs, value) {
      if (++visited > limit) return;
      while (index < remaining.length && used.has(remaining[index].id)) index++;
      if (value + (remaining.length - index) * 2100 < bestValue) return;
      if (index === remaining.length) { if (value > bestValue) { bestValue = value; best = pairs.slice(); } return; }
      const a = remaining[index];
      for (const p of choices.get(a.id)) if (!used.has(p.b)) {
        used.add(p.a); used.add(p.b); pairs.push(p);
        search(index + 1, pairs, value + (targets.has(p.b) ? 2000 : 1000) + p.score);
        pairs.pop(); used.delete(p.a); used.delete(p.b);
      }
      search(index + 1, pairs, value);
    }
    search(0, [], 0);
    return { pairs: best, searched: Math.min(visited, limit), optimal: false, method: 'Bounded search over ten best eligible opponents per fighter' };
  }
  function validateBoard(board, data) {
    if (!board || board.version !== VERSION || !data.events.some(e => e.id === board.eventId) || !Array.isArray(board.locks) || board.locks.length > 40) throw new Error('Invalid or unsupported shared board.');
    const known = new Set(data.fighters.map(f => f.id)), used = new Set();
    for (const p of board.locks) { if (!known.has(p.a) || !known.has(p.b) || p.a === p.b || used.has(p.a) || used.has(p.b)) throw new Error('Shared board has missing fighters or duplicate bookings.'); used.add(p.a); used.add(p.b); }
    return board;
  }
  return { VERSION, WEIGHTS, pairKey, normalize, division, rank, streak, tier, tags, eventResult, priorMeetings, rematchCase, availability, targetRange, evaluate, candidates, recommendations, lock, autoMatch, validateBoard };
});
