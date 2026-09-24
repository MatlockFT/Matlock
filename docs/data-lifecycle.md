# Data lifecycle contract

Stage 8 formalizes repository data by **how it is used**, not by whether a filename happens to contain words such as `cache`, `current`, or `generated`.

The machine-readable registry is `.repository-data-policy.json`. CI validates it with:

```sh
npm run check:data
```

## Permanent storage classes

### Jekyll build-time data

```text
_data/
```

Files here are inputs to the Jekyll build or internal automation. They are not browser-facing URLs. Some are curated source data and some are generated build artifacts.

### Published runtime data

```text
assets/data/
```

Everything under this root is published by GitHub Pages. Existing paths remain stable in Stage 8 even when a file is used primarily by automation rather than the browser.

A filename containing `cache` under `assets/data/` does **not** mean the file is disposable. On This Day image/content caches and registries persist verified work between automation runs, and Matchmaker snapshots preserve historical state.

### Temporary scratch/cache

```text
.cache/
```

This is disposable local or CI scratch state. It is ignored by Git and must never become a published dependency. New temporary caches belong here.

Legacy scratch aliases such as `.otd-share-cache/`, `.otd-poster-cache/`, and `.otd-event-fallback-snapshot.json` remain ignored while their local defaults migrate toward `.cache/`.

### Generated media

```text
assets/generated/
```

This remains governed by the Stage 3 media pipeline. Stage 8 does not merge generated media with generated data.

## Lifecycle labels

The registry uses these meanings:

- `curated-input` / `curated-operational-input`: human-reviewed source material. Do not regenerate or delete casually.
- `generated-build-data`: reproducible data used during builds or automation.
- `generated-public-runtime`: published data consumed by browser/runtime surfaces. It can be rebuilt, but its tracked/public path is still a dependency.
- `generated-validation-data`: generated reports or offline validation universes.
- `operational-cache`: tracked state that avoids redoing expensive discovery/verification work. Rebuildable does not mean safe to remove from the repository.
- `snapshot-archive`: point-in-time historical state. It is intentionally not treated as reproducible from today's data.

## Important current datasets

`assets/data/matchmaker/current.json` is the live Matchmaker dataset and remains at its established URL.

`assets/data/matchmaker/historical-universe.json` is generated for historical validation/backtesting. Its size is intentional and Stage 8 does not relocate it.

`assets/data/matchmaker/rankings/` and `assets/data/matchmaker/state/` are historical snapshots. They are not disposable generated clutter because removing old snapshots weakens time-correct backtesting.

`assets/data/on-this-day.json` remains the full public/fallback history archive. Browser-optimized month shards remain under `assets/data/on-this-day-runtime/`.

`assets/data/on-this-day-image-cache.json`, `on-this-day-content-cache.json`, `on-this-day-pancrase-cache.json`, and `on-this-day-poster-registry.json` are operational persistence. They stay under their current public paths for compatibility, even though normal browser code does not treat them as primary APIs.

`assets/data/mma-news.json` remains the bundled fallback for the live news feed.

`_data/upcoming_events.json` remains build-time schedule data; `assets/data/upcoming-events-live.json` is the published bridge used by browser runtime code.

## Deletion rule

Before deleting any tracked data file:

1. Run the repository reference audit.
2. Check its entry in `.repository-data-policy.json`.
3. Confirm whether it is curated, a public contract, an operational cache, or a historical snapshot.
4. Identify the producer and consumers.
5. If it is rebuildable, prove the rebuild before removing anything.
6. Do not interpret `safeToRegenerate: true` as `safeToDeleteFromRepository: true`.

Stage 8 intentionally performs almost no data relocation. The improvement is that the repository can now explain what each data family is, who owns it, whether it can be regenerated, and whether its path is part of a runtime contract.
