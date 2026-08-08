import fs from "node:fs/promises";

const UFC_ORIGIN = "https://www.ufc.com";
const EVENTS_URL = `${UFC_ORIGIN}/events`;
const TARGET = "upcoming-events.html";
const USER_AGENT = "Mozilla/5.0 (compatible; MMAMatlockUpcomingEvents/2.0; +https://matlockfighttalk.com/)";
const REQUEST_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_EVENT_PAGES = 24;
const MAX_FUTURE_DAYS = 240;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const decodeHtml = (value = "") => value
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
  .replace(/&#039;|&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
const stripTags = (value = "") => decodeHtml(value
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const esc = (value = "") => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase() || "?";
const slugify = value => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function requestText(url) {
  let lastError;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,*/*" }
      });
      if (response.ok) return response.text();
      lastError = new Error(`${response.status} ${response.statusText} for ${url}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < REQUEST_ATTEMPTS) await sleep(800 * attempt);
  }
  throw lastError || new Error(`Request failed for ${url}`);
}

function normalizeEventUrl(value) {
  try {
    const url = new URL(value, UFC_ORIGIN);
    if (!/^(?:www\.)?ufc\.com$/i.test(url.hostname)) return null;
    if (!/^\/event\/[^/?#]+\/?$/.test(url.pathname)) return null;
    if (/contender|dwcs|ultimate-fighter|road-to-ufc|fight-pass/i.test(url.pathname)) return null;
    if (!/^\/event\/(?:ufc-|noche-ufc|ufc-noche)/i.test(url.pathname)) return null;
    url.protocol = "https:";
    url.hostname = "www.ufc.com";
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function extractEventUrls(html) {
  const decoded = decodeHtml(html).replaceAll("\\/", "/");
  const urls = new Set();
  for (const match of decoded.matchAll(/(?:href\s*=\s*["'])?((?:https?:\/\/(?:www\.)?ufc\.com)?\/event\/[a-z0-9][a-z0-9-]*)(?=[?#["'<>\s\\]|$)/gi)) {
    const url = normalizeEventUrl(match[1]);
    if (url) urls.add(url);
  }
  return [...urls].slice(0, MAX_EVENT_PAGES);
}

function jsonLdObjects(html) {
  const out = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]).trim());
      if (Array.isArray(parsed)) out.push(...parsed);
      else if (parsed?.["@graph"]) out.push(...parsed["@graph"]);
      else out.push(parsed);
    } catch {}
  }
  return out;
}

function meta(html, property) {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const a of tag[0].matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gi)) attrs[a[1].toLowerCase()] = decodeHtml(a[3]);
    if ((attrs.property || attrs.name || "").toLowerCase() === property.toLowerCase()) return (attrs.content || "").trim();
  }
  return "";
}

function eventDate(html, url) {
  for (const item of jsonLdObjects(html)) {
    if (item?.startDate && !Number.isNaN(Date.parse(item.startDate))) return new Date(item.startDate);
  }
  const embedded = html.match(/["']startDate["']\s*:\s*["']([^"']+)["']/i);
  if (embedded?.[1] && !Number.isNaN(Date.parse(decodeHtml(embedded[1])))) return new Date(decodeHtml(embedded[1]));
  const slug = new URL(url).pathname.match(/(january|february|march|april|may|june|july|august|september|october|november|december)-(\d{1,2})-(\d{4})/i);
  return slug ? new Date(`${slug[1]} ${slug[2]}, ${slug[3]} 12:00:00 UTC`) : null;
}

function eventLocation(html) {
  for (const item of jsonLdObjects(html)) {
    const location = item?.location;
    if (!location) continue;
    const name = typeof location === "string" ? location : location.name || "";
    const address = location.address || {};
    const tail = [address.addressLocality, address.addressRegion].filter(Boolean).join(", ");
    if (name && tail && !name.includes(tail)) return `${name} · ${tail}`;
    if (name) return name;
    if (tail) return tail;
  }
  return "Venue TBA";
}

function cleanEventTitle(html, url) {
  let title = meta(html, "og:title").replace(/\s*\|\s*UFC.*$/i, "").trim();
  if (!title) title = stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "");
  return title || new URL(url).pathname.split("/").filter(Boolean).at(-1).replaceAll("-", " ");
}

function titleParts(title) {
  const numbered = title.match(/^(UFC\s+\d+)\s*[:\-]?\s*(.*)$/i);
  if (numbered) return { promotion: numbered[1].toUpperCase(), matchup: numbered[2] || "Fight Card" };
  const fn = title.match(/^(UFC\s+Fight\s+Night)\s*[:\-]?\s*(.*)$/i);
  if (fn) return { promotion: "UFC Fight Night", matchup: fn[2] || "Fight Card" };
  const noche = title.match(/^(Noche\s+UFC|UFC\s+Noche)\s*[:\-]?\s*(.*)$/i);
  if (noche) return { promotion: noche[1], matchup: noche[2] || "Fight Card" };
  return { promotion: "UFC", matchup: title.replace(/^UFC\s*[:\-]?\s*/i, "") || "Fight Card" };
}

