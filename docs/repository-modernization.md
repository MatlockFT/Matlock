# Repository modernization

This document tracks the controlled reorganization of the MMA Matlock repository.

## Current status

**Stage 0 of 10 — Baseline and rollback map: IN PROGRESS**

No public page, article, asset, permalink, Writer path, or runtime-data path is being moved or renamed in Stage 0.

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

## Planned stages

| Stage | Scope | Status |
| --- | --- | --- |
| 0 | Baseline, rollback marker, reference audit | In progress |
| 1 | Permanent organizational rules | Pending |
| 2 | Future article asset upload hierarchy | Pending |
| 3 | Media source/generated/video pipeline separation | Pending |
| 4 | Writer frontend module split | Pending |
| 5 | Development-script organization | Pending |
| 6 | GitHub Actions workflow consolidation | Pending |
| 7 | Legacy/V2/V3 page cleanup | Pending |
| 8 | Runtime-data and cache policy | Pending |
| 9 | Repository integrity enforcement | Pending |
| 10 | Final documentation and maintenance mode | Pending |

The status table is updated at the end of every completed stage.
