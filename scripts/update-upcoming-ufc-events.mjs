import { dateLabel, fighter, loadData, loadPortraitCache, mergePromotion, portraitFor, updatedLabel } from './upcoming-events-data.mjs';

const ORIGIN = 'https://www.ufc.com';
const EVENTS_URL = `${ORIGIN}/events`;
const TICKETS_URL = `${ORIGIN}/tickets`;
const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockUpcomingEvents/4.3; +https://matlockfighttalk.com/)';
const MAX_DAYS = 240;
const DISCOVERY_DAYS = 100;
const MAX_PAGES = 40;
const EVENT_MAX_HOURS = 5;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = (s = '') => s.replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16))).replace(/&#(\d+);/g, (_, x) => String.fromCodePoint(+x)).replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#039;|&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
const text = (s = '') => decode(String(s).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ymd = d => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];

async function request(url, asJson = false) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
        headers: { 'user-agent': UA, accept: asJson ? 'application/json,*/*' : 'text/html,*/*' }
      });
      if (r.ok) return asJson ? r.json() : r.text();
      last = new Error(`${r.status} ${r.statusText} for ${url}`);
    } catch (e) { last = e; }
    if (i < 3) await sleep(700 * i);
  }
  throw last || new Error(`Request failed for ${url}`);
}
const get = url => request(url, false);
const getJson = url => request(url, true);

function canonicalEventUrl(raw) {
  try {
    const u = new URL(raw, ORIGIN);
    if (!/(?:^|\.)ufc\.com$/i.test(u.hostname)) return '';
    if (!/^\/event\/(?:ufc-|noche-ufc|ufc-noche)/i.test(u.pathname)) return '';
    if (/contender|dwcs|ultimate-fighter|road-to-ufc|fight-pass/i.test(u.pathname)) return '';
    u.protocol = 'https:';
    u.hostname = 'www.ufc.com';
    u.search = '';
    u.hash = '';
    u.pathname = u.pathname.replace(/\/$/, '');
    return u.toString();
  } catch { return ''; }
}

function eventUrls(html) {
  const out = new Set(), src = decode(html).replaceAll('\\/', '/');
  for (const m of src.matchAll(/(?:href\s*=\s*["'])?((?:https?:\/\/(?:[a-z0-9-]+\.)?ufc\.com)?\/event\/[a-z0-9][a-z0-9-]*)(?=[?#["'<>\s\\]|$)/gi)) {
    const url = canonicalEventUrl(m[1]);
    if (url) out.add(url);
  }
  return [...out];
}

function fightNightDateUrls(date) {
  const dates = new Set();
  if (!Number.isNaN(date.getTime())) {
    // ESPN timestamps can represent the same international event on a different
    // UTC/US calendar day. Probe the surrounding dates, then require the UFC
    // page itself to validate before anything is accepted.
    for (const delta of [-1, 0, 1]) {
      const d = new Date(date.getTime() + delta * 86400000);
      dates.add(`${monthNames[d.getUTCMonth()]}-${String(d.getUTCDate()).padStart(2, '0')}-${d.getUTCFullYear()}`);
    }
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
      dates.add(`${monthNames[Number(parts.month) - 1]}-${parts.day}-${parts.year}`);
    } catch {}
  }
  return [...dates].flatMap(stamp => [
    `${ORIGIN}/event/ufc-fight-night-${stamp}`,
    `${ORIGIN}/event/noche-ufc-${stamp}`,
    `${ORIGIN}/event/ufc-noche-${stamp}`
  ]).map(canonicalEventUrl).filter(Boolean);
}

function espnCandidateUrls(event) {
  const name = String(event?.name || event?.shortName || event?.season?.slug || '').trim();
  const out = new Set();
  const numbered = name.match(/\bUFC\s+(\d{3,4})\b/i);
  if (numbered) out.add(canonicalEventUrl(`${ORIGIN}/event/ufc-${numbered[1]}`));

  const date = new Date(event?.date || event?.competitions?.[0]?.date || '');
  if (/UFC\s+(?:Fight\s+Night|on\s+ESPN)|Noche\s+UFC|UFC\s+Noche/i.test(name) || !numbered) {
    for (const url of fightNightDateUrls(date)) out.add(url);
  }
  return [...out].filter(Boolean);
}

async function espnDiscoveryUrls() {
  const start = new Date(Date.now() - 86400000);
  const end = new Date(Date.now() + DISCOVERY_DAYS * 86400000);
  try {
    const json = await getJson(`${ESPN_SCOREBOARD}?dates=${ymd(start)}-${ymd(end)}&limit=100`);
    const events = Array.isArray(json?.events) ? json.events : [];
    const urls = [...new Set(events.flatMap(espnCandidateUrls))];
    console.log(`ESPN UFC discovery found ${events.length} event(s) and ${urls.length} candidate UFC URL(s).`);
    return urls;
  } catch (error) {
    console.warn(`ESPN UFC discovery unavailable: ${error.message}`);
    return [];
  }
}

function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(decode(m[1]).trim()); Array.isArray(j) ? out.push(...j) : j?.['@graph'] ? out.push(...j['@graph']) : out.push(j); } catch {}
  }
  return out;
}

