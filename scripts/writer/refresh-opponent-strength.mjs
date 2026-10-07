import fs from 'node:fs/promises';
import { parseSherdogCareerProfile } from '../../_netlify-auth/netlify/functions/_writer-career-fallback.mjs';

const POST_PATH_INPUT = String(process.env.WRITER_STRENGTH_POST || '').trim();
const CACHE_PATH = 'assets/data/writer-opponent-strength.json';
const WRITER_PATH = 'assets/data/writer-fighters.json';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockOpponentStrength/1.0; +https://mmamatlock.com/write/)';
const MAX_RECORD_AGE_MS = 6 * 86400000;
const SHERDOG_EVENT_URL_INPUT = String(process.env.SHERDOG_EVENT_URL || '').trim();
const SHERDOG_UPCOMING_URL = 'https://www.sherdog.com/organizations/Ultimate-Fighting-Championship-UFC-2/upcoming-events/0';
const HISTORY_ALIASES = new Map([
  ['benardo sopaj','Bernardo Sopai'],
  ['ateba gautier','Ateba Abega Gautier'],
  ['khaos williams','Kalinn Williams'],
  ['bobby green','King Green'],
  ['ramazan temirov','Ramazonbek Temirov'],
  ['cam rowston','Cameron Rowston']
]);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalize(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/['’]/g,'')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ').trim();
}

function dataKey(value) {
  return normalize(value).replace(/\s+/g,'');
}

function slugify(value) {
  return normalize(value).replace(/\s+/g,'-');
}

function editDistance(a,b) {
  const left=String(a||''), right=String(b||'');
  const row=Array.from({length:right.length+1},(_,i)=>i);
  for(let i=1;i<=left.length;i++){
    let prev=row[0]; row[0]=i;
    for(let j=1;j<=right.length;j++){
      const hold=row[j];
      row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(left[i-1]===right[j-1]?0:1));
      prev=hold;
    }
  }
  return row[right.length];
}

function likelySameName(a,b) {
  const left=normalize(a), right=normalize(b);
  if(!left||!right) return false;
  if(left===right) return true;
  const lt=left.split(' '), rt=right.split(' ');
  if(lt.length===rt.length && [...lt].sort().join(' ')===[...rt].sort().join(' ')) return true;
  if(lt.length!==rt.length || lt.length<2) return false;
  return lt.every((token,index)=>token.length>=4 && rt[index].length>=4 && editDistance(token,rt[index])<=1);
}

