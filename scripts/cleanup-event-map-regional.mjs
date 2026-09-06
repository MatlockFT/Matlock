import fs from 'node:fs/promises';

const DATA_PATH = '_data/event_map_regional.json';
const TODAY = new Date().toISOString().slice(0, 10);
const UA = 'Mozilla/5.0 (compatible; MatlockFightTalk-EventMap/1.0; +https://matlockfighttalk.com/event-map/)';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}
function stripTags(value) { return clean(decodeEntities(String(value || '').replace(/<[^>]+>/g, ' '))); }
function parseDate(value) {
  const text = clean(value);
  const m = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(20\d{2})\b/i);
  if (!m) return '';
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
  const key = m[1].toLowerCase().startsWith('sept') ? 'sept' : m[1].toLowerCase().slice(0,3);
  const month = months[key];
  return month ? `${m[3]}-${String(month).padStart(2,'0')}-${String(Number(m[2])).padStart(2,'0')}` : '';
}
async function fetchHtml(url) {
  const response = await fetch(url, { redirect:'follow', signal:AbortSignal.timeout(15000), headers:{ 'user-agent':UA, accept:'text/html,application/xhtml+xml' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
function h1Text(html) {
  return [...String(html || '').matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => stripTags(m[1])).filter(Boolean);
}
function tuffMatchup(text) {
  const m = clean(text).match(/TUFF[- ]N[- ]UFF\s+(\d+)\s*:\s*([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,3})\s+vs\.?\s+([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,3})/i);
  return m ? { number:m[1], left:clean(m[2]), right:clean(m[3]) } : null;
}

const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
let removedMajorDiscovery = 0;
let removedPastTuff = 0;
let repairedTuff = 0;

let events = (data.events || []).filter(event => {
  if (event.source_key !== 'sherdog_discovery') return true;
  const label = `${event.promotion || ''} ${event.title || ''}`;
  const major = /\b(?:Dana White'?s Contender Series|Contender Series|DWCS|UFC|Professional Fighters League|PFL|ONE Championship|Bellator|BKFC)\b/i.test(label);
  if (major) removedMajorDiscovery += 1;
  return !major;
});

const repaired = [];
for (const event of events) {
  if (event.source_key !== 'tuff_n_uff' || !event.official_url) {
    repaired.push(event);
    continue;
  }

  try {
    const html = await fetchHtml(event.official_url);
    const headings = h1Text(html);
    const pageTitle = headings.find(value => /TUFF[- ]N[- ]UFF\s+\d+/i.test(value)) || '';
    const date = headings.map(parseDate).find(Boolean) || '';
    const matchup = tuffMatchup(pageTitle);

    if (date && date < TODAY) {
      removedPastTuff += 1;
      continue;
    }

    if (date) event.date = date;
    if (matchup) {
      event.title = `Tuff-N-Uff ${matchup.number}: ${matchup.left} vs. ${matchup.right}`;
      event.main_event = { fighters:[matchup.left, matchup.right] };
      const pageText = stripTags(html);
      const weight = pageText.match(/\b(World\s+)?(Women'?s\s+)?(Strawweight|Flyweight|Bantamweight|Featherweight|Lightweight|Welterweight|Middleweight|Light Heavyweight|Heavyweight)\s+Championship\b/i);
      if (weight && new RegExp(`${matchup.left.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}[^.]{0,120}${matchup.right.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`, 'i').test(pageText)) {
        event.main_event.weight_class = `${weight[2] || ''}${weight[3]} Championship`.replace(/\s+/g,' ').trim();
      } else if (/World Flyweight Championship showdown[^.]{0,120}/i.test(pageText)) {
        event.main_event.weight_class = 'Flyweight Championship';
      }
      repairedTuff += 1;
    }
    repaired.push(event);
  } catch (error) {
    console.warn(`Tuff-N-Uff cleanup ${event.official_url}: ${error.message}; preserving event`);
    repaired.push(event);
  }
}

data.events = repaired
  .filter(event => !event.date || event.date >= TODAY)
  .sort((a,b) => String(a.date || '').localeCompare(String(b.date || '')) || clean(a.promotion).localeCompare(clean(b.promotion)) || clean(a.title).localeCompare(clean(b.title)));

await fs.writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(`Regional cleanup: removed ${removedMajorDiscovery} major-promotion discovery duplicate(s), removed ${removedPastTuff} past Tuff-N-Uff card(s), repaired ${repairedTuff} Tuff-N-Uff card(s).`);
console.log(`Regional cleanup complete: ${data.events.length} event(s).`);
