import fs from 'node:fs/promises';
import { clean, key } from './ufc.mjs';

const SHERDOG = 'https://www.sherdog.com';
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

export function parseSherdogProfile(html, sourceUrl = null) {
  const source = String(html || '');
  const text = stripHtml(source);
  const h1 = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const name = h1 ? stripHtml(h1[1]) : null;
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

  return {
    name,
    record: `${wins}-${losses}-${draws}`,
    sourceUrl,
    career: {
      winsByKnockout,
      winsBySubmission,
      totalFinishes: winsByKnockout + winsBySubmission,
      decisionWins
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
  const expectedRecord = fighterRecord(fighter.record);
  if (!expectedRecord) return null;
  const expected = expectedRecord.join('-');
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
    if (!parsed || parsed.record !== expected) continue;
    const score = Math.max(nameScore(parsed.name || '', fighter.name), nameScore(candidate.label || '', fighter.name));
    if (!score) continue;
    matches.push({ ...parsed, score });
    if (score >= 1000) break;
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
  const before = JSON.stringify(fighter.career);
  for (const field of ['winsByKnockout', 'winsBySubmission', 'totalFinishes', 'decisionWins']) {
    if (!finite(fighter.career[field]) && finite(source[field])) fighter.career[field] = source[field];
  }
  const classified =
    (finite(fighter.career.unanimousDecisionWins) ? fighter.career.unanimousDecisionWins : 0) +
    (finite(fighter.career.splitDecisionWins) ? fighter.career.splitDecisionWins : 0) +
    (finite(fighter.career.majorityDecisionWins) ? fighter.career.majorityDecisionWins : 0) +
    (finite(fighter.career.otherDecisionWins) ? fighter.career.otherDecisionWins : 0);
  if (finite(fighter.career.decisionWins)) {
    fighter.career.decisionBreakdownKnownWins = classified;
    fighter.career.decisionBreakdownComplete = classified >= fighter.career.decisionWins;
  }
  fighter.careerSource = {
    source: 'Sherdog',
    sourceUrl: fallback.sourceUrl || null,
    recordMatched: true,
    checkedAt: fallback.checkedAt || new Date().toISOString()
  };
  return JSON.stringify(fighter.career) !== before;
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
      entry.record === fighter.record &&
      entry.miss !== true &&
      completeCareerCore(entry.career)
    ) {
      if (applyFallback(fighter, entry)) appliedFromCache++;
      continue;
    }
    if (
      entry &&
      entry.record === fighter.record &&
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
        record: fighter.record,
        checkedAt,
        sourceUrl: hit.sourceUrl,
        career: hit.career
      };
      cache.fighters[cacheKey] = entry;
      cacheChanged = true;
      applyFallback(fighter, entry);
      resolved++;
    } else {
      cache.fighters[cacheKey] = {
        name: fighter.name,
        record: fighter.record,
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

  return {
    targets: targets.length,
    resolved,
    missed,
    appliedFromCache,
    complete: fighters.filter(fighter => completeDisplayedCareer(fighter.career)).length
  };
}
