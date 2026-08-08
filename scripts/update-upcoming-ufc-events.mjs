import fs from "node:fs/promises";

const UFC_ORIGIN = "https://www.ufc.com";
const EVENTS_URL = `${UFC_ORIGIN}/events`;
const TARGET = "upcoming-events.html";
const USER_AGENT = "Mozilla/5.0 (compatible; MMAMatlockUpcomingEvents/1.0; +https://matlockfighttalk.com/)";
const REQUEST_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_EVENT_PAGES = 24;
const MAX_FUTURE_DAYS = 240;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function decodeHtml(value = "") {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#039;|&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function stripTags(value = "") {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function esc(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function requestText(url) {
  let lastError;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8" }
      });
      if (response.ok) return response.text();
      const preview = (await response.text()).slice(0, 180).replace(/\s+/g, " ");
      lastError = new Error(`${response.status} ${response.statusText} for ${url}: ${preview}`);
    } catch (error) { lastError = error; }
    if (attempt < REQUEST_ATTEMPTS) await sleep(800 * attempt);
  }
  throw lastError || new Error(`Request failed for ${url}`);
}

function normalizeEventUrl(value) {
  try {
    const url = new URL(value, UFC_ORIGIN);
    if (!/^(?:www\.)?ufc\.com$/i.test(url.hostname)) return null;
    if (!/^\/event\/[^/?#]+\/?$/.test(url.pathname)) return null;
    url.protocol = "https:"; url.hostname = "www.ufc.com"; url.search = ""; url.hash = ""; url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch { return null; }
}

function standardEvent(url) {
  const path = new URL(url).pathname.toLowerCase();
  if (/contender|dwcs|ultimate-fighter|road-to-ufc|fight-pass/.test(path)) return false;
  return /^\/event\/(?:ufc-|noche-ufc|ufc-noche)/.test(path);
}

function extractEventUrls(html) {
  const decoded = decodeHtml(html).replaceAll("\\/", "/");
  const urls = new Set();
  for (const match of decoded.matchAll(/(?:href\s*=\s*["'])?((?:https?:\/\/(?:www\.)?ufc\.com)?\/event\/[a-z0-9][a-z0-9-]*)(?=[?#["'<>\s\\]|$)/gi)) {
    const url = normalizeEventUrl(match[1]);
    if (url && standardEvent(url)) urls.add(url);
  }
  return [...urls];
}

function meta(html, property) {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const a of tag[0].matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gi)) attrs[a[1].toLowerCase()] = decodeHtml(a[3]);
    if ((attrs.property || attrs.name || "").toLowerCase() === property.toLowerCase()) return (attrs.content || "").trim();
  }
  return "";
}

function jsonLdObjects(html) {
  const out = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]).trim());
      if (Array.isArray(parsed)) out.push(...parsed); else if (parsed?.["@graph"]) out.push(...parsed["@graph"]); else out.push(parsed);
    } catch {}
  }
  return out;
}

