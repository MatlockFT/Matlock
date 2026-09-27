import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard';
const CORE_BASE = 'https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeFighterName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sameFighterName(a, b) {
  const left = normalizeFighterName(a);
  const right = normalizeFighterName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const l = left.split(' ').sort().join(' ');
  const r = right.split(' ').sort().join(' ');
  return l === r;
}

function competitorName(competitor) {
  return competitor?.athlete?.displayName ||
    competitor?.athlete?.fullName ||
    competitor?.displayName ||
    competitor?.fullName ||
    competitor?.name ||
    '';
}

function matchupCompetitors(competition, fighterA, fighterB) {
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const a = competitors.find(item => sameFighterName(competitorName(item), fighterA));
  const b = competitors.find(item => sameFighterName(competitorName(item), fighterB));
  return a && b ? { a, b } : null;
}

export function formatAmericanOdds(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^(?:even|evens|pk|pick)$/i.test(raw)) return 'EVEN';
  const number = Number(raw.replace(/^\+/, ''));
  if (!Number.isFinite(number)) return null;
  if (number === 0) return 'EVEN';
  return number > 0 ? '+' + Math.round(number) : String(Math.round(number));
}

function readMoneyline(value) {
  if (!value || typeof value !== 'object') return null;
  const direct = [
    value.moneyLine,
    value.moneyline,
    value.american,
    value.americanOdds,
    value.price
  ];
  for (const candidate of direct) {
    const formatted = formatAmericanOdds(candidate);
    if (formatted) return formatted;
  }
  for (const nested of [value.current, value.odds, value.priceInfo]) {
    if (!nested || typeof nested !== 'object') continue;
    const formatted = readMoneyline(nested);
    if (formatted) return formatted;
  }
  return null;
}

function outcomeName(value) {
  return value?.athlete?.displayName ||
    value?.athlete?.fullName ||
    value?.participant?.displayName ||
    value?.participant?.name ||
    value?.team?.displayName ||
    value?.team?.name ||
    value?.displayName ||
    value?.name ||
    value?.label ||
    '';
}

function idFromOddsSide(value) {
  return String(
    value?.athlete?.id ||
    value?.participant?.id ||
    value?.competitor?.id ||
    value?.team?.id ||
    value?.id ||
    ''
  );
}

function surname(value) {
  const words = normalizeFighterName(value).split(' ').filter(Boolean);
  return words.at(-1) || '';
}

function detailsMention(details, fighterA, fighterB) {
  const normalized = ' ' + normalizeFighterName(details) + ' ';
  const aLast = surname(fighterA);
  const bLast = surname(fighterB);
  const aHit = aLast.length >= 3 && normalized.includes(' ' + aLast + ' ');
  const bHit = bLast.length >= 3 && normalized.includes(' ' + bLast + ' ');
  if (aHit === bHit) return null;
  return aHit ? 'a' : 'b';
}

function providerName(item) {
  return item?.provider?.name ||
    item?.provider?.displayName ||
    item?.providerName ||
    item?.bookmaker ||
    null;
}

function providerScore(item) {
  const name = String(providerName(item) || '').toLowerCase();
  const preferred = ['espn bet','draftkings','fanduel','caesars','betmgm','bet365'];
  const preferredIndex = preferred.indexOf(name);
  if (preferredIndex >= 0) return preferredIndex;
  const priority = Number(item?.provider?.priority);
  return 20 + (Number.isFinite(priority) ? priority : 50);
}

function candidateOddsItems(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  const items = Array.isArray(payload.items) ? payload.items :
    Array.isArray(payload.odds) ? payload.odds :
    Array.isArray(payload.providers) ? payload.providers : [payload];
  return items.filter(Boolean).sort((a,b) => providerScore(a) - providerScore(b));
}

