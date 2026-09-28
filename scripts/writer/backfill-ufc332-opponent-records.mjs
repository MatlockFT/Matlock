import fs from 'node:fs/promises';

const DRAFT_PATH = '_posts/2026-09-25-ufc-332.md';
const DIRECTORY_PATH = 'assets/data/writer-fighters.json';
const LIVE_ENDPOINT = 'https://mmamatlock-writer-auth.netlify.app/api/writer/fighter';

const normalize = value => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function parseRecord(value) {
  const match = String(value || '').match(/\b(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);
  if (!match) return null;
  return { wins:Number(match[1]), losses:Number(match[2]), draws:Number(match[3] || 0) };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function opponentMarkup(a,b) {
  if (!(a.opponentsRecord || b.opponentsRecord || a.opponentsPct || b.opponentsPct)) return '';
  return '<div class="fc-opponents"><div class="fc-opponent-stat"><strong>'+escapeHtml(a.opponentsRecord||'—')+
    '</strong><span>'+escapeHtml(a.opponentsPct||'')+'</span></div><div class="fc-opponent-label">OPPONENTS COMBINED RECORD</div>'+
    '<div class="fc-opponent-stat"><strong>'+escapeHtml(b.opponentsRecord||'—')+'</strong><span>'+escapeHtml(b.opponentsPct||'')+'</span></div></div>';
}

const directory = JSON.parse(await fs.readFile(DIRECTORY_PATH,'utf8'));
const byName = new Map((directory.fighters || []).map(f => [normalize(f.name),f]));
const liveCache = new Map();
const supplementalRecords = new Map(Object.entries({
  "Viviane Araujo":"14-8-0",
  "Andrea Lee":"13-11-0",
  "Ariane da Silva":"17-11-0",
  "Bruna Brasil":"11-7-1",
  "Henry Cejudo":"16-6-0",
  "Yanis Ghemmouri":"13-4-0",
  "Andreas Gustafsson":"12-3-0",
  "Carlston Harris":"19-8-0",
  "Rolando Bedoya":"14-5-0",
  "Tre'ston Vines":"10-4-0",
  "Robert Valentin":"12-6-0",
  "Jose Daniel Medina":"11-7-0",
  "Stewart Nicoll":"8-4-0",
  "Timmy Cuamba":"10-4-0",
  "Ricky Turcios":"12-6-0",
  "Lukasz Brzeski":"9-7-1",
  "Mohammed Usman":"11-4-0",
  "Caio Machado":"8-4-1",
  "Jamal Pogues":"12-6-0",
  "Kurt Holobaugh":"22-10-0",
  "Austin Hubbard":"16-11-0",
  "JunYong Park":"19-7-0",
  "Siyar Bahadurzada":"24-8-1",
  "Michael Chiesa":"20-7-0",
  "Alex Morono":"24-13-0",
  "Matt Brown":"24-19-0"
}).map(([name,record]) => [normalize(name),record]));

async function liveRecord(name) {
  const key = normalize(name);
  if (liveCache.has(key)) return liveCache.get(key);
  const url = LIVE_ENDPOINT + '?name=' + encodeURIComponent(name);
  let record = null;
  try {
    const response = await fetch(url, {
      headers:{Accept:'application/json','User-Agent':'MMAMatlock-UFC332-Backfill/1.0'},
      signal:AbortSignal.timeout(20000)
    });
    const data = await response.json().catch(()=>null);
    if (response.ok && data?.ok) record = parseRecord(data.profile?.record);
  } catch (error) {
    console.warn('Live lookup failed for', name, error.message);
  }
  liveCache.set(key,record);
  return record;
}

async function recordForOpponent(name) {
  const normalized = normalize(name);
  const cached = parseRecord(byName.get(normalized)?.record);
  if (cached) return cached;
  const supplemental = parseRecord(supplementalRecords.get(normalized));
  if (supplemental) return supplemental;
  return liveRecord(name);
}

async function calculate(side) {
  if (side.opponentsRecord || side.opponentsPct) {
    return {record:side.opponentsRecord||'', pct:side.opponentsPct||'', preserved:true};
  }
  const opponents = (side.recent || []).map(row => row.opponent).filter(Boolean).slice(0,5);
  if (!opponents.length) return {record:'',pct:'',unresolved:[]};
  const records = [];
  const unresolved = [];
  for (const opponent of opponents) {
    const record = await recordForOpponent(opponent);
    if (!record) unresolved.push(opponent);
    else records.push(record);
  }
  if (unresolved.length) return {record:'',pct:'',unresolved};
  const wins = records.reduce((sum,r)=>sum+r.wins,0);
  const losses = records.reduce((sum,r)=>sum+r.losses,0);
  if (!(wins+losses)) return {record:'',pct:'',unresolved:opponents};
  return {record:`${wins}-${losses}`,pct:`${Math.round(wins/(wins+losses)*100)}%`,unresolved:[]};
}

let source = await fs.readFile(DRAFT_PATH,'utf8');
const taleRe = /<section class="article-html-visual" data-writer-block="tale" data-writer-config="([^"]+)">([\s\S]*?)<\/section>/g;
let output = '';
let cursor = 0;
let changed = 0;
let blockNumber = 0;
const report=[];

for (const match of source.matchAll(taleRe)) {
  blockNumber++;
  output += source.slice(cursor,match.index);
  const cfg = JSON.parse(decodeURIComponent(match[1]));
  const aCalc = await calculate(cfg.a || {});
  const bCalc = await calculate(cfg.b || {});
  if (!cfg.a.opponentsRecord && aCalc.record) cfg.a.opponentsRecord=aCalc.record;
  if (!cfg.a.opponentsPct && aCalc.pct) cfg.a.opponentsPct=aCalc.pct;
  if (!cfg.b.opponentsRecord && bCalc.record) cfg.b.opponentsRecord=bCalc.record;
  if (!cfg.b.opponentsPct && bCalc.pct) cfg.b.opponentsPct=bCalc.pct;

  let inner = match[2];
  inner = inner.replace(/<div class="fc-opponents">[\s\S]*?<\/div><\/div>(?=\s*<\/div>\s*$)/,'</div>');
  const markup = opponentMarkup(cfg.a || {},cfg.b || {});
  if (markup && !inner.includes('class="fc-opponents"')) {
    const tail = /<\/div><\/div>\s*$/;
    if (!tail.test(inner)) throw new Error(`Could not locate Tale shell tail in block ${blockNumber}`);
    inner = inner.replace(tail, markup + '</div></div>');
  }

  const encoded = encodeURIComponent(JSON.stringify(cfg));
  const rebuilt = '<section class="article-html-visual" data-writer-block="tale" data-writer-config="'+encoded+'">'+inner+'</section>';
  if (rebuilt !== match[0]) changed++;
  output += rebuilt;
  cursor = match.index + match[0].length;
  report.push({
    matchup:`${cfg.a?.name} vs ${cfg.b?.name}`,
    a:`${cfg.a?.opponentsRecord||'—'} ${cfg.a?.opponentsPct||''}`.trim(),
    b:`${cfg.b?.opponentsRecord||'—'} ${cfg.b?.opponentsPct||''}`.trim(),
    unresolved:[...(aCalc.unresolved||[]).map(name=>`${cfg.a?.name}: ${name}`),...(bCalc.unresolved||[]).map(name=>`${cfg.b?.name}: ${name}`)]
  });
}
output += source.slice(cursor);
if (!blockNumber) throw new Error('No Tale blocks found.');
await fs.writeFile(DRAFT_PATH,output);
console.log(JSON.stringify({blocks:blockNumber,changed,report},null,2));
