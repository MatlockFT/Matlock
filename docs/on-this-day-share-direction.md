# On This Day share-card direction

Saved design direction for the next rebuild of On This Day sharing.

- Stop treating every share card as one generic Canvas 2D template.
- Preserve the original historical image as the primary visual.
- Use different compositions for event posters, action photography, and no-image entries.
- Keep text minimal: anniversary, event/moment title, original date, tiny MMA Matlock branding.
- Avoid fake scrapbook framing and procedural grit as the main design language.
- If using zine styling, prefer real scanned texture assets and make it optional rather than mandatory.
- Design feed and Story compositions independently.
- Allow lightweight user controls such as Fit/Fill, image repositioning/zoom, and Clean/Zine treatment.
- Prefer an SVG/HTML template or build-time renderer over hand-drawing the entire design with Canvas 2D.
- No visual element should depend on tiny text that becomes unreadable on a phone.

## Preferred technical direction

For static On This Day records, strongly consider pre-generating share assets during GitHub Actions instead of rendering them on click. A Node build step can use SVG/HTML templates plus Sharp or a headless browser to output consistent 1080x1350, 1080x1920, and optional square assets. Browser sharing then becomes selecting/sharing an already-rendered image rather than doing the design work client-side.