function directOutcomePair(item, fighterA, fighterB) {
  const outcomes = [
    ...(Array.isArray(item?.outcomes) ? item.outcomes : []),
    ...(Array.isArray(item?.selections) ? item.selections : []),
    ...(Array.isArray(item?.markets?.moneyline?.outcomes) ? item.markets.moneyline.outcomes : [])
  ];
  if (!outcomes.length) return null;
  const a = outcomes.find(value => sameFighterName(outcomeName(value), fighterA));
  const b = outcomes.find(value => sameFighterName(outcomeName(value), fighterB));
  const aOdds = readMoneyline(a);
  const bOdds = readMoneyline(b);
  return aOdds && bOdds ? { a:aOdds, b:bOdds } : null;
}

function sidePair(item, competition, fighterA, fighterB) {
  const home = item?.homeTeamOdds || item?.homeOdds || item?.home;
  const away = item?.awayTeamOdds || item?.awayOdds || item?.away;
  const homeOdds = readMoneyline(home);
  const awayOdds = readMoneyline(away);
  if (!homeOdds || !awayOdds) return null;

  const matched = matchupCompetitors(competition,fighterA,fighterB);
  if (!matched) return null;
  const { a, b } = matched;

  const aName = competitorName(a);
  const bName = competitorName(b);
  const homeName = outcomeName(home);
  const awayName = outcomeName(away);
  if (homeName && awayName) {
    if (sameFighterName(homeName,aName) && sameFighterName(awayName,bName)) return {a:homeOdds,b:awayOdds};
    if (sameFighterName(homeName,bName) && sameFighterName(awayName,aName)) return {a:awayOdds,b:homeOdds};
  }

  const homeId = idFromOddsSide(home);
  const awayId = idFromOddsSide(away);
  if (homeId && awayId) {
    if (homeId === String(a.id) && awayId === String(b.id)) return {a:homeOdds,b:awayOdds};
    if (homeId === String(b.id) && awayId === String(a.id)) return {a:awayOdds,b:homeOdds};
  }

  const homeCompetitor = [a,b].find(value => String(value.homeAway || '').toLowerCase() === 'home');
  const awayCompetitor = [a,b].find(value => String(value.homeAway || '').toLowerCase() === 'away');
  if (homeCompetitor && awayCompetitor) {
    return String(homeCompetitor.id) === String(a.id)
      ? {a:homeOdds,b:awayOdds}
      : {a:awayOdds,b:homeOdds};
  }

  const detailSide = detailsMention(item?.details || item?.summary || '', fighterA, fighterB);
  const homeFavorite = Boolean(home?.favorite) && !away?.favorite;
  const awayFavorite = Boolean(away?.favorite) && !home?.favorite;
  if (detailSide && (homeFavorite || awayFavorite)) {
    const favoriteIsA = detailSide === 'a';
    if (homeFavorite) return favoriteIsA ? {a:homeOdds,b:awayOdds} : {a:awayOdds,b:homeOdds};
    return favoriteIsA ? {a:awayOdds,b:homeOdds} : {a:homeOdds,b:awayOdds};
  }

  return null;
}

export function extractMoneylines(competition, payload, fighterA, fighterB) {
  for (const item of candidateOddsItems(payload)) {
    const pair = directOutcomePair(item,fighterA,fighterB) || sidePair(item,competition,fighterA,fighterB);
    if (!pair) continue;
    return {
      fighterA: pair.a,
      fighterB: pair.b,
      provider: providerName(item)
    };
  }
  return null;
}

function isoDateOffset(value, days) {
  const date = DATE_RE.test(String(value || ''))
    ? new Date(String(value) + 'T12:00:00Z')
    : new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0,10);
}

function espnDate(value) {
  return String(value || '').replaceAll('-','');
}

async function fetchJson(url, { optional=false } = {}) {
  const response = await fetch(url, {
    headers:{
      Accept:'application/json',
      'User-Agent':'Mozilla/5.0 (compatible; MMAMatlockOdds/1.0; +https://mmamatlock.com/)'
    },
    redirect:'follow',
    signal:AbortSignal.timeout(9000)
  });
  if (optional && (response.status === 404 || response.status === 400)) return null;
  if (!response.ok) throw new Error('ESPN returned HTTP ' + response.status);
  return response.json();
}

