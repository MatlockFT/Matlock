# MMA Matlock

[MMA Matlock](https://mmamatlock.com) is a fan-run MMA website featuring original fight breakdowns, predictions, edited classic MMA clips, and commentary.

## What’s here

- Written MMA breakdowns, previews, recaps, and opinion pieces
- A [live MMA news feed](https://mmamatlock.com/news/) aggregated from trusted MMA outlets and fight promotions
- The [MMA Yellow Pages](https://mmamatlock.com/mma-yellowpages), a curated directory of MMA websites, tools, and creators
- A media kit, picture gallery, and supporting site pages
- Links to MMA Matlock videos and social channels

## How it works

The site is built with [Jekyll](https://jekyllrb.com/) and published through GitHub Pages. Posts live in `_posts/`, shared layouts live in `_layouts/`, and public styles, scripts, images, and runtime data live in `assets/`.

Repository organization is intentionally stability-first: existing public URLs stay in place, while new content follows the permanent structure documented in [`docs/repository-structure.md`](docs/repository-structure.md). The staged migration plan and rollback point are tracked in [`docs/repository-modernization.md`](docs/repository-modernization.md).

## Run locally

Install Ruby, Bundler, and Node.js, then run:

```sh
bundle install
npm ci
bundle exec jekyll serve
```

Open `http://localhost:4000`.

## Publishing articles

The custom Writer at `/write/` is the primary publishing interface. Articles remain Jekyll posts under `_posts/`; Writer handles drafts, scheduling, publishing, article images, and GitHub Release video uploads.

Existing article-media URLs remain valid. Stage 2 of the repository modernization will make new Writer image uploads article-scoped under `assets/uploads/articles/YYYY/MM/article-slug/` without moving older media.

For manual maintenance of featured images, responsive variants and content metadata can still be validated with:

```sh
npm run optimize:images
npm run check:content
```

## Search visibility and advertising

The site publishes an RSS feed at
[mmamatlock.com/feed.xml](https://mmamatlock.com/feed.xml).
Register the site with Google Search Console, then place the supplied
verification token in `_config.yml`; verification tokens are account-specific
and should never be guessed.

AdSense stays disabled until both a banner slot and
`consent_manager_enabled: true` are configured. Enable that setting only after
a consent-management platform appropriate for the site's visitors is active.

## Links

- [Website](https://mmamatlock.com)
- [YouTube](https://www.youtube.com/@MMAMatlock)
- [X](https://x.com/MMAMatlock)
- [Instagram](https://www.instagram.com/mmamatlock/)

## License

The website source code is available under the [MIT License](LICENSE). Original articles, images, audio, video, logos, and other editorial or brand assets are not covered by that license unless explicitly stated.

## About

MMA Matlock is an independent project made by a longtime MMA fan. It is not affiliated with the UFC or any other promotion.
