import { clean, key } from './ufc.mjs';

const MONTHS = {
  jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03', apr: '04', april: '04',
  may: '05', jun: '06', june: '06', jul: '07', july: '07', aug: '08', august: '08', sep: '09', sept: '09', september: '09',
  oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12'
};

export const statsId = url => String(url || '').match(/\/fighter-details\/([a-f0-9]+)/i)?.[1] || '';

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
    if (!result) continue; // Skips upcoming "next" rows.
    const date = parseDate(text);
    if (!date || date > cutoff) continue;
    const event = eventLink(row);
    if (!event.title || !/^UFC\b/i.test(event.title)) continue; // Excludes DWCS/TUF exhibitions from UFC rematch history.
    meetings.push({
      opponentStatsId: opponent.id,
      opponentName: opponent.name,
      date,
      result,
      event: event.title,
      source: 'UFCStats',
      sourceUrl: fightLink(row) || event.url || profileUrl
    });
  }

  const unique = new Map();
  for (const meeting of meetings) {
    const id = `${meeting.date}|${meeting.opponentStatsId}`;
    if (!unique.has(id)) unique.set(id, meeting);
  }
  return [...unique.values()].sort((a, b) => b.date.localeCompare(a.date));
}