function rawStartDate(html) {
  for (const x of jsonLd(html)) if (typeof x?.startDate === 'string' && !Number.isNaN(Date.parse(x.startDate))) return x.startDate;
  const e = html.match(/["']startDate["']\s*:\s*["']([^"']+)["']/i);
  return e?.[1] && !Number.isNaN(Date.parse(decode(e[1]))) ? decode(e[1]) : '';
}

function exactEventStart(html) {
  const raw = rawStartDate(html);
  if (!/T\d{2}:\d{2}/i.test(raw) || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function eventDate(html, url) {
  const raw = rawStartDate(html);
  if (raw) return new Date(raw);
  const s = new URL(url).pathname.match(/(january|february|march|april|may|june|july|august|september|october|november|december)-(\d{1,2})-(\d{4})/i);
  return s ? new Date(`${s[1]} ${s[2]}, ${s[3]} 12:00:00 UTC`) : null;
}

function title(html, url) {
  const og = (html.match(/<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i) || [])[1];
  const h1 = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  return text(og || h1 || new URL(url).pathname.split('/').filter(Boolean).at(-1).replaceAll('-', ' ')).replace(/\s*\|\s*UFC.*$/i, '').trim();
}

function titleParts(value) {
  let m = value.match(/^(UFC\s+\d+)\s*[:\-]?\s*(.*)$/i); if (m) return { promotion: m[1].toUpperCase(), matchup: m[2] || 'Fight Card' };
  m = value.match(/^(UFC\s+Fight\s+Night)\s*[:\-]?\s*(.*)$/i); if (m) return { promotion: 'UFC Fight Night', matchup: m[2] || 'Fight Card' };
  m = value.match(/^(Noche\s+UFC|UFC\s+Noche)\s*[:\-]?\s*(.*)$/i); if (m) return { promotion: m[1], matchup: m[2] || 'Fight Card' };
  return { promotion: 'UFC', matchup: value.replace(/^UFC\s*[:\-]?\s*/i, '') || 'Fight Card' };
}

function location(html) {
  for (const x of jsonLd(html)) {
    const l = x?.location; if (!l) continue;
    const name = typeof l === 'string' ? l : l.name || '', a = l.address || {}, tail = [a.addressLocality, a.addressRegion].filter(Boolean).join(', ');
    return [name, tail && !name.includes(tail) ? tail : ''].filter(Boolean).join(' · ') || 'Venue TBA';
  }
  return 'Venue TBA';
}

function times(html) {
  const p = text(html).replace(/\bEDT\b|\bEST\b/g, 'ET'), out = {};
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
    const t = text(m[1]), section = /^Early Prelims?$/i.test(t) ? 'early' : /^Prelims?$/i.test(t) ? 'prelims' : /^Main Card$/i.test(t) ? 'main' : null;
    if (section) markers.push({ i: m.index, section });
  }
  const starts = [...html.matchAll(/<div\b[^>]*class=["'][^"']*\bc-listing-fight__content\b[^"']*["'][^>]*>/gi)].map(m => m.index), out = [];
  for (let n = 0; n < starts.length; n++) {
    const start = starts[n], chunk = html.slice(start, starts[n + 1] ?? html.length), fighters = [];
    for (const m of chunk.matchAll(/<a\b[^>]*href=["'](\/athlete\/[a-z0-9][a-z0-9-]*\/?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const name = text(m[2]); if (!name || name.length > 70) continue;
      const href = new URL(m[1], ORIGIN).toString(); if (!fighters.some(f => f.href === href)) fighters.push({ name, href }); if (fighters.length === 2) break;
    }
    if (fighters.length !== 2) continue;
    let section = 'main'; for (const mk of markers) { if (mk.i > start) break; section = mk.section; }
    const division = text((chunk.match(/class=["'][^"']*c-listing-fight__class-text[^"']*["'][^>]*>([\s\S]*?)<\//i) || [])[1] || '') || 'Weight class TBA';
    out.push({ section, division, fighters });
  }
  return out;
}

const isoDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const data = await loadData(), cache = await loadPortraitCache(), previous = data.events.filter(e => e.promotion_key === 'ufc');
const discovered = new Set();
for (const url of [EVENTS_URL, TICKETS_URL]) {
  try { for (const eventUrl of eventUrls(await get(url))) discovered.add(eventUrl); }
  catch (error) { console.warn(`UFC discovery source unavailable ${url}: ${error.message}`); }
}
for (const eventUrl of await espnDiscoveryUrls()) discovered.add(eventUrl);
const urls = [...discovered].slice(0, MAX_PAGES);
if (!urls.length) { console.warn('No UFC event URLs found; preserving existing UFC data.'); process.exit(0); }

const rawEvents = [];
for (const url of urls) {
  try {
    const html = await get(url), date = eventDate(html, url); if (!date) continue;
    const delta = (date - Date.now()) / 86400000; if (delta < -1 || delta > MAX_DAYS) continue;
    const card = bouts(html); if (!card.length) continue;
    const exactStart = exactEventStart(html);
    rawEvents.push({
      url,
      date,
      startsAt: exactStart?.toISOString() || '',
      expiresAt: exactStart ? new Date(exactStart.getTime() + EVENT_MAX_HOURS * 3600000).toISOString() : '',
      title: title(html, url),
      location: location(html),
      times: times(html),
      broadcast: broadcast(html),
      bouts: card
    });
  } catch (e) { console.warn(`UFC skip ${url}: ${e.message}`); }
}
const seen = new Set(), unique = rawEvents.sort((a, b) => a.date - b.date).filter(e => !seen.has(e.url) && seen.add(e.url));
if (!unique.length) { console.warn('Parsed zero usable UFC events; preserving existing UFC data.'); process.exit(0); }

const candidates = unique.map(e => {
  const parts = titleParts(e.title), date = isoDay(e.date), grouped = { main: [], prelims: [], early: [] };
  for (const b of e.bouts) grouped[b.section]?.push(b);
  let order = 1;
  const sections = [];
  for (const [kind, label] of [['main', 'Main Card'], ['prelims', 'Prelims'], ['early', 'Early Prelims']]) {
    const rows = grouped[kind] || []; if (!rows.length) continue;
    sections.push({ kind, title: label, time: e.times[kind] || 'Time TBA', bouts: rows.map((b, i) => ({
      order: order++, label: kind === 'main' && i === 0 ? 'Main Event' : kind === 'main' && i === 1 ? 'Co-Main Event' : '', weight_class: b.division,
      fighters: b.fighters.map(x => fighter(x.name, portraitFor(x.name, previous, cache)))
    })) });
  }
  return {
    id: `${slugify(parts.promotion)}-${date}-${slugify(parts.matchup)}`,
    promotion_key: 'ufc',
    promotion: parts.promotion,
    title: parts.matchup,
    date,
    date_label: dateLabel(date),
    starts_at: e.startsAt,
    expires_at: e.expiresAt,
    venue: e.location,
    broadcast: e.broadcast,
    official_url: e.url,
    updated_label: updatedLabel(),
    sections
  };
});

await mergePromotion('ufc', candidates, { maxEventDrop: 1, maxBoutDrop: 3 });
