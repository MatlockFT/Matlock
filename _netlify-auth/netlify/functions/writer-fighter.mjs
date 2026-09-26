import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import { fetchCareerFallback, hasCompleteDisplayedCareer } from './_writer-career-fallback.mjs';

const UFCSTATS_BASE = 'https://ufcstats.com/fighter-details/';
const UFC_PROFILE_BASE = 'https://www.ufc.com/athlete/';
const ID_RE = /^[a-f0-9]{16}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

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

export function parseUfcProfileSummary(html) {
  const text = clean(html);
  const record = text.match(/\b(\d+-\d+-\d+)\s*\(W-L-D\)/i)?.[1] ||
    text.match(/\b(\d+-\d+-\d+)\b/)?.[1] || null;
  const countBefore = label => {
    const escaped = escapeRegex(label);
    const match = text.match(new RegExp('\\b(\\d+)\\s+' + escaped + '\\b', 'i'));
    return match ? Number(match[1]) : null;
  };
  const rawWinsByKnockout = countBefore('Wins by Knockout');
  const rawWinsBySubmission = countBefore('Wins by Submission');
  const firstRoundFinishes = countBefore('First Round Finishes');
  const winsByKnockout = Number.isFinite(rawWinsByKnockout)
    ? rawWinsByKnockout
    : Number.isFinite(rawWinsBySubmission) ? 0 : null;
  const winsBySubmission = Number.isFinite(rawWinsBySubmission)
    ? rawWinsBySubmission
    : Number.isFinite(rawWinsByKnockout) ? 0 : null;
  const wins = Number(record?.split('-')[0]) || null;
  const decisionWins = Number.isFinite(wins) && Number.isFinite(winsByKnockout) && Number.isFinite(winsBySubmission)
    ? Math.max(0, wins - winsByKnockout - winsBySubmission)
    : null;
  return {
    record,
    career: {
      winsByKnockout,
      winsBySubmission,
      firstRoundFinishes,
      decisionWins,
      totalFinishes: Number.isFinite(winsByKnockout) && Number.isFinite(winsBySubmission)
        ? winsByKnockout + winsBySubmission
        : null
    }
  };
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

async function fetchOfficialProfile(slug) {
  const sourceUrl = UFC_PROFILE_BASE + slug;
  let lastError;
  for (let attempt=0; attempt<3; attempt++) {
    try {
      const response = await fetch(sourceUrl, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; MMAMatlockWriter/1.0; +https://mmamatlock.com/write/)'
        },
        redirect:'follow',
        signal:AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error('UFC profile returned HTTP ' + response.status);
      const html = await response.text();
      if (html.length < 5000) throw new Error('UFC profile returned an incomplete page');
      const profile = parseUfcProfileSummary(html);
      if (!profile.record && !Number.isFinite(profile.career?.winsByKnockout)) {
        throw new Error('UFC profile did not expose career method data');
      }
      return { profile, sourceUrl };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve,500*(attempt+1)));
    }
  }
  throw lastError;
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
  const slug = String(url.searchParams.get('slug') || '').toLowerCase();
  const name = String(url.searchParams.get('name') || '').trim().slice(0, 100);
  const expectedBio = {
    dob:String(url.searchParams.get('dob') || '').trim().slice(0, 40),
    height:String(url.searchParams.get('height') || '').trim().slice(0, 30),
    weight:String(url.searchParams.get('weight') || '').trim().slice(0, 30)
  };
  const validStatsId = ID_RE.test(statsId);
  if (statsId && !validStatsId) {
    return Response.json({ok:false,error:'Invalid UFCStats fighter id.'},{status:400,headers});
  }
  if (!validStatsId && !name) {
    return Response.json({ok:false,error:'A fighter name or valid UFCStats fighter id is required.'},{status:400,headers});
  }
  if (slug && !SLUG_RE.test(slug)) {
    return Response.json({ok:false,error:'Invalid UFC athlete slug.'},{status:400,headers});
  }

  const fetchedAt = new Date().toISOString();
  const [statsResult, officialResult, fallbackResult] = await Promise.allSettled([
    validStatsId ? fetchProfile(statsId) : Promise.resolve(null),
    slug ? fetchOfficialProfile(slug) : Promise.resolve(null),
    name ? fetchCareerFallback({name,...expectedBio}) : Promise.resolve(null)
  ]);

  const statsResolved = statsResult.status === 'fulfilled' ? statsResult.value : null;
  const officialResolved = officialResult.status === 'fulfilled' ? officialResult.value : null;
  const fallbackResolved = fallbackResult.status === 'fulfilled' ? fallbackResult.value : null;
  const liveStats = Boolean(statsResolved?.profile);
  const liveOfficial = Boolean(officialResolved?.profile);
  const liveCareerFallback = Boolean(fallbackResolved?.career);

  if (!liveStats && !liveOfficial && !liveCareerFallback) {
    const reasons = [
      statsResult.status === 'rejected' ? 'UFCStats: ' + statsResult.reason?.message : '',
      officialResult.status === 'rejected' ? 'UFC profile: ' + officialResult.reason?.message : '',
      fallbackResult.status === 'rejected' ? 'Career fallback: ' + fallbackResult.reason?.message : ''
    ].filter(Boolean);
    return Response.json({
      ok:false,
      source:'UFCStats+UFC.com+career fallback',
      mode:'live',
      fetchedAt,
      error:reasons.join(' · ') || 'Live fighter lookup failed'
    }, {status:502,headers});
  }

  const statsProfile = statsResolved?.profile || {};
  const officialProfile = officialResolved?.profile || {};
  const fallbackProfile = fallbackResolved || {};

  // Start with fallback career data, then let UFC.com override any career values it
  // actually exposes. Null/undefined official fields never erase verified fallback data.
  const career = {...(fallbackProfile.career || {})};
  for (const [field,value] of Object.entries(officialProfile.career || {})) {
    if (value !== null && value !== undefined && value !== '') career[field] = value;
  }

  const profile = {
    ...statsProfile,
    record: officialProfile.record || fallbackProfile.record || statsProfile.record || null,
    career:Object.keys(career).length ? career : null
  };
  const core = [
    profile.stats?.slpm,
    profile.stats?.sapm,
    profile.stats?.strAccuracy,
    profile.stats?.strDefense
  ].filter(Boolean);

  return Response.json({
    ok:true,
    source:'UFCStats+UFC.com+career fallback',
    mode:'live',
    fetchedAt,
    sourceUrl:statsResolved?.sourceUrl || officialResolved?.sourceUrl || fallbackProfile.sourceUrl || null,
    officialSourceUrl:officialResolved?.sourceUrl || null,
    careerSourceUrl:fallbackProfile.sourceUrl || null,
    careerSource:fallbackProfile.source || null,
    liveUfcStats:liveStats && core.length >= 2,
    liveUfcProfile:liveOfficial,
    liveCareerFallback,
    completeCareer:hasCompleteDisplayedCareer(profile.career),
    warnings:[
      validStatsId && !liveStats ? (statsResult.status === 'rejected' ? statsResult.reason?.message : 'UFCStats unavailable') : null,
      slug && !liveOfficial ? (officialResult.status === 'rejected' ? officialResult.reason?.message : 'UFC profile unavailable') : null,
      name && !liveCareerFallback && !hasCompleteDisplayedCareer(officialProfile.career)
        ? (fallbackResult.status === 'rejected' ? fallbackResult.reason?.message : 'Career fallback unavailable')
        : null
    ].filter(Boolean),
    profile
  }, {status:200,headers});
}

export const config = {
  path: '/api/writer/fighter'
};
