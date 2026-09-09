# On This Day share-card direction

Implemented in the v3 share renderer.

- The original historical image remains the primary visual.
- Event posters, action photography, and no-image entries use separate compositions.
- Post, Story, and square social layouts are composed independently.
- A real, original scanned xerox texture replaces procedural grit as the main surface.
- The palette is strictly black, white, and warm paper—no generic social-card gradient or accent color.
- The primary field is inverted black paper with pale toner damage and ghost type. Warm paper is reserved for ripped edges, image mats, and the metadata footer.
- Torn image mattes, halftone screening, paste-up title strips, registration marks, and toner damage create the 1990s zine language.
- Display titles use phrase-aware balanced wrapping. The fitter avoids one-word final lines, protects punctuation-led phrases such as `UFC 3:` / `THE AMERICAN DREAM`, and only reduces type after testing better line breaks.
- Text stays minimal: anniversary, moment title, original date, promotion, image credit, and compact MMA Matlock branding.
- Source attribution is printed on the card and retained in the copied caption.

## Preferred technical direction

GitHub Actions pre-generates the rolling current-date cache through Sharp at 1080×1350, 1080×1920, and 1200×1200. The browser selects and shares the finished image. Dates outside the rolling cache use a matching black-and-white SVG fallback, so the visual direction does not collapse when a historical date is opened directly.

## Image sourcing guardrails

- Search engines may discover candidates, but a search result is never treated as proof that a photo depicts the named event.
- Each published image must retain its source page and credit. Ambiguous fighter portraits, rematches, weigh-ins, and unrelated events are rejected rather than guessed.
- Additional collage images should be stored as explicitly curated candidates with event/date evidence and reuse status. The legacy single `imageUrl` remains the safe fallback.
- Paid editorial libraries such as Getty may only be added through an account and license that explicitly covers the rendered social output and its visual treatment.