function sectionMarkers(html) {
  const markers = [];
  for (const m of html.matchAll(/<(?:h2|h3|div|span|p)\b[^>]*>([\s\S]{0,220}?)<\/(?:h2|h3|div|span|p)>/gi)) {
    const text = stripTags(m[1]);
    const section = /^Early Prelims?$/i.test(text) ? "early" : /^Prelims?$/i.test(text) ? "prelims" : /^Main Card$/i.test(text) ? "main" : null;
    if (section) markers.push({ index: m.index, section });
  }
  return markers;
}

function sectionAt(index, markers) {
  let current = "main";
  for (const marker of markers) {
    if (marker.index > index) break;
    current = marker.section;
  }
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
  const plain = stripTags(html).toLowerCase();
  const options = ["Paramount+", "ESPN+", "ESPN", "ABC", "CBS", "ESPN2", "UFC Fight Pass"];
  return options.filter(name => plain.includes(name.toLowerCase())).slice(0, 3).join(" · ") || "Broadcast TBA";
}

function parseBouts(html) {
  const markers = sectionMarkers(html);
  const starts = [...html.matchAll(/<div\b[^>]*class=["'][^"']*\bc-listing-fight__content\b[^"']*["'][^>]*>/gi)].map(m => m.index);
  const bouts = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const chunk = html.slice(start, starts[i + 1] ?? html.length);
    const fighters = [];
    for (const m of chunk.matchAll(/<a\b[^>]*href=["'](\/athlete\/[a-z0-9][a-z0-9-]*\/?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const name = stripTags(m[2]);
      if (!name || name.length > 70) continue;
      const href = new URL(m[1], UFC_ORIGIN).toString();
      if (!fighters.some(f => f.href === href)) fighters.push({ name, href, image: "" });
      if (fighters.length === 2) break;
    }
    if (fighters.length !== 2) continue;
    const division = stripTags((chunk.match(/class=["'][^"']*c-listing-fight__class-text[^"']*["'][^>]*>([\s\S]*?)<\//i) || [])[1] || "") || "Weight class TBA";
    bouts.push({ section: sectionAt(start, markers), division, fighters });
  }
  return bouts;
}

function existingPortraits(html) {
  const map = new Map();
  for (const m of html.matchAll(/<img\b[^>]*data-fighter-photo[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']+)["'][^>]*>/gi)) map.set(decodeHtml(m[2]).trim().toLowerCase(), decodeHtml(m[1]));
  for (const m of html.matchAll(/<img\b[^>]*alt=["']([^"']+)["'][^>]*data-fighter-photo[^>]*src=["']([^"']+)["'][^>]*>/gi)) map.set(decodeHtml(m[1]).trim().toLowerCase(), decodeHtml(m[2]));
  return map;
}

function fighterMarkup(fighter, eager, existing) {
  const image = existing.get(fighter.name.toLowerCase()) || fighter.image || "";
  const photo = image
    ? `<div class="fighter-photo"><span class="fighter-fallback" aria-hidden="true">${esc(initials(fighter.name))}</span><img data-fighter-photo src="${esc(image)}" alt="${esc(fighter.name)}" loading="${eager ? "eager" : "lazy"}" decoding="async" referrerpolicy="no-referrer"></div>`
    : `<div class="fighter-photo photo-missing"><span class="fighter-fallback" aria-hidden="true">${esc(initials(fighter.name))}</span></div>`;
  return `<div class="fighter">${photo}<p class="fighter-name">${esc(fighter.name)}</p></div>`;
}

function boutMarkup(bout, index, featured, existing) {
  const label = index === 0 ? " Main Event" : index === 1 ? " Co-Main Event" : "";
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

function dayLabel(date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date).replace(/^(\w+), /, "$1 · ");
}
function isoDay(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function updateDate() {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" }).format(new Date());
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
  if (early.length) sections.push(sectionMarkup("Early Prelims", "early", early, offset, event.times.early, existing));
  const metaLines = [`<p>${esc(event.location)}</p>`];
  if (event.times.early) metaLines.push(`<p><strong>Early Prelims</strong> ${esc(event.times.early)}</p>`);
  if (event.times.prelims) metaLines.push(`<p><strong>Prelims</strong> ${esc(event.times.prelims)}</p>`);
  if (event.times.main) metaLines.push(`<p><strong>Main Card</strong> ${esc(event.times.main)}</p>`);
  metaLines.push(`<p>${esc(event.broadcast)}</p>`);
  metaLines.push(`<a href="${esc(event.url)}" target="_blank" rel="noopener noreferrer">Official event page ↗</a>`);
  return `<section class="upcoming-event-card" data-auto-promotion="ufc" aria-labelledby="${id}"><header class="event-card-header"><div class="event-card-heading"><p class="event-promotion">${esc(promotion)}</p><h2 id="${id}">${esc(matchup)}</h2><p class="event-date"><time datetime="${isoDay(event.date)}">${esc(dayLabel(event.date))}</time></p></div><div class="event-card-meta">${metaLines.join("")}</div></header>${sections.join("")}<footer class="event-card-note"><p>Card order and start times updated ${esc(updateDate())}. Fight cards can change.</p></footer></section>`;
}

function listBounds(html) {
  const open = html.match(/<div\b[^>]*class=["'][^"']*\bupcoming-events-list\b[^"']*["'][^>]*>/i);
  if (!open || open.index == null) throw new Error("Could not locate .upcoming-events-list");
  const start = open.index + open[0].length;
  const tokens = /<div\b[^>]*>|<\/div\s*>/gi;
  tokens.lastIndex = start;
  let depth = 1;
  for (let token; (token = tokens.exec(html)); ) {
    if (/^<div\b/i.test(token[0])) depth += 1;
    else depth -= 1;
    if (depth === 0) return { start, end: token.index };
  }
  throw new Error("Could not find closing tag for .upcoming-events-list");
}

function cardDate(card) {
  return (card.match(/<time\s+datetime=["'](\d{4}-\d{2}-\d{2})["']/i) || [])[1] || "9999-12-31";
}
function isUfcCard(card) {
  return /data-auto-promotion=["']ufc["']/i.test(card) || /<p\s+class=["']event-promotion["']>\s*(?:UFC|Noche UFC|UFC Noche)/i.test(card);
}

const original = await fs.readFile(TARGET, "utf8");
const existing = existingPortraits(original);
const eventsHtml = await requestText(EVENTS_URL);
const urls = extractEventUrls(eventsHtml);
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
const seen = new Set();
const unique = events.filter(event => !seen.has(event.url) && seen.add(event.url));
if (!unique.length) throw new Error("Parsed zero usable future UFC events; refusing to change the site.");

const { start, end } = listBounds(original);
let inner = original.slice(start, end);

// One-time migration from the old data-driven UFC loop. The recurring updater now owns UFC cards directly.
inner = inner.replace(/\{%-?\s*for\s+event\s+in\s+site\.data\.ufc_events\.events\s*-?%\}[\s\S]*?\{%-?\s*endfor\s*-?%\}\s*/gi, "");

const cardRe = /<section\b[^>]*class=["'][^"']*\bupcoming-event-card\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi;
const existingCards = [...inner.matchAll(cardRe)].map(m => m[0]);
const existingUfcCount = existingCards.filter(isUfcCard).length;
const minimumSafeCount = Math.max(1, existingUfcCount - 2);
if (unique.length < minimumSafeCount) throw new Error(`Parsed ${unique.length} usable future UFC event(s), below UFC-only safety floor ${minimumSafeCount}; refusing to replace ${existingUfcCount} existing UFC card(s).`);

const keptCards = existingCards.filter(card => !isUfcCard(card));
const generatedCards = unique.map(event => eventMarkup(event, existing));
const cards = [...keptCards, ...generatedCards].map(html => ({ html, date: cardDate(html) }));
cards.sort((a, b) => a.date.localeCompare(b.date));

const disclaimer = (inner.match(/<div\b[^>]*class=["'][^"']*event-card-disclaimer[^"']*["'][^>]*>[\s\S]*$/i) || [])[0] || "";
const updatedInner = `\n${cards.map(card => card.html).join("\n")}${disclaimer ? `\n${disclaimer}` : ""}\n`;
const updated = original.slice(0, start) + updatedInner + original.slice(end);

if (updated === original) {
  console.log("Upcoming UFC events already match the official UFC pages.");
  process.exit(0);
}

await fs.writeFile(TARGET, updated);
console.log(`Updated ${TARGET} with ${unique.length} UFC event(s) and ${unique.reduce((n, e) => n + e.bouts.length, 0)} bout(s), preserving non-UFC cards.`);
