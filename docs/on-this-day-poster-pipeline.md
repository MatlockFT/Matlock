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

## No-poster events

If an exact title-and-date Tapology event page is proven but it exposes no usable poster, the registry records `verified-unavailable`. The event receives no generic event image, fighter portrait, or adjacent-event artwork. This is a successful identity result, not an excuse to substitute a visually similar image.

## Automated operation

`.github/workflows/otd-poster-sync.yml` runs after the main daily history refresh and can also be dispatched manually. It restores every existing registry record first, works through a bounded unresolved batch, validates the registry, publishes new immutable poster bytes, rebuilds the browser history shards and social-image cache, then commits only generated On This Day data.

The workflow shares the `on-this-day-history` concurrency group with the history updater and does not cancel an in-progress run. This prevents two writers from racing on `main`.

Useful commands:

```sh
npm run resolve:history-posters
npm run check:poster-registry
npm run check:history-images
```

Use `OTD_TAPOLOGY_POSTER_LIMIT` to control backlog size. Use `--apply-only` to restore the last verified registry without making network requests. Use `--refresh` only when deliberately reviewing a changed Tapology poster asset.
