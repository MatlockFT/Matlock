# MMA Matlock

[MMA Matlock](https://matlockfighttalk.com) is a fan-run MMA website featuring original fight breakdowns, predictions, edited classic MMA clips, and commentary.

## What’s here

- Written MMA breakdowns, previews, recaps, and opinion pieces
- A [live MMA news feed](https://matlockfighttalk.com/news/) aggregated from trusted MMA outlets and fight promotions
- The [MMA Yellow Pages](https://matlockfighttalk.com/mma-yellowpages), a curated directory of MMA websites, tools, and creators
- A media kit, picture gallery, and supporting site pages
- Links to MMA Matlock videos and social channels

## How it works

The site is built with [Jekyll](https://jekyllrb.com/) and published through GitHub Pages. Posts live in `_posts/`, shared layouts live in `_layouts/`, and styles, scripts, and images live in `assets/`.

## Run locally

Install Ruby, Bundler, and Node.js, then run:

```sh
bundle install
npm ci
bundle exec jekyll serve
```

Open `http://localhost:4000`.

## Publishing articles

New articles created in Pages CMS begin as drafts. Keep `published: false`
until the copy, description, and featured-image alt text are ready. Before
publishing an article with a new featured image, regenerate and validate its
responsive image variants:

```sh
npm run optimize:images
npm run check:content
```

## Search visibility and advertising

The site publishes an RSS feed at
[matlockfighttalk.com/feed.xml](https://matlockfighttalk.com/feed.xml).
Register the site with Google Search Console, then place the supplied
verification token in `_config.yml`; verification tokens are account-specific
and should never be guessed.

AdSense stays disabled until both a banner slot and
`consent_manager_enabled: true` are configured. Enable that setting only after
a consent-management platform appropriate for the site's visitors is active.

## Links

- [Website](https://matlockfighttalk.com)
- [YouTube](https://www.youtube.com/@MMAMatlock)
- [X](https://x.com/MMAMatlock)
- [Instagram](https://www.instagram.com/mmamatlock/)

## License

The website source code is available under the [MIT License](LICENSE). Original articles, images, audio, video, logos, and other editorial or brand assets are not covered by that license unless explicitly stated.

## About

MMA Matlock is an independent project made by a longtime MMA fan. It is not affiliated with the UFC or any other promotion.
