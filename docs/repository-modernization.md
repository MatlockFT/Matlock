# Repository modernization

This document tracks the controlled reorganization of the MMA Matlock repository.

## Current status

**Stage 9 of 10 — Repository integrity enforcement: IN PROGRESS**

Next stage after validation: **Stage 10 — Final documentation and maintenance mode**

Stages 0–5 established the safety baseline, repository/media contracts, article-owned asset hierarchy, modular Writer source, and domain-organized development scripts. Stage 6 consolidates overlapping GitHub Actions ownership while preserving schedules, publishing behavior, and production regression gates.

## Rollback point

The repository state immediately before modernization is preserved at:

- Branch: `archive/repo-modernization-baseline-2026-09-24`
- Commit: `611484294199df4db7a0cc71b11d442b26481dae`

## Stage 0 baseline

Measurements from the rollback commit:

- 709 tracked files
- 51 files at repository root
- 27 article files under `_posts/`
- 420 files under `assets/`, approximately 121.1 MB
- 45 files under `assets/uploads/`, approximately 56.8 MB
- 54 files under `assets/data/`, approximately 39.1 MB
- 138 files under `scripts/`, approximately 1.28 MB
- 25 workflow files under `.github/workflows/`
- 9 root canonical/V3 page pairs identified during inventory

Large runtime-data files include:

- `assets/data/matchmaker/historical-universe.json` — approximately 17.7 MB
- `assets/data/matchmaker/current.json` — approximately 13.0 MB
- `assets/data/on-this-day.json` — approximately 3.0 MB

These are observations, not cleanup targets by themselves.

## Safety rules for every stage

1. Existing public URLs are preserved unless a stage explicitly documents a redirect or retirement.
2. Existing article media is not relocated merely to make old folders look cleaner.
3. A file is not moved or removed until the reference audit has been run against it.
4. Generated files are treated separately from authored source files.
5. Writer storage behavior changes only in a Writer-specific stage with Writer regression tests.
6. Every stage must pass repository integrity, Jekyll/site checks, and feature-specific tests it touches.
7. Structural cleanup is performed in small reversible changes rather than one repository-wide rewrite.

## Reference audit

Stage 0 added a repository-aware reference audit that is now part of Site Quality CI.

Run the full inventory/report locally with:

```sh
npm run audit:repo
```

Before changing a specific tracked path, inspect inbound references with:

```sh
npm run audit:repo -- --target news.html
npm run audit:repo -- --target assets/some-file.js
```

Machine-readable output is available with:

```sh
npm run audit:repo -- --json
```

CI runs:

```sh
npm run audit:repo -- --check
```

The check currently protects against duplicate root permalinks and root pages referencing missing `page_styles` or `page_scripts` assets. The report also inventories repository responsibilities and identifies legacy/versioned page candidates with inbound references.

## Critical production surfaces

Public routes that later stages must continue to protect:

- `/`
- `/news/`
- `/breakdowns/`
- `/upcoming-events/`
- `/live/`
- `/event-map/`
- `/on-this-day/`
- `/ufc-roster/`
- `/matchmaker/`
- `/about/`
- `/contact/`
- `/privacy/`
- `/write/`

Content invariants:

- Jekyll posts remain under `_posts/`.
- Existing post permalinks remain `/:year/:month/:day/:title.html`.
- Writer remains the primary article publishing interface.
- Existing featured-image URLs remain valid.
- Existing GitHub Release video URLs remain valid.

Automation that must remain operational includes site quality/build checks, Writer production smoke tests, Writer backend quality tests, scheduled publishing, news updates, On This Day generation, Matchmaker generation/validation, and event-data jobs.

## Stage 1 organization contract

Stage 1 formalized the stability-first repository model in two forms:

- Human-readable contract: `docs/repository-structure.md`
- Machine-readable contract: `.repository-policy.json`

The contract establishes:

- Existing public URLs and working asset paths are preserved by default.
- Root-level Jekyll pages are valid and do not need cosmetic relocation.
- Articles remain in `_posts/` with the existing permalink format.
- Existing files in `assets/uploads/` remain where they are.
- Stage 2 will route **new** Writer article media to `assets/uploads/articles/YYYY/MM/article-slug/`.
- Generated media belongs under `assets/generated/`.
- Public runtime datasets belong under `assets/data/`; Jekyll build-time data belongs under `_data/`.
- Article video remains outside Git history as GitHub Release assets.
- Internal scripts have a target domain structure, but moves wait until Stage 5.
- Workflow consolidation waits until Stage 6.
- Versioned legacy page cleanup was completed in Stage 7.

The policy is checked in CI with:

```sh
npm run check:repo-policy
```

That check verifies the permanent roots, Jekyll permalink contract, protected paths, media separation, GitHub Release video policy, and staged legacy exceptions before later migrations build on top of them.

## Stage 2 article media hierarchy

Stage 2 routes **new Writer image uploads** into article-owned directories:

```text
assets/uploads/articles/YYYY/MM/article-slug/
```

The Writer derives the year and month from the article date and uses the saved filename slug when available, falling back to the article title slug for an unsaved article. Existing files under `assets/uploads/` are not moved or renamed.

The Writer upload UI and backend allow nested article-media paths, and production smoke coverage verifies that new uploads resolve under the article hierarchy. GitHub Release video uploads remain unchanged and outside Git history.

Stage 2 also made the repository-policy stage validator reusable for later stages. Site Quality, Writer auth quality, Writer production smoke, and GitHub Pages deployment all passed before Stage 2 was closed.

## Stage 3 media pipeline separation

Stage 3 formalized three independent media lanes:

```text
AUTHORED ARTICLE IMAGE
assets/uploads/articles/YYYY/MM/article-slug/

RESPONSIVE DERIVATIVE
assets/generated/posts/YYYY/MM/article-slug/

ARTICLE VIDEO
GitHub Release asset: writer-media-YYYY-MM
```

Legacy image sources and their established generated URLs remain unchanged. The responsive-image generator now uses `scripts/media/media-paths.mjs`, which keeps legacy output flat while routing future article-owned derivatives into matching article namespaces.

`scripts/qa/check-content.mjs` now validates generated responsive images recursively so nested derivatives receive the same size checks as legacy flat output.

Stage 3 also added:

- `docs/media-pipeline.md` for the media lifecycle contract;
- `npm run check:media` for source/generated/video boundary enforcement;
- Site Quality enforcement for the media check;
- an optimizer workflow trigger for media-path rule changes;
- a Writer UI clarification that local article-upload paths are image storage, not video storage.

The image optimizer completed successfully, Writer production smoke passed, Site Quality passed including the new media check, and GitHub Pages built successfully before Stage 3 was closed.

## Stage 4 Writer frontend modules

Stage 4 keeps the browser contract unchanged:

```text
/write/
  → /assets/writer.js
```

The maintainable source now lives under `_writer/`:

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

`scripts/writer/build-frontend-bundles.mjs` concatenates those ordered source modules into the existing `assets/writer.js` compatibility bundle. This deliberately preserves the Writer's shared closure and runtime ordering instead of introducing a risky browser-module rewrite.

The split reduced the single-file maintenance surface into domains for core/frontmatter helpers, preview rendering, state/library/GitHub transport, publishing, editor tools, media upload/layout, and event/bootstrap behavior.

Safeguards added in Stage 4:

- `assets/writer.js` is explicitly marked generated;
- `npm run check:frontend` rejects any public Writer bundle that differs from `_writer/`;
- Writer auth quality checks the generated bundle before browser-script validation;
- Writer production smoke watches changes under `_writer/**`;
- `_writer/` is explicitly excluded from Jekyll output so source fragments are not published;
- the repository audit recognizes `_writer/` as Writer frontend source;
- the repository policy records the stable public bundle and source model.

The generated bundle was verified byte-for-byte against the ordered source fragments. Writer auth quality passed, production Writer smoke passed, Site Quality passed the generated-bundle check, and GitHub Pages built successfully before Stage 4 was closed.

## Stage 5 development-script organization

Stage 5 moves the previously flat development-script surface into stable responsibility domains:

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