async function findMatchup(fighterA, fighterB, eventDate) {
  const dates = eventDate
    ? [isoDateOffset(eventDate,-1), eventDate, isoDateOffset(eventDate,1)]
    : [new Date().toISOString().slice(0,10)];
  const seen = new Set();

  for (const date of dates) {
    if (seen.has(date)) continue;
    seen.add(date);
    const payload = await fetchJson(SCOREBOARD + '?dates=' + espnDate(date));
    for (const event of payload?.events || []) {
      for (const competition of event?.competitions || []) {
        if (!matchupCompetitors(competition,fighterA,fighterB)) continue;
        return { event, competition };
      }
    }
  }
  return null;
}

export default async function handler(request) {
  const origin = normalizeOrigin(request.headers.get('origin'));
  const headers = {
    ...corsHeaders(request),
    'Cache-Control':'public, max-age=20, s-maxage=45, stale-while-revalidate=120',
    'Content-Type':'application/json; charset=utf-8'
  };

  if (request.method === 'OPTIONS') {
    if (!isAllowedOrigin(origin)) return new Response(null,{status:403,headers});
    return new Response(null,{
      status:204,
      headers:{...headers,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Accept'}
    });
  }
  if (request.method !== 'GET') {
    return Response.json({ok:false,error:'Method not allowed'},{status:405,headers:{...headers,Allow:'GET, OPTIONS'}});
  }
  if (origin && !isAllowedOrigin(origin)) {
    return Response.json({ok:false,error:'Origin not allowed'},{status:403,headers});
  }

  const url = new URL(request.url);
  const fighterA = String(url.searchParams.get('fighterA') || '').trim().slice(0,100);
  const fighterB = String(url.searchParams.get('fighterB') || '').trim().slice(0,100);
  const eventDate = String(url.searchParams.get('date') || '').trim();
  if (!fighterA || !fighterB) {
    return Response.json({ok:false,error:'Both fighter names are required.'},{status:400,headers});
  }
  if (eventDate && !DATE_RE.test(eventDate)) {
    return Response.json({ok:false,error:'Invalid event date.'},{status:400,headers});
  }

  const fetchedAt = new Date().toISOString();
  try {
    const matchup = await findMatchup(fighterA,fighterB,eventDate || null);
    if (!matchup) {
      return Response.json({
        ok:true,available:false,source:'ESPN',fetchedAt,
        reason:'matchup-not-found'
      },{status:200,headers});
    }

    const { event, competition } = matchup;
    let payload = competition.odds || null;
    if (!payload || (Array.isArray(payload) && !payload.length)) {
      payload = await fetchJson(
        CORE_BASE + '/events/' + encodeURIComponent(event.id) +
        '/competitions/' + encodeURIComponent(competition.id) + '/odds',
        {optional:true}
      );
    }

    const odds = extractMoneylines(competition,payload,fighterA,fighterB);
    if (!odds) {
      return Response.json({
        ok:true,available:false,source:'ESPN',fetchedAt,
        eventId:event.id || null,
        competitionId:competition.id || null,
        eventDate:competition.date || event.date || null,
        reason:'line-not-posted'
      },{status:200,headers});
    }

    return Response.json({
      ok:true,
      available:true,
      source:'ESPN',
      provider:odds.provider,
      fetchedAt,
      eventId:event.id || null,
      competitionId:competition.id || null,
      eventDate:competition.date || event.date || null,
      fighterA:{name:fighterA,moneyline:odds.fighterA},
      fighterB:{name:fighterB,moneyline:odds.fighterB}
    },{status:200,headers});
  } catch (error) {
    return Response.json({
      ok:false,
      available:false,
      source:'ESPN',
      fetchedAt,
      error:error?.message || 'Live odds lookup failed'
    },{status:502,headers});
  }
}

export const config = {
  path:'/api/fight-odds'
};
