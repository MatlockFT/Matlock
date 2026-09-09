# On This Day share-card direction

Implemented in the v3 share renderer.

- The original historical image remains the primary visual.
- Event posters, action photography, and no-image entries use separate compositions.
- Post, Story, and square social layouts are composed independently.
- A real, original scanned xerox texture replaces procedural grit as the main surface.
- The palette is strictly black, white, and warm paper—no generic social-card gradient or accent color.
- Torn image mattes, halftone screening, paste-up title strips, registration marks, and toner damage create the 1990s zine language.
- Text stays minimal: anniversary, moment title, original date, promotion, image credit, and compact MMA Matlock branding.
- Source attribution is printed on the card and retained in the copied caption.

## Preferred technical direction

GitHub Actions pre-generates the rolling current-date cache through Sharp at 1080×1350, 1080×1920, and 1200×1200. The browser selects and shares the finished image. Dates outside the rolling cache use a matching black-and-white SVG fallback, so the visual direction does not collapse when a historical date is opened directly.