The migration preserves the existing human-facing npm commands while changing their implementation paths. GitHub Actions workflows and documentation were updated to the new locations at the same time as the moves.

The migration also repaired path-sensitive scripts whose relative imports or `import.meta.url` asset lookups changed after relocation, including Matchmaker helpers, UFC portrait tooling, On This Day share tooling, and generated GoBold assets.

Stage 5 added `npm run check:scripts`, which rejects:

- files placed directly under `scripts/`;
- unknown script-domain folders;
- broken relative imports caused by future moves;
- stale references to the pre-Stage-5 flat script paths;
- script references that point to nonexistent files.

A pre-Stage-5 rollback branch is preserved at `archive/repo-modernization-stage4-complete-2026-09-24`.

## Stage 6 GitHub Actions consolidation

Stage 6 reduces overlapping workflow ownership without combining jobs that have distinct data-writing responsibilities or unsafe concurrency requirements.

The consolidation changes are:

- Writer validation and deployed Writer smoke move from two workflows into `.github/workflows/writer-quality.yml`.
- Site visual geometry smoke and mobile Lighthouse move into `.github/workflows/site-browser-quality.yml`, preserving their separate daily schedules as separate jobs.
- Matchmaker pull-request validation moves into `.github/workflows/update-matchmaker.yml`, alongside the existing scheduled/live data update job.
- Scheduled publishers for news, On This Day, live status, UFC roster, events, and other independently owned datasets remain separate because they use different cadences, credentials, or write targets.

Stage 6 adds `npm run check:workflows` so CI verifies canonical consolidated workflows, retired workflow removal, unique workflow display names, and valid Pages CMS workflow references.

Stage 6 validation confirmed that the consolidation preserved behavior:

- `Site quality` passed, including the workflow-layout checker.
- `Writer quality` passed.
- `Update Matchmaker data` passed.
- The consolidated visual-smoke job passed.
- GitHub Pages deployed successfully.
- The consolidated mobile Lighthouse job remained red on the same existing performance gate that was already failing in the pre-consolidation `Mobile performance` workflow. The previous run failed the same gate before Stage 6, so this is recorded as a pre-existing site-performance issue rather than a workflow-consolidation regression.

The exact pre-Stage-6 repository state remains available at `archive/repo-modernization-stage5-complete-2026-09-24`.

## Stage 7 legacy/V2/V3 page cleanup

Stage 7 retired the noindex migration/demo page entry points only after the reference audit confirmed they were not canonical public surfaces.

Removed root pages:

```text
about-v3.html
breakdowns-v3.html
contact-v3.html
event-map-v3.html
homepage-v2.html
homepage-v3.html
matchmaker-v3.html
news-v3.html
on-this-day-v3.html
ufc-roster-v3.html
upcoming-events-v3.html
```

The old Homepage V2-only browser bundle was also removed because its only consumer was `homepage-v2.html`:

```text
assets/homepage-v2.css
assets/homepage-v2.js
```

Canonical routes remain unchanged. Browser smoke coverage now targets the canonical live pages instead of migration fixtures, the obsolete Homepage V2 navigation branches were removed from `_layouts/default.html`, and mobile Lighthouse no longer audits `/homepage-v2/`.

Version-named V3 assets such as `assets/homepage-v3.css`, `assets/news-v3.css`, and `assets/matchmaker-v3.css` were deliberately retained because the canonical live pages still consume them. Stage 7 removes dead page entry points, not working production styling.

The repository policy now advances to modernization Stage 7 and rejects any new root `*-vN.html` migration page. Existing `legacy-*.html` files are retained because they are deliberate redirect stubs that preserve older public article URLs.

The exact pre-Stage-7 repository state is preserved at `archive/repo-modernization-stage6-complete-2026-09-24`.

## Stage 8 runtime-data and cache policy

Stage 8 classifies tracked repository data by lifecycle without relocating established public URLs.

The permanent roots are:

```text
_data/          Jekyll/build-time data
assets/data/    published runtime and operational data
.cache/         disposable local/CI scratch data
assets/generated/ generated media (Stage 3 contract)
```

