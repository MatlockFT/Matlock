import fs from 'node:fs/promises';

const ORIGIN = 'https://www.ufc.com';
const EVENTS_URL = `${ORIGIN}/events`;
const TARGET = 'upcoming-events.html';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockUpcomingEvents/3.0; +https://matlockfighttalk.com/)';
const MAX_DAYS = 240;
const MAX_PAGES = 24;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = (s = '') => s
  .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
  .replace(/&#(\d+);/g, (_, x) => String.fromCodePoint(+x))
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
  .replace(/&#039;|&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
const text = (s = '') => decode(s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase() || '?';
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function get(url) {
  let last;
  for (let i = 1; i <= 3; i += 1) {
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { 'user-agent': UA, accept: 'text/html,*/*' } });
      if (r.ok) return await r.text();
      last = new Error(`${r.status} ${r.statusText} for ${url}`);
    } catch (e) { last = e; }
    if (i < 3) await sleep(700 * i);
  }
  throw last || new Error(`Request failed for ${url}`);
}

function eventUrls(html) {
  const out = new Set();
  const src = decode(html).replaceAll('\\/', '/');
  for (const m of src.matchAll(/(?:href\s*=\s*["'])?((?:https?:\/\/(?:www\.)?ufc\.com)?\/event\/[a-z0-9][a-z0-9-]*)(?=[?#["'<>\s\\]|$)/gi)) {
    try {
      const u = new URL(m[1], ORIGIN);
      if (!/^(?:www\.)?ufc\.com$/i.test(u.hostname)) continue;
      if (!/^\/event\/(?:ufc-|noche-ufc|ufc-noche)/i.test(u.pathname)) continue;
      if (/contender|dwcs|ultimate-fighter|road-to-ufc|fight-pass/i.test(u.pathname)) continue;
      u.protocol = 'https:'; u.hostname = 'www.ufc.com'; u.search = ''; u.hash = ''; u.pathname = u.pathname.replace(/\/$/, '');
      out.add(u.toString());
    } catch {}
  }
  return [...out].slice(0, MAX_PAGES);
}

function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(decode(m[1]).trim());
      if (Array.isArray(j)) out.push(...j); else if (j?.['@graph']) out.push(...j['@graph']); else out.push(j);
    } catch {}
  }
  return out;
}

