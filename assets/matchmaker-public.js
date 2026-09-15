/* Public Matchmaker recommendation filters shared by browser and tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MatlockMatchmakerPublic = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_MEDIUM_ALTERNATIVE_GAP = 12;

  function titleQueueEligible(fighter, recommendation, engine, ctx) {
    const opponent = recommendation?.fighter;
    if (!opponent) return false;

    const fighterRank = engine.rank(fighter, ctx);
    const opponentRank = engine.rank(opponent, ctx);
    const oneChampion = (fighterRank === 0) !== (opponentRank === 0);
    if (!oneChampion) return true;

    const challenger = fighterRank === 0 ? opponent : fighter;
    if (typeof engine.titleClaim === 'function') return engine.titleClaim(challenger, ctx).eligible;
    return engine.eventResult(challenger, ctx) === 'W';
  }

  function filterRecommendations(fighter, recommendations, engine, ctx) {
    const titleEligible = recommendations.filter(recommendation => titleQueueEligible(fighter, recommendation, engine, ctx));
    if (titleEligible.length < 2) return titleEligible;

    const bestScore = titleEligible[0].score;
    return titleEligible.filter((recommendation, index) => {
      if (index === 0 || recommendation.confidence === 'high') return true;
      return recommendation.score >= bestScore - MAX_MEDIUM_ALTERNATIVE_GAP;
    });
  }

  return { MAX_MEDIUM_ALTERNATIVE_GAP, titleQueueEligible, filterRecommendations };
});
