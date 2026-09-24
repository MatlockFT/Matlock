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

Beginning in Stage 2, **new Writer article-image uploads** will use:

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

Tracked video files under `assets/` are prohibited by the Stage 3 media pipeline check. Direct external video URLs may still be embedded, but Writer uploads use GitHub Releases.

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

Browser-consumed datasets belong under:

```text
assets/data/
```

Jekyll build-time data belongs under:

```text
_data/
```

Large JSON files are not considered wrong solely because they are large. Stage 8 will document producer, consumer, regeneration policy, and retention rules for each important dataset.

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

The target internal script structure is:

```text
scripts/
  writer/
  media/
  matchmaker/
  news/
  history/
  site-data/
  qa/
```

This is a Stage 5 migration. Existing script locations remain valid until then.

Human-facing npm commands should stay stable where practical even when their implementation moves.

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

Stage 6 will consolidate responsibilities and naming without inventing unsupported workflow subdirectories.

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

## Legacy exceptions

The repository intentionally tolerates several legacy patterns until their dedicated migration stage:

- Existing flat files in `assets/uploads/`
- Versioned root pages such as `*-v3.html` until Stage 7
- Mostly flat `scripts/` until Stage 5
- Current workflow sprawl until Stage 6

A legacy exception is permission to leave a working file alone, not permission for new work to keep expanding the old pattern.

## Decision rule for new files

When adding something new, use this order:

1. Is it an article? → `_posts/`
2. Is it media owned by one article? → Stage-2 article media hierarchy
3. Is it generated output? → `assets/generated/`
4. Is it runtime browser data? → `assets/data/`
5. Is it Jekyll build data? → `_data/`
6. Is it internal automation? → appropriate `scripts/` domain
7. Is it Writer backend code? → `_netlify-auth/`
8. Is it a standalone public page? → root Jekyll page is acceptable
9. Is it shared public CSS/JS/image infrastructure? → `assets/`, preserving established URL conventions

If none applies cleanly, the location should be decided before the file is added rather than creating another miscellaneous bucket.
