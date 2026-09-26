const UFCFIGHT_BASE = 'https://ufcfight.net/';
const SHERDOG_BASE = 'https://www.sherdog.com';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockWriter/1.1; +https://mmamatlock.com/write/)';

function decode(value) {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&mdash;|&#8212;/gi, '—')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function clean(value) {
  return decode(
    String(value || '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function normalizeName(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(value) {
  return normalizeName(value).replace(/\s+/g, '-');
}

function compactMeasure(value) {
  return clean(value)
    .replace(/[′’]/g, "'")
    .replace(/[″”]/g, '"')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dateKey(value) {
  const text = clean(value);
  if (!text || text === '--' || /^n\/a$/i.test(text)) return '';
  const numeric = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric) {
    return `${numeric[3]}-${String(numeric[1]).padStart(2, '0')}-${String(numeric[2]).padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return compactMeasure(text);
  return parsed.toISOString().slice(0, 10);
}

function identityChecks(expected, actual) {
  const checks = [];
  const expectedDob = dateKey(expected?.dob);
  const actualDob = dateKey(actual?.dob);
  if (expectedDob && actualDob) checks.push({field:'dob', match:expectedDob === actualDob});

  const expectedHeight = compactMeasure(expected?.height);
  const actualHeight = compactMeasure(actual?.height);
  if (expectedHeight && actualHeight) checks.push({field:'height', match:expectedHeight === actualHeight});

  const expectedWeight = compactMeasure(expected?.weight);
  const actualWeight = compactMeasure(actual?.weight);
  if (expectedWeight && actualWeight) checks.push({field:'weight', match:expectedWeight === actualWeight});

  return checks;
}

function decisionBreakdownFromHistory(source, decisionWins) {
  const result = {unanimous:0, split:0, majority:0, other:0};
  for (const row of String(source || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const text = clean(row[1]).replace(/[–—]/g, '-');
    if (!/(?:^|\s)W(?:\s|\(|$)/i.test(text) || !/Decision/i.test(text)) continue;
    if (/Decision\s*(?:-|\()?\s*Unanimous/i.test(text)) result.unanimous++;
    else if (/Decision\s*(?:-|\()?\s*Split/i.test(text)) result.split++;
    else if (/Decision\s*(?:-|\()?\s*Majority/i.test(text)) result.majority++;
    else result.other++;
  }
  const known = result.unanimous + result.split + result.majority + result.other;
  return {
    unanimousDecisionWins: result.unanimous,
    splitDecisionWins: result.split,
    majorityDecisionWins: result.majority,
    otherDecisionWins: result.other,
    decisionBreakdownKnownWins: known,
    decisionBreakdownComplete: Number.isFinite(decisionWins) ? known === decisionWins : false
  };
}

export function parseUfcFightCareerProfile(html, sourceUrl = null) {
  const source = String(html || '');
  const text = clean(source);
  const headings = [...source.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map(match => clean(match[1]))
    .filter(Boolean);
  const name = headings.find(value => !/^(?:record|statistics|fight history|biography)$/i.test(value)) || null;

  const record = text.match(/\bW-L-D\s+(\d+)-(\d+)-(\d+)\b/i);
  if (!record) return null;
  const wins = Number(record[1]);
  const losses = Number(record[2]);
  const draws = Number(record[3]);

  const winStart = text.search(/\bWINS\s+\d+\b/i);
  const lossStart = text.search(/\bLOSSES\s+\d+\b/i);
  if (winStart < 0 || lossStart <= winStart) return null;
  const winSection = text.slice(winStart, lossStart);
  const count = label => {
    const match = winSection.match(new RegExp(label + '\\s+(\\d+)', 'i'));
    return match ? Number(match[1]) : null;
  };

  const winsByKnockout = count('KO\\s*\\/\\s*TKO');
  const winsBySubmission = count('SUB(?:MISSIONS?)?');
  const decisionWins = count('DECISIONS?');
  if (![winsByKnockout, winsBySubmission, decisionWins].every(Number.isFinite)) return null;
  if (winsByKnockout + winsBySubmission + decisionWins > wins) return null;

  const htWt = text.match(/\bHT\s*\/\s*WT\s+([^,]+),\s*(\d+\s+lbs?)\b/i);
  const bio = {
    dob: text.match(/\bBIRTHDATE\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i)?.[1] || null,
    height: htWt?.[1] || null,
    weight: htWt?.[2] || null
  };

  return {
    source:'UFCFight.net',
    sourceUrl,
    name,
    record:`${wins}-${losses}-${draws}`,
    bio,
    career:{
      winsByKnockout,
      winsBySubmission,
      totalFinishes:winsByKnockout + winsBySubmission,
      decisionWins,
      ...decisionBreakdownFromHistory(source, decisionWins)
    }
  };
}

function parseSherdogSearchProfiles(html) {
  const found = [];
  const seen = new Set();
  for (const match of String(html || '').matchAll(/<a\b[^>]*href=["'](\/fighter\/[a-z0-9][a-z0-9-]*-\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(match[1], SHERDOG_BASE).toString();
    if (seen.has(href)) continue;
    seen.add(href);
    found.push({href,label:clean(match[2])});
  }
  return found.slice(0, 5);
}

export function parseSherdogCareerProfile(html, sourceUrl = null) {
  const source = String(html || '');
  const text = clean(source);
  const name = clean(source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const winsMatch = text.match(/\bWins\s+(\d+)\b/i);
  const lossesMatch = text.match(/\bLosses\s+(\d+)\b/i);
  if (!winsMatch || !lossesMatch) return null;

  const wins = Number(winsMatch[1]);
  const losses = Number(lossesMatch[1]);
  const draws = Number(text.match(/\bDraws?\s+(\d+)\b/i)?.[1] || 0);
  const start = winsMatch.index ?? -1;
  const end = lossesMatch.index ?? -1;
  if (start < 0 || end <= start) return null;
  const section = text.slice(start, end);
  const count = label => {
    const match = section.match(new RegExp(label + '\\s+(\\d+)', 'i'));
    return match ? Number(match[1]) : null;
  };

  const winsByKnockout = count('KO\\s*\\/\\s*TKO');
  const winsBySubmission = count('SUBMISSIONS?');
  const decisionWins = count('DECISIONS?');
  if (![winsByKnockout, winsBySubmission, decisionWins].every(Number.isFinite)) return null;

  const ageDob = text.match(/\bAGE\s+(?:\d+|N\/A)\s*\/\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}|N\/A)\b/i);
  const bio = {
    dob:ageDob?.[1] || null,
    height:text.match(/\bHEIGHT\s+(\d+'\s*\d+"?)\b/i)?.[1] || null,
    weight:text.match(/\bWEIGHT\s+(\d+\s+lbs?)\b/i)?.[1] || null
  };

  const historyStart = source.search(/FIGHT\s+HISTORY\s*-\s*PRO/i);
  const amateurStart = source.search(/FIGHT\s+HISTORY\s*-\s*AMATEUR/i);
  const proHistory = historyStart >= 0
    ? source.slice(historyStart, amateurStart > historyStart ? amateurStart : source.length)
    : source;

  return {
    source:'Sherdog',
    sourceUrl,
    name,
    record:`${wins}-${losses}-${draws}`,
    bio,
    career:{
      winsByKnockout,
      winsBySubmission,
      totalFinishes:winsByKnockout + winsBySubmission,
      decisionWins,
      ...decisionBreakdownFromHistory(proHistory, decisionWins)
    }
  };
}

async function get(url, {attempts=2, timeout=5500} = {}) {
  let lastError;
  for (let attempt=0; attempt<attempts; attempt++) {
    try {
      const response = await fetch(url, {
        redirect:'follow',
        signal:AbortSignal.timeout(timeout),
        headers:{
          'Accept':'text/html,application/xhtml+xml',
          'User-Agent':UA
        }
      });
      if (response.ok) return await response.text();
      const error = new Error('Career fallback returned HTTP ' + response.status);
      error.status = response.status;
      if (response.status === 404) throw error;
      lastError = error;
    } catch (error) {
      if (error?.status === 404) throw error;
      lastError = error;
    }
    if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw lastError || new Error('Career fallback failed.');
}

function verified(profile, expected) {
  if (!profile?.career || !profile.name || !expected?.name) return false;
  if (normalizeName(profile.name) !== normalizeName(expected.name)) return false;
  const checks = identityChecks(expected, profile.bio);
  if (checks.some(check => !check.match)) return false;
  return true;
}

async function directLookup(expected) {
  const slug = slugify(expected.name);
  if (!slug) return null;
  const sourceUrl = UFCFIGHT_BASE + slug + '/';
  try {
    const html = await get(sourceUrl);
    const profile = parseUfcFightCareerProfile(html, sourceUrl);
    return verified(profile, expected) ? profile : null;
  } catch {
    return null;
  }
}

async function sherdogLookup(expected) {
  try {
    const search = await get(SHERDOG_BASE + '/stats/fightfinder?SearchTxt=' + encodeURIComponent(expected.name), {attempts:1,timeout:4500});
    const candidates = parseSherdogSearchProfiles(search);
    for (const candidate of candidates) {
      if (normalizeName(candidate.label) !== normalizeName(expected.name)) continue;
      try {
        const html = await get(candidate.href, {attempts:1,timeout:4500});
        const profile = parseSherdogCareerProfile(html, candidate.href);
        if (verified(profile, expected)) return profile;
      } catch {}
    }
  } catch {}
  return null;
}

export async function fetchCareerFallback(expected) {
  const direct = await directLookup(expected);
  if (direct) return direct;
  return sherdogLookup(expected);
}

export function hasCompleteDisplayedCareer(career) {
  return Boolean(
    career &&
    Number.isFinite(career.totalFinishes) &&
    Number.isFinite(career.winsByKnockout) &&
    Number.isFinite(career.winsBySubmission) &&
    Number.isFinite(career.unanimousDecisionWins) &&
    Number.isFinite(career.splitDecisionWins)
  );
}
