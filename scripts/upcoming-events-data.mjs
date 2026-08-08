import fs from 'node:fs/promises';

export const DATA_PATH = '_data/upcoming_events.json';

const suspiciousText = /\b(?:EVENT INFO|WHERE TO WATCH|BUY TICKETS|MATCHUPS|MAIN CARD|EARLY CARD|PRELIMS?|REGISTER INTEREST|VIEW RESULTS|d\s*:\s*h\s*:\s*m\s*:\s*s)\b/i;
const trackingUrl = /(?:piwik|matomo|google-analytics|googletagmanager|doubleclick|analytics|tracking|pixel|beacon|\/collect(?:[/?]|$)|\/track(?:[/?]|$))/i;

export const norm = (s = '') => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const initials = name => String(name || '').split(/\s+/).filter(Boolean).slice(0, 3).map(x => x[0]).join('').toUpperCase() || '?';
export const updatedLabel = () => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());
export const dateLabel = iso => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${iso}T12:00:00Z`)).replace(/^(\w+), /, '$1 · ');

function easternClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// Keep an event through the overnight hours after its listed date. This avoids
// removing late-running cards at midnight while still clearing yesterday's
// events from an Upcoming Events page by the following morning.
export function eventIsCurrent(event, now = new Date()) {
  if (!event?.date) return false;
  const clock = easternClock(now);
  if (event.date >= clock.date) return true;
  const eventDay = new Date(`${event.date}T12:00:00Z`);
  const today = new Date(`${clock.date}T12:00:00Z`);
  const daysOld = Math.round((today - eventDay) / 86400000);
  return daysOld === 1 && clock.hour < 6;
}

export async function loadData() {
  try {
    const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
    if (!Array.isArray(data.events)) throw new Error('events is not an array');
    return data;
  } catch (error) {
    throw new Error(`Could not read ${DATA_PATH}: ${error.message}`);
  }
}

export async function loadPortraitCache() {
  try { return JSON.parse(await fs.readFile('_data/fighter_portraits.json', 'utf8')); }
  catch { return {}; }
}

export function portraitFor(name, previousEvents = [], cache = {}) {
  const key = norm(name);
  for (const event of previousEvents) for (const section of event.sections || []) for (const bout of section.bouts || []) for (const fighter of bout.fighters || []) {
    if (norm(fighter.name) === key && fighter.image && !trackingUrl.test(fighter.image)) {
      return { image: fighter.image, image_source: fighter.image_source || '', image_framing: fighter.image_framing || '' };
    }
  }
  const hit = cache[key];
  if (hit?.url && !trackingUrl.test(hit.url)) return { image: hit.url, image_source: hit.source || '', image_framing: hit.framing || '' };
  return { image: '', image_source: '', image_framing: '' };
}

export function fighter(name, portrait = {}) {
  return { name: String(name || '').trim(), initials: initials(name), image: portrait.image || '', image_source: portrait.image_source || '', image_framing: portrait.image_framing || '' };
}

function boutCount(event) {
  return (event.sections || []).reduce((n, section) => n + (section.bouts || []).length, 0);
}

function validateFighter(f, context) {
  if (!f || typeof f.name !== 'string' || !f.name.trim()) throw new Error(`${context}: missing fighter name`);
  if (f.name.length > 80 || suspiciousText.test(f.name)) throw new Error(`${context}: suspicious fighter name "${f.name}"`);
  if (f.image && (!/^https?:\/\//i.test(f.image) || trackingUrl.test(f.image))) throw new Error(`${context}: invalid portrait URL for ${f.name}`);
}

export function validateEvent(event) {
  if (!event || !/^(ufc|pfl|rizin)$/.test(event.promotion_key || '')) throw new Error('invalid promotion key');
  if (!event.id || !event.title || !/^20\d{2}-\d{2}-\d{2}$/.test(event.date || '')) throw new Error(`${event?.promotion_key || 'event'}: missing id/title/date`);
  if (!Array.isArray(event.sections) || !event.sections.length) throw new Error(`${event.id}: no sections`);
  const bouts = event.sections.flatMap(s => s.bouts || []);
  if (!bouts.length) throw new Error(`${event.id}: no bouts`);
  const orders = new Set();
  for (const bout of bouts) {
    if (!Array.isArray(bout.fighters) || bout.fighters.length !== 2) throw new Error(`${event.id}: bout does not have two fighters`);
    if (!Number.isInteger(bout.order) || bout.order < 1) throw new Error(`${event.id}: invalid bout order`);
    if (orders.has(bout.order)) throw new Error(`${event.id}: duplicate bout order ${bout.order}`);
    orders.add(bout.order);
    bout.fighters.forEach(f => validateFighter(f, `${event.id} bout ${bout.order}`));
  }
  return event;
}

export async function mergePromotion(promotionKey, candidateEvents, { maxEventDrop = 1, maxBoutDrop = 3 } = {}) {
  const data = await loadData();
  const current = data.events.filter(e => e.promotion_key === promotionKey && eventIsCurrent(e));
  const candidates = candidateEvents.map(validateEvent).filter(eventIsCurrent).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  if (!candidates.length) {
    console.warn(`${promotionKey.toUpperCase()}: no valid current candidate events; preserving existing data.`);
    return false;
  }
  if (current.length && candidates.length < Math.max(1, current.length - maxEventDrop)) {
    console.warn(`${promotionKey.toUpperCase()}: candidate event count ${candidates.length} is below safety floor for ${current.length}; preserving existing data.`);
    return false;
  }
  const currentByUrl = new Map(current.map(e => [e.official_url, e]));
  for (const event of candidates) {
    const old = currentByUrl.get(event.official_url);
    if (!old) continue;
    const oldCount = boutCount(old), newCount = boutCount(event);
    if (oldCount >= 4 && newCount < Math.max(1, oldCount - maxBoutDrop)) {
      console.warn(`${promotionKey.toUpperCase()}: ${event.title} collapsed from ${oldCount} to ${newCount} bouts; preserving existing promotion data.`);
      return false;
    }
  }
  const merged = [...data.events.filter(e => e.promotion_key !== promotionKey && eventIsCurrent(e)), ...candidates]
    .sort((a, b) => a.date.localeCompare(b.date) || a.promotion_key.localeCompare(b.promotion_key) || a.id.localeCompare(b.id));
  merged.forEach(validateEvent);
  const next = { schema_version: 1, generated_at: new Date().toISOString(), events: merged };
  const temp = `${DATA_PATH}.tmp`;
  await fs.writeFile(temp, JSON.stringify(next, null, 2) + '\n');
  await fs.rename(temp, DATA_PATH);
  console.log(`${promotionKey.toUpperCase()}: merged ${candidates.length} event(s) into unified data.`);
  return true;
}
