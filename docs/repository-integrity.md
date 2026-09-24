# Repository integrity enforcement

Stage 9 makes the repository organization self-policing. The goal is not to reject every legacy pattern retroactively; it is to freeze known legacy state and prevent new drift.

## CI contract

Site Quality must reject:

- a new oversized image placed directly under `assets/`;
- a new article upload placed in the old flat `assets/uploads/` namespace;
- an article-owned upload whose path does not follow `assets/uploads/articles/YYYY/MM/article-slug/image.ext`;
- a video committed beneath `assets/` instead of the Writer GitHub Release pipeline;
- a generated file that no longer matches the generation-integrity manifest;
- a post that references nonexistent local `/assets/...` media;
- duplicate root permalinks;
- a new root migration page such as `*-v4.html`;
- repository/data/script/workflow policy drift already covered by earlier modernization stages.

The rules are deliberately layered. Existing specialized checks remain the authority for their domains rather than being reimplemented in one giant script.

## Legacy upload freeze

The pre-Stage-2 flat upload namespace is grandfathered through:

```text
.repository-legacy-media.json
```

That file records the exact flat `assets/uploads/` paths that existed when Stage 9 began. Those files may remain indefinitely because moving them could break published articles.

Any new article media must instead use:

```text
assets/uploads/articles/YYYY/MM/article-slug/image.ext
```

Deleting a grandfathered legacy upload is allowed only as an intentional cleanup: remove the file and its manifest entry together after the reference audit proves it is unused.

## Generated asset integrity

Generated media is tracked by:

```text
.repository-generated-assets.json
```

The manifest records the Git blob hash of every file under `assets/generated/`. CI runs:

```sh
npm run check:generated
```

If a generated file is edited directly, added without the generator, removed without regeneration, or otherwise differs from the manifest, the check fails.

`npm run optimize:images` is the supported generator for responsive/site image outputs. It now rewrites the generated-asset manifest automatically, and the image-optimization workflow commits the manifest with the generated files.

This is an accidental-edit safeguard, not a security boundary. A deliberate regeneration updates both the generated output and its manifest.

## Root asset size guard

Direct children of `assets/` are shared site infrastructure, not an upload dumping ground. Raster/vector images placed directly there are capped at 3 MiB.

Large article imagery belongs in the article-upload hierarchy and is processed into responsive derivatives. Existing media under older folders is preserved unless separately audited.

## Article local-media references

`npm run check:integrity` scans every tracked post for local `/assets/...` references and requires the referenced path to exist in Git.

This extends the older featured-image check to inline article media as well. External URLs and GitHub Release video URLs are not treated as local files.

## Existing enforcement retained

Stage 9 builds on checks already introduced earlier:

- `npm run audit:repo -- --check` rejects duplicate root permalinks and broken root page style/script references.
- `npm run check:repo-policy` rejects root `*-vN.html` migration pages after Stage 7.
- `npm run check:media` rejects tracked videos and validates article/generated media path conventions.
- `npm run check:data` rejects unclassified build/runtime datasets.
- `npm run check:scripts` and `npm run check:workflows` protect automation organization.
- `npm run check:frontend` protects the generated Writer bundle.
- `npm run check:history-runtime` protects generated On This Day runtime shards.

The result is intentionally redundant at the highest-risk boundaries: a future cleanup should have to break more than one explicit contract before it can silently damage a production dependency.
