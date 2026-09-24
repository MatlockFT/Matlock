# Repository structure contract

This is the permanent organization contract for the MMA Matlock repository. It describes where new work belongs. It does **not** require old working files to be moved merely for appearance.

The machine-readable version lives at `.repository-policy.json`.

## Core rule

**Preserve working public paths. Apply the cleaner structure to new content first.**

The repository is a Jekyll/GitHub Pages site and is allowed to look like one. Root-level page files are not considered a defect. Existing asset URLs are not renamed simply to produce prettier folders.

## Content

Articles remain in:

```text
_posts/
  YYYY-MM-DD-article-slug.md
```

The public permalink contract remains:

```text
/:year/:month/:day/:title.html
```

Writer remains the primary publishing interface.

New standalone site pages may remain root-level Jekyll pages when that is the simplest implementation:

```text
new-page.html
```

A new directory or collection should only be introduced when the page type genuinely benefits from one.

## Article media

Existing files under `assets/uploads/` remain valid and are not migrated simply for organization.

**New Writer article-image uploads** use:

```text
assets/uploads/articles/YYYY/MM/article-slug/
```

Example:

```text
_posts/
  2026-09-24-example-article.md

assets/uploads/articles/2026/09/example-article/
  cover.webp
  fighter-a.webp
  scorecard.webp
```

An article owns the files inside its article-media directory. Shared site assets do not belong there.

## Video

Article videos do not belong in Git history.

Writer-uploaded videos remain GitHub Release assets using the monthly release convention:

```text
writer-media-YYYY-MM
```

The article stores the release URL. Existing release URLs are permanent dependencies and must not be deleted casually.

Tracked video files under `assets/` are prohibited by the media pipeline check. Direct external video URLs may still be embedded, but Writer uploads use GitHub Releases.

## Generated media

Machine-produced derivatives belong under:

```text
assets/generated/
```

Generated files are outputs, not source material. A generation script should be able to recreate them from their authored source.

For new article-owned source images, responsive derivatives mirror article ownership under:

```text
assets/generated/posts/YYYY/MM/article-slug/
```

Legacy source images keep their existing flat generated filenames so established public URLs do not change.

The full source → generated → video separation is documented in [`docs/media-pipeline.md`](media-pipeline.md). Templates should use `_data/responsive_images.yml` rather than constructing generated URLs by hand.

## Runtime data

Browser-consumed/published datasets belong under:

```text
assets/data/
```

Jekyll build-time data belongs under:

```text
_data/
```

Disposable local/CI scratch data belongs under:

```text
.cache/
```

The repository records producer, consumer, regeneration, retention, ownership, and public-contract status in `.repository-data-policy.json`. CI runs `npm run check:data` and rejects an unclassified file added beneath `_data/` or `assets/data/`.

Files such as `assets/data/on-this-day-image-cache.json` remain tracked operational data despite the word “cache” in their filename. Historical Matchmaker snapshots likewise remain tracked because they preserve point-in-time state. Generated data is only disposable when its lifecycle rule explicitly says so.

See [`docs/data-lifecycle.md`](data-lifecycle.md) for the full contract.

## Site code

Existing public asset paths stay stable unless a migration has a concrete benefit.

Current public CSS/JS such as:

```text
assets/site.js
assets/base.css
assets/post-v3.css
assets/writer.js
```

remain stable public interfaces.

The Writer's maintainable source now lives under:

```text
_writer/
  00-core.js
  01-preview.js
  02-state-library.js
  03-publishing.js
  04-editor-tools.js
  05-media.js
  06-bootstrap.js
```

`assets/writer.js` is a generated compatibility bundle built from those ordered fragments with `npm run build:frontend`. The source fragments intentionally share one closure at build time, preserving the Writer's existing runtime semantics while removing the 135 KB single-file maintenance surface. CI rejects a stale public bundle.

## Automation

Development automation is organized by domain:

```text
scripts/
  writer/
  media/
  matchmaker/
  news/
  history/
  site-data/
    events/
    ufc/
    live/
  qa/
```

Human-facing npm commands remain stable where practical even though their implementations live in domain folders. Feature-specific helpers and validation stay beside the feature they support; cross-site quality checks live under `scripts/qa/`.

## Backend

Writer server-side code remains under:

```text
_netlify-auth/
  netlify/functions/
  test/
```

Browser code must not receive long-lived GitHub credentials. Media staging remains temporary and is cleaned automatically.

## GitHub Actions

GitHub requires workflow files to remain directly inside:

```text
.github/workflows/
```

The flat physical layout is retained, while workflows are consolidated by responsibility instead of artificial subdirectories:

```text
writer-quality.yml
  Writer source/backend validation + production browser smoke

site-browser-quality.yml
  visual geometry smoke + mobile Lighthouse

update-matchmaker.yml
  pull-request validation + scheduled/live Matchmaker refresh
```

Scheduled data publishers remain separate when they have meaningfully different cadences, credentials, concurrency groups, or generated-data ownership. `npm run check:workflows` enforces the canonical consolidated files, rejects retired split workflows, checks duplicate display names, and verifies Pages CMS workflow references still resolve.

## Integrity enforcement

Known legacy media is frozen and the permanent structure is enforceable in CI.

New article images must use the article-owned upload hierarchy. The exact pre-Stage-2 flat uploads that remain valid are recorded in `.repository-legacy-media.json`; adding another flat upload is rejected.

Generated media under `assets/generated/` is protected by `.repository-generated-assets.json`. The image generator updates this manifest, while `npm run check:generated` rejects hand-edited or otherwise drifting generated output.

`npm run check:integrity` also verifies local article media references and caps direct `assets/` images at 3 MiB so the root asset namespace cannot turn into another upload bucket.

See [`docs/repository-integrity.md`](repository-integrity.md) for the complete enforcement map.

## Protected production paths

The following paths are treated as high-risk dependencies and should not be moved casually:

```text
_config.yml
_layouts/default.html
index.html
write.html
assets/site.js
assets/base.css
assets/writer.js
assets/writer.css
assets/post-v3.css
_netlify-auth/netlify/functions/writer-github.mjs
```

This list is not exhaustive; the reference audit is still required before any move or removal.

## Legacy compatibility

The repository intentionally preserves working legacy paths when they still serve a compatibility purpose:

- the exact pre-Stage-2 flat upload paths frozen in `.repository-legacy-media.json`;
- existing `legacy-*.html` redirect stubs that preserve old public article URLs;
- older V2/V3-named CSS/JS assets that canonical live pages still consume.

Legacy compatibility is permission to preserve a working dependency, not permission for new work to expand the old pattern. New article media, scripts, workflows, pages, and data must follow the permanent contract.

## Maintenance mode

The ten-stage repository modernization is complete. Routine work should now follow this contract without reopening broad structural migration work.

Use [`docs/maintenance.md`](maintenance.md) for day-to-day tasks, required checks, legacy compatibility rules, and rollback guidance.

A future structural migration should only happen when a concrete requirement cannot fit the current contract. Old-but-working filenames are not, by themselves, a reason to reorganize the repository.

## Decision rule for new files

When adding something new, use this order:

1. Is it an article? → `_posts/`
2. Is it media owned by one article? → `assets/uploads/articles/YYYY/MM/article-slug/`
3. Is it generated output? → `assets/generated/`
4. Is it runtime browser data? → `assets/data/`
5. Is it Jekyll build data? → `_data/`
6. Is it internal automation? → appropriate `scripts/` domain
7. Is it Writer backend code? → `_netlify-auth/`
8. Is it a standalone public page? → root Jekyll page is acceptable
9. Is it shared public CSS/JS/image infrastructure? → `assets/`, preserving established URL conventions

If none applies cleanly, the location should be decided before the file is added rather than creating another miscellaneous bucket.
