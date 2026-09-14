import { clean, key } from './ufc.mjs';

const MONTHS = {
  jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03', apr: '04', april: '04',
  may: '05', jun: '06', june: '06', jul: '07', july: '07', aug: '08', august: '08', sep: '09', sept: '09', september: '09',
  oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12'
};

export const statsId = url => String(url || '').match(/\/fighter-details\/([a-f0-9]+)/i)?.[1]?.toLowerCase() || '';

function rows(html) {
  return [...String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => match[1]);
}

function groupedFighterLinks(html) {
  const groups = new Map();
  const pattern = /<a\b[^>]*href\s*=\s*["']?(https?:\/\/(?:www\.)?ufcstats\.com\/fighter-details\/([a-f0-9]+))["']?[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    const id = match[2].toLowerCase();
    const text = clean(match[3]);
    if (!text) continue;
    const existing = groups.get(id) || { id, url: `https://ufcstats.com/fighter-details/${id}`, parts: [] };
    if (!existing.parts.includes(text)) existing.parts.push(text);
    groups.set(id, existing);
  }
  return [...groups.values()].map(group => ({ ...group, name: clean(group.parts.join(' ')) }));
}

function parseDate(text) {
  const match = clean(text).match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Sept(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),\s+(\d{4})\b/i);
  if (!match) return null;
  const month = MONTHS[match[1].replace(/\.$/, '').toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${String(match[2]).padStart(2, '0')}`;
}

function eventLink(row) {
  const match = String(row || '').match(/<a\b[^>]*href\s*=\s*["']?(https?:\/\/(?:www\.)?ufcstats\.com\/event-details\/[a-f0-9]+)["']?[^>]*>([\s\S]*?)<\/a>/i);
  return match ? { url: match[1].replace(/^http:/i, 'https:'), title: clean(match[2]) } : { url: null, title: null };
}

function fightLink(row) {
  const match = String(row || '').match(/(?:data-link|href)\s*=\s*["']?(https?:\/\/(?:www\.)?ufcstats\.com\/fight-details\/[a-f0-9]+)["']?/i);
  return match?.[1]?.replace(/^http:/i, 'https:') || null;
}

function resultCode(text) {
  const value = clean(text).toLowerCase();
  if (/\bwin\b/.test(value)) return 'W';
  if (/\bloss\b|\blost\b/.test(value)) return 'L';
  if (/\bdraw\b/.test(value)) return 'D';
  if (/\bnc\b|no contest/.test(value)) return 'NC';
  return null;
}

function isUfcEvent(title) {
  return /^(?:UFC\b|Noche UFC\b|The Ultimate Fighter\b)/i.test(clean(title));
}

export function parseFighterDirectory(html) {
  const found = [];
  for (const row of rows(html)) {
    const groups = groupedFighterLinks(row);
    for (const group of groups) {
      if (!group.id || !group.name) continue;
      found.push({ id: group.id, name: group.name, key: key(group.name), url: group.url });
    }
  }
  const deduped = new Map();
  for (const fighter of found) {
    const previous = deduped.get(fighter.id);
    if (!previous || fighter.name.length > previous.name.length) deduped.set(fighter.id, fighter);
  }
  return [...deduped.values()];
}

export function parseFighterHistory(html, profileUrl, checkedAt = new Date().toISOString()) {
  const selfId = statsId(profileUrl);
  if (!selfId) throw new Error(`Invalid UFCStats fighter URL: ${profileUrl}`);
  const cutoff = checkedAt.slice(0, 10);
  const meetings = [];

  for (const row of rows(html)) {
    const fighters = groupedFighterLinks(row);
    if (fighters.length < 2 || !fighters.some(fighter => fighter.id === selfId)) continue;
    const opponent = fighters.find(fighter => fighter.id !== selfId);
    if (!opponent) continue;
    const text = clean(row);
    const result = resultCode(text);
    if (!result) continue;
    const date = parseDate(text);
    if (!date || date > cutoff) continue;
    const event = eventLink(row);
    if (!event.title || !isUfcEvent(event.title)) continue;
    const sourceUrl = fightLink(row) || event.url || profileUrl;
    meetings.push({
      fightStatsId: String(sourceUrl).match(/\/fight-details\/([a-f0-9]+)/i)?.[1]?.toLowerCase() || null,
      opponentStatsId: opponent.id,
      opponentName: opponent.name,
      date,
      result,
      event: event.title,
      source: 'UFCStats',
      sourceUrl
    });
  }

  const unique = new Map();
  for (const meeting of meetings) {
    const id = meeting.fightStatsId || `${meeting.date}|${meeting.opponentStatsId}`;
    if (!unique.has(id)) unique.set(id, meeting);
  }
  return [...unique.values()].sort((a, b) => b.date.localeCompare(a.date));
}

// Small RFC-4180-compatible reader used for the GitHub-hosted UFCStats mirror. It deliberately
// returns strings only; source-specific validation happens after parsing.
export function parseCsv(text) {
  const records = [];
  let row = [], field = '', quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); records.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); records.push(row); }
  if (!records.length) return [];
  const headers = records.shift().map(header => clean(header));
  return records.filter(values => values.some(Boolean)).map(values => Object.fromEntries(headers.map((header, index) => [header, clean(values[index] || '')])));
}

export function parseMirrorFighters(fighterCsv) {
  const fighters = new Map();
  for (const row of parseCsv(fighterCsv)) {
    const id = statsId(row.URL);
    const name = clean([row.FIRST, row.LAST].filter(Boolean).join(' '));
    if (!id || !name) continue;
    const candidate = {
      id,
      name,
      nickname: clean(row.NICKNAME),
      key: key(name),
      url: `https://ufcstats.com/fighter-details/${id}`
    };
    const existing = fighters.get(id);
    if (!existing || candidate.name.length > existing.name.length) fighters.set(id, candidate);
  }
  return [...fighters.values()];
}