The machine-readable registry is `.repository-data-policy.json`. Every tracked file beneath `_data/` and `assets/data/` must match exactly one lifecycle rule describing its owner, producer, consumers, regeneration status, deletion status, and whether its path is a browser/runtime contract.

Stage 8 adds `npm run check:data` and Site Quality enforcement. The check rejects unclassified managed data, overlapping classifications, missing declared files/producers, tracked scratch-cache files, and invalid public-contract metadata.

Important policy decisions:

- existing `assets/data/` URLs remain in place;
- large Matchmaker files are not moved merely because of size;
- Matchmaker ranking/state snapshots are historical archives and are not considered reproducible from current data;
- On This Day files with `cache` in their names are tracked operational persistence, not disposable scratch;
- `safeToRegenerate: true` never implies `safeToDeleteFromRepository: true`;
- new temporary scratch data belongs under ignored `.cache/`.

Local On This Day scratch defaults now use `.cache/on-this-day/`. Existing workflow-specific poster/share cache branches and their public URLs remain unchanged.

The exact pre-Stage-8 repository state is preserved at `archive/repo-modernization-stage7-complete-2026-09-24`.


Stage 8 validation confirmed:

- `npm run check:data` classified all 16 tracked `_data/` files and all 54 tracked `assets/data/` files with no gaps or overlaps.
- Repository reference safety, repository policy, script organization, workflow organization, media separation, brand/theme, content, and browser/data syntax checks passed.
- The Site Browser exact-commit Jekyll build passed.
- Production visual smoke passed across the canonical desktop/mobile surfaces.
- The triggered On This Day refresh successfully rebuilt runtime shards, built and validated share images, published the share cache, rebuilt homepage/lead data, validated the archive, and committed its generated-data refresh.
- Mobile Lighthouse and the long Matchmaker validation remain independent existing gates and are not weakened by Stage 8.


## Stage 9 repository integrity enforcement

Stage 9 converts the repository conventions from earlier stages into hard CI boundaries.

New enforcement includes:

- `.repository-legacy-media.json` freezes the exact 46 flat `assets/uploads/` files that predate the article-owned upload hierarchy. New flat uploads are rejected; future article media must use `assets/uploads/articles/YYYY/MM/article-slug/`.
- `.repository-generated-assets.json` records a Git blob hash for every generated asset. `npm run check:generated` rejects direct edits, unexplained additions, and missing generated files.
- `npm run optimize:images` now refreshes the generated integrity manifest automatically, and the image-optimization workflow commits it with responsive derivatives.
- direct images under the top-level `assets/` namespace are capped at 3 MiB so shared site infrastructure cannot become another upload dumping ground;
- `npm run check:integrity` scans article-local `/assets/...` references and rejects nonexistent media;
- the Stage 9 policy records these constraints and requires their manifests.

Earlier enforcement remains in place and forms part of the Stage 9 integrity boundary:

- duplicate root permalinks are rejected by the repository reference audit;
- new root `*-vN.html` migration pages are rejected by repository policy;
- tracked video assets are rejected by the media pipeline;
- Writer and On This Day generated runtime bundles retain their feature-specific freshness checks;
- runtime/build datasets, script domains, and workflow organization retain their Stage 5–8 policy checks.

The exact pre-Stage-9 repository state is preserved at `archive/repo-modernization-stage8-complete-2026-09-24`.

## Planned stages

| Stage | Scope | Status |
| --- | --- | --- |
| 0 | Baseline, rollback marker, reference audit | Complete |
| 1 | Permanent organizational rules | Complete |
| 2 | Future article asset upload hierarchy | Complete |
| 3 | Media source/generated/video pipeline separation | Complete |
| 4 | Writer frontend module split | Complete |
| 5 | Development-script organization | Complete |
| 6 | GitHub Actions workflow consolidation | Complete |
| 7 | Legacy/V2/V3 page cleanup | Complete |
| 8 | Runtime-data and cache policy | Complete |
| 9 | Repository integrity enforcement | In progress |
| 10 | Final documentation and maintenance mode | Pending |

The status table is updated at the end of every completed stage.
