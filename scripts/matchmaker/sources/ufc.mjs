// Each adapter returns plain, source-attributed records. Never execute source HTML.
export const clean = (s = '') => String(s).replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'").replace(/\s+/g, ' ').trim();
export const key = s => clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const slug = u => u?.match(/\/athlete\/([^/?#"\s]+)/)?.[1] || '';
export const profileStatus = html => clean(html).match(/\b(?:Fighter\s+)?Status\s*(Active|Not Fighting|Inactive|Retired)\b/i)?.[1] || null;
const field = (html, cls) => clean(html.match(new RegExp(`class="[^"]*\\b${cls}[^\"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`))?.[1]);
export function eventDate(html, timestamp) {
  const start = new Date(+timestamp * 1000), label = field(html, 'c-hero__headline-suffix');
  const parts = label.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b/);
  if (!parts) throw new Error('Missing published calendar date; cannot infer event day from UTC alone');
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(parts[1]);
  const dates = [-1, 0, 1].map(offset => new Date(Date.UTC(start.getUTCFullYear() + offset, month, +parts[2]))).sort((a,b) => Math.abs(a-start)-Math.abs(b-start));
  if (Math.abs(dates[0]-start) > 2 * 86400000) throw new Error('Published date conflicts with event timestamp');
  return dates[0].toISOString().slice(0,10);
}
export function parseRankings(html) {
  const rankings = [];
  for (const block of html.split('<div class="view-grouping">').slice(1)) {
    const division = clean(block.match(/view-grouping-header">([^<]+)/)?.[1]);
    if (!division || /pound/i.test(division) || rankings.some(r => r.division === division)) continue;
    const table = block.split('</table>')[0];
    const champion = table.match(/<h5>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (champion) rankings.push({ id: slug(champion[1]), name: clean(champion[2]), division, rank: 0 });
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)];
    let count = 0;
    for (const [, row] of rows) {
      const rank = row.match(/views-field-weight-class-rank">\s*(\d+)/);
      const fighter = row.match(/href="([^" ]*\/athlete\/[^" ]+)"[^>]*>([\s\S]*?)<\/a>/);
      if (rank && fighter) { rankings.push({ id: slug(fighter[1]), name: clean(fighter[2]), division, rank: +rank[1], interim: /interim/i.test(clean(row)) }); count++; }
    }
    if (!champion || count < 15) throw new Error(`Incomplete ${division} rankings: ${count} challengers. Retaining last good data.`);
  }
  if (new Set(rankings.map(r => r.division)).size < 11) throw new Error('Rankings parser returned fewer than 11 divisions');
  return rankings;
}
export function parseEvent(html, url) {
  const timestamp = html.match(/data-timestamp="(\d{10})"/)?.[1];
  if (!timestamp) throw new Error(`Missing event date: ${url}`);
  const date = eventDate(html, timestamp);
  const title = clean(html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || html.match(/<title>(.*?)<\/title>/)?.[1]).replace(/\s*\|.*$/, '');
  const bouts = [];
  for (const block of html.split(/<div class="c-listing-fight"/).slice(1)) {
    const fighters = ['red', 'blue'].map(corner => {
      const segment = block.match(new RegExp(`c-listing-fight__corner-name--${corner}">([\\s\\S]*?)<\\/div>`))?.[1] || '';
      const href = segment.match(/href="([^"]+)"/)?.[1];
      const outcomeSection = block.split(`c-listing-fight__corner-body--${corner}`)[1]?.split('c-listing-fight__corner-body--')[0] || '';
      const outcome = outcomeSection.match(/c-listing-fight__outcome--(win|loss|draw|no-contest)/)?.[1];
      const imageSection = block.split(`c-listing-fight__corner-image--${corner}`)[1]?.split('</a>')[0];
      return { id: slug(href), name: clean(segment), result: ({ win: 'W', loss: 'L', draw: 'D', 'no-contest': 'NC' })[outcome] || null, image: imageSection?.match(/<img[^>]+src="([^"]+)"/)?.[1] || null };
    });
    if (fighters.some(f => !f.id)) continue;
    bouts.push({ id: block.match(/data-fmid="([^"]+)"/)?.[1], division: field(block, 'c-listing-fight__class-text').replace(/ (Title )?Bout/i, ''), fighters, method: field(block, 'c-listing-fight__result-text method') });
  }
  if (bouts.length < 5 || new Set(bouts.flatMap(b => b.fighters.map(f => f.id))).size !== bouts.length * 2) throw new Error(`Incomplete or duplicate event card: ${url}`);
  const completed = bouts.every(b => b.fighters.every(f => f.result));
  const main = ['e-divider__top', 'e-divider__bottom'].map(cls => field(html, cls));
  const displayTitle = main.every(Boolean) ? `${title}: ${main.join(' vs ')}` : title;
  return { id: url.split('/').pop(), title: displayTitle, date, source: url, completed, bouts };
}
export function parseProfile(html, fighter, checkedAt) {
  const division = field(html, 'hero-profile__division-title').replace(/ Division$/i, '');
  const record = field(html, 'hero-profile__division-body').match(/\d+-\d+-\d+/)?.[0] || null;
  if (!division || !record) throw new Error(`Missing profile division/record: ${fighter.id}`);
  const historyBlock = html.match(/field--name-qna-ufc[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
  const history = [];
  for (const [, p] of historyBlock.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = clean(p), dateParts = text.match(/\((\d{1,2})\/(\d{1,2})\/(\d{2,4})\)/);
    if (!dateParts || !/^UFC\b/i.test(text)) continue; // Excludes DWCS, TUF exhibition records.
    const year = +dateParts[3] < 100 ? 2000 + +dateParts[3] : +dateParts[3];
    const date = `${year}-${dateParts[1].padStart(2, '0')}-${dateParts[2].padStart(2, '0')}`;
    if (date > checkedAt.slice(0, 10)) continue;
    const result = /no contest|overturned/i.test(text) ? 'NC' : /draw/i.test(text) ? 'D' : /\blost\b|was (?:defeated|stopped|submitted|knocked out|disqualified)|\bloss\b/i.test(text) ? 'L' : /\bwon\b|\bdefeated\b|\bstopped\b|\bsubmitted\b|\bknocked out\b/i.test(text) ? 'W' : null;
    history.push({ date, result, text, opponentIds: [] });
  }
  history.sort((a, b) => b.date.localeCompare(a.date));
  return { ...fighter, profileStatus: profileStatus(html), division, record, history, historyCoverage: 'UFC profile listed bouts; may be incomplete', checkedAt, lastFight: history[0]?.date || null };
}