export function parseMirrorHistory(fightCsv, eventCsv, cutoff = new Date().toISOString().slice(0, 10)) {
  const eventRows = parseCsv(eventCsv);
  const eventDates = new Map();
  for (const row of eventRows) {
    const title = clean(row.EVENT);
    const date = parseDate(row.DATE);
    if (!title || !date || date > cutoff || !isUfcEvent(title)) continue;
    const existing = eventDates.get(title);
    if (!existing || date > existing) eventDates.set(title, date);
  }

  const fights = new Map();
  for (const row of parseCsv(fightCsv)) {
    const event = clean(row.EVENT);
    const date = eventDates.get(event);
    const sourceUrl = String(row.URL || '').replace(/^http:/i, 'https:');
    if (!event || !date || !isUfcEvent(event) || !/^https:\/\/ufcstats\.com\/fight-details\/[a-f0-9]+/i.test(sourceUrl)) continue;
    const names = clean(row.BOUT).split(/\s+vs\.?\s+/i).map(clean);
    const outcomes = clean(row.OUTCOME).split('/').map(value => value.toUpperCase());
    if (names.length !== 2 || outcomes.length !== 2 || outcomes.some(value => !['W', 'L', 'D', 'NC'].includes(value))) continue;
    const fightStatsId = sourceUrl.match(/fight-details\/([a-f0-9]+)/i)?.[1]?.toLowerCase() || null;
    const sourceId = fightStatsId || `${date}|${key(names[0])}|${key(names[1])}`;
    if (!fights.has(sourceId)) fights.set(sourceId, {
      fightStatsId,
      date,
      event,
      aName: names[0],
      bName: names[1],
      aResult: outcomes[0],
      bResult: outcomes[1],
      weightClass: clean(row.WEIGHTCLASS) || null,
      method: clean(row.METHOD) || null,
      round: Number(row.ROUND) || null,
      time: clean(row.TIME) || null,
      referee: clean(row.REFEREE) || null,
      details: clean(row.DETAILS) || null,
      source: 'UFCStats',
      sourceUrl
    });
  }
  return [...fights.values()].sort((a, b) => b.date.localeCompare(a.date) || a.sourceUrl.localeCompare(b.sourceUrl));
}
