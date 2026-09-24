# Repository modernization

This document tracks the controlled reorganization of the MMA Matlock repository.

## Current status

**Stage 2 of 10 — Future article asset upload hierarchy: COMPLETE**

Next stage: **Stage 3 — Media source/generated/video pipeline separation**

Stages 0 and 1 established the rollback baseline and permanent organization contract without moving public paths. Stage 2 changes only where new Writer article-image uploads are stored; existing article media remains untouched.

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
npm run audit:repo -- --target news-v3.html
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
- Versioned legacy page cleanup waits until Stage 7.

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

## Planned stages

| Stage | Scope | Status |
| --- | --- | --- |
| 0 | Baseline, rollback marker, reference audit | Complete |
| 1 | Permanent organizational rules | Complete |
| 2 | Future article asset upload hierarchy | Complete |
| 3 | Media source/generated/video pipeline separation | Next |
| 4 | Writer frontend module split | Pending |
| 5 | Development-script organization | Pending |
| 6 | GitHub Actions workflow consolidation | Pending |
| 7 | Legacy/V2/V3 page cleanup | Pending |
| 8 | Runtime-data and cache policy | Pending |
| 9 | Repository integrity enforcement | Pending |
| 10 | Final documentation and maintenance mode | Pending |

The status table is updated at the end of every completed stage.
