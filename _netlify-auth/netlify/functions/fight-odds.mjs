import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard';
const CORE_BASE = 'https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BEST_FIGHT_ODDS = 'https://www.bestfightodds.com/';
const BFO_PROVIDER_NAMES = new Map([
  [21,'FanDuel'],
  [22,'DraftKings'],
  [23,'BetMGM'],
  [24,'Caesars'],
  [25,'BetRivers'],
  [20,'BetWay'],
  [26,'Unibet'],
  [29,'Kalshi'],
  [28,'Polymarket']
]);
const BFO_PROVIDER_PRIORITY = [21,22,23,24,25,20,26,29,28];
let bestFightOddsCache = { fetchedAt:0, html:'' };

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

function decodeHtml(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi,(_,hex) => String.fromCodePoint(parseInt(hex,16)))
    .replace(/&#(\d+);/g,(_,dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#0?39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>');
}

function htmlText(value) {
  return decodeHtml(String(value || '').replace(/<script\b[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' '))
    .replace(/\s+/g,' ')
    .trim();
}

function bfoPairForMarket(market) {
  for (const providerId of BFO_PROVIDER_PRIORITY) {
    const prices = market?.prices?.get(providerId);
    if (!prices?.[1] || !prices?.[2]) continue;
    return {
      fighterA:prices[1],
      fighterB:prices[2],
      provider:BFO_PROVIDER_NAMES.get(providerId) || ('Book ' + providerId)
    };
  }
  return null;
}

export function parseBestFightOddsHtml(html) {
  const markets = new Map();
  for (const match of String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1];
    const fighterMatch = row.match(/<a\b[^>]*href=["']\/fighters\/[^"']+["'][^>]*>[\s\S]*?<span\b[^>]*class=["'][^"']*\bt-b-fcc\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const fighter = htmlText(fighterMatch?.[1] || '');
    if (!fighter) continue;

    const priceCells = [...row.matchAll(/<td\b[^>]*data-li=["']\[(\d+),([12]),(\d+)\]["'][^>]*>([\s\S]*?)<\/td>/gi)];
    if (!priceCells.length) continue;

    for (const cell of priceCells) {
      const providerId = Number(cell[1]);
      const side = Number(cell[2]);
      const matchupId = String(cell[3]);
      const moneyline = formatAmericanOdds(htmlText(cell[4]).match(/(?:[+-]\d{2,5}|EVEN)/i)?.[0] || '');
      if (!moneyline) continue;
      if (!markets.has(matchupId)) {
        markets.set(matchupId,{matchupId,fighters:{},prices:new Map()});
      }
      const market = markets.get(matchupId);
      market.fighters[side] = fighter;
      if (!market.prices.has(providerId)) market.prices.set(providerId,{});
      market.prices.get(providerId)[side] = moneyline;
    }
  }

  return [...markets.values()]
    .map(market => {
      const pair = bfoPairForMarket(market);
      if (!pair || !market.fighters[1] || !market.fighters[2]) return null;
      return {
        matchupId:market.matchupId,
        provider:pair.provider,
        fighters:[
          {name:market.fighters[1],moneyline:pair.fighterA},
          {name:market.fighters[2],moneyline:pair.fighterB}
        ]
      };
    })
    .filter(Boolean);
}

export function extractBestFightOddsMoneylines(html, fighterA, fighterB) {
  for (const market of parseBestFightOddsHtml(html)) {
    const first = market.fighters?.[0];
    const second = market.fighters?.[1];
    if (!first || !second) continue;
    if (sameFighterName(first.name,fighterA) && sameFighterName(second.name,fighterB)) {
      return {fighterA:first.moneyline,fighterB:second.moneyline,provider:market.provider};
    }
    if (sameFighterName(first.name,fighterB) && sameFighterName(second.name,fighterA)) {
      return {fighterA:second.moneyline,fighterB:first.moneyline,provider:market.provider};
    }
  }
  return null;
}

export function extractBestFightOddsCardOdds(html) {
  return parseBestFightOddsHtml(html).map(market => ({
    competitionId:'bfo-' + market.matchupId,
    source:'BestFightOdds',
    provider:market.provider,
    fighters:market.fighters
  }));
}

function cardOddsKey(market) {
  return (market?.fighters || []).map(row => normalizeFighterName(row?.name)).filter(Boolean).sort().join('|');
}

function mergeCardOdds(primary, fallback) {
  const out = [];
  const seen = new Set();
  for (const market of [...(primary || []),...(fallback || [])]) {
    const key = cardOddsKey(market);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(market);
  }
  return out;
}

async function fetchBestFightOddsHtml() {
  const now = Date.now();
  if (bestFightOddsCache.html && now - bestFightOddsCache.fetchedAt < 45000) {
    return bestFightOddsCache.html;
  }
  const response = await fetch(BEST_FIGHT_ODDS,{
    headers:{
      Accept:'text/html,application/xhtml+xml',
      'Accept-Language':'en-US,en;q=0.8',
      'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36'
    },
    redirect:'follow',
    signal:AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error('BestFightOdds returned HTTP ' + response.status);
  const html = await response.text();
  if (!/bestfightodds/i.test(html) || html.length < 10000) throw new Error('BestFightOdds response was incomplete');
  bestFightOddsCache = {fetchedAt:now,html};
  return html;
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

function fittFights(payload) {
  const segments = payload?.page?.content?.gamepackage?.cardSegs;
  if (!Array.isArray(segments)) return [];
  return segments.flatMap(segment => Array.isArray(segment?.mtchs) ? segment.mtchs : []);
}

function fittFighterName(value) {
  return value?.dspNm || value?.displayName ||
    [value?.frstNm,value?.lstNm].filter(Boolean).join(' ') || '';
}

function fittMoneyline(value) {
  const markets = Array.isArray(value?.bets?.odds) ? value.bets.odds : [];
  const market = markets.find(item =>
    String(item?.abbreviation || item?.displayName || '').toUpperCase() === 'ML' ||
    /money\s*line/i.test(String(item?.displayName || ''))
  );
  const odds = market?.values?.[0]?.odds ?? market?.values?.[0]?.value;
  return formatAmericanOdds(odds);
}

export function extractFittMoneylines(payload, fighterA, fighterB) {
  for (const fight of fittFights(payload)) {
    const away = fight?.awy || fight?.away;
    const home = fight?.hme || fight?.home;
    const awayName = fittFighterName(away);
    const homeName = fittFighterName(home);
    const matchesDirect =
      sameFighterName(awayName,fighterA) && sameFighterName(homeName,fighterB);
    const matchesReverse =
      sameFighterName(awayName,fighterB) && sameFighterName(homeName,fighterA);
    if (!matchesDirect && !matchesReverse) continue;
    const awayOdds = fittMoneyline(away);
    const homeOdds = fittMoneyline(home);
    if (!awayOdds || !homeOdds) return null;
    const provider = away?.bets?.provider?.name || home?.bets?.provider?.name || null;
    return matchesDirect
      ? {fighterA:awayOdds,fighterB:homeOdds,provider}
      : {fighterA:homeOdds,fighterB:awayOdds,provider};
  }
  return null;
}

export function extractFittCardOdds(payload) {
  return fittFights(payload).map(fight => {
    const away = fight?.awy || fight?.away;
    const home = fight?.hme || fight?.home;
    const awayName = fittFighterName(away);
    const homeName = fittFighterName(home);
    const awayOdds = fittMoneyline(away);
    const homeOdds = fittMoneyline(home);
    if (!awayName || !homeName || !awayOdds || !homeOdds) return null;
    return {
      competitionId:String(fight?.id || ''),
      provider:away?.bets?.provider?.name || home?.bets?.provider?.name || null,
      fighters:[
        {name:awayName,moneyline:awayOdds},
        {name:homeName,moneyline:homeOdds}
      ]
    };
  }).filter(Boolean);
}

export function parseEspnFittHtml(html) {
  const source = String(html || '');
  const marker = "window['__espnfitt__']=";
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const payloadStart = start + marker.length;
  const scriptEnd = source.indexOf('</script>',payloadStart);
  if (scriptEnd < 0) return null;
  let raw = source.slice(payloadStart,scriptEnd).trim();
  if (raw.endsWith(';')) raw = raw.slice(0,-1).trim();
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

async function fetchFittEvent(eventId) {
  const url = 'https://www.espn.com/mma/fightcenter/_/id/' + encodeURIComponent(eventId) + '/league/ufc';
  let lastError = null;
  for (let attempt=0; attempt<2; attempt++) {
    try {
      const response = await fetch(url,{
        headers:{
          Accept:'text/html,application/xhtml+xml',
          'Accept-Language':'en-US,en;q=0.8',
          'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36'
        },
        redirect:'follow',
        signal:AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error('ESPN FightCenter returned HTTP ' + response.status);
      const payload = parseEspnFittHtml(await response.text());
      if (!payload) throw new Error('ESPN FightCenter odds payload was unavailable');
      return payload;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('ESPN FightCenter lookup failed');
}

export function scoreboardDateQueries(eventDate, now = new Date()) {
  const today = now.toISOString().slice(0,10);
  const queries = [];
  if (eventDate && DATE_RE.test(eventDate)) {
    queries.push(
      espnDate(isoDateOffset(eventDate,-1)),
      espnDate(eventDate),
      espnDate(isoDateOffset(eventDate,1))
    );
  }
  const futureEnd = isoDateOffset(today,90);
  queries.push(espnDate(today) + '-' + espnDate(futureEnd));
  return [...new Set(queries)];
}

async function findMatchup(fighterA, fighterB, eventDate) {
  for (const dates of scoreboardDateQueries(eventDate)) {
    const payload = await fetchJson(SCOREBOARD + '?dates=' + dates + '&limit=200');
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
  let matchup = null;
  let odds = null;
  let oddsSource = null;
  let cardOdds = [];
  const warnings = [];

  try {
    matchup = await findMatchup(fighterA,fighterB,eventDate || null);
  } catch (error) {
    warnings.push('ESPN matchup lookup: ' + (error?.message || 'unavailable'));
  }

  if (matchup) {
    const { event, competition } = matchup;
    try {
      const fitt = await fetchFittEvent(event.id);
      cardOdds = extractFittCardOdds(fitt).map(market => ({...market,source:'ESPN'}));
      odds = extractFittMoneylines(fitt,fighterA,fighterB);
      if (odds) oddsSource = 'ESPN';
    } catch (error) {
      warnings.push('ESPN FightCenter: ' + (error?.message || 'unavailable'));
    }

    if (!odds) {
      try {
        let payload = competition.odds || null;
        if (!payload || (Array.isArray(payload) && !payload.length)) {
          payload = await fetchJson(
            CORE_BASE + '/events/' + encodeURIComponent(event.id) +
            '/competitions/' + encodeURIComponent(competition.id) + '/odds',
            {optional:true}
          );
        }
        odds = extractMoneylines(competition,payload,fighterA,fighterB);
        if (odds) oddsSource = 'ESPN';
      } catch (error) {
        warnings.push('ESPN core odds: ' + (error?.message || 'unavailable'));
      }
    }
  }

  try {
    const bestFightOddsHtml = await fetchBestFightOddsHtml();
    const bfoCardOdds = extractBestFightOddsCardOdds(bestFightOddsHtml);
    cardOdds = mergeCardOdds(cardOdds,bfoCardOdds);
    if (!odds) {
      odds = extractBestFightOddsMoneylines(bestFightOddsHtml,fighterA,fighterB);
      if (odds) oddsSource = 'BestFightOdds';
    }
  } catch (error) {
    warnings.push('BestFightOdds: ' + (error?.message || 'unavailable'));
  }

  const event = matchup?.event || null;
  const competition = matchup?.competition || null;

  if (!odds) {
    return Response.json({
      ok:true,
      available:false,
      source:matchup ? 'ESPN + BestFightOdds' : 'BestFightOdds',
      fetchedAt,
      eventId:event?.id || null,
      competitionId:competition?.id || null,
      eventDate:competition?.date || event?.date || (eventDate || null),
      cardOdds,
      reason:matchup ? 'line-not-posted' : 'matchup-not-found',
      warnings
    },{status:200,headers});
  }

  return Response.json({
    ok:true,
    available:true,
    source:oddsSource || 'live odds',
    provider:odds.provider,
    fetchedAt,
    eventId:event?.id || null,
    competitionId:competition?.id || null,
    eventDate:competition?.date || event?.date || (eventDate || null),
    cardOdds,
    fighterA:{name:fighterA,moneyline:odds.fighterA},
    fighterB:{name:fighterB,moneyline:odds.fighterB},
    warnings
  },{status:200,headers});
}

export const config = {
  path:'/api/fight-odds'
};
