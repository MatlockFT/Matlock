/* Public Matchmaker recommendation filters shared by browser and tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.MatlockMatchmakerPublic = api;
    api.install(root.MatlockMatchmaker);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_MEDIUM_ALTERNATIVE_GAP = 12;
  const PUBLIC_CANDIDATE_POOL = 8;

  function contextualTitleRematch(recommendation) {
    const rematch = recommendation?.rematch;
    return Boolean(rematch?.allowed && rematch.profile?.titleBout && (rematch.profile.closeDecision || rematch.profile.balancedSeries));
  }

  function titleQueueEligible(fighter, recommendation, engine, ctx) {
    const opponent = recommendation?.fighter;
    if (!opponent) return false;

    const fighterRank = engine.rank(fighter, ctx);
    const opponentRank = engine.rank(opponent, ctx);
    const oneChampion = (fighterRank === 0) !== (opponentRank === 0);
    if (!oneChampion) return true;
    if (contextualTitleRematch(recommendation)) return true;

    const challenger = fighterRank === 0 ? opponent : fighter;
    if (typeof engine.titleClaim === 'function') return engine.titleClaim(challenger, ctx).eligible;
    return engine.eventResult(challenger, ctx) === 'W';
  }

  function reciprocalRank(recommendation) {
    const value = Number(recommendation?.opportunityCost?.reciprocalRank);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function reciprocalAdjustment(recommendation) {
    const rank = reciprocalRank(recommendation);
    if (rank === null) return 0;
    if (rank === 1) return 1.5;
    if (rank === 2) return 1;
    if (rank === 3) return 0.5;
    if (rank === 4) return 0;
    return -Math.min(2, (rank - 4) * 0.5);
  }

  function publicPriority(recommendation) {
    const rankingScore = Number(recommendation?.rankingScore);
    const pairScore = Number(recommendation?.score);
    const base = Number.isFinite(rankingScore) ? rankingScore : Number.isFinite(pairScore) ? pairScore : 0;
    return base + reciprocalAdjustment(recommendation);
  }

  function orderForPublic(recommendations) {
    return recommendations.slice().sort((a, b) =>
      publicPriority(b) - publicPriority(a) ||
      Number(b?.rankingScore ?? b?.score ?? 0) - Number(a?.rankingScore ?? a?.score ?? 0) ||
      Number(b?.score ?? 0) - Number(a?.score ?? 0) ||
      String(a?.fighter?.id || '').localeCompare(String(b?.fighter?.id || ''))
    );
  }

  function filterRecommendations(fighter, recommendations, engine, ctx) {
    const titleEligible = recommendations.filter(recommendation => titleQueueEligible(fighter, recommendation, engine, ctx));
    const ordered = orderForPublic(titleEligible).slice(0, 3);
    if (ordered.length < 2) return ordered;

    const bestScore = ordered[0].score;
    return ordered.filter((recommendation, index) => {
      if (index === 0 || recommendation.confidence === 'high') return true;
      return recommendation.score >= bestScore - MAX_MEDIUM_ALTERNATIVE_GAP;
    });
  }

  function selectRecommendations(fighter, fighters, engine, ctx) {
    if (!engine || typeof engine.candidates !== 'function') return [];
    const pool = engine.candidates(fighter, fighters, ctx)
      .filter(recommendation => recommendation.publishable)
      .slice(0, PUBLIC_CANDIDATE_POOL);
    return filterRecommendations(fighter, pool, engine, ctx);
  }

  function install(engine) {
    if (!engine || typeof engine.candidates !== 'function' || engine.__matlockPublicOrderingInstalled) return false;
    engine.recommendations = (fighter, fighters, ctx) => selectRecommendations(fighter, fighters, engine, ctx);
    Object.defineProperty(engine, '__matlockPublicOrderingInstalled', { value: true, configurable: false, enumerable: false });
    return true;
  }

  return {
    MAX_MEDIUM_ALTERNATIVE_GAP,
    PUBLIC_CANDIDATE_POOL,
    contextualTitleRematch,
    titleQueueEligible,
    reciprocalRank,
    reciprocalAdjustment,
    publicPriority,
    orderForPublic,
    filterRecommendations,
    selectRecommendations,
    install
  };
});