function eventDate(html, url) {
  for (const item of jsonLdObjects(html)) {
    const value = item?.startDate;
    if (value && !Number.isNaN(Date.parse(value))) return new Date(value);
  }
  const match = html.match(/["']startDate["']\s*:\s*["']([^"']+)["']/i);
  if (match?.[1] && !Number.isNaN(Date.parse(decodeHtml(match[1])))) return new Date(decodeHtml(match[1]));
  const slug = new URL(url).pathname.match(/(january|february|march|april|may|june|july|august|september|october|november|december)-(\d{1,2})-(\d{4})/i);
  if (slug) return new Date(`${slug[1]} ${slug[2]}, ${slug[3]} 12:00:00 UTC`);
  return null;
}

function eventLocation(html) {
  for (const item of jsonLdObjects(html)) {
    const location = item?.location;
    if (!location) continue;
    const name = typeof location === "string" ? location : location.name || "";
    const address = location.address || {};
    const city = address.addressLocality || "";
    const region = address.addressRegion || "";
    const tail = [city, region].filter(Boolean).join(", ");
    if (name && tail && !name.includes(tail)) return `${name} · ${tail}`;
    if (name) return name;
    if (tail) return tail;
  }
  const plain = stripTags(html);
  const match = plain.match(/\bLocation\s+(.{3,100}?)(?=\s+(?:Main Card|Prelims|Early Prelims|Fight Card|Watch|How to Watch)\b)/i);
  return match?.[1]?.trim() || "Venue TBA";
}

function cleanEventTitle(html, url) {
  let title = meta(html, "og:title").replace(/\s*\|\s*UFC.*$/i, "").trim();
  if (!title) title = stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "");
  if (!title) title = new URL(url).pathname.split("/").filter(Boolean).at(-1).replaceAll("-", " ");
  return title.replace(/\s+/g, " ").trim();
}

function titleParts(title) {
  const numbered = title.match(/^(UFC\s+\d+)\s*[:\-]?\s*(.*)$/i);
  if (numbered) return { promotion: numbered[1].toUpperCase().replace("UFC ", "UFC "), matchup: numbered[2] || "Fight Card" };
  const fn = title.match(/^(UFC\s+Fight\s+Night)\s*[:\-]?\s*(.*)$/i);
  if (fn) return { promotion: "UFC Fight Night", matchup: fn[2] || "Fight Card" };
  const noche = title.match(/^(Noche\s+UFC|UFC\s+Noche)\s*[:\-]?\s*(.*)$/i);
  if (noche) return { promotion: noche[1], matchup: noche[2] || "Fight Card" };
  return { promotion: "UFC", matchup: title.replace(/^UFC\s*[:\-]?\s*/i, "") || "Fight Card" };
}

function athleteFromAnchor(anchor, href) {
  const name = stripTags(anchor).replace(/\s+/g, " ").trim();
  if (!name || name.length > 70) return null;
  return { name, href: new URL(href, UFC_ORIGIN).toString() };
}

function imageForAthlete(chunk, athlete) {
  const slug = new URL(athlete.href).pathname.split("/").filter(Boolean).at(-1);
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const near = chunk.match(new RegExp(`<img\\b[^>]*(?:alt=["'][^"']*${escaped}[^"']*["']|src=["'][^"']*${escaped}[^"']*["'])[^>]*>`, "i"));
  const generic = near || chunk.match(/<img\b[^>]*(?:src|data-src)=["'][^"']+["'][^>]*>/i);
  if (!generic) return "";
  const src = (generic[0].match(/(?:src|data-src)=["']([^"']+)["']/i) || [])[1] || "";
  try { const u = new URL(decodeHtml(src), UFC_ORIGIN); return /^https?:$/.test(u.protocol) ? u.toString() : ""; } catch { return ""; }
}

function sectionMarkers(html) {
  const markers = [];
  const re = /<(?:h2|h3|div|span|p)\b[^>]*>([\s\S]{0,220}?)<\/(?:h2|h3|div|span|p)>/gi;
  for (const m of html.matchAll(re)) {
    const text = stripTags(m[1]);
    const section = /^Early Prelims?$/i.test(text) ? "early" : /^Prelims?$/i.test(text) ? "prelims" : /^Main Card$/i.test(text) ? "main" : null;
    if (section) markers.push({ index: m.index, section, text });
  }
  return markers;
}

function sectionAt(index, markers) {
  let current = "main";
  for (const marker of markers) { if (marker.index > index) break; current = marker.section; }
  return current;
}

function sectionTimes(html) {
  const plain = stripTags(html).replace(/\bEDT\b|\bEST\b/g, "ET");
  const result = {};
  for (const [key, label] of [["early", "Early Prelims"], ["prelims", "Prelims"], ["main", "Main Card"]]) {
    const match = plain.match(new RegExp(`${label}.{0,140}?(\\d{1,2}:\\d{2}\\s*[AP]M\\s*(?:ET|CT|MT|PT))`, "i"));
    if (match) result[key] = match[1].replace(/\s+/g, " ").toUpperCase();
  }
  return result;
}

function broadcastInfo(html) {
  const plain = stripTags(html);
  const names = ["Paramount+", "ESPN+", "ESPN", "ABC", "CBS", "ESPN2", "UFC Fight Pass"];
  return names.filter((name, i) => plain.toLowerCase().includes(name.toLowerCase()) && !names.slice(0, i).some(parent => parent.includes(name))).slice(0, 3).join(" · ") || "Broadcast TBA";
}

function fightBlocks(html) {
  const starts = [...html.matchAll(/<div\b[^>]*class=["'][^"']*\bc-listing-fight__content\b[^"']*["'][^>]*>/gi)].map(m => m.index);
  if (!starts.length) return [];
  return starts.map((start, i) => ({ start, html: html.slice(start, starts[i + 1] ?? html.length) }));
}

function parseBouts(html) {
  const markers = sectionMarkers(html);
  const blocks = fightBlocks(html);
  const bouts = [];
  for (const block of blocks) {
    const athletes = [];
    for (const m of block.html.matchAll(/<a\b[^>]*href=["'](\/athlete\/[a-z0-9][a-z0-9-]*\/?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const athlete = athleteFromAnchor(m[2], m[1]);
      if (athlete && !athletes.some(x => x.href === athlete.href)) athletes.push(athlete);
      if (athletes.length === 2) break;
    }
    if (athletes.length !== 2) continue;
    const division = stripTags((block.html.match(/class=["'][^"']*c-listing-fight__class-text[^"']*["'][^>]*>([\s\S]*?)<\//i) || [])[1] || "") || "Weight class TBA";
    bouts.push({
      section: sectionAt(block.start, markers),
      division,
      fighters: athletes.map(a => ({ ...a, image: imageForAthlete(block.html, a) }))
    });
  }
  return bouts;
}

function existingPortraits(html) {
  const map = new Map();
  for (const m of html.matchAll(/<img\b[^>]*data-fighter-photo[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']+)["'][^>]*>/gi)) map.set(decodeHtml(m[2]).trim().toLowerCase(), decodeHtml(m[1]));
  for (const m of html.matchAll(/<img\b[^>]*alt=["']([^"']+)["'][^>]*data-fighter-photo[^>]*src=["']([^"']+)["'][^>]*>/gi)) map.set(decodeHtml(m[1]).trim().toLowerCase(), decodeHtml(m[2]));
  return map;
}

function initials(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase() || "?"; }
function slugify(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function dayLabel(date) { return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date).replace(/^(\w+), /, "$1 · "); }
function isoDay(date) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function updateDate() { return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" }).format(new Date()); }

function fighterMarkup(fighter, eager, existing) {
  const image = fighter.image || existing.get(fighter.name.toLowerCase()) || "";
  const photo = image ? `<div class="fighter-photo"><span class="fighter-fallback" aria-hidden="true">${esc(initials(fighter.name))}</span><img data-fighter-photo src="${esc(image)}" alt="${esc(fighter.name)}" loading="${eager ? "eager" : "lazy"}" decoding="async" referrerpolicy="no-referrer"></div>` : `<div class="fighter-photo photo-missing"><span class="fighter-fallback" aria-hidden="true">${esc(initials(fighter.name))}</span></div>`;
  return `<div class="fighter">${photo}<p class="fighter-name">${esc(fighter.name)}</p></div>`;
}

function boutMarkup(bout, index, featured, existing) {
  const label = index === 0 ? " Main Event" : index === 1 && featured ? " Co-Main Event" : "";
  return `<article class="bout-card ${featured ? "bout-card-featured" : "bout-card-compact"}"><div class="bout-label"><span>${String(index + 1).padStart(2, "0")}</span>${label}</div><div class="bout-fighters">${fighterMarkup(bout.fighters[0], featured, existing)}${fighterMarkup(bout.fighters[1], featured, existing)}</div><div class="bout-footer"><span>${esc(bout.division)}</span><strong>VS</strong></div></article>`;
}

function sectionMarkup(name, key, bouts, startIndex, time, existing) {
  if (!bouts.length) return "";
  if (key === "main") {
    const featured = bouts.slice(0, 2);
    const rest = bouts.slice(2);
    return `<div class="event-card-section"><div class="event-card-section-heading"><h3>Main Card</h3><span>${esc(time || "Time TBA")}</span></div><div class="featured-bouts">${featured.map((b, i) => boutMarkup(b, startIndex + i, true, existing)).join("")}</div>${rest.length ? `<div class="main-card-bouts">${rest.map((b, i) => boutMarkup(b, startIndex + featured.length + i, false, existing)).join("")}</div>` : ""}</div>`;
  }
  return `<div class="event-card-section event-card-prelims"><div class="event-card-section-heading"><h3>${esc(name)}</h3><span>${esc(time || "Time TBA")}</span></div><div class="prelim-bouts">${bouts.map((b, i) => boutMarkup(b, startIndex + i, false, existing)).join("")}</div></div>`;
}

function eventMarkup(event, existing) {
  const { promotion, matchup } = titleParts(event.title);
  const id = `${slugify(promotion)}-${isoDay(event.date)}-title`;
  const main = event.bouts.filter(b => b.section === "main");
  const prelims = event.bouts.filter(b => b.section === "prelims");
  const early = event.bouts.filter(b => b.section === "early");
  let offset = 0;
  const sections = [];
  if (main.length) { sections.push(sectionMarkup("Main Card", "main", main, offset, event.times.main, existing)); offset += main.length; }
  if (prelims.length) { sections.push(sectionMarkup("Prelims", "prelims", prelims, offset, event.times.prelims, existing)); offset += prelims.length; }
  if (early.length) { sections.push(sectionMarkup("Early Prelims", "early", early, offset, event.times.early, existing)); offset += early.length; }
  const metaLines = [];
  metaLines.push(`<p>${esc(event.location)}</p>`);
  if (event.times.early) metaLines.push(`<p><strong>Early Prelims</strong> ${esc(event.times.early)}</p>`);
  if (event.times.prelims) metaLines.push(`<p><strong>Prelims</strong> ${esc(event.times.prelims)}</p>`);
  if (event.times.main) metaLines.push(`<p><strong>Main Card</strong> ${esc(event.times.main)}</p>`);
  metaLines.push(`<p>${esc(event.broadcast)}</p>`);
  metaLines.push(`<a href="${esc(event.url)}" target="_blank" rel="noopener noreferrer">Official event page ↗</a>`);
  return `<section class="upcoming-event-card" aria-labelledby="${id}"><header class="event-card-header"><div class="event-card-heading"><p class="event-promotion">${esc(promotion)}</p><h2 id="${id}">${esc(matchup)}</h2><p class="event-date"><time datetime="${isoDay(event.date)}">${esc(dayLabel(event.date))}</time></p></div><div class="event-card-meta">${metaLines.join("")}</div></header>${sections.join("")}<footer class="event-card-note"><p>Card order and start times updated ${esc(updateDate())}. Fight cards can change.</p></footer></section>`;
}

function replaceList(html, inner) {
  const open = html.match(/<div\b[^>]*class=["'][^"']*\bupcoming-events-list\b[^"']*["'][^>]*>/i);
  if (!open || open.index == null) throw new Error("Could not locate .upcoming-events-list in upcoming-events.html");
  const contentStart = open.index + open[0].length;
  const tokenRe = /<div\b[^>]*>|<\/div\s*>/gi;
  tokenRe.lastIndex = contentStart;
  let depth = 1;
  for (let token; (token = tokenRe.exec(html)); ) {
    if (/^<div\b/i.test(token[0])) depth += 1; else depth -= 1;
    if (depth === 0) return html.slice(0, contentStart) + "\n" + inner + "\n" + html.slice(token.index);
  }
  throw new Error("Could not find closing tag for .upcoming-events-list");
}

const original = await fs.readFile(TARGET, "utf8");
const existing = existingPortraits(original);
const existingCount = (original.match(/class=["'][^"']*\bupcoming-event-card\b/gi) || []).length;
const eventsHtml = await requestText(EVENTS_URL);
const urls = extractEventUrls(eventsHtml).slice(0, MAX_EVENT_PAGES);
if (!urls.length) throw new Error("No standard UFC event URLs found; refusing to change the site.");

const now = Date.now();
const events = [];
for (const url of urls) {
  try {
    const html = await requestText(url);
    const date = eventDate(html, url);
    if (!date) continue;
    const delta = (date.getTime() - now) / 86400000;
    if (delta < -1 || delta > MAX_FUTURE_DAYS) continue;
    const bouts = parseBouts(html);
    if (!bouts.length) continue;
    events.push({ url, date, title: cleanEventTitle(html, url), location: eventLocation(html), times: sectionTimes(html), broadcast: broadcastInfo(html), bouts });
  } catch (error) {
    console.warn(`Skipping ${url}: ${error.message}`);
  }
}

events.sort((a, b) => a.date - b.date);
const minimumSafeCount = Math.max(1, existingCount - 2);
if (events.length < minimumSafeCount) throw new Error(`Parsed ${events.length} usable future UFC event(s), below safety floor ${minimumSafeCount}; refusing to replace ${existingCount} existing card(s).`);

const seen = new Set();
const unique = events.filter(event => !seen.has(event.url) && seen.add(event.url));
const updated = replaceList(original, unique.map(event => eventMarkup(event, existing)).join("\n"));
if (updated === original) {
  console.log("Upcoming UFC events already match the official UFC pages.");
  process.exit(0);
}
await fs.writeFile(TARGET, updated);
console.log(`Updated ${TARGET} with ${unique.length} UFC event(s) and ${unique.reduce((n, e) => n + e.bouts.length, 0)} bout(s).`);
