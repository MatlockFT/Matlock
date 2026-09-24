# On This Day event-poster pipeline

Event entries have one dedicated poster path. General On This Day image resolution does not choose event art.

## Source order

Every unresolved event follows the same order in every workflow:

1. **Canonical registry/cache** — restore any previously verified assignment first. A solved event is not searched again during routine runs.
2. **Tapology** — exact event title/date match, exact event page, event-bound `poster_images` asset, byte/dimension validation, SHA-256 fingerprint, immutable `otd-poster-cache` copy.
3. **Wikipedia/Wikimedia** — exact event page plus poster/key-art filename evidence.
4. **Official/archive sources** — promotion-hosted event art such as Pancrase, then curated archived-promotion rules.
5. **Manual verified override** — only with explicit visual verification.
6. **Generated archive card** — presentation fallback only. It is never registered as authentic poster art.

Fighter portraits, fight photos, generic promotion logos, adjacent-event artwork and orientation-only guesses cannot satisfy an event-poster record.

## One canonical registry

`assets/data/on-this-day-poster-registry.json` is version 2 and is source-agnostic.

It stores the active verified poster assignment for Tapology, Wikipedia/Wikimedia, official promotion, archived promotion and manually verified sources. Tapology records retain the stricter event-page identity, image-byte, dimensions and SHA-256 fields. If Tapology verifies that an exact event page has no poster and another trusted source later resolves the event, that Tapology evidence is preserved while the active poster assignment becomes the verified non-Tapology source.

The pipeline always restores this registry before performing discovery and captures the final verified assignments back into it after discovery. This prevents the same historical event from being searched repeatedly.

## Tapology acceptance contract

A Tapology poster is published only when:

1. search produces one unique event matching title and date;
2. the exact Tapology event page independently matches;
3. that page exposes a `poster_images` asset;
4. numeric event IDs agree when Tapology provides them;
5. downloaded bytes are an actual image of plausible size and dimensions;
6. bytes are SHA-256 fingerprinted and copied to the immutable poster-cache branch;
7. registry, history metadata and cached bytes agree in QA.

Changed poster bytes are quarantined unless a deliberate refresh is requested.

## Single entry point

All automated poster work now goes through:

```sh
npm run resolve:history-event-posters
```

Useful modes:

```sh
# Full discovery: registry → Tapology → Wikipedia → official/manual fallbacks
npm run resolve:history-event-posters

# Restore verified poster assignments only; no network discovery
node scripts/history/resolve-on-this-day-event-poster-pipeline.mjs --apply-only

# Current-date fast path, still using the same source order
node scripts/history/resolve-on-this-day-event-poster-pipeline.mjs --current-window

# History rebuild: reuse Tapology registry without fetching new Tapology pages,
# then allow Wikipedia and lower-priority sources to resolve new events.
node scripts/history/resolve-on-this-day-event-poster-pipeline.mjs --skip-tapology-fetch
```

Low-level Tapology and Wikipedia scripts remain implementation details for verification and troubleshooting; workflows should not compose them independently.

## Automation

- `.github/workflows/otd-poster-sync.yml` runs the full resolver and publishes new immutable Tapology bytes.
- `.github/workflows/otd-current-window-fast-publish.yml` runs the same resolver in current-window mode.
- `.github/workflows/update-on-this-day-events.yml` keeps ordinary fighter/moment images separate, then runs the event-poster pipeline without a fresh Tapology crawl. The dedicated poster sync performs the broader Tapology discovery pass.

All three share the `on-this-day-history` concurrency group, so history writers cannot race each other.

Use `OTD_TAPOLOGY_POSTER_LIMIT` for the Tapology batch size and `OTD_EVENT_POSTER_LIMIT` for Wikipedia recovery. Use `OTD_POSTER_REFRESH=1` or `--refresh` only for deliberate Tapology asset review.
