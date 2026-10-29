# Scorecard replacement — staged build

Target: /copper-orchard-47/ (unindexed standalone page)

## Design contract
- Watch the fight first. During an active round the main interaction is Left/Right.
- Arrow presses create observations, never automatic 10-point scores.
- Round scores are confirmed by the operator under the 10-point-must system.
- Keep manual operation available if network connections fail.
- No OBS, stream overlays, social graphics, or content-production modules.
- Keep historic v1 browser storage keys intact; imports make copies.
- Never infer official results from the operator's unofficial scorecard.

## Stage 1 — Local judging core
- Multi-event dashboard with a fight card and editable corner labels, division, and bout order.
- Three-/five-round fights and 3-/5-/10-minute clock settings.
- Focused judging view with Left/Right observations, keyboard shortcuts, undo, timing controls, and an observations timeline.
- End-of-round score confirmation (10–9, 10–8, 10–7, explicit 10–10) with referee deductions.
- Running totals, fight closure for decisions and stoppages, results stored separately from scores.
- Local autosave, JSON full-workspace backup/import, CSV scorecard export, manual v1 session migration.
- Guardrails: no-repeat input, no scoring from keypress counts, accidental early end confirmation, score-edit and deletion confirmation.

Stage 1 exit criteria:
- QA: multi-round decision and points; stoppage; reload; legacy migration; local backup.
- Keyboard controls never interrupt viewing, with no mouse required during active rounds.
- State persists across refresh, without changing historic saved keys.

## Stage 2 — Scoring quality / review
- More refined time-distributed observations and round-history navigator.
- Editing controls with a clear revision log and close-round flags.
- Technical decision / incomplete round handling, richer referee deductions.
- Better clock synchronization, manual timing corrections, and scoring recovery.
- Full keyboard-only usability / accessibility and browser-disconnect testing.

## Stage 3 — Data and synchronization
- Optional Google Drive synchronization (Google user consent); preserve local-first operation.
- Import scheduled cards through an authorized source, maintain offline manual entry.
- Optional official result/scorecard comparison; clearly distinguish provenance.
- Search and filters for historic events and rounds.
- Safer multi-device conflict resolution and duplicate-fight checks.

## Operational notes
- All data currently lives in that browser's local storage; clearing site data removes it unless exported.
- Keep JSON backups, particularly before device changes.
- Link obscurity + noindex are not access control; add authentication if data privacy becomes necessary.
- The old v1 page can be recovered from the Git history. New app does not delete the older v1 local storage keys.
