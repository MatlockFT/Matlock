import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';

const UFCSTATS_BASE = 'https://ufcstats.com/fighter-details/';
const ID_RE = /^[a-f0-9]{16}$/i;

function decode(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&mdash;|&#8212;/gi, '—')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function clean(value) {
  return decode(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
}

function labelValue(html, label) {
  const escaped = escapeRegex(label);
  const patterns = [
    new RegExp('<i\\b[^>]*>\\s*' + escaped + '\\s*:?[\\s\\S]*?<\\/i>\\s*([^<\\n\\r]+)', 'i'),
    new RegExp('>\\s*' + escaped + '\\s*:?\\s*<\\/[^>]+>\\s*([^<\\n\\r]+)', 'i')
  ];
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (match) {
      const value = clean(match[1]);
      if (value && value !== '--' && value !== '---') return value;
    }
  }
  return null;
}

function monthDate(text) {
  const match = clean(text).match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Sept(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),\s+(\d{4})\b/i);
  if (!match) return null;
  const months = { jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12 };
  const month = months[match[1].replace(/\.$/,'').toLowerCase()];
  if (!month) return null;
  return match[3] + '-' + String(month).padStart(2,'0') + '-' + String(match[2]).padStart(2,'0');
}

function fighterLinks(row) {
  const found = [];
  const pattern = /<a\b[^>]*href=["']https?:\/\/(?:www\.)?ufcstats\.com\/fighter-details\/([a-f0-9]{16})["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(row || '').matchAll(pattern)) {
    const entry = { id: match[1].toLowerCase(), name: clean(match[2]) };
    if (entry.name && !found.some(item => item.id === entry.id)) found.push(entry);
  }
  return found;
}

function resultFromRow(row) {
  const flag = String(row || '').match(/b-flag__text[^>]*>\s*([^<]+)/i);
  const value = clean(flag?.[1]).toUpperCase();
  if (['W','L','D','NC'].includes(value)) return value;
  const text = clean(row);
  if (/\bwin\b/i.test(text)) return 'W';
  if (/\b(?:loss|lost)\b/i.test(text)) return 'L';
  if (/\bdraw\b/i.test(text)) return 'D';
  if (/no contest/i.test(text)) return 'NC';
  return null;
}

function methodFromRow(row) {
  const text = clean(row);
  const methods = [
    'Decision - Unanimous','Decision - Split','Decision - Majority',
    'Technical Decision','KO/TKO','Submission','DQ','Overturned'
  ];
  return methods.find(method => text.toLowerCase().includes(method.toLowerCase())) || null;
}

