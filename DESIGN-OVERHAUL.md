# MMA Matlock — Design Overhaul Readiness

This file is preparation for a future full visual redesign. It is not a specification for the final look.

## Current problem

The existing site is structurally useful, but its visual language relies heavily on patterns that have become generic across AI-assisted websites:

- dark charcoal surfaces on a darker background
- rounded cards and rounded controls
- soft shadows and glow effects
- red accent washes and gradients
- pill-shaped chips
- blurred or translucent navigation surfaces
- repeated modular card grids
- uppercase micro-labels used as decoration
- polished, evenly spaced component blocks with very little visual irregularity

Those choices are not inherently bad. The problem is that they make the site feel interchangeable.

## Preparation rule

Structural CSS and visual identity should be separate.

The current site must remain stable while the redesign is being planned. Preparation work should therefore:

1. move palette, typography, shape, and effects into theme tokens;
2. remove hard-coded brand colors from public page CSS;
3. keep page layout and functionality intact;
4. avoid introducing new one-off visual systems;
5. avoid adding decorative gradients, glass effects, pill controls, or rounded-card patterns unless they are required by the existing design;
6. preserve specialty tools such as Writer and Matchmaker until their redesign is intentional.

## Theme ownership

`assets/theme.css` owns the skin.

It should eventually control:

- palette
- display/body/editorial/utility typefaces
- border and divider language
- corner geometry
- shadows
- accent washes
- overall width and reading width
- other global visual effects

Existing component CSS should consume semantic aliases rather than knowing the literal values.

## What should survive a redesign

These are product/structure decisions, not visual-style decisions:

- article hierarchy
- News Wire
- Fight Cards and picks
- Event Map
- On This Day
- UFC Roster
- Matchmaker functionality
- Writer functionality
- responsive behavior
- accessibility states
- reduced-motion support
- readable mode
- SEO and AdSense structure
- content and data pipelines

## What is intentionally disposable

The redesign should be free to replace:

- current card appearance
- current hero treatments
- current nav appearance
- rounded geometry
- red glow treatment
- gradients
- shadows
- pill chips
- current button style
- current Gobold usage
- current Courier utility styling
- current dark-panel hierarchy
- current spacing rhythm where it exists only for decoration

## Directional principle

Do not start the redesign by choosing a new accent color.

Start by choosing a publishing identity and a visual grammar. The final site should look like it belongs specifically to MMA Matlock even if the logo and site name are temporarily hidden.

That means the future system should define things such as:

- how a headline is composed
- how an article image is treated
- what a divider looks like
- how fight data is presented
- what visual texture belongs to the publication
- how dense or loose the information should feel
- what deliberate imperfections are allowed
- what elements repeat often enough to become recognizable brand signatures

The target is a publication identity, not a new template.
