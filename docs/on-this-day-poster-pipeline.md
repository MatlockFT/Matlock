# On This Day verified poster pipeline

The poster pipeline treats event identity and image retrieval as separate steps. A search result may suggest an event, but it is never enough to publish a poster.

## Acceptance contract

A Tapology poster is published only when all of these checks pass:

1. Tapology search returns one unique event whose date and normalized title match the On This Day entry.
2. The exact Tapology event page independently matches the expected title.
3. The image is exposed by that event page from Tapology's `poster_images` CDN path.
4. When Tapology uses a numeric event ID, the same ID appears in the poster asset path.
5. Downloaded bytes are a real image, at least 10 KB, at least 240 pixels in both dimensions, and have a plausible poster aspect ratio.
6. The bytes receive a SHA-256 fingerprint and an immutable filename before being copied to the `otd-poster-cache` branch.
7. The registry record, history entry, cached URL, dimensions, and SHA-256 fingerprint all agree in offline QA.

An ambiguous match, transport failure, changed image hash, or malformed asset cannot overwrite a previously verified record. Hash changes are quarantined until a deliberate `--refresh` run.

## Poster fallback order

Tapology is the first-choice source, not the only source. After the exact Tapology pass, the daily poster workflow now applies deterministic curated poster rules and then runs the exact-event Wikipedia/Wikimedia recovery pass. Trusted non-Tapology poster types are:

- official promotion event posters or key art
- Wikipedia/Wikimedia event posters whose exact event page and filename identify the event
- archived promotion event posters
- manually verified event posters with an explicit visual-verification flag

Fighter portraits, unrelated action photos, adjacent-event artwork, generic promotion logos, and orientation-only guesses are never promoted to an event poster.

## When an authentic poster still cannot be recovered

A Tapology `verified-unavailable` result means only that the exact Tapology event page did not provide a usable poster. It no longer means the page should render blank. Other trusted poster sources are still allowed to satisfy the event.

If no authentic poster/key art has been verified yet, the browser renders a clearly labeled event-specific archive card using the real event title, promotion, and date. That card is a presentation fallback only: it is not stored as historical poster art, is not counted as a verified poster, and explicitly says that the original poster is still pending. This guarantees that every event has a poster-shaped visual without passing fabricated artwork off as an original event poster.

## Automated operation

`.github/workflows/otd-poster-sync.yml` runs after the main daily history refresh and can also be dispatched manually. It restores every existing registry record first, works through a bounded unresolved Tapology batch, applies curated deterministic poster fallbacks, runs the broader exact Wikipedia event-poster recovery pass, validates the registry, publishes new immutable Tapology poster bytes, rebuilds the browser history shards and social-image cache, then commits generated On This Day data.

The workflow shares the `on-this-day-history` concurrency group with the history updater and does not cancel an in-progress run. This prevents two writers from racing on `main`.

Useful commands:

```sh
npm run resolve:history-posters
npm run apply:history-poster-fallbacks
npm run resolve:history-event-posters
npm run check:poster-registry
npm run check:history-images
```

Use `OTD_TAPOLOGY_POSTER_LIMIT` to control the exact Tapology backlog size. Use `OTD_EVENT_POSTER_LIMIT` to control the broader non-Tapology recovery pass. Use `--apply-only` to restore the last verified Tapology registry without making network requests. Use `--refresh` only when deliberately reviewing a changed Tapology poster asset.
