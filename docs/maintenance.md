# Maintenance runbook

The repository modernization is complete. This document is the default operating guide for routine changes.

## Maintenance-mode principle

The site is established software, not an ongoing folder-reorganization project.

Prefer:

1. publishing articles;
2. adding article media through Writer;
3. maintaining automated datasets;
4. making focused page or feature changes;
5. adding a new page only when there is a concrete product/editorial need.

Do not restart broad structural cleanup merely because an older working filename or public path looks untidy.

## Common tasks

### Publish an article

Use `/write/`.

Writer owns the normal article workflow:

```text
article
→ _posts/YYYY-MM-DD-slug.md

article image
→ assets/uploads/articles/YYYY/MM/article-slug/

article video
→ GitHub Release asset
```

Do not manually place a new article image in the old flat `assets/uploads/` namespace.

### Add article images manually

Only when Writer is not appropriate, use the same article-owned path:

```text
assets/uploads/articles/YYYY/MM/article-slug/
```

Then run:

```sh
npm run optimize:images
npm run check:generated
npm run check:content
```

### Change Writer frontend code

Edit the source under `_writer/`, not `assets/writer.js`.

Then run:

```sh
npm run build:frontend
npm run check:frontend
```

### Change generated responsive media

Change the source image or generator, then run:

```sh
npm run optimize:images
```

Do not edit files under `assets/generated/` directly. The optimizer updates the generated-asset integrity manifest.

### Add or change runtime data

Use the lifecycle policy before choosing a location:

```text
_data/       Jekyll/build-time data
assets/data/ published runtime or tracked operational data
.cache/      disposable local/CI scratch data
```

Every tracked file beneath `_data/` or `assets/data/` must have exactly one rule in `.repository-data-policy.json`.

Run:

```sh
npm run check:data
```

### Add automation

Use an existing responsibility domain:

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

Do not put new development scripts directly in `scripts/`.

Run:

```sh
npm run check:scripts
```

### Add or change a GitHub Action

Workflow files must remain directly under `.github/workflows/`.

Prefer extending an existing responsibility owner over adding another overlapping workflow. Run:

```sh
npm run check:workflows
```

### Add a standalone page

A root-level Jekyll page is valid:

```text
new-page.html
```

Use frontmatter and an intentional permalink. Do not create `new-page-v2.html`, `new-page-v3.html`, or another migration/demo page as a permanent parallel surface.

### Move or delete a file

Always audit inbound references first:

```sh
npm run audit:repo -- --target path/to/file
```

If the path is public, preserve the URL or add an intentional redirect where appropriate. Do not remove a legacy redirect merely because its filename looks old.

## Required structural checks

For a broad repository change, run:

```sh
npm run check:integrity
npm run audit:repo -- --check
npm run check:repo-policy
npm run check:data
npm run check:scripts
npm run check:workflows
npm run check:media
npm run check:generated
npm run check:content
npm run check:frontend
```

Feature-specific changes should also run their feature-specific checks. GitHub Actions remains the final integration gate.

## Protected boundaries

Treat these as contracts rather than suggestions:

- existing public URLs remain stable by default;
- `_posts/` remains the article source;
- `assets/uploads/articles/YYYY/MM/article-slug/` is the new article-image namespace;
- `assets/generated/` is generator-owned;
- article video stays in GitHub Releases;
- `assets/data/` and `_data/` must remain lifecycle-classified;
- `_writer/` is Writer source and `assets/writer.js` is its generated public bundle;
- scripts stay grouped by domain;
- canonical workflows keep responsibility boundaries;
- root `*-vN.html` migration pages are prohibited.

## Legacy compatibility

Legacy does not mean disposable.

The repository intentionally preserves:

- older public article/image paths that are still referenced;
- the exact grandfathered flat uploads listed in `.repository-legacy-media.json`;
- `legacy-*.html` redirect stubs that preserve old article URLs;
- established V2/V3-named CSS/JS assets when canonical live pages still consume them.

Remove any of these only after a reference audit and a concrete compatibility decision.

## Generated and tracked state

Do not assume a file is disposable because its name includes `generated` or `cache`.

- `assets/generated/` is reproducible media output and is protected by `.repository-generated-assets.json`.
- On This Day operational cache JSON files preserve expensive verification/discovery state.
- Matchmaker state/ranking snapshots preserve historical state for time-correct validation.

Consult `docs/data-lifecycle.md` before deleting tracked data.

## Recovery and rollback

The original pre-modernization repository remains archived at:

```text
archive/repo-modernization-baseline-2026-09-24
```

The state immediately before the final documentation stage is preserved at:

```text
archive/repo-modernization-stage9-complete-2026-09-24
```

Earlier stage rollback branches are documented in `docs/repository-modernization.md`.

Do not force-reset `main` as a routine recovery technique. Prefer a normal revert or branch from the appropriate archived state, inspect the diff, and restore only the affected change.

## When to change the structure again

A structural migration is justified only when the current contract blocks a real requirement—for example, a new content type with different lifecycle needs or a platform constraint that makes an existing public path untenable.

Aesthetic discomfort with an old filename is not sufficient reason.

When a genuine structural change is needed:

1. identify the concrete limitation;
2. run the reference audit;
3. document the proposed new contract;
4. preserve public compatibility;
5. add or update automated enforcement;
6. validate before deleting the old path.

That is the maintenance-mode successor to the completed ten-stage modernization.