function eventDate(html, url) {
  for (const x of jsonLd(html)) if (x?.startDate && !Number.isNaN(Date.parse(x.startDate))) return new Date(x.startDate);
  const e = html.match(/["']startDate["']\s*:\s*["']([^"']+)["']/i);
  if (e?.[1] && !Number.isNaN(Date.parse(decode(e[1])))) return new Date(decode(e[1]));
  const s = new URL(url).pathname.match(/(january|february|march|april|may|june|july|august|september|october|november|december)-(\d{1,2})-(\d{4})/i);
  return s ? new Date(`${s[1]} ${s[2]}, ${s[3]} 12:00:00 UTC`) : null;
}

function title(html, url) {
  const og = (html.match(/<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i) || [])[1];
  const h1 = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  return text(og || h1 || new URL(url).pathname.split('/').filter(Boolean).at(-1).replaceAll('-', ' ')).replace(/\s*\|\s*UFC.*$/i, '').trim();
}

function titleParts(value) {
  let m = value.match(/^(UFC\s+\d+)\s*[:\-]?\s*(.*)$/i);
  if (m) return { promotion: m[1].toUpperCase(), matchup: m[2] || 'Fight Card' };
  m = value.match(/^(UFC\s+Fight\s+Night)\s*[:\-]?\s*(.*)$/i);
  if (m) return { promotion: 'UFC Fight Night', matchup: m[2] || 'Fight Card' };
  m = value.match(/^(Noche\s+UFC|UFC\s+Noche)\s*[:\-]?\s*(.*)$/i);
  if (m) return { promotion: m[1], matchup: m[2] || 'Fight Card' };
  return { promotion: 'UFC', matchup: value.replace(/^UFC\s*[:\-]?\s*/i, '') || 'Fight Card' };
}

function location(html) {
  for (const x of jsonLd(html)) {
    const l = x?.location; if (!l) continue;
    const name = typeof l === 'string' ? l : l.name || '';
    const a = l.address || {}; const tail = [a.addressLocality, a.addressRegion].filter(Boolean).join(', ');
    return [name, tail && !name.includes(tail) ? tail : ''].filter(Boolean).join(' · ') || 'Venue TBA';
  }
  return 'Venue TBA';
}

function times(html) {
  const p = text(html).replace(/\bEDT\b|\bEST\b/g, 'ET');
  const out = {};
  for (const [k, label] of [['early', 'Early Prelims'], ['prelims', 'Prelims'], ['main', 'Main Card']]) {
    const m = p.match(new RegExp(`${label}.{0,140}?(\\d{1,2}:\\d{2}\\s*[AP]M\\s*(?:ET|CT|MT|PT))`, 'i'));
    if (m) out[k] = m[1].replace(/\s+/g, ' ').toUpperCase();
  }
  return out;
}

function broadcast(html) {
  const p = text(html).toLowerCase();
  return ['Paramount+', 'ESPN+', 'ESPN', 'ABC', 'CBS', 'ESPN2', 'UFC Fight Pass'].filter(x => p.includes(x.toLowerCase())).slice(0, 3).join(' · ') || 'Broadcast TBA';
}

function bouts(html) {
  const markers = [];
  for (const m of html.matchAll(/<(?:h2|h3|div|span|p)\b[^>]*>([\s\S]{0,220}?)<\/(?:h2|h3|div|span|p)>/gi)) {
    const t = text(m[1]); const section = /^Early Prelims?$/i.test(t) ? 'early' : /^Prelims?$/i.test(t) ? 'prelims' : /^Main Card$/i.test(t) ? 'main' : null;
    if (section) markers.push({ i: m.index, section });
  }
  const starts = [...html.matchAll(/<div\b[^>]*class=["'][^"']*\bc-listing-fight__content\b[^"']*["'][^>]*>/gi)].map(m => m.index);
  const out = [];
  for (let n = 0; n < starts.length; n += 1) {
    const start = starts[n], chunk = html.slice(start, starts[n + 1] ?? html.length), fighters = [];
    for (const m of chunk.matchAll(/<a\b[^>]*href=["'](\/athlete\/[a-z0-9][a-z0-9-]*\/?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const name = text(m[2]); if (!name || name.length > 70) continue;
      const href = new URL(m[1], ORIGIN).toString(); if (!fighters.some(f => f.href === href)) fighters.push({ name, href });
      if (fighters.length === 2) break;
    }
    if (fighters.length !== 2) continue;
    let section = 'main'; for (const mk of markers) { if (mk.i > start) break; section = mk.section; }
    const division = text((chunk.match(/class=["'][^"']*c-listing-fight__class-text[^"']*["'][^>]*>([\s\S]*?)<\//i) || [])[1] || '') || 'Weight class TBA';
    out.push({ section, division, fighters });
  }
  return out;
}

function existingPortraits(html) {
  const map = new Map();
  for (const m of html.matchAll(/<img\b[^>]*data-fighter-photo[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']+)["'][^>]*>/gi)) map.set(decode(m[2]).trim().toLowerCase(), decode(m[1]));
  for (const m of html.matchAll(/<img\b[^>]*alt=["']([^"']+)["'][^>]*data-fighter-photo[^>]*src=["']([^"']+)["'][^>]*>/gi)) map.set(decode(m[1]).trim().toLowerCase(), decode(m[2]));
  return map;
}

function dayLabel(d) { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(d).replace(/^(\w+), /, '$1 · '); }
function isoDay(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
function updatedLabel() { return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date()); }

function fighterMarkup(f, eager, photos) {
  const image = photos.get(f.name.toLowerCase()) || '';
  const portrait = image ? `<div class="fighter-photo"><span class="fighter-fallback" aria-hidden="true">${esc(initials(f.name))}</span><img data-fighter-photo src="${esc(image)}" alt="${esc(f.name)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" referrerpolicy="no-referrer"></div>` : `<div class="fighter-photo photo-missing"><span class="fighter-fallback" aria-hidden="true">${esc(initials(f.name))}</span></div>`;
  return `<div class="fighter">${portrait}<p class="fighter-name">${esc(f.name)}</p></div>`;
}
function boutMarkup(b, index, featured, photos) {
  const label = index === 0 ? ' Main Event' : index === 1 ? ' Co-Main Event' : '';
  return `<article class="bout-card ${featured ? 'bout-card-featured' : 'bout-card-compact'}"><div class="bout-label"><span>${String(index + 1).padStart(2, '0')}</span>${label}</div><div class="bout-fighters">${fighterMarkup(b.fighters[0], featured, photos)}${fighterMarkup(b.fighters[1], featured, photos)}</div><div class="bout-footer"><span>${esc(b.division)}</span><strong>VS</strong></div></article>`;
}
function sectionMarkup(name, kind, rows, start, time, photos) {
  if (!rows.length) return '';
  if (kind === 'main') return `<div class="event-card-section"><div class="event-card-section-heading"><h3>Main Card</h3><span>${esc(time || 'Time TBA')}</span></div><div class="featured-bouts">${rows.slice(0, 2).map((b, i) => boutMarkup(b, start + i, true, photos)).join('')}</div>${rows.length > 2 ? `<div class="main-card-bouts">${rows.slice(2).map((b, i) => boutMarkup(b, start + i + 2, false, photos)).join('')}</div>` : ''}</div>`;
  return `<div class="event-card-section event-card-prelims"><div class="event-card-section-heading"><h3>${esc(name)}</h3><span>${esc(time || 'Time TBA')}</span></div><div class="prelim-bouts">${rows.map((b, i) => boutMarkup(b, start + i, false, photos)).join('')}</div></div>`;
}
function eventMarkup(e, photos) {
  const parts = titleParts(e.title), id = `${slugify(parts.promotion)}-${isoDay(e.date)}-title`;
  const main = e.bouts.filter(b => b.section === 'main'), pre = e.bouts.filter(b => b.section === 'prelims'), early = e.bouts.filter(b => b.section === 'early');
  let offset = 0, sections = '';
  sections += sectionMarkup('Main Card', 'main', main, offset, e.times.main, photos); offset += main.length;
  sections += sectionMarkup('Prelims', 'prelims', pre, offset, e.times.prelims, photos); offset += pre.length;
  sections += sectionMarkup('Early Prelims', 'early', early, offset, e.times.early, photos);
  const meta = [`<p>${esc(e.location)}</p>`];
  if (e.times.early) meta.push(`<p><strong>Early Prelims</strong> ${esc(e.times.early)}</p>`);
  if (e.times.prelims) meta.push(`<p><strong>Prelims</strong> ${esc(e.times.prelims)}</p>`);
  if (e.times.main) meta.push(`<p><strong>Main Card</strong> ${esc(e.times.main)}</p>`);
  meta.push(`<p>${esc(e.broadcast)}</p>`, `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">Official event page ↗</a>`);
  return `<section class="upcoming-event-card" data-auto-promotion="ufc" aria-labelledby="${id}"><header class="event-card-header"><div class="event-card-heading"><p class="event-promotion">${esc(parts.promotion)}</p><h2 id="${id}">${esc(parts.matchup)}</h2><p class="event-date"><time datetime="${isoDay(e.date)}">${esc(dayLabel(e.date))}</time></p></div><div class="event-card-meta">${meta.join('')}</div></header>${sections}<footer class="event-card-note"><p>Card order and start times updated ${esc(updatedLabel())}. Fight cards can change.</p></footer></section>`;
}

function listBounds(html) {
  const open = html.match(/<div\b[^>]*class=["'][^"']*\bupcoming-events-list\b[^"']*["'][^>]*>/i);
  if (!open || open.index == null) throw new Error('Could not locate .upcoming-events-list');
  const start = open.index + open[0].length, re = /<div\b[^>]*>|<\/div\s*>/gi; re.lastIndex = start; let depth = 1;
  for (let m; (m = re.exec(html)); ) { depth += /^<div\b/i.test(m[0]) ? 1 : -1; if (depth === 0) return { start, end: m.index }; }
  throw new Error('Could not find end of .upcoming-events-list');
}
function removeOldDataLoop(inner) {
  const startRe = /\{%-?\s*for\s+event\s+in\s+site\.data\.ufc_events\.events\s*-?%\}/i;
  const start = inner.search(startRe); if (start < 0) return inner;
  const tags = /\{%-?\s*(for\b[^%]*|endfor)\s*-?%\}/gi; tags.lastIndex = start; let depth = 0;
  for (let m; (m = tags.exec(inner)); ) {
    if (/^for\b/i.test(m[1])) depth += 1; else depth -= 1;
    if (depth === 0) return inner.slice(0, start) + inner.slice(tags.lastIndex).replace(/^\s+/, '\n');
  }
  throw new Error('Found legacy UFC data loop but could not find its matching endfor.');
}
function cardDate(card) { return (card.match(/<time\s+datetime=["'](\d{4}-\d{2}-\d{2})["']/i) || [])[1] || '9999-12-31'; }
function isUfc(card) { return /data-auto-promotion=["']ufc["']/i.test(card) || /<p\s+class=["']event-promotion["']>\s*(?:UFC|Noche UFC|UFC Noche)/i.test(card); }

const original = await fs.readFile(TARGET, 'utf8');
const photos = existingPortraits(original);
const urls = eventUrls(await get(EVENTS_URL));
if (!urls.length) throw new Error('No UFC event URLs found; refusing to change the site.');

const events = [];
for (const url of urls) {
  try {
    const html = await get(url), date = eventDate(html, url); if (!date) continue;
    const delta = (date.getTime() - Date.now()) / 86400000; if (delta < -1 || delta > MAX_DAYS) continue;
    const card = bouts(html); if (!card.length) continue;
    events.push({ url, date, title: title(html, url), location: location(html), times: times(html), broadcast: broadcast(html), bouts: card });
  } catch (e) { console.warn(`UFC skip ${url}: ${e.message}`); }
}
events.sort((a, b) => a.date - b.date);
const seen = new Set(), unique = events.filter(e => !seen.has(e.url) && seen.add(e.url));
if (!unique.length) throw new Error('Parsed zero usable future UFC events; refusing to change the site.');

const { start, end } = listBounds(original);
let inner = removeOldDataLoop(original.slice(start, end));
const cardRe = /<section\b[^>]*class=["'][^"']*\bupcoming-event-card\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi;
const existingCards = [...inner.matchAll(cardRe)].map(m => m[0]);
const oldUfcCount = existingCards.filter(isUfc).length;
if (unique.length < Math.max(1, oldUfcCount - 2)) throw new Error(`Parsed ${unique.length} UFC events, below safety floor for ${oldUfcCount} existing UFC cards.`);

const cards = [...existingCards.filter(c => !isUfc(c)), ...unique.map(e => eventMarkup(e, photos))].map(html => ({ html, date: cardDate(html) })).sort((a, b) => a.date.localeCompare(b.date));
const disclaimer = (inner.match(/<div\b[^>]*class=["'][^"']*event-card-disclaimer[^"']*["'][^>]*>[\s\S]*$/i) || [])[0] || '';
const updatedInner = `\n${cards.map(c => c.html).join('\n')}${disclaimer ? `\n${disclaimer}` : ''}\n`;
const updated = original.slice(0, start) + updatedInner + original.slice(end);
if (updated === original) { console.log('UFC cards already current.'); process.exit(0); }
await fs.writeFile(TARGET, updated);
console.log(`Updated UFC feed with ${unique.length} event(s), preserving PFL/RIZIN cards.`);
