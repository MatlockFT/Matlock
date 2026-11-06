# Matlock Opponent Quality (OQ) — v1

## Purpose

The Tale of the Tape has two distinct measures:
- **Opponents combined record**: the sum of the professional career W-L records of every opponent; uses the opponents' current records.
- **Opponent Quality**: a **descriptive strength-of-schedule measure**, on a 0–100 point scale, that grades the opponent *immediately before* each professional fight and then averages across **every career fight**. An additional **Recent 6** average makes current opposition strength easy to compare. Scores are not win probabilities, betting odds, world rankings or percentiles.

The model is independently implemented for MMA Matlock. It uses transparent techniques similar in intent to Fight Matrix's point-in-time opposition evaluation and Tapology's recent-form / opponents'-opponents analysis, but does not reproduce either proprietary ranking algorithm.

## Formula

For each career opponent, collect that opponent's complete professional fight ledger from a source-verified Sherdog fighter profile.

Before the particular bout date, calculate:

- **Career form C**: (wins + 0.5 draws + 3) / (W + L + D + 6).
- **Recent form R**: (wins + 0.5 draws + 2) / (W + L + D + 4) across the last six professional results in the previous 1,095 days. No-contests excluded from form.
- **Schedule S**, where available: mean of (0.7 C + 0.3 R) for that opponent's previous six opponents, rated just *before their own respective matchups*.

The 3-3 and 2-2 neutral priors shrink very short records toward 50%. An opponent's score is:
- **100 × (0.56 C + 0.24 R + 0.20 S)** when at least two and at least half of the previous-six opponents have verifiable complete histories; or
- **100 × (0.70 C + 0.30 R)** when second-order coverage is insufficient.

The fighter's **Full Career** OQ is the arithmetic mean of their opponent scores over **all professional fights**, including fights that later ended no contest. The accompanying **Recent 6** is a separate average of the six latest fight opponents; it does *not* limit Full Career.

## Reliability controls

1. Exclude fights on or after the encounter's date. Results after the encounter cannot improve or downgrade the historical score.
2. Match opponent identities by normalized full name plus the exact Sherdog fighter profile URL. Never merge two identically named fighters solely by name.
3. Never substitute amateur bouts, future bouts, rankings, promotional name prestige or bookmaker odds.
4. Refuse to publish a Full Career score unless **every fight opponent has a source-verified complete history**. An unavailable fighter is displayed as an em dash, not zero or an inferred score.
5. Persist version, source coverage, and count of career and second-order opponents alongside the rating. The GitHub Actions refresh runs automated deterministic tests of the formula before it can update public article figures.
6. Keep the original opponents' combined record unchanged.

## Interpretation and limits

OQ is a relative description of faced opposition, **not** a calibrated prediction of a fight result. The neutral sample-size prior cannot directly measure the skill of an undefeated prospect in their debut; record-based second-order schedules also have limitations in disconnected regional circuits. A 10-point difference is not a defined advantage in win probability, and fight outcomes still require tactical analysis.

Source profiles may be delayed or unavailable. An incomplete value should stay blank. The rating should be treated as a first release until independently benchmarked using held-out historical results and reviewed for behavior across eras and divisions.

## Maintenance

- Calculation: `scripts/writer/opponent-quality.mjs`
- Regression tests: `scripts/writer/opponent-quality.test.mjs`
- Verified profiles and article refresh: `scripts/writer/refresh-opponent-strength.mjs`
- Scheduled automation: `.github/workflows/refresh-opponent-strength.yml`
- Writer cache: `assets/data/writer-opponent-strength.json`
- Article markup: `_writer/04-editor-tools.js` and `assets/writer.js`
- Site styles: `assets/post-v3.css`
