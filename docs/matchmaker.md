# Matchmaker

The `/matchmaker/` route is intentionally simple: choose a completed UFC card and read the most plausible next opponents for each fighter. Visitors do not build or manage a fantasy booking board. The complexity belongs in the data and recommendation engine, not in the interface.

## Run and verify

Run `node scripts/update-matchmaker.mjs` to refresh source data, then `node scripts/check-matchmaker.mjs` for deterministic-engine regressions and real-card checks. The **Update Matchmaker data** workflow runs twice daily, supports manual dispatch, and also runs when Matchmaker engine/source code changes. Collection is atomic: validation failure leaves the previous good dataset published.

`assets/matchmaker-engine.js` is the deterministic recommendation engine. `scripts/matchmaker/sources/ufc.mjs` handles UFC event results, rankings and athlete-profile context. `scripts/matchmaker/sources/ufcstats.mjs` supplies structured prior-opponent history for rematch detection. The site's canonical UFC roster, upcoming schedule and portrait registry are reused. Visitors never trigger source scraping; the browser only reads normalized published JSON.

The refresh workflow also runs two recommendation-level validation passes. `scripts/matchmaker/audit-recommendations.mjs` audits the current engine and the actual public shortlist separately, including reciprocal-fit asymmetry and generic fallback usage. `scripts/matchmaker/backtest-recommendations.mjs` reconstructs recent pre-fight states and compares the engine's recommendations with the fighter's eventual next UFC opponent. The backtest is diagnostic calibration evidence, not an instruction to imitate every UFC booking.

## Engine principles

The engine separates hard facts from matchmaking judgment.

Hard eligibility facts are checked before scoring: active-roster status, announced bookings, division, prior UFC meetings and basic competitive-range constraints. A pair that fails a hard rule is not allowed into the recommendation ranking just because its score would otherwise be high.

Prior meetings receive special treatment because a false first-meeting claim is unacceptable. UFC.com athlete biography/history text remains useful for recent form and record context, but it is not treated as authoritative proof that two fighters have never met. Displayed event participants are cross-checked against structured UFCStats fighter histories. A verified prior meeting blocks an ordinary fresh-matchup recommendation unless the engine can establish a documented rematch case. When structured history coverage is unavailable, the engine labels the history as incomplete and reduces freshness confidence rather than claiming a first meeting.

The known Jean Silva / Diego Lopes fight on September 13, 2025 is a permanent regression case: the test suite must detect that meeting and reject Lopes as a normal fresh recommendation for Silva.

## Recommendation model

After hard eligibility checks, eligible opponents are ranked by a deterministic fit model using division hierarchy, trajectory, availability, freshness, progression, timing and limited story context. The score describes how defensible a booking is; it is not a fight-win probability.

The public page intentionally exposes only the useful result: up to three plausible opponents with concise factual context. Internal score components and source evidence remain available to tests and the engine without turning the page into an operator dashboard.

The public shortlist compares a small pool of the engine's strongest candidates before choosing the final three. When two matchups are already close, reciprocal booking fit can act as a modest ordering nudge: a matchup that also ranks highly in the proposed opponent's own queue can move ahead of a slightly stronger but one-sided option. Reciprocal fit is not a hard eligibility rule and cannot override a clearly stronger matchup, title-claim rules, prior-meeting rules, bookings or other hard constraints.

A generic `divisional-sorting` fallback may still exist inside the engine as a diagnostic signal that no stronger matchmaking thesis was found, but it is not public-eligible. Every matchup shown to visitors must have a specific engine case such as hierarchy progression, rebound pairing, prospect progression, contender positioning or a supported rematch/title case.

Rematches are conservative. A previous meeting normally excludes the matchup. Exceptions require an explicit supported case such as a draw/no contest, a qualifying 1–1 series with subsequent wins, or a sufficiently old matchup where both fighters have rebuilt with multiple wins. The presentation layer does not let visitors override these facts.

## Temporal backtesting

Historical validation must not leak present-day information backward. The backtest truncates each fighter's history and verified meeting ledger at the case cutoff date, reconstructs the record from only those bouts, clears current bookings and current champion-state flags, reconstructs active status from fight recency, and infers division only from source-native fight weight classes known at the cutoff.

Dated ranking snapshots under `assets/data/matchmaker/rankings/` are now part of the historical state. For each case, the backtest uses only the newest snapshot whose date is on or before the cutoff and is no more than 14 days old. If no qualifying snapshot exists, that case is deliberately evaluated unranked rather than applying today's rankings to an older booking. The report separates snapshot-backed cases from unranked cases so the historical score becomes more representative automatically as the archive grows.

The backtest also records why a real next opponent could not be reconstructed. Missing pre-cutoff UFC history, unverified history, missing historical division and division mismatches are counted separately rather than collapsed into a single missing-roster bucket. This keeps data-coverage failures distinct from actual matchmaking-model misses.

The historical candidate universe remains survivor-biased because it can only reconstruct fighters present in the current normalized Matchmaker dataset. The report records those coverage limits, missing targets, ineligible real bookings and representative misses so future changes can target systemic failure patterns instead of overfitting individual fights.

## Data quality and failure behavior

- Completed cards require verified results for every bout.
- Current rankings are captured as dated snapshots; later data is not retroactively treated as a historical ranking.
- Active-roster membership comes from the canonical roster collector. The engine does not invent active status.
- Upcoming UFC cards and the site's schedule/roster monitor are used to exclude already-booked fighters.
- UFCStats prior-opponent records are source-attributed and date-stamped. The normalized dataset records per-fighter verification coverage.
- The dataset validator checks structured meeting dates, results, source URLs, duplicate meetings and canonical opponent IDs.
- Once the structured history source is enabled, broad UFCStats coverage failure aborts publication rather than silently converting unknown history into "no previous meeting."
- Source outages retain the last valid published snapshot; they do not manufacture replacement history.

The goal is a low-friction page backed by a comparatively strict engine: the visitor should be able to glance at the recommendations, while the collector and tests do the work required to make those recommendations defensible.