function eventFromRow(row) {
  const match = String(row || '').match(/<a\b[^>]*href=["']https?:\/\/(?:www\.)?ufcstats\.com\/event-details\/[a-f0-9]+["'][^>]*>([\s\S]*?)<\/a>/i);
  return clean(match?.[1]) || null;
}

function fightRows(html, selfId) {
  const rows = [];
  const rowPattern = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  for (const match of String(html || '').matchAll(rowPattern)) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    const fightUrl = (attrs + body).match(/(?:data-link|href)=["']?(https?:\/\/(?:www\.)?ufcstats\.com\/fight-details\/[a-f0-9]+)["']?/i)?.[1];
    if (!fightUrl) continue;
    const fighters = fighterLinks(body);
    if (!fighters.some(fighter => fighter.id === selfId)) continue;
    const opponent = fighters.find(fighter => fighter.id !== selfId);
    if (!opponent) continue;
    rows.push({
      result: resultFromRow(body),
      opponent: opponent.name,
      opponentStatsId: opponent.id,
      event: eventFromRow(body),
      date: monthDate(body),
      method: methodFromRow(body),
      sourceUrl: fightUrl.replace(/^http:/i, 'https:')
    });
  }
  return rows.sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function recordFromRows(rows) {
  const counts = { W:0, L:0, D:0, NC:0 };
  for (const row of rows) if (row.result && Object.hasOwn(counts,row.result)) counts[row.result]++;
  return counts.W + '-' + counts.L + '-' + counts.D + (counts.NC ? ' (' + counts.NC + ' NC)' : '');
}

export function parseUfcStatsProfile(html, statsId) {
  const source = String(html || '');
  const title = source.match(/b-content__title-highlight[^>]*>([\s\S]*?)<\/(?:span|h2)>/i);
  const recordNode = source.match(/b-content__title-record[^>]*>([\s\S]*?)<\/(?:span|h2)>/i);
  const recordText = clean(recordNode?.[1]);
  const record = recordText.match(/Record:\s*([^\s<]+)/i)?.[1] || null;
  const history = fightRows(source, statsId.toLowerCase());
  const ufcHistory = history.filter(row => /^(?:UFC\b|Noche UFC\b)/i.test(row.event || ''));

  return {
    statsId: statsId.toLowerCase(),
    name: clean(title?.[1]) || null,
    record,
    height: labelValue(source, 'Height'),
    weight: labelValue(source, 'Weight'),
    reach: labelValue(source, 'Reach'),
    stance: labelValue(source, 'STANCE') || labelValue(source, 'Stance'),
    dob: labelValue(source, 'DOB'),
    stats: {
      slpm: labelValue(source, 'SLpM'),
      strAccuracy: labelValue(source, 'Str. Acc.'),
      sapm: labelValue(source, 'SApM'),
      strDefense: labelValue(source, 'Str. Def.'),
      tdAvg: labelValue(source, 'TD Avg.'),
      tdAccuracy: labelValue(source, 'TD Acc.'),
      tdDefense: labelValue(source, 'TD Def.'),
      subAvg: labelValue(source, 'Sub. Avg.')
    },
    ufcRecord: ufcHistory.length ? recordFromRows(ufcHistory) : null,
    latestBoutDate: history[0]?.date || null,
    recent: history.slice(0,5)
  };
}

async function fetchProfile(statsId) {
  const sourceUrl = UFCSTATS_BASE + statsId;
  let lastError;
  for (let attempt=0; attempt<3; attempt++) {
    try {
      const response = await fetch(sourceUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; MMAMatlockWriter/1.0; +https://mmamatlock.com/write/)'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error('UFCStats returned HTTP ' + response.status);
      const html = await response.text();
      if (!/b-content__title/i.test(html) || html.length < 2000) throw new Error('UFCStats returned an incomplete fighter page');
      return { profile: parseUfcStatsProfile(html, statsId), sourceUrl };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

export default async function handler(request) {
  const origin = normalizeOrigin(request.headers.get('origin'));
  const headers = {
    ...corsHeaders(request),
    'Cache-Control': 'no-store, max-age=0',
    'Content-Type': 'application/json; charset=utf-8'
  };

  if (request.method === 'OPTIONS') {
    if (!isAllowedOrigin(origin)) return new Response(null, { status:403, headers });
    return new Response(null, {
      status:204,
      headers:{...headers,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Accept'}
    });
  }
  if (request.method !== 'GET') {
    return Response.json({ok:false,error:'Method not allowed'}, {status:405,headers:{...headers,Allow:'GET, OPTIONS'}});
  }
  if (origin && !isAllowedOrigin(origin)) {
    return Response.json({ok:false,error:'Origin not allowed'}, {status:403,headers});
  }

  const url = new URL(request.url);
  const statsId = String(url.searchParams.get('id') || '').toLowerCase();
  if (!ID_RE.test(statsId)) {
    return Response.json({ok:false,error:'A valid UFCStats fighter id is required.'},{status:400,headers});
  }

  try {
    const resolved = await fetchProfile(statsId);
    const profile = resolved.profile;
    const core = [profile.stats.slpm,profile.stats.sapm,profile.stats.strAccuracy,profile.stats.strDefense].filter(Boolean);
    if (core.length < 2) throw new Error('UFCStats profile did not expose enough career statistics');
    return Response.json({
      ok:true,
      source:'UFCStats',
      mode:'live',
      fetchedAt:new Date().toISOString(),
      sourceUrl:resolved.sourceUrl,
      profile
    }, {status:200,headers});
  } catch (error) {
    return Response.json({
      ok:false,
      source:'UFCStats',
      mode:'live',
      fetchedAt:new Date().toISOString(),
      error:error instanceof Error ? error.message : 'UFCStats lookup failed'
    }, {status:502,headers});
  }
}

export const config = {
  path: '/api/writer/fighter'
};
