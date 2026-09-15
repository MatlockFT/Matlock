/* Reusable deterministic engine. No browser, network, or language-model dependency. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MatlockMatchmaker = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 2;
  // Eligibility never earns points. These weights measure why the fight makes sense competitively.
  const WEIGHTS = { competitiveLevel: 30, careerDirection: 20, trajectory: 15, opponentQuality: 20, experience: 10, timing: 5 };
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

  function titleExperience(f) {
    const bouts = verifiedHistory(f).filter(meeting => meeting.competitionClass === 'ufc' && /\btitle bout\b/i.test(String(meeting.weightClass || '')));
    return {
      appearances: bouts.length,
      wins: bouts.filter(meeting => meeting.result === 'W').length,
      latest: bouts[0]?.date || null
    };
  }

  function careerLane(f, ctx) {
    const r = rank(f, ctx);
    const titles = titleExperience(f);
    if (r === 0) return 'current-champion';
    if (r !== null) return 'ranked';
    if (titles.wins >= 2 || titles.appearances >= 3) return 'championship-legacy';
    if (titles.appearances >= 1) return 'title-experienced';
    return 'standard-unranked';
  }

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
    const titles = titleExperience(f);
    if (streak(f) >= 3) result.push('RISING');
    if (streak(f) <= -2) result.push('FALLING');
    if (history(f).length <= 1) result.push('NEW TO UFC');
    if (history(f).length >= 15) result.push('VETERAN');
    if ((f.formerChampion || titles.wins > 0) && rank(f, ctx) !== 0) result.push('FORMER CHAMP');
    if (careerLane(f, ctx) === 'championship-legacy') result.push('CHAMPIONSHIP LEGACY');
    if (tier(f, ctx) === 'U+') result.push('PROSPECT');
    if (f.interim) result.push('INTERIM CHAMPION');
    return result;
  }

  function eventResult(f, ctx) {
    const fromEvent = ctx.event?.bouts?.flatMap(b => b.fighters || []).find(x => x.id === f.id);
    const latest = history(f)[0];
    return latest?.date > (ctx.event?.date || '') ? latest.result : fromEvent?.result || latest?.result;
  }

  function careerStage(f, ctx) {
    const r = rank(f, ctx);
    const s = streak(f);
    const result = eventResult(f, ctx);
    const experience = history(f).length;
    const titles = titleExperience(f);
    if (r === 0) return 'champion';
    if (r !== null) {
      if (r <= 5) return 'title-contender';
      if (s >= 2 || (result === 'W' && experience <= 5)) return 'rising-ranked';
      if (r <= 10) return 'established-ranked';
      return 'fringe-ranked';
    }
    if (titles.wins >= 2 || titles.appearances >= 3) return 'championship-legacy';
    if (titles.appearances >= 1) return 'title-experienced-veteran';
    if (experience <= 5 && (s >= 2 || (result === 'W' && experience <= 3))) return 'prospect';
    if (experience >= 8 && (result === 'L' || s <= -2)) return 'rebuilding-veteran';
    if (experience >= 8) return 'veteran';
    if (result === 'L') return 'rebuilding';
    if (result === 'W' && experience >= 4) return 'high-level-unranked';
    return 'standard-unranked';
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
      const datedOpponent = meeting.date && (meeting.opponentId || meeting.opponentName) ? `${meeting.date}|${meeting.opponentId || normalize(meeting.opponentName)}` : null;
      const id = meeting.fightStatsId || datedOpponent || meeting.sourceUrl || JSON.stringify(meeting);
      const existing = deduped.get(id);
      if (!existing || meeting.verified && !existing.verified) deduped.set(id, meeting);
    }
    return [...deduped.values()].sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')));
  }

  // Rematch progression is UFC competitive history, not feeder-series wins that are retained only for prior-meeting detection.
  const completeResults = f => history(f);

  function rematchCase(a, b, ctx) {
    const meetings = priorMeetings(a, b);
    const verifiedCoverage = hasVerifiedCoverage(a) && hasVerifiedCoverage(b);
    if (!meetings.length) return { allowed: true, meetings, verifiedCoverage, reason: verifiedCoverage ? 'No prior meeting in the verified fight ledger.' : 'Prior-meeting verification is incomplete.' };
    if (ctx.overrides?.[a.id]?.allowRematch || ctx.overrides?.[b.id]?.allowRematch) return { allowed: true, meetings, verifiedCoverage, reason: 'Rematch explicitly allowed by an override.' };
    if (['D', 'NC'].includes(meetings[0].result)) return { allowed: true, meetings, verifiedCoverage, reason: 'The previous meeting ended in a draw or no contest.' };
    const subsequentWins = f => completeResults(f).filter(h => h.date > meetings[0].date && h.result === 'W').length;
    if (Date.parse(ctx.asOf) - Date.parse(meetings[0].date) > 3 * 365 * DAY && subsequentWins(a) >= 3 && subsequentWins(b) >= 3) return { allowed: true, meetings, verifiedCoverage, reason: 'More than three years apart, with at least three subsequent UFC wins for each fighter.' };
    const series = meetings.filter(meeting => ['W', 'L', 'D', 'NC'].includes(meeting.result));
    if (series.length === 2 && series.some(h => h.result === 'W') && series.some(h => h.result === 'L') && subsequentWins(a) >= 1 && subsequentWins(b) >= 1) return { allowed: true, meetings, verifiedCoverage, reason: 'A 1–1 series, with both fighters winning again in the UFC since their last meeting.' };
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

  // Ranked fighters use this as their actual hierarchy target; unranked values remain diagnostic.
  function targetRange(a, ctx) {
    const r = rank(a, ctx), result = eventResult(a, ctx);
    if (r === 0) return [1, 5];
    if (r === null) return streak(a) >= 3 ? [12, 20] : [16, 26];
    return result === 'W' ? [Math.max(1, r - (r >= 11 ? 5 : 4)), Math.min(16, r + 1)] : [Math.max(1, r - 1), Math.min(21, r + 5)];
  }

  function baseCompetitiveState(f, ctx) {
    const r = rank(f, ctx);
    const s = streak(f);
    const result = eventResult(f, ctx);
    const experience = history(f).length;
    const titles = titleExperience(f);
    const lane = careerLane(f, ctx);
    const stage = careerStage(f, ctx);
    const formerChampion = Boolean(f.formerChampion || titles.wins > 0);
    let level;
    if (r === 0) level = 100;
    else if (r !== null) level = clamp(98 - (r - 1) * 2.55, 60, 98);
    else level = clamp(40 + Math.min(experience, 8) * 1.8 + Math.max(0, s) * 3 - Math.max(0, -s) * 3 + (result === 'W' ? 4 : result === 'L' ? -3 : 0) + (formerChampion ? 6 : 0), 28, 68);

    let type;
    if (r === 0) type = 'champion';
    else if (r !== null && r <= 5 && result === 'W') type = 'elite-contender';
    else if (r !== null && result === 'L') type = 'ranked-rebound';
    else if (r !== null && s >= 2) type = 'ranked-riser';
    else if (r !== null && r <= 10) type = 'ranked-contender';
    else if (r !== null) type = 'fringe-ranked';
    else if (lane === 'championship-legacy') type = 'championship-legacy';
    else if (lane === 'title-experienced') type = 'title-experienced-veteran';
    else if (s >= 3 && experience <= 7) type = 'surging-prospect';
    else if (experience <= 3 && result === 'W') type = 'developing-prospect';
    else if (experience >= 8 && result === 'L') type = 'rebuilding-veteran';
    else if (experience >= 7) type = 'unranked-veteran';
    else if (result === 'L') type = 'rebuilding';
    else type = 'high-end-unranked';
    return { type, level, rank: r, streak: s, result, experience, titleExperience: titles, careerLane: lane, careerStage: stage, formerChampion };
  }

  function scheduleStrength(f, ctx, limit = 5) {
    const index = ctx.fighterIndex instanceof Map ? ctx.fighterIndex : null;
    const recent = history(f).filter(bout => ['W', 'L', 'D', 'NC'].includes(bout.result)).slice(0, limit);
    const weights = [1, 0.85, 0.7, 0.55, 0.45];
    let possibleWeight = 0, linkedWeight = 0, levelTotal = 0, winWeight = 0, winLevelTotal = 0, linkedBouts = 0;
    for (let i = 0; i < recent.length; i++) {
      const bout = recent[i], weight = weights[i] ?? 0.4;
      possibleWeight += weight;
      if (!index) continue;
      const opponentId = (bout.opponentIds || []).find(id => index.has(id));
      const opponent = opponentId ? index.get(opponentId) : null;
      if (!opponent) continue;
      const opponentLevel = baseCompetitiveState(opponent, ctx).level;
      levelTotal += opponentLevel * weight;
      linkedWeight += weight;
      linkedBouts++;
      if (bout.result === 'W') {
        winLevelTotal += opponentLevel * weight;
        winWeight += weight;
      }
    }
    return {
      average: linkedWeight ? levelTotal / linkedWeight : null,
      winAverage: winWeight ? winLevelTotal / winWeight : null,
      coverage: possibleWeight ? linkedWeight / possibleWeight : 0,
      linkedBouts,
      sampledBouts: recent.length
    };
  }

  function recentForm(f, ctx, limit = 5) {
    const index = ctx.fighterIndex instanceof Map ? ctx.fighterIndex : null;
    const recent = history(f).filter(bout => ['W', 'L', 'D', 'NC'].includes(bout.result)).slice(0, limit);
    const verified = verifiedHistory(f);
    const weights = [1, 0.82, 0.66, 0.52, 0.4];
    let possibleWeight = 0, linkedWeight = 0, weightedTotal = 0, titleBouts = 0;
    const bouts = recent.map((bout, i) => {
      const weight = weights[i] ?? 0.35;
      possibleWeight += weight;
      const opponentId = (bout.opponentIds || []).find(id => index?.has(id));
      const opponent = opponentId && index ? index.get(opponentId) : null;
      if (opponent) linkedWeight += weight;
      const opponentLevel = opponent ? baseCompetitiveState(opponent, ctx).level : 50;
      const meeting = verified.find(item => item.date === bout.date && (
        (item.opponentId && (bout.opponentIds || []).includes(item.opponentId)) ||
        (!item.opponentId && item.opponentName && normalize(bout.text).includes(normalize(item.opponentName)))
      ));
      const titleBout = Boolean(meeting && meeting.competitionClass === 'ufc' && /\btitle bout\b/i.test(String(meeting.weightClass || '')));
      if (titleBout) titleBouts++;
      const resultBase = bout.result === 'W' ? 62 : bout.result === 'L' ? 38 : 50;
      const titleContext = titleBout ? (['W', 'L'].includes(bout.result) ? 5 : 2) : 0;
      const value = clamp(resultBase + (opponentLevel - 50) * 0.28 + titleContext, 20, 85);
      weightedTotal += value * weight;
      return { date: bout.date, result: bout.result, opponentId: opponentId || meeting?.opponentId || null, opponentLevel, titleBout, value, weight };
    });
    return {
      score: possibleWeight ? weightedTotal / possibleWeight : 50,
      coverage: possibleWeight ? linkedWeight / possibleWeight : 0,
      sampledBouts: recent.length,
      linkedBouts: bouts.filter(bout => bout.opponentId && index?.has(bout.opponentId)).length,
      titleBouts,
      bouts
    };
  }

  function competitiveState(f, ctx) {
    const base = baseCompetitiveState(f, ctx);
    const schedule = scheduleStrength(f, ctx);
    const form = recentForm(f, ctx);
    let scheduleAdjustment = 0;
    // Current rankings dominate ranked fighters. For unranked fighters, verified opposition quality
    // separates proven UFC competition from shallow records that would otherwise look identical.
    if (base.rank === null && schedule.average !== null && schedule.coverage >= 0.25) {
      const winLevel = schedule.winAverage ?? schedule.average;
      scheduleAdjustment = clamp(((schedule.average - 50) * 0.14 + (winLevel - 50) * 0.06) * schedule.coverage, -6, 8);
    }
    return { ...base, baseLevel: base.level, level: clamp(base.level + scheduleAdjustment, 28, 100), scheduleAdjustment, schedule, form };
  }

  function titleClaim(f, ctx) {
    const state = competitiveState(f, ctx);
    const r = state.rank;
    if (r === null || r === 0) return { eligible: false, score: 0, reason: 'A title challenger must be a ranked non-champion.', rank: r };
    if (r > 5) return { eligible: false, score: 0, reason: `Rank #${r} is outside the automatic title-challenger tier.`, rank: r };
    if (state.result !== 'W') return { eligible: false, score: 0, reason: 'Automatic title challengers must be coming off a UFC win.', rank: r };

    const titleLosses = verifiedHistory(f).filter(meeting => meeting.competitionClass === 'ufc' && meeting.result === 'L' && /\btitle bout\b/i.test(String(meeting.weightClass || '')));
    const latestTitleLoss = titleLosses[0] || null;
    const winsSinceTitleLoss = latestTitleLoss ? history(f).filter(bout => bout.date > latestTitleLoss.date && bout.result === 'W').length : null;
    const latestWin = state.form?.bouts?.find(bout => bout.result === 'W') || null;
    const latestWinQuality = latestWin?.opponentLevel ?? state.schedule?.winAverage ?? 50;
    const strongRecentWin = latestWinQuality >= 68;
    const formQualified = (state.form?.score ?? 50) >= 58;
    const momentumQualified = state.streak >= 2;
    const rankQualified = r <= 2;
    const claimQualified = rankQualified || momentumQualified || strongRecentWin || formQualified;
    if (!claimQualified) return { eligible: false, score: 0, reason: `Rank #${r} has not built enough recent form or win quality for an automatic title shot.`, rank: r, winsSinceTitleLoss, latestWinQuality };
    if (latestTitleLoss && winsSinceTitleLoss === 0) return { eligible: false, score: 0, reason: 'A recent title-fight loss requires a subsequent UFC win before another automatic title shot.', rank: r, winsSinceTitleLoss, latestWinQuality };

    const rankPoints = clamp(46 - (r - 1) * 6, 22, 46);
    const streakPoints = clamp(Math.max(state.streak, 0) * 5, 0, 15);
    const formPoints = clamp(((state.form?.score ?? 50) - 45) * 0.45, 0, 18);
    const qualityPoints = clamp((latestWinQuality - 50) * 0.35, 0, 14);
    const titlePenalty = latestTitleLoss && winsSinceTitleLoss === 1 ? 8 : 0;
    const score = Math.round(clamp(rankPoints + streakPoints + formPoints + qualityPoints - titlePenalty, 0, 100));
    return {
      eligible: true,
      score,
      rank: r,
      streak: state.streak,
      formScore: Number((state.form?.score ?? 50).toFixed(2)),
      latestWinQuality: Number(latestWinQuality.toFixed(2)),
      latestTitleLoss: latestTitleLoss?.date || null,
      winsSinceTitleLoss,
      reason: 'Current rank, recent wins, opponent quality, and title history support a credible title claim.'
    };
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

  function rankedHierarchy(a, b, ctx, self = competitiveState(a, ctx), opponent = competitiveState(b, ctx)) {
    if (self.rank === null || opponent.rank === null || self.rank === 0 || opponent.rank === 0) return null;
    const band = targetRange(a, ctx);
    const distance = bandDistance(opponent.rank, band);
    const rankGap = Math.abs(self.rank - opponent.rank);
    const direction = distance === 0 ? 20 : distance === 1 ? 18 : distance <= 3 ? 14 : 8;
    let trajectory = 9;
    if (self.result === 'W' && opponent.result === 'L' || self.result === 'L' && opponent.result === 'W') trajectory = distance <= 1 ? 15 : distance <= 3 ? 12 : 8;
    else if (self.result === 'W' && opponent.result === 'W') trajectory = rankGap <= 5 ? 13 : 9;
    else if (self.result === 'L' && opponent.result === 'L') trajectory = rankGap <= 5 ? 12 : 7;
    else if (opponent.streak >= 3 && self.result !== 'W') trajectory = 13;
    return { band, distance, rankGap, direction, trajectory };
  }

  function recentFormTrajectoryFit(self, opponent) {
    const selfScore = self.form?.score ?? 50;
    const opponentScore = opponent.form?.score ?? 50;
    const target = self.result === 'W' ? selfScore + 4 : self.result === 'L' ? selfScore - 4 : selfScore;
    let fit = clamp(15 - Math.abs(opponentScore - target) * 0.22, 6, 15);
    if (self.result === 'W' && opponentScore < 45) fit -= 1.5;
    if (self.result === 'L' && opponentScore > 65) fit -= 1.5;
    return clamp(fit, 5, 15);
  }

  function opponentQualityFit(self, opponent) {
    const selfSchedule = self.schedule?.average;
    const opponentSchedule = opponent.schedule?.average;
    if (opponentSchedule === null || opponentSchedule === undefined) return 10;
    const target = (selfSchedule ?? self.level) + (self.result === 'W' ? 5 : self.result === 'L' ? -5 : 0);
    const raw = clamp(20 - Math.abs(opponentSchedule - target) * 0.55, 4, 20);
    const coverage = selfSchedule === null || selfSchedule === undefined
      ? (opponent.schedule?.coverage || 0) * 0.6
      : Math.min(self.schedule?.coverage || 0, opponent.schedule?.coverage || 0);
    return clamp(10 + (raw - 10) * coverage, 4, 20);
  }

  function directionalFit(a, b, ctx) {
    const self = competitiveState(a, ctx);
    const opponent = competitiveState(b, ctx);
    const hierarchy = rankedHierarchy(a, b, ctx, self, opponent);
    const band = hierarchy?.band || desiredLevelBand(self);
    const distance = hierarchy ? hierarchy.distance : bandDistance(opponent.level, band);
    const levelFit = hierarchy
      ? clamp(WEIGHTS.competitiveLevel - distance * 4, 0, WEIGHTS.competitiveLevel)
      : clamp(WEIGHTS.competitiveLevel - distance * 2, 0, WEIGHTS.competitiveLevel);

    let direction = hierarchy?.direction ?? 14;
    if (!hierarchy) {
      if (self.result === 'W') {
        if (opponent.level >= self.level - 3 && opponent.level <= self.level + 14) direction = 20;
        else if (opponent.level < self.level - 10) direction = 6;
        else direction = 12;
      } else if (self.result === 'L') {
        if (opponent.level >= self.level - 14 && opponent.level <= self.level + 5) direction = 20;
        else if (opponent.level > self.level + 10) direction = 7;
        else direction = 13;
      } else direction = Math.abs(opponent.level - self.level) <= 10 ? 18 : 11;
    }

    let trajectory = hierarchy?.trajectory ?? 9;
    if (!hierarchy) {
      if (self.result === 'W' && opponent.result === 'L' && opponent.level >= self.level - 2) trajectory = 15;
      else if (self.result === 'L' && opponent.result === 'W' && opponent.level <= self.level + 8) trajectory = 15;
      else if (self.result === 'W' && opponent.result === 'W') trajectory = Math.abs(opponent.level - self.level) <= 14 ? 13 : 9;
      else if (self.result === 'L' && opponent.result === 'L') trajectory = Math.abs(opponent.level - self.level) <= 14 ? 12 : 7;
      else if (opponent.streak >= 3 && self.result !== 'W') trajectory = 13;
    }
    const formTrajectory = recentFormTrajectoryFit(self, opponent);
    trajectory = Number(clamp(trajectory * 0.6 + formTrajectory * 0.4, 4, 15).toFixed(2));

    const opponentQuality = opponentQualityFit(self, opponent);
    const experienceGap = Math.abs(self.experience - opponent.experience);
    const experience = experienceGap <= 3 ? 10 : experienceGap <= 6 ? 8 : experienceGap <= 10 ? 5 : 2;
    let timing = 0;
    if (a.lastFight && b.lastFight) {
      const days = Math.abs(Date.parse(a.lastFight) - Date.parse(b.lastFight)) / DAY;
      timing = days <= 120 ? 5 : days <= 240 ? 3 : days <= 365 ? 2 : 1;
    }
    const parts = { competitiveLevel: levelFit, careerDirection: direction, trajectory, opponentQuality, experience, timing };
    return {
      fighter: a,
      opponent: b,
      state: self,
      opponentState: opponent,
      band,
      distance,
      hierarchySource: hierarchy ? 'rank' : 'competitive-level',
      rankGap: hierarchy?.rankGap ?? null,
      formTrajectory,
      parts,
      score: Object.values(parts).reduce((sum, value) => sum + value, 0)
    };
  }

  function scheduleComparison(aState, bState) {
    const a = aState.schedule?.average, b = bState.schedule?.average;
    if (a === null || a === undefined || b === null || b === undefined) return null;
    if ((aState.schedule?.coverage || 0) < 0.35 || (bState.schedule?.coverage || 0) < 0.35) return null;
    return a - b;
  }

  function matchupCase(a, b, ctx, aFit, bFit) {
    const A = aFit.state, B = bFit.state;
    const levelGap = Math.abs(A.level - B.level);
    const rankedPair = A.rank !== null && B.rank !== null && A.rank > 0 && B.rank > 0;
    const rankGap = rankedPair ? Math.abs(A.rank - B.rank) : null;
    const scheduleGap = scheduleComparison(A, B);
    let code = 'divisional-sorting';
    let rationale;
    let reasons;

    const champion = A.rank === 0 ? a : B.rank === 0 ? b : null;
    const challenger = champion?.id === a.id ? b : champion ? a : null;
    const challengerState = champion?.id === a.id ? B : champion ? A : null;
    const challengerClaim = challenger ? titleClaim(challenger, ctx) : null;
    if (champion && challenger && challengerClaim?.eligible) {
      code = 'title-case';
      rationale = `${challenger.name} has a credible current title claim against champion ${champion.name}.`;
      reasons = [`${challenger.name} is ranked #${challengerState.rank}.`, `Title-claim score: ${challengerClaim.score}/100.`, 'Recent form and title history clear the automatic title-shot gate.'];
    } else if (A.rank !== null && B.rank !== null && A.rank <= 5 && B.rank <= 5 && A.result === 'W' && B.result === 'W') {
      code = 'title-eliminator';
      rationale = `${a.name} and ${b.name} are both winning inside the top contender tier; pairing them directly clarifies the title queue.`;
      reasons = [`${a.name} is ranked #${A.rank}.`, `${b.name} is ranked #${B.rank}.`, 'Both are coming off wins.'];
    } else if (A.result === 'W' && B.result === 'L' || A.result === 'L' && B.result === 'W') {
      const winner = A.result === 'W' ? a : b;
      const loser = winner.id === a.id ? b : a;
      const winnerState = winner.id === a.id ? A : B;
      const loserState = winner.id === a.id ? B : A;
      const winnerSchedule = winnerState.schedule?.average;
      const loserSchedule = loserState.schedule?.average;
      const strongerSchedule = winnerSchedule !== null && winnerSchedule !== undefined && loserSchedule !== null && loserSchedule !== undefined && (winnerState.schedule?.coverage || 0) >= 0.35 && (loserState.schedule?.coverage || 0) >= 0.35 && loserSchedule >= winnerSchedule + 5;
      const rankedProgression = winnerState.rank !== null && loserState.rank !== null && winnerState.rank > 0 && loserState.rank > 0
        && bandDistance(loserState.rank, targetRange(winner, ctx)) <= 2
        && bandDistance(winnerState.rank, targetRange(loser, ctx)) <= 2;
      const levelProgression = !rankedPair && loserState.level >= winnerState.level - 2;
      if (rankedProgression || levelProgression) {
        code = loserState.rank !== null && winnerState.rank === null ? 'ranking-opportunity' : 'step-up-vs-rebound';
        rationale = `${winner.name} is coming off a win and is ready for stronger opposition; ${loser.name} is coming off ${strongerSchedule ? 'the stronger recent UFC schedule' : 'higher or comparable competition'}, giving ${winner.name} a meaningful step up while giving ${loser.name} a credible rebound fight.`;
        reasons = [
          `${winner.name} is coming off a win${winnerState.streak > 1 ? ` with a ${winnerState.streak}-fight winning streak` : ''}.`,
          rankedProgression ? `${winner.name} is ranked #${winnerState.rank}; ${loser.name} is ranked #${loserState.rank}.` : `${loser.name} is coming off a loss but remains in a ${loserState.rank !== null ? `ranked (#${loserState.rank})` : 'comparable'} competitive tier.`,
          strongerSchedule ? `${loser.name}'s recent linked opponents grade stronger than ${winner.name}'s.` : 'The pairing advances one trajectory without forcing the other fighter into an artificial drop.'
        ];
      }
    }

    const comparableWins = rankedPair ? rankGap <= 5 : levelGap <= 14;
    if (!rationale && A.result === 'W' && B.result === 'W' && comparableWins) {
      code = A.rank === null && B.rank === null ? 'rising-vs-rising' : 'rankings-progression';
      const scheduleDetail = scheduleGap !== null && Math.abs(scheduleGap) >= 6 ? `${scheduleGap > 0 ? a.name : b.name} has faced the stronger recent UFC schedule, adding a real step in opposition for the other fighter.` : 'Neither fighter has to make an artificial jump or drop for the matchup.';
      rationale = `${a.name} and ${b.name} are both moving forward at a similar competitive level. Matching them now separates two upward trajectories and moves the winner toward the next tier.`;
      reasons = ['Both are coming off wins.', rankedPair ? `Their rankings are #${A.rank} and #${B.rank}.` : `Their competitive-level gap is ${Math.round(levelGap)} points on the engine scale.`, scheduleDetail];
    }

    const comparableLosses = rankedPair ? rankGap <= 5 : levelGap <= 14;
    if (!rationale && A.result === 'L' && B.result === 'L' && comparableLosses) {
      code = 'rebound-pairing';
      rationale = `${a.name} and ${b.name} are both coming off setbacks at a similar level. This is a logical reset fight that keeps the winner relevant without dropping either fighter too far down the division.`;
      reasons = ['Both are coming off losses.', rankedPair ? `Their rankings are #${A.rank} and #${B.rank}.` : `Their competitive-level gap is ${Math.round(levelGap)} points on the engine scale.`, 'Both need a credible rebound opportunity.'];
    }

    if (!rationale) {
      const prospect = ['surging-prospect', 'developing-prospect'].includes(A.type) ? a : ['surging-prospect', 'developing-prospect'].includes(B.type) ? b : null;
      const veteran = prospect?.id === a.id && B.experience >= 6 ? b : prospect?.id === b.id && A.experience >= 6 ? a : null;
      if (prospect && veteran) {
        const veteranState = veteran.id === a.id ? A : B;
        const prospectState = prospect.id === a.id ? A : B;
        const provenSchedule = veteranState.schedule?.average !== null && veteranState.schedule?.average !== undefined && prospectState.schedule?.average !== null && prospectState.schedule?.average !== undefined && (veteranState.schedule?.coverage || 0) >= 0.35 && veteranState.schedule.average > prospectState.schedule.average + 4;
        code = 'prospect-test';
        rationale = `${prospect.name} needs a deeper UFC test; ${veteran.name}'s ${provenSchedule ? 'stronger recent opposition and ' : ''}experience make this a credible measuring stick without skipping multiple tiers.`;
        reasons = [`${prospect.name} is classified as a ${prospect.id === a.id ? A.type : B.type}.`, `${veteran.name} has ${veteranState.experience} canonical UFC bouts.`, provenSchedule ? `${veteran.name} has faced the stronger recent linked UFC schedule.` : 'The competitive-level gap remains inside a defensible range.'];
      }
    }

    if (!rationale) {
      rationale = `${a.name} and ${b.name} occupy a comparable competitive tier, and the matchup would clarify their position in the division without forcing an artificial leap up or down.`;
      reasons = [
        `${a.name}: ${A.rank === null ? 'unranked' : A.rank === 0 ? 'champion' : `#${A.rank}`}, ${A.result || 'no recent result'} trajectory.`,
        `${b.name}: ${B.rank === null ? 'unranked' : B.rank === 0 ? 'champion' : `#${B.rank}`}, ${B.result || 'no recent result'} trajectory.`,
        rankedPair ? `Ranking gap: ${rankGap}.` : `Competitive-level gap: ${Math.round(levelGap)}.`
      ];
    }

    return { code, rationale, reasons };
  }

  function confidenceFor(score, weakerSide, balanceGap, caseFile) {
    // Confidence describes the strength of the fit after eligibility. It is diagnostic only;
    // hard eligibility decides whether an automatic pairing can be recommended.
    if (caseFile.code === 'divisional-sorting') return 'low';
    if (score >= 78 && weakerSide >= 70 && balanceGap <= 14) return 'high';
    if (score >= 64 && weakerSide >= 58 && balanceGap <= 20) return 'medium';
    return 'low';
  }

  function careerLaneMismatch(a, b, A, B) {
    if (A.rank !== null && B.rank !== null) return null;
    const aStage = A.careerStage;
    const bStage = B.careerStage;
    const legacyPool = new Set(['championship-legacy', 'title-experienced-veteran', 'title-contender', 'established-ranked', 'rising-ranked', 'fringe-ranked', 'high-level-unranked']);
    const lowUnranked = new Set(['standard-unranked', 'veteran', 'rebuilding', 'rebuilding-veteran']);

    if (aStage === 'championship-legacy' && !legacyPool.has(bStage)) return `${a.name} is in a championship-legacy career lane; automatic matchmaking keeps unranked legacy title fighters against ranked, UFC title-experienced, or high-level unranked opposition.`;
    if (bStage === 'championship-legacy' && !legacyPool.has(aStage)) return `${b.name} is in a championship-legacy career lane; automatic matchmaking keeps unranked legacy title fighters against ranked, UFC title-experienced, or high-level unranked opposition.`;

    if (aStage === 'title-contender' && B.rank === null && lowUnranked.has(bStage)) return `${a.name} is a top-five title contender while ${b.name} is in a ${bStage} career state; automatic matchmaking does not bridge that career-stage gap.`;
    if (bStage === 'title-contender' && A.rank === null && lowUnranked.has(aStage)) return `${b.name} is a top-five title contender while ${a.name} is in a ${aStage} career state; automatic matchmaking does not bridge that career-stage gap.`;

    if (aStage === 'established-ranked' && B.rank === null && lowUnranked.has(bStage)) return `${a.name} is an established ranked fighter while ${b.name} is in a ${bStage} career state; automatic matchmaking keeps that unranked pool below established contenders.`;
    if (bStage === 'established-ranked' && A.rank === null && lowUnranked.has(aStage)) return `${b.name} is an established ranked fighter while ${a.name} is in a ${aStage} career state; automatic matchmaking keeps that unranked pool below established contenders.`;
    return null;
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
    const laneMismatch = careerLaneMismatch(a, b, A, B);
    if (!manual && laneMismatch) return reject(laneMismatch);
    const champion = A.rank === 0 ? a : B.rank === 0 ? b : null;
    if (!manual && champion) {
      const challenger = champion.id === a.id ? b : a;
      const claim = titleClaim(challenger, ctx);
      if (!claim.eligible) return reject(`No credible automatic title claim: ${claim.reason}`);
    }
    if (!manual && (A.experience >= 7 && B.experience < 2 || B.experience >= 7 && A.experience < 2)) return reject('Too large a UFC experience gap for an automatic recommendation.');
    if (!manual && ((A.rank === 0 && (B.rank === null || B.rank > 7)) || (B.rank === 0 && (A.rank === null || A.rank > 7)) || (A.rank !== null && B.rank !== null && Math.abs(A.rank - B.rank) > 8) || (A.rank !== null && A.rank < 8 && B.rank === null && B.level < 62) || (B.rank !== null && B.rank < 8 && A.rank === null && A.level < 62))) return reject('Outside a defensible competitive range.');

    const aFit = directionalFit(a, b, ctx);
    const bFit = directionalFit(b, a, ctx);
    const harmonic = aFit.score + bFit.score ? 2 * aFit.score * bFit.score / (aFit.score + bFit.score) : 0;
    const weakerSide = Math.min(aFit.score, bFit.score);
    const balanceGap = Math.abs(aFit.score - bFit.score);
    const score = Math.round(clamp(harmonic * 0.7 + weakerSide * 0.3 - balanceGap * 0.12, 0, 100));
    const caseFile = matchupCase(a, b, ctx, aFit, bFit);
    const confidence = confidenceFor(score, weakerSide, balanceGap, caseFile);
    const sameEvent = ctx.event?.bouts?.flatMap(bout => bout.fighters || []).some(f => f.id === b.id);
    const evidence = [
      ...caseFile.reasons,
      `Two-sided fit: ${a.name} ${Math.round(aFit.score)}/100; ${b.name} ${Math.round(bFit.score)}/100.`,
      `Pair balance: ${balanceGap.toFixed(1)} points; weaker-side fit ${Math.round(weakerSide)}/100.`,
      `Recent-form quality: ${a.name} ${aFit.state.form.score.toFixed(1)}/100; ${b.name} ${bFit.state.form.score.toFixed(1)}/100.`,
      `Recent-opposition coverage: ${Math.round((aFit.state.schedule?.coverage || 0) * 100)}% / ${Math.round((bFit.state.schedule?.coverage || 0) * 100)}%.`,
      `Timing: last listed fights ${a.lastFight || 'unknown'} / ${b.lastFight || 'unknown'}${sameEvent ? ' (same card)' : ''}.`,
      rematch.meetings.length ? rematch.reason : 'Freshness passed the verified prior-meeting gate.'
    ];
    return {
      eligible: true,
      fighter: b,
      score,
      pairScore: score,
      confidence,
      publishable: true,
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

  function rosterContext(fighters, ctx) {
    return ctx.fighterIndex instanceof Map ? ctx : { ...ctx, fighterIndex: new Map(fighters.map(fighter => [fighter.id, fighter])) };
  }

  function candidates(a, fighters, ctx) {
    const scoped = rosterContext(fighters, ctx);
    const requireVerified = fighters.some(f => Number(f.historyModelVersion || 0) >= 2);
    const evaluated = fighters.map(b => evaluatePair(a, b, scoped, false, requireVerified)).filter(r => r.eligible);
    if (rank(a, scoped) === 0) {
      return evaluated.sort((x, y) => titleClaim(y.fighter, scoped).score - titleClaim(x.fighter, scoped).score || y.score - x.score || x.fighter.id.localeCompare(y.fighter.id));
    }
    return evaluated.sort((x, y) => y.score - x.score || x.fighter.id.localeCompare(y.fighter.id));
  }

  function recommendations(a, fighters, ctx) {
    return candidates(a, fighters, ctx).filter(r => r.publishable).slice(0, 3).map((r, i) => ({ ...r, label: ['Best match', 'Alternative', 'Another option'][i] }));
  }

  function lock(a, b, ctx, manual = false) {
    const match = evaluatePair(a, b, ctx, manual, false);
    if (!match.eligible) throw new Error(match.reason);
    return { a: a.id, b: b.id, score: match.score, rationale: match.rationale, evidence: match.evidence, manual, createdAt: new Date().toISOString() };
  }

  function autoMatch(fighters, ctx, targetIds, limit = 20000) {
    const scoped = rosterContext(fighters, ctx);
    const targets = new Set(targetIds), used = new Set((scoped.locks || []).flatMap(p => [p.a, p.b]));
    const remaining = fighters.filter(f => targets.has(f.id) && !availability(f, scoped));
    const choices = new Map(remaining.map(a => [a.id, candidates(a, fighters, scoped).filter(r => r.publishable).slice(0, 10).map(r => ({ a: a.id, b: r.fighter.id, score: r.score, rationale: r.rationale, evidence: r.evidence, manual: false, createdAt: new Date().toISOString() }))]));
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
    return { pairs: best, searched: Math.min(visited, limit), optimal: false, method: 'Bounded search over ten publishable two-sided matchups per fighter' };
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

  return { VERSION, WEIGHTS, pairKey, normalize, division, rank, titleExperience, titleClaim, careerLane, careerStage, streak, tier, tags, eventResult, priorMeetings, rematchCase, availability, targetRange, baseCompetitiveState, scheduleStrength, recentForm, competitiveState, rankedHierarchy, directionalFit, careerLaneMismatch, evaluatePair, evaluate, candidates, recommendations, lock, autoMatch, validateBoard };
});