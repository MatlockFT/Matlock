import fs from "node:fs";

const protectedCss = [
  "assets/homepage-dashboard.css",
  "assets/news.css",
  "assets/news-matlock.css",
  "assets/upcoming-events.css",
  "assets/event-map.css",
  "assets/event-map-sumo.css",
  "assets/media-kit.css",
  "assets/ufc-roster.css",
  "assets/gallery.css",
  "assets/otd-event-poster-fallback.css"
];

const forbiddenBrandLiterals = [
  { label: "#ff4a54", pattern: /#ff4a54\b/gi },
  { label: "#ff8990", pattern: /#ff8990\b/gi },
  { label: "rgba(255, 74, 84, …)", pattern: /rgba\(\s*255\s*,\s*74\s*,\s*84\s*,/gi }
];

const requiredThemeTokens = [
  "--theme-background",
  "--theme-surface",
  "--theme-text",
  "--theme-accent",
  "--theme-accent-soft",
  "--theme-accent-rgb",
  "--theme-font-display",
  "--theme-font-body",
  "--theme-font-editorial",
  "--theme-font-mono",
  "--theme-radius-small",
  "--theme-radius-medium",
  "--theme-radius-large",
  "--theme-radius-pill",
  "--theme-shadow"
];

let failed = false;

function read(path) {
  return fs.readFileSync(path, "utf8");
}

for (const path of protectedCss) {
  const css = read(path);
  for (const rule of forbiddenBrandLiterals) {
    if (rule.pattern.test(css)) {
      console.error(
        `${path}: uses hard-coded brand value ${rule.label}. Use theme tokens instead.`
      );
      failed = true;
    }
    rule.pattern.lastIndex = 0;
  }
}

const theme = read("assets/theme.css");
for (const token of requiredThemeTokens) {
  if (!theme.includes(token)) {
    console.error(`assets/theme.css: missing required token ${token}`);
    failed = true;
  }
}

const layout = read("_layouts/default.html");
const baseIndex = layout.indexOf("/assets/base.css");
const themeIndex = layout.indexOf("/assets/theme.css");
const pageStylesIndex = layout.indexOf("{% for stylesheet in page.page_styles %}");

if (
  baseIndex === -1 ||
  themeIndex === -1 ||
  pageStylesIndex === -1 ||
  !(baseIndex < themeIndex && themeIndex < pageStylesIndex)
) {
  console.error(
    "_layouts/default.html: expected CSS order is base.css -> theme.css -> page styles."
  );
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Theme readiness checks passed.");
}
