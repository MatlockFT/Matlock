# Matchmaker

The `/matchmaker/` route uses the existing Jekyll layout and main navigation. It requires no server or new dependencies.

## Run and verify

Run `node scripts/update-matchmaker.mjs` to fetch official data, then `node scripts/check-matchmaker.mjs` for the deterministic-engine regressions and real-card checks. The scheduled **Update Matchmaker data** workflow runs twice daily and supports manual dispatch. Collection fails closed if the roster, divisions, event results, or profile coverage fails validation; the last valid snapshot stays published.

`assets/matchmaker-engine.js` is a reusable browser/CommonJS engine. `scripts/matchmaker/sources/ufc.mjs` holds the official UFC event, rankings, and profile adapters. The existing site's canonical roster release, upcoming schedule, and portrait registry are reused. No visitor triggers source scraping. The browser reads the normalized JSON from the main branch, with the bundled Pages JSON as a fallback, so data-only bot commits do not require another Pages deployment.

## Data and limitations

- Completed cards require verified results for every bout. UFC 331 was still upcoming at initial collection and is intentionally absent from completed events.
- Rankings are captured without overwriting daily snapshots. Pre-event ranks remain null until a real snapshot from before that event exists. An event page retrieved later is not treated as a historical rankings source.
- UFC profile narrative histories may be incomplete. Unresolved or missing histories are disclosed; profiles with no listed UFC bouts are excluded from recommendations. Overall records are sourced from athlete profiles; the displayed UFC record explicitly counts **listed** bouts.
- The existing active-roster collector is authoritative for roster membership. Recent event participants missing from it remain visible but unavailable; no active status is invented.
- Bookings use both official upcoming event cards and the existing site's schedule/roster monitor. Booked fighters are excluded on both sides, including manual picks. Injury and division overrides are local board decisions, not medical/roster assertions.
- Rematches are excluded unless supported by a draw/NC, an eligible 1–1 trilogy, an old matchup plus subsequent wins, or an explicit override. Unknown controversy, injuries, and title claims are not invented.
- Auto matchmaking maximizes event-fighter coverage before quality using a bounded deterministic search over the ten best candidates per fighter. It enforces unique pairings but does not promise a globally optimal matching.
- Source and collection dates are visible. A stale-data notice appears after two days. Availability is only as current as collected source data.

## Boards and prediction records

Working boards, undo, overrides, and frozen snapshots are stored on the visitor's device. Freezing makes an independent copy; subsequent changes do not alter it. Share URLs encode a validated working copy. JSON exports retain full reasoning and timestamps. The PNG export is 1080×1350 and uses text rather than cross-origin portraits so canvas exports remain reliable.

Official booking observations are retained across updates, even after the scheduled event passes. Frozen boards report matches first observed after their timestamp. This is **collector observation time**, not independently verified announcement time. Device-local timestamps and share URLs are not public, tamper-proof predictions. Site-wide editorial hit rates require a committed prediction archive; this version does not manufacture one or pool visitor data.

The source adapters are designed to be extended with UFC Stats or other verified history sources later. They deliberately do not silently fall back to synthetic records if a source blocks access.
