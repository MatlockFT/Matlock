import fs from 'node:fs/promises';

const beforePath = process.argv[2] || '/tmp/upcoming-events.before.html';
const afterPath = process.argv[3] || 'upcoming-events.html';
const before = await fs.readFile(beforePath, 'utf8');
const after = await fs.readFile(afterPath, 'utf8');
const failures = [];

const normalize = s => String(s || '').replace(/\s+/g, ' ').trim();
const today = new Date().toISOString().slice(0, 10);

function balancedLiquid(html) {
  const stack = [];
  for (const m of html.matchAll(/\{%\s*(for|endfor|if|endif|unless|endunless|case|endcase)\b[^%]*%\}/gi)) {
    const token = m[1].toLowerCase();
    const closeMap = { endfor: 'for', endif: 'if', endunless: 'unless', endcase: 'case' };
    if (closeMap[token]) {
      const expected = closeMap[token];
      const actual = stack.pop();
      if (actual !== expected) failures.push(`Liquid mismatch: expected end of ${actual || 'nothing'}, found ${token}.`);
    } else {
      stack.push(token);
    }
  }
  if (stack.length) failures.push(`Unclosed Liquid blocks: ${stack.join(', ')}`);
}

function eventCards(html) {
  const out = [];
  const re = /<section\b[^>]*class=["'][^"']*\bupcoming-event-card\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi;
  for (const m of html.matchAll(re)) {
    const card = m[0];
    const promotion = normalize((card.match(/<p\b[^>]*class=["'][^"']*event-promotion[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) || [])[1]?.replace(/<[^>]+>/g, ''));
    const title = normalize((card.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i) || [])[1]?.replace(/<[^>]+>/g, ''));
    const date = (card.match(/<time\b[^>]*datetime=["'](\d{4}-\d{2}-\d{2})["']/i) || [])[1] || '';
    const bouts = (card.match(/<article\b[^>]*class=["'][^"']*\bbout-card\b/gi) || []).length;
    const key = `${promotion.toLowerCase()}|${date}|${title.toLowerCase()}`;
    out.push({ key, promotion, title, date, bouts, html: card });
  }
  return out;
}

function checkPortraits(html) {
  for (const m of html.matchAll(/<img\b[^>]*data-fighter-photo[^>]*src=["']([^"']+)["'][^>]*>/gi)) {
    const url = m[1];
    if (/piwik|analytics|tracking|pixel|acs01\.rvlvr\.co/i.test(url)) failures.push(`Tracking/analytics URL used as fighter portrait: ${url}`);
    if (!/^(https?:)?\/\//i.test(url) && !/^\//.test(url) && !/\{\{/.test(url)) failures.push(`Malformed fighter portrait URL: ${url}`);
  }
}

function checkFighterNames(html) {
  const banned = /\b(EVENT INFO|WHERE TO WATCH|BUY TICKETS|MATCHUPS|MAIN CARD SATURDAY|EARLY CARD SATURDAY|d\s*:\s*h\s*:\s*m\s*:\s*s)\b/i;
  for (const m of html.matchAll(/<p\b[^>]*class=["'][^"']*fighter-name[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)) {
    const raw = normalize(m[1].replace(/<[^>]+>/g, ''));
    if (!raw || /\{\{/.test(raw)) continue;
    if (banned.test(raw)) failures.push(`Suspicious fighter name: ${raw}`);
    if (raw.length > 80) failures.push(`Implausibly long fighter name: ${raw}`);
  }
}

balancedLiquid(after);
checkPortraits(after);
checkFighterNames(after);

if (!/class=["'][^"']*upcoming-events-list/i.test(after)) failures.push('Missing upcoming-events-list container.');
if (/<section\b[^>]*class=["'][^"']*upcoming-event-card/i.test(before) && !/<section\b[^>]*class=["'][^"']*upcoming-event-card/i.test(after)) failures.push('All event cards disappeared.');
if (/\{\{\s*event\./i.test(after) && !/\{%\s*for\s+event\s+in\s+site\.data\.ufc_events\.events\s*%\}/i.test(after)) failures.push('Orphaned event Liquid variables found without the UFC data loop.');

const oldCards = eventCards(before);
const newCards = eventCards(after);
const newByKey = new Map(newCards.map(c => [c.key, c]));
for (const oldCard of oldCards) {
  if (!oldCard.date || oldCard.date <= today) continue;
  const next = newByKey.get(oldCard.key);
  if (!next) {
    failures.push(`Future event disappeared unexpectedly: ${oldCard.promotion} ${oldCard.title} (${oldCard.date}).`);
    continue;
  }
  if (oldCard.bouts >= 4 && next.bouts < Math.max(2, Math.ceil(oldCard.bouts * 0.6))) {
    failures.push(`Bout count collapsed for ${oldCard.promotion} ${oldCard.title}: ${oldCard.bouts} -> ${next.bouts}.`);
  }
}

const futureOld = oldCards.filter(c => c.date > today).length;
const futureNew = newCards.filter(c => c.date > today).length;
if (futureOld >= 3 && futureNew < Math.max(1, futureOld - 2)) failures.push(`Future event count collapsed: ${futureOld} -> ${futureNew}.`);

if (failures.length) {
  console.error('Upcoming Events validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Upcoming Events validation passed (${newCards.length} literal event card(s) checked).`);
