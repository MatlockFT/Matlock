import fs from 'node:fs/promises';
import { clean, key } from './ufc.mjs';

const SHERDOG = 'https://www.sherdog.com';
const UFCFIGHT = 'https://ufcfight.net';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockWriterCareer/1.0; +https://mmamatlock.com/write/)';

const finite = value => Number.isFinite(value);

export function completeDisplayedCareer(career) {
  return Boolean(
    career &&
    finite(career.totalFinishes) &&
    finite(career.winsByKnockout) &&
    finite(career.winsBySubmission) &&
    finite(career.unanimousDecisionWins) &&
    finite(career.splitDecisionWins)
  );
}

function completeCareerCore(career) {
  return Boolean(
    career &&
    finite(career.totalFinishes) &&
    finite(career.winsByKnockout) &&
    finite(career.winsBySubmission)
  );
}

function stripHtml(value = '') {
  return clean(
    String(value)
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  );
}

function fighterRecord(value) {
  return clean(value).match(/^(\d+)-(\d+)-(\d+)/)?.slice(1, 4).map(Number) || null;
}

function subtractRecords(overall, ufc) {
  const a = fighterRecord(overall);
  const b = fighterRecord(ufc);
  if (!a || !b) return null;
  return a.map((value, index) => Math.max(0, value - b[index])).join('-');
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
  if (numeric) return `${numeric[3]}-${String(numeric[1]).padStart(2, '0')}-${String(numeric[2]).padStart(2, '0')}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return compactMeasure(text);
  return parsed.toISOString().slice(0, 10);
}

function comparableBioMatches(fighter, parsed) {
  const matches = [];
  const expectedDob = dateKey(fighter.bio?.dob);
  const actualDob = dateKey(parsed.bio?.dob);
  if (expectedDob && actualDob) {
    matches.push({ field: 'dob', match: expectedDob === actualDob });
  }
  const expectedHeight = compactMeasure(fighter.bio?.height);
  const actualHeight = compactMeasure(parsed.bio?.height);
  if (expectedHeight && actualHeight) matches.push({ field: 'height', match: expectedHeight === actualHeight });
  const expectedWeight = compactMeasure(fighter.bio?.weight);
  const actualWeight = compactMeasure(parsed.bio?.weight);
  if (expectedWeight && actualWeight) matches.push({ field: 'weight', match: expectedWeight === actualWeight });
  return matches;
}

function nameTokens(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function nameScore(actual, expected) {
  if (key(actual) === key(expected)) return 1000;
  const a = nameTokens(actual);
  const b = nameTokens(expected);
  if (!a.length || !b.length) return 0;
  const aset = new Set(a);
  const shared = b.filter(token => aset.has(token)).length;
  const sameTokenSet = a.length === b.length && shared === a.length;
  if (sameTokenSet) return 900;
  const surnameShared = aset.has(b.at(-1)) || new Set(b).has(a.at(-1));
  const needed = Math.min(2, Math.min(a.length, b.length));
  if (shared < needed || !surnameShared) return 0;
  return 500 + shared * 25;
}

function fighterSlug(name) {
  return clean(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseUfcFightProfile(html, sourceUrl = null) {
  const source = String(html || '');
  const text = stripHtml(source);
  const headingMatches = [...source.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map(match => stripHtml(match[1]))
    .filter(Boolean);
  const name = headingMatches.find(value => !/^(?:record|statistics|fight history|biography)$/i.test(value)) || null;
  const recordMatch = text.match(/\bW-L-D\s+(\d+)-(\d+)-(\d+)\b/i);
  if (!recordMatch) return null;

  const wins = Number(recordMatch[1]);
  const losses = Number(recordMatch[2]);
  const draws = Number(recordMatch[3]);
  const winStart = text.search(/\bWINS\s+\d+\b/i);
  const lossStart = text.search(/\bLOSSES\s+\d+\b/i);
  if (winStart < 0 || lossStart <= winStart) return null;
  const winSection = text.slice(winStart, lossStart);
  const count = label => {
    const match = winSection.match(new RegExp(label + '\\s+(\\d+)', 'i'));
    return match ? Number(match[1]) : null;
  };
  const winsByKnockout = count('KO\\s*\\/\\s*TKO');
  const winsBySubmission = count('SUB');
  const decisionWins = count('DECISION');
  if (![winsByKnockout, winsBySubmission, decisionWins].every(finite)) return null;
  if (winsByKnockout + winsBySubmission + decisionWins > wins) return null;

  const dob = text.match(/\bBIRTHDATE\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i)?.[1] || null;
  const htWt = text.match(/\bHT\s*\/\s*WT\s+([^,]+),\s*(\d+\s+lbs?)\b/i);
  const height = htWt?.[1] || null;
  const weight = htWt?.[2] || null;

  const decisions = { unanimous: 0, split: 0, majority: 0, other: 0 };
  const historyStart = source.search(/Fight History/i);
  const historySource = historyStart >= 0 ? source.slice(historyStart) : '';
  for (const row of historySource.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowText = stripHtml(row[1]).replace(/[–—]/g, '-');
    if (!/\bW\b/i.test(rowText) || !/Decision/i.test(rowText)) continue;
    if (/Decision\s*-?\s*Unanimous/i.test(rowText)) decisions.unanimous++;
    else if (/Decision\s*-?\s*Split/i.test(rowText)) decisions.split++;
    else if (/Decision\s*-?\s*Majority/i.test(rowText)) decisions.majority++;
    else decisions.other++;
  }
  const classifiedDecisionWins = decisions.unanimous + decisions.split + decisions.majority + decisions.other;

  return {
    source: 'UFCFight.net',
    name,
    record: `${wins}-${losses}-${draws}`,
    sourceUrl,
    bio: { dob, height, weight },
    career: {
      winsByKnockout,
      winsBySubmission,
      totalFinishes: winsByKnockout + winsBySubmission,
      decisionWins,
      unanimousDecisionWins: decisions.unanimous,
      splitDecisionWins: decisions.split,
      majorityDecisionWins: decisions.majority,
      otherDecisionWins: decisions.other,
      decisionBreakdownKnownWins: classifiedDecisionWins,
      decisionBreakdownComplete: classifiedDecisionWins === decisionWins
    }
  };
}

async function lookupUfcFightCareer(fighter) {
  const slug = fighterSlug(fighter.name);
  if (!slug) return null;
  const sourceUrl = `${UFCFIGHT}/${slug}/`;
  let page;
  try {
    page = await fetchText(sourceUrl);
  } catch {
    return null;
  }
  const parsed = parseUfcFightProfile(page, sourceUrl);
  if (!parsed) return null;
  const score = nameScore(parsed.name || '', fighter.name);
  if (score < 900) return null;
  const bioChecks = comparableBioMatches(fighter, parsed);
  const bioMatches = bioChecks.filter(check => check.match).length;
  const bioConflicts = bioChecks.filter(check => !check.match).length;
  if (bioConflicts) return null;
  if (bioChecks.length && bioMatches < 1) return null;
  return { ...parsed, score: score + bioMatches * 100, bioMatches };
}

export function parseSherdogProfile(html, sourceUrl = null) {
  const source = String(html || '');
  const text = stripHtml(source);
  const h1 = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const name = h1 ? stripHtml(h1[1]) : null;
  const dob = text.match(/\bAGE\s+(?:\d+|N\/A)\s*\/\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}|N\/A)\b/i)?.[1] || null;
  const height = text.match(/\bHEIGHT\s+(\d+'\d+")\b/i)?.[1] || null;
  const weight = text.match(/\bWEIGHT\s+(\d+\s+lbs?)\b/i)?.[1] || null;
  const winsMatch = text.match(/\bWins\s+(\d+)\b/i);
  const lossesMatch = text.match(/\bLosses\s+(\d+)\b/i);
  if (!winsMatch || !lossesMatch) return null;

  const winsIndex = winsMatch.index ?? -1;
  const lossesIndex = lossesMatch.index ?? -1;
  if (winsIndex < 0 || lossesIndex <= winsIndex) return null;
  const winSection = text.slice(winsIndex, lossesIndex);
  const count = label => {
    const match = winSection.match(new RegExp(label + '\\s+(\\d+)', 'i'));
    return match ? Number(match[1]) : null;
  };

  const wins = Number(winsMatch[1]);
  const losses = Number(lossesMatch[1]);
  const draws = Number(text.match(/\bDraws?\s+(\d+)\b/i)?.[1] || 0);
  const winsByKnockout = count('KO\\s*\\/\\s*TKO');
  const winsBySubmission = count('SUBMISSIONS?');
  const decisionWins = count('DECISIONS?');
  if (![winsByKnockout, winsBySubmission, decisionWins].every(finite)) return null;
  if (winsByKnockout + winsBySubmission + decisionWins > wins) return null;

  const decisions = { unanimous: 0, split: 0, majority: 0, other: 0 };
  const proStart = source.search(/FIGHT\s+HISTORY\s*-\s*PRO/i);
  const amateurStart = source.search(/FIGHT\s+HISTORY\s*-\s*AMATEUR/i);
  const proSource = proStart >= 0
    ? source.slice(proStart, amateurStart > proStart ? amateurStart : source.length)
    : '';
  for (const row of proSource.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowText = stripHtml(row[1]);
    if (!/^win\b/i.test(rowText) || !/\bDecision\b/i.test(rowText)) continue;
    if (/Decision\s*\(Unanimous\)/i.test(rowText)) decisions.unanimous++;
    else if (/Decision\s*\(Split\)/i.test(rowText)) decisions.split++;
    else if (/Decision\s*\(Majority\)/i.test(rowText)) decisions.majority++;
    else decisions.other++;
  }
  const classifiedDecisionWins = decisions.unanimous + decisions.split + decisions.majority + decisions.other;

  return {
    source: 'Sherdog',
    name,
    record: `${wins}-${losses}-${draws}`,
    sourceUrl,
    bio: { dob, height, weight },
    career: {
      winsByKnockout,
      winsBySubmission,
      totalFinishes: winsByKnockout + winsBySubmission,
      decisionWins,
      unanimousDecisionWins: decisions.unanimous,
      splitDecisionWins: decisions.split,
      majorityDecisionWins: decisions.majority,
      otherDecisionWins: decisions.other,
      decisionBreakdownKnownWins: classifiedDecisionWins,
      decisionBreakdownComplete: classifiedDecisionWins === decisionWins
    }
  };
}

export function parseSherdogSearchProfiles(html) {
  const found = [];
  const seen = new Set();
  for (const match of String(html || '').matchAll(/<a\b[^>]*href=["'](\/fighter\/[a-z0-9][a-z0-9-]*-\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = new URL(match[1], SHERDOG).toString();
    if (seen.has(href)) continue;
    seen.add(href);
    found.push({ href, label: stripHtml(match[2]) });
  }
  return found.slice(0, 8);
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,*/*;q=0.8'
    }
  });
  if (!response.ok) throw new Error(`Sherdog HTTP ${response.status}: ${url}`);
  return response.text();
}

async function lookupCareer(fighter) {
  const direct = await lookupUfcFightCareer(fighter);
  if (direct) return direct;

  let search;
  try {
    search = await fetchText(`${SHERDOG}/stats/fightfinder?SearchTxt=${encodeURIComponent(fighter.name)}`);
  } catch {
    return null;
  }

  const candidates = parseSherdogSearchProfiles(search);
  const matches = [];
  for (const candidate of candidates) {
    let page;
    try {
      page = await fetchText(candidate.href);
    } catch {
      continue;
    }
    const parsed = parseSherdogProfile(page, candidate.href);
    if (!parsed) continue;

    const score = Math.max(nameScore(parsed.name || '', fighter.name), nameScore(candidate.label || '', fighter.name));
    if (score < 500) continue;

    const bioChecks = comparableBioMatches(fighter, parsed);
    const bioMatches = bioChecks.filter(check => check.match).length;
    const bioConflicts = bioChecks.filter(check => !check.match).length;
    if (bioConflicts) continue;

    const exactName = score >= 900;
    if (!exactName && bioMatches < 1) continue;
    if (exactName && bioChecks.length > 0 && bioMatches < 1) continue;

    matches.push({ ...parsed, score: score + bioMatches * 100, bioMatches });
  }

  if (!matches.length) return null;
  matches.sort((a, b) => b.score - a.score);
  if (matches.length > 1 && matches[0].score === matches[1].score && matches[0].sourceUrl !== matches[1].sourceUrl) {
    return null;
  }
  return matches[0];
}

function applyFallback(fighter, fallback) {
  const source = fallback?.career;
  if (!source) return false;
  fighter.career ||= {};
  const before = JSON.stringify({ record: fighter.record, recordOutsideUfc: fighter.recordOutsideUfc, career: fighter.career });

  for (const field of ['winsByKnockout', 'winsBySubmission', 'totalFinishes', 'decisionWins']) {
    if (!finite(fighter.career[field]) && finite(source[field])) fighter.career[field] = source[field];
  }

  if (source.decisionBreakdownComplete) {
    for (const field of [
      'unanimousDecisionWins',
      'splitDecisionWins',
      'majorityDecisionWins',
      'otherDecisionWins',
      'decisionBreakdownKnownWins'
    ]) {
      if (finite(source[field])) fighter.career[field] = source[field];
    }
    fighter.career.decisionBreakdownComplete = true;
  } else {
    const classified =
      (finite(fighter.career.unanimousDecisionWins) ? fighter.career.unanimousDecisionWins : 0) +
      (finite(fighter.career.splitDecisionWins) ? fighter.career.splitDecisionWins : 0) +
      (finite(fighter.career.majorityDecisionWins) ? fighter.career.majorityDecisionWins : 0) +
      (finite(fighter.career.otherDecisionWins) ? fighter.career.otherDecisionWins : 0);
    if (finite(fighter.career.decisionWins)) {
      fighter.career.decisionBreakdownKnownWins = classified;
      fighter.career.decisionBreakdownComplete = classified >= fighter.career.decisionWins;
    }
  }

  if (fallback.record) {
    fighter.record = fallback.record;
    fighter.recordOutsideUfc = subtractRecords(fallback.record, fighter.ufcRecord);
  }
  fighter.careerSource = {
    source: fallback.source || 'secondary',
    sourceUrl: fallback.sourceUrl || null,
    identityVerifiedBy: fallback.identityVerifiedBy || null,
    checkedAt: fallback.checkedAt || new Date().toISOString()
  };
  return JSON.stringify({ record: fighter.record, recordOutsideUfc: fighter.recordOutsideUfc, career: fighter.career }) !== before;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function run() {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      results[current] = await worker(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, run));
  return results;
}

export async function enrichSherdogCareers(fighters, { cachePath } = {}) {
  const path = cachePath || 'assets/data/writer-fighter-career-fallbacks.json';
  let cache = { schemaVersion: 1, fighters: {} };
  try {
    const loaded = JSON.parse(await fs.readFile(path, 'utf8'));
    if (loaded?.schemaVersion === 1 && loaded?.fighters && typeof loaded.fighters === 'object') cache = loaded;
  } catch {}

  let appliedFromCache = 0;
  const targets = [];
  for (const fighter of fighters) {
    if (completeCareerCore(fighter.career)) continue;
    const cacheKey = fighter.ufcStatsId || key(fighter.name);
    const entry = cache.fighters[cacheKey];
    if (
      entry &&
      entry.observedRecord === fighter.record &&
      entry.miss !== true &&
      completeCareerCore(entry.career)
    ) {
      if (applyFallback(fighter, entry)) appliedFromCache++;
      continue;
    }
    if (
      entry &&
      entry.observedRecord === fighter.record &&
      entry.miss === true &&
      Date.now() - Date.parse(entry.checkedAt || 0) < 7 * 86400000
    ) {
      continue;
    }
    targets.push({ fighter, cacheKey });
  }

  let resolved = 0;
  let missed = 0;
  let cacheChanged = false;
  const checkedAt = new Date().toISOString();
  const results = await mapLimit(targets, 8, async ({ fighter, cacheKey }) => {
    const hit = await lookupCareer(fighter);
    return { fighter, cacheKey, hit };
  });

  for (const { fighter, cacheKey, hit } of results) {
    if (hit) {
      const entry = {
        name: fighter.name,
        observedRecord: fighter.record,
        record: hit.record,
        checkedAt,
        source: hit.source || 'secondary',
        sourceUrl: hit.sourceUrl,
        identityVerifiedBy: hit.bioMatches ? 'name+bio' : 'exact-name',
        career: hit.career
      };
      cache.fighters[cacheKey] = entry;
      cacheChanged = true;
      applyFallback(fighter, entry);
      resolved++;
    } else {
      cache.fighters[cacheKey] = {
        name: fighter.name,
        observedRecord: fighter.record,
        checkedAt,
        miss: true
      };
      cacheChanged = true;
      missed++;
    }
  }

  if (cacheChanged) {
    cache.updatedAt = checkedAt;
    await fs.writeFile(path, JSON.stringify(cache, null, 2) + '\n');
  }

  const sourceCounts = {};
  for (const fighter of fighters) {
    const source = fighter.careerSource?.source;
    if (source) sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  }
  return {
    targets: targets.length,
    resolved,
    missed,
    appliedFromCache,
    sourceCounts,
    complete: fighters.filter(fighter => completeDisplayedCareer(fighter.career)).length
  };
}