function parseRecord(value) {
  const m=String(value||'').match(/\b(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);
  return m ? {wins:Number(m[1]),losses:Number(m[2]),draws:Number(m[3]||0)} : null;
}

function decode(value) {
  return String(value||'')
    .replace(/&#x([0-9a-f]+);/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16)))
    .replace(/&#(\d+);/g,(_,dec)=>String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"').replace(/&#0?39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
}

function text(value) {
  return decode(String(value||'').replace(/<script\b[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
}

async function fetchText(url,{attempts=2,timeout=9000}={}) {
  let lastError;
  for(let attempt=0;attempt<attempts;attempt++){
    try {
      const response=await fetch(url,{
        redirect:'follow',
        signal:AbortSignal.timeout(timeout),
        headers:{'user-agent':UA,accept:'text/html,application/xhtml+xml,*/*;q=0.8'}
      });
      if(response.ok) return await response.text();
      const error=new Error('HTTP '+response.status+' '+url);
      error.status=response.status;
      if(response.status===404) throw error;
      lastError=error;
    } catch(error) {
      if(error?.status===404) throw error;
      lastError=error;
    }
    if(attempt<attempts-1) await sleep(300*(attempt+1));
  }
  throw lastError || new Error('Request failed: '+url);
}

function absoluteSherdogUrl(href) {
  try { return new URL(href,'https://www.sherdog.com').toString(); } catch { return null; }
}

function parseSherdogEventFighters(html) {
  const found=[];
  const seen=new Set();
  for(const match of String(html||'').matchAll(/<a\b[^>]*href=["'](\/fighter\/[a-z0-9][a-z0-9-]*-\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const href=absoluteSherdogUrl(match[1]);
    const label=text(match[2]);
    if(!href||!label||seen.has(href)) continue;
    seen.add(href);
    found.push({href,label});
  }
  return found;
}

function targetAlias(name) {
  return HISTORY_ALIASES.get(normalize(name)) || name;
}

function matchEventFighter(entries,name) {
  const alias=targetAlias(name);
  return entries.find(entry=>normalize(entry.label)===normalize(name)) ||
    entries.find(entry=>normalize(entry.label)===normalize(alias)) ||
    entries.find(entry=>likelySameName(entry.label,name)) ||
    entries.find(entry=>likelySameName(entry.label,alias)) ||
    null;
}

async function sherdogHistoryLookup(url,expectedName) {
  let html;
  try { html=await fetchText(url,{attempts:3,timeout:12000}); } catch { return null; }
  const profile=parseSherdogCareerProfile(html,url);
  if(!profile?.name) return null;
  const alias=targetAlias(expectedName);
  if(!likelySameName(profile.name,expectedName) && !likelySameName(profile.name,alias)) return null;
  return profile;
}

async function sherdogRecordLookup(url,expectedName) {
  let html;
  try { html=await fetchText(url,{attempts:3,timeout:12000}); } catch { return null; }
  const clean=text(html);
  const name=text(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || expectedName);
  const wins=clean.match(/\bWins\s+(\d+)\b/i);
  const losses=clean.match(/\bLosses\s+(\d+)\b/i);
  if(!wins||!losses) return null;
  const draws=clean.match(/\bDraws?\s+(\d+)\b/i);
  return {
    name:name||expectedName,
    record:wins[1]+'-'+losses[1]+'-'+(draws?.[1]||0),
    source:'Sherdog',
    sourceUrl:url
  };
}

async function readJson(path,fallback) {
  try { return JSON.parse(await fs.readFile(path,'utf8')); } catch { return fallback; }
}

async function resolvePostPath(input) {
  if(input) return input;
  const names=(await fs.readdir('_posts'))
    .filter(name=>/\.md$/i.test(name))
    .sort()
    .reverse();
  for(const name of names){
    const path='_posts/'+name;
    let source='';
    try { source=await fs.readFile(path,'utf8'); } catch { continue; }
    if(!source.includes('data-writer-block="tale"')) continue;
    if(/^published:\s*false\s*$/mi.test(source)) return path;
  }
  return null;
}

function parseSherdogEventLinks(html) {
  const out=[];
  const seen=new Set();
  for(const match of String(html||'').matchAll(/<a\b[^>]*href=["'](\/events\/[a-z0-9][^"'?#]*-\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    const href=absoluteSherdogUrl(match[1]);
    const label=text(match[2]);
    if(!href||seen.has(href)) continue;
    seen.add(href);
    out.push({href,label});
  }
  return out.slice(0,20);
}

async function discoverSherdogEventUrl(targetNames) {
  const indexHtml=await fetchText(SHERDOG_UPCOMING_URL,{attempts:3,timeout:15000});
  const candidates=parseSherdogEventLinks(indexHtml);
  if(!candidates.length) throw new Error('Sherdog upcoming-events page exposed no event links.');

  let best=null;
  await mapLimit(candidates,3,async candidate=>{
    await sleep(60);
    let html;
    try { html=await fetchText(candidate.href,{attempts:2,timeout:12000}); } catch { return; }
    const entries=parseSherdogEventFighters(html);
    const matched=targetNames.filter(name=>matchEventFighter(entries,name)).length;
    if(!best || matched>best.matched) best={...candidate,matched,total:entries.length};
  });
  const required=Math.min(6,Math.max(2,Math.ceil(targetNames.length*0.4)));
  if(!best || best.matched<required){
    throw new Error('Could not match draft fighters to a Sherdog upcoming event; best match was '+(best?.matched||0)+'/'+targetNames.length+'.');
  }
  console.log('Matched Sherdog event: '+best.href+' ('+best.matched+'/'+targetNames.length+' draft fighters)');
  return best.href;
}

async function mapLimit(items,limit,worker) {
  const results=new Array(items.length);
  let cursor=0;
  async function run(){
    while(true){
      const index=cursor++;
      if(index>=items.length) return;
      results[index]=await worker(items[index],index);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length||1)},run));
  return results;
}

function extractTaleConfigs(markdown) {
  const fights=[];
  for(const match of markdown.matchAll(/<section class="article-html-visual" data-writer-block="tale" data-writer-config="([^"]+)">[\s\S]*?<\/section>/g)){
    const config=JSON.parse(decodeURIComponent(match[1]));
    fights.push(config);
  }
  return fights;
}

function formatDate(value) {
  if(!value) return '';
  const date=new Date(String(value).length===10 ? value+'T12:00:00Z' : value);
  if(Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
}

function recentRows(history) {
  return (history||[]).slice(0,5).map(fight=>({
    result:String(fight.result||'').toUpperCase(),
    opponent:fight.opponent || fight.opponentName || '',
    detail:[fight.method||'',formatDate(fight.date)].filter(Boolean).join(' · ')
  })).filter(row=>row.result||row.opponent);
}

function lastFive(rows) {
  const counts={W:0,L:0,D:0,NC:0};
  for(const row of (rows||[]).slice(0,5)){
    const result=String(row.result||'').toUpperCase();
    if(Object.hasOwn(counts,result)) counts[result]++;
  }
  if(!Object.values(counts).some(Boolean)) return '';
  let value=counts.W+'-'+counts.L;
  if(counts.D) value+='-'+counts.D;
  if(counts.NC) value+=', '+counts.NC+' NC';
  return value;
}

function escapeHtml(value) {
  return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function portrait(fighter) {
  const p=fighter?.portrait||{};
  return {
    x:Number.isFinite(+p.x)?+p.x:50,
    y:Number.isFinite(+p.y)?+p.y:50,
    zoom:Number.isFinite(+p.zoom)?+p.zoom:100
  };
}

function recentMarkup(rows) {
  return (rows||[]).map(row=>{
    const result=String(row.result||'').toUpperCase();
    const resultClass=result==='W'?'win':result==='L'?'loss':'draw';
    return '<div class="fc-form-row"><span class="fc-result '+resultClass+'">'+escapeHtml(result||'—')+
      '</span><div class="fc-form-copy"><strong>'+escapeHtml(row.opponent||'')+
      '</strong><small>'+escapeHtml(row.detail||'')+'</small></div></div>';
  }).join('');
}

function portraitMarkup(side,fighter) {
  const p=portrait(fighter);
  const image=String(fighter?.image||'').trim();
  return '<div class="fc-portrait ring-'+side+'" data-portrait-side="'+(side==='left'?'a':'b')+'">'+
    '<span class="fc-ring"></span><span class="fc-ring fc-ring-inner"></span>'+
    (image?'<img class="fc-portrait-source" data-portrait-source src="'+escapeHtml(image)+'" alt="'+escapeHtml(fighter?.name||'')+
      '" data-portrait-x="'+p.x+'" data-portrait-y="'+p.y+'" data-portrait-zoom="'+p.zoom+'">':'')+
    '</div>';
}

function topMarkup(side,fighter) {
  const odds=String(fighter?.odds||'').trim()||'—';
  const oddsClass=side==='left'?' fc-red-odds':' fc-blue-odds';
  const liveSide=side==='left'?'a':'b';
  return '<div class="fc-fighter fc-'+side+'">'+portraitMarkup(side,fighter)+
    '<div class="fc-meta"><span class="fc-division">'+escapeHtml(fighter?.division||'')+
    '</span><h2>'+escapeHtml(fighter?.name||'')+
    '</h2><div class="fc-meta-strip"><div class="fc-odds'+oddsClass+'" data-live-odds-side="'+liveSide+
    '" data-live-odds-fighter="'+escapeHtml(fighter?.name||'')+'" data-live-odds-state="pending"><span>ML</span><strong data-live-odds-value>'+
    escapeHtml(odds)+'</strong></div><div class="fc-last5"><span class="fc-last5-record">'+
    escapeHtml(fighter?.last5||'—')+'</span><span class="fc-last5-label">Last 5</span></div></div></div></div>';
}

function buildTale(config) {
  const a=config.a||{}, b=config.b||{}, rows=config.rows||[];
  const taleRows=rows.map((row,index)=>
    '<div class="fc-tale-row'+(index===0?' featured':'')+'"><strong>'+escapeHtml(row.a||'—')+
    '</strong><span>'+escapeHtml(row.label||'')+'</span><strong>'+escapeHtml(row.b||'—')+'</strong></div>'
  ).join('');
  const recentA=recentMarkup(a.recent), recentB=recentMarkup(b.recent);
  const recent=recentA||recentB
    ? '<div class="fc-form-section"><div class="fc-section-title fc-form-title"><span>Recent Form</span></div>'+
      '<div class="fc-form-wrap"><div class="fc-column"><div class="fc-mobile-column-label"><span>RECENT FORM</span><strong>'+
      escapeHtml(a.name||'Fighter A')+'</strong></div>'+recentA+
      '</div><div class="fc-column"><div class="fc-mobile-column-label"><span>RECENT FORM</span><strong>'+
      escapeHtml(b.name||'Fighter B')+'</strong></div>'+recentB+'</div></div></div>'
    : '';
  const opponents=(a.opponentsRecord||b.opponentsRecord||a.opponentsPct||b.opponentsPct)
    ? '<div class="fc-opponents"><div class="fc-opponent-stat"><strong>'+escapeHtml(a.opponentsRecord||'—')+
      '</strong><span>'+escapeHtml(a.opponentsPct||'')+'</span></div><div class="fc-opponent-label">OPPONENTS COMBINED RECORD</div>'+
      '<div class="fc-opponent-stat"><strong>'+escapeHtml(b.opponentsRecord||'—')+'</strong><span>'+
      escapeHtml(b.opponentsPct||'')+'</span></div></div>'
    : '';
  const eventDate=String(config.eventDate||a.source?.bookingDate||b.source?.bookingDate||'').trim();
  const inner='<div class="fight-compare-sleek" data-live-odds-matchup data-live-odds-fighter-a="'+escapeHtml(a.name||'')+
    '" data-live-odds-fighter-b="'+escapeHtml(b.name||'')+'" data-live-odds-event-date="'+escapeHtml(eventDate)+'"><div class="fc-shell">'+
    '<div class="fc-top">'+topMarkup('left',a)+
    '<div class="fc-center-badge"><strong>MATCHUP</strong><i></i></div>'+topMarkup('right',b)+'</div>'+
    '<div class="fc-tale"><div class="fc-section-title"><span>Tale of the Tape</span></div>'+taleRows+'</div>'+
    recent+opponents+'</div></div>';
  return '<section class="article-html-visual" data-writer-block="tale" data-writer-config="'+
    encodeURIComponent(JSON.stringify(config))+'">\n'+inner+'\n</section>';
}

const POST_PATH=await resolvePostPath(POST_PATH_INPUT);
if(!POST_PATH){
  console.log('No Tale-based article draft found; nothing to refresh.');
  process.exit(0);
}
console.log('Opponent-strength article: '+POST_PATH);
const markdown=await fs.readFile(POST_PATH,'utf8');
const configs=extractTaleConfigs(markdown);
if(!configs.length) throw new Error('No Tale blocks found in '+POST_PATH);

const writerData=await readJson(WRITER_PATH,{fighters:[]});
const directory=new Map((writerData.fighters||[]).map(fighter=>[normalize(fighter.name),fighter]));
const targetNames=[...new Set(configs.flatMap(config=>[config.a?.name,config.b?.name]).filter(Boolean))];
console.log('Refreshing all-career opponent strength for '+targetNames.length+' fighters.');

const profiles=new Map();
const SHERDOG_EVENT_URL=SHERDOG_EVENT_URL_INPUT || await discoverSherdogEventUrl(targetNames);
const eventHtml=await fetchText(SHERDOG_EVENT_URL,{attempts:3,timeout:15000});
const eventFighters=parseSherdogEventFighters(eventHtml);
if(eventFighters.length<20) throw new Error('Sherdog event page exposed only '+eventFighters.length+' fighter links.');

await mapLimit(targetNames,3,async name=>{
  const eventFighter=matchEventFighter(eventFighters,name);
  if(!eventFighter) throw new Error('Sherdog event profile link unavailable for '+name);
  await sleep(90);
  const profile=await sherdogHistoryLookup(eventFighter.href,name);
  if(!profile?.historyComplete || !Array.isArray(profile.history) || !profile.history.length){
    throw new Error('Complete Sherdog professional history unavailable for '+name);
  }
  profiles.set(normalize(name),profile);
  console.log('History '+name+': '+profile.history.length+' pro bouts via Sherdog ['+eventFighter.href+']');
});
const existing=await readJson(CACHE_PATH,{schemaVersion:1,updatedAt:null,fighters:{},opponents:{}});
existing.schemaVersion=1;
existing.fighters ||= {};
existing.opponents ||= {};
const now=Date.now();
const opponentTargets=new Map();
for(const profile of profiles.values()){
  for(const fight of profile.history){
    const name=String(fight.opponent||'').trim();
    const url=fight.opponentSourceUrl || null;
    if(!name) continue;
    const key=url || normalize(name);
    if(!opponentTargets.has(key)) opponentTargets.set(key,{name,url});
  }
}
console.log('Resolving '+opponentTargets.size+' unique opponent records from direct Sherdog profiles.');

const opponentRecords=new Map();
const unresolved=[];
await mapLimit([...opponentTargets.values()],4,async target=>{
  const name=target.name;
  const cacheKey=normalize(name);
  const cached=existing.opponents[cacheKey];
  if(cached?.record && cached?.sourceUrl===target.url && Date.now()-Date.parse(cached.checkedAt||0)<MAX_RECORD_AGE_MS){
    opponentRecords.set(cacheKey,cached);
    return;
  }

  await sleep(70);
  let hit=target.url ? await sherdogRecordLookup(target.url,name) : null;
  if(!parseRecord(hit?.record)){
    unresolved.push(name+(target.url?' ['+target.url+']':''));
    return;
  }
  const entry={...hit,name,checkedAt:new Date().toISOString()};
  existing.opponents[cacheKey]=entry;
  opponentRecords.set(cacheKey,entry);
});

if(unresolved.length){
  throw new Error('Unresolved opponent records ('+unresolved.length+'): '+unresolved.sort().join(', '));
}
const strengthByName=new Map();
for(const name of targetNames){
  const profile=profiles.get(normalize(name));
  const records=profile.history.map(fight=>opponentRecords.get(normalize(fight.opponent)));
  if(records.some(record=>!record)) throw new Error('Partial opponent record set for '+name);
  const parsed=records.map(record=>parseRecord(record.record));
  const wins=parsed.reduce((sum,row)=>sum+row.wins,0);
  const losses=parsed.reduce((sum,row)=>sum+row.losses,0);
  const draws=parsed.reduce((sum,row)=>sum+row.draws,0);
  const denominator=wins+losses;
  if(!denominator) throw new Error('No opponent W/L denominator for '+name);
  const strength={
    record:wins+'-'+losses,
    winPct:Math.round(wins/denominator*100),
    wins,losses,draws,
    bouts:profile.history.length,
    uniqueOpponents:new Set(profile.history.map(fight=>normalize(fight.opponent))).size,
    checkedAt:new Date().toISOString(),
    complete:true
  };
  strengthByName.set(normalize(name),strength);
  existing.fighters[dataKey(name)]={
    name,
    record:profile.record||null,
    checkedAt:new Date().toISOString(),
    source:profile.source||null,
    sourceUrl:profile.sourceUrl||null,
    historyComplete:true,
    history:profile.history,
    recent:profile.history.slice(0,5),
    opponentStrength:strength
  };
  console.log(name+': '+strength.record+' / '+strength.winPct+'% ('+strength.bouts+' bouts)');
}
existing.updatedAt=new Date().toISOString();
existing.lastRefresh={postPath:POST_PATH,eventUrl:SHERDOG_EVENT_URL,checkedAt:existing.updatedAt};
await fs.writeFile(CACHE_PATH,JSON.stringify(existing,null,2)+'\n');

let changed=0;
const updatedMarkdown=markdown.replace(
  /<section class="article-html-visual" data-writer-block="tale" data-writer-config="([^"]+)">[\s\S]*?<\/section>/g,
  (whole,encoded)=>{
    const config=JSON.parse(decodeURIComponent(encoded));
    let touched=false;
    for(const side of ['a','b']){
      const fighter=config[side];
      const cached=existing.fighters[dataKey(fighter?.name)];
      if(!fighter||!cached) continue;
      const recent=recentRows(cached.history);
      fighter.recent=recent;
      fighter.last5=lastFive(recent);
      fighter.opponentsRecord=cached.opponentStrength.record;
      fighter.opponentsPct=cached.opponentStrength.winPct+'%';
      touched=true;
    }
    if(!touched) return whole;
    changed++;
    return buildTale(config);
  }
);
if(changed!==configs.length) throw new Error('Expected '+configs.length+' Tale blocks updated; got '+changed);
await fs.writeFile(POST_PATH,updatedMarkdown);

console.log('Updated '+changed+' Tale blocks and '+targetNames.length+' cached fighter strength profiles.');
