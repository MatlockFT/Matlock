# MMA Matlock

[MMA Matlock](https://mmamatlock.com) is a fan-run MMA website for original fight breakdowns, predictions, commentary, MMA news, event tools, history, and supporting editorial projects.

The site is built with Jekyll and published through GitHub Pages. The repository is now in **maintenance mode**: preserve working public paths, use the established structure for new work, and let CI reject organizational drift.

## Developer map

| Task | Where it belongs |
| --- | --- |
| Add or edit an article | Use the Writer at `/write/`; posts live in `_posts/` |
| New article images | Writer → `assets/uploads/articles/YYYY/MM/article-slug/` |
| Article video | Writer → GitHub Release assets; never commit video to Git |
| Generated responsive media | `assets/generated/`; do not hand-edit |
| New standalone page | Root Jekyll HTML + frontmatter unless a collection is genuinely warranted |
| Browser/runtime data | `assets/data/` |
| Jekyll build-time data | `_data/` |
| Temporary local/CI cache | `.cache/` |
| Writer frontend source | `_writer/`; build publishes `assets/writer.js` |
| Development automation | `scripts/<domain>/` |
| Writer backend | `_netlify-auth/` |
| GitHub Actions | `.github/workflows/`, grouped by responsibility |

## Operating rules

- Do not reorganize old working content merely for aesthetics.
- New articles and media follow the current structure automatically.
- Writer determines article-media placement.
- Videos never enter Git history.
- Generated output must remain identifiable and reproducible.
- Existing public URLs are preserved unless a change has a concrete reason and migration plan.
- Before moving or deleting a tracked path, run the reference audit.
- Do not add another legacy/versioned page, flat article-upload pattern, mystery dataset, or miscellaneous script location.

Before moving or deleting a file:

```sh
npm run audit:repo -- --target path/to/file
```

## Publishing articles

The custom Writer at `/write/` is the primary publishing interface.

Articles remain Jekyll posts under:

```text
_posts/
  YYYY-MM-DD-article-slug.md
```

New Writer image uploads use:

```text
assets/uploads/articles/YYYY/MM/article-slug/
```

Existing legacy image URLs remain valid and are intentionally not moved. Their grandfathered paths are recorded in `.repository-legacy-media.json`.

Writer-uploaded video uses monthly GitHub Release assets such as:

```text
writer-media-2026-09
```

## Generated files

Responsive image derivatives live under `assets/generated/`. Do not edit them directly.

Regenerate and validate with:

```sh
npm run optimize:images
npm run check:generated
npm run check:content
```

The optimizer updates `.repository-generated-assets.json`, which lets CI detect hand-edited or stale generated media.

The public Writer bundle is also generated. Edit `_writer/`, then run:

```sh
npm run build:frontend
npm run check:frontend
```

## Repository checks

The main structural checks are:

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

GitHub Actions runs these as part of the normal quality gates.

## Run locally

Install Ruby, Bundler, and Node.js, then run:

```sh
bundle install
npm ci
bundle exec jekyll serve
```

Open `http://localhost:4000`.

## Documentation

- [Maintenance runbook](docs/maintenance.md) — day-to-day rules and change workflow
- [Repository structure](docs/repository-structure.md) — permanent file-placement contract
- [Repository integrity](docs/repository-integrity.md) — CI enforcement and legacy freezes
- [Media pipeline](docs/media-pipeline.md) — source images, generated derivatives, and video
- [Data lifecycle](docs/data-lifecycle.md) — build-time, runtime, cache, and historical data
- [Repository modernization](docs/repository-modernization.md) — completed migration history and rollback markers

## Search visibility and advertising

The site publishes an RSS feed at [mmamatlock.com/feed.xml](https://mmamatlock.com/feed.xml).

Search Console verification values belong in `_config.yml` and must come from the relevant account. Ad/consent settings should only be changed when the corresponding service configuration is actually ready.

## Links

- [Website](https://mmamatlock.com)
- [YouTube](https://www.youtube.com/@MMAMatlock)
- [X](https://x.com/MMAMatlock)
- [Instagram](https://www.instagram.com/mmamatlock/)

## License

The website source code is available under the [MIT License](LICENSE). Original articles, images, audio, video, logos, and other editorial or brand assets are not covered by that license unless explicitly stated.

MMA Matlock is an independent project and is not affiliated with the UFC or any other promotion.
