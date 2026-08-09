import { dateLabel, fighter, loadData, loadPortraitCache, mergePromotion, portraitFor, updatedLabel } from './upcoming-events-data.mjs';

const ORIGIN = 'https://pflmma.com';
const EVENTS_URL = `${ORIGIN}/events`;
const HOME_URL = `${ORIGIN}/`;
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/mma/pfl/scoreboard';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockPFLUpdater/3.5; +https://matlockfighttalk.com/)';
const MAX_DAYS = 240;
const MAIN_CARD_SIZE = 5;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = (s='') => s.replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(+x)).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
const text = (s='') => decode(s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const norm = (s='') => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const slugify = s => norm(s).replace(/\s+/g,'-');
const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const BAD_TEXT = /\b(?:main card|early card|event info|where to watch|matchups?|buy tickets?|register interest|view results?|hours?|minutes?|seconds?)\b/i;
const saneName = name => { const n=String(name||'').replace(/\s+/g,' ').trim(); return n.length>=2 && n.length<=60 && !BAD_TEXT.test(n) && !/\d{1,2}:\d{2}/.test(n); };
const saneVenue = value => { const v=String(value||'').replace(/\s+/g,' ').trim(); return v.length>=3 && v.length<=120 && !BAD_TEXT.test(v) && !/^d\s*:\s*h\s*:/i.test(v); };

const TAMPA_NAMES = new Map(Object.entries({
  cyborg:'Cris Cyborg', vieira:'Ketlen Vieira', rabadanov:'Gadzhi Rabadanov', kaszuba:'Jakub Kaszuba',
  oliveira:'Gustavo Oliveira', alves:'Marcirley Alves', trainer:'Luke Trainer', dunlap:'Roland Dunlap',
  magomedov:'Magomed Magomedov', marcos:'Daniel Marcos', santos:'Taila Santos', 'de sousa':'Sabrinna de Sousa',
  ibragimov:'Movsar Ibragimov', basharat:'Javid Basharat', bush:'Dakota Bush', forest:'Morquez Forest',
  schulte:'Natan Schulte', zaynukov:'Makkasharip Zaynukov', 'van steenis':'Gino van Steenis', watley:'Robert Watley',
  zendeli:'Florim Zendeli', chaaban:'Omran Chaaban', sheridan:'Eoin Sheridan', vake:'James Vake'
}));

async function get(url,json=false) {
  let last;
  for(let i=1;i<=3;i++) {
    try { const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(30000),headers:{'user-agent':UA,accept:json?'application/json,*/*':'text/html,*/*'}}); if(r.ok)return json?r.json():r.text(); last=new Error(`${r.status} ${r.statusText} for ${url}`); }
    catch(e){ last=e; }
    if(i<3) await sleep(700*i);
  }
  throw last;
}

function parseDate(value) {
  const m=String(value||'').match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i); if(!m)return null;
  let year=Number(m[3]||new Date().getUTCFullYear()), d=new Date(`${m[1]} ${m[2]}, ${year} 12:00:00 UTC`);
  if((d-Date.now())/86400000 < -120){ year++; d=new Date(`${m[1]} ${m[2]}, ${year} 12:00:00 UTC`); }
  return Number.isNaN(d.getTime())?null:d;
}
const isoDay=d=>d.toISOString().slice(0,10);

function discover(html) {
  const set=new Set(),src=decode(html).replaceAll('\\/','/');
  for(const m of src.matchAll(/href=["']([^"']*\/event\/pfl-[^"'?#]+)["']/gi)) try { const u=new URL(m[1],ORIGIN);u.search='';u.hash='';set.add(u.toString()); } catch {}
  return [...set];
}

function eventTitle(page,url) {
  const headings=[...page.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(m=>text(m[1])).filter(v=>/^PFL\s+/i.test(v));
  const slug=new URL(url).pathname.split('/').filter(Boolean).at(-1)?.replace(/^pfl-/i,'').replace(/-/g,' ')||'';
  const match=headings.find(v=>norm(v.replace(/^PFL\s+/i,''))===norm(slug));
  return match||headings[0]||`PFL ${slug}`.trim();
}

function weight(note='') {
  const m=note.match(/\b(Women'?s\s+(?:Strawweight|Flyweight|Bantamweight|Featherweight)|Light Heavyweight|Heavyweight|Middleweight|Welterweight|Lightweight|Featherweight|Bantamweight|Flyweight|Catchweight)\b/i);
  return m ? m[1].replace(/women'?s/i,"Women's") + (/title|championship|world title/i.test(note)?' Title':'') : 'Weight class TBA';
}

function expandOfficialName(name,url) {
  const clean=String(name||'').replace(/\s+/g,' ').trim();
  if(/\/event\/pfl-tampa\/?$/i.test(url)) return TAMPA_NAMES.get(norm(clean)) || clean;
  return clean;
}

function homepageBouts(homeHtml,date,url) {
  const plain=text(homeHtml);
  const marker=plain.match(/Upcoming Event\s+((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2})\s+\d{1,2}(?::\d{2})?\s*[AP]M\s*[A-Z]{2,4}/i);
  if(!marker)return [];
  const homeDate=parseDate(marker[1]);
  if(!homeDate||isoDay(homeDate)!==isoDay(date))return [];

  const start=plain.indexOf(marker[0])+marker[0].length;
  let block=plain.slice(start,start+5000);
  block=block.split(/\b(?:BUY TICKETS|VIEW MATCHUPS)\b/i)[0].trim();
  if(!block)return [];

  const division="PFL Women's Featherweight World Title|Women's Featherweight World Title|Women's Strawweight|Women's Flyweight|Women's Bantamweight|Women's Featherweight|Light Heavyweight|Heavyweight|Middleweight|Welterweight|Lightweight|Featherweight|Bantamweight|Flyweight|Catchweight";
  const rx=new RegExp(`(.+?)\\s+vs\\s+(.+?)\\s+(${division})(?=\\s|$)`,'gi');
  const out=[],seen=new Set();
  for(const m of block.matchAll(rx)) {
    const a=expandOfficialName(m[1],url), b=expandOfficialName(m[2],url), div=weight(m[3]);
    if(!saneName(a)||!saneName(b))continue;
    const key=[norm(a),norm(b),norm(div)].join('|');
    if(seen.has(key))continue;
    seen.add(key);
    out.push({division:div,fighters:[{name:a,image:''},{name:b,image:''}]});
  }
  return out;
}

async function espnBouts(date) {
  try {
    const j=await get(`${ESPN}?dates=${isoDay(date).replaceAll('-','')}&limit=100`,true), candidates=(j?.events||[]).filter(e=>Array.isArray(e.competitions));
    const e=candidates.sort((a,b)=>(b.competitions?.length||0)-(a.competitions?.length||0))[0]; if(!e)return [];
    const out=[];
    for(const c of e.competitions||[]) {
      const cs=c.competitors||[]; if(cs.length<2)continue;
      const fighters=cs.slice(0,2).map(z=>{const a=z.athlete||z.team||{};return{name:a.displayName||a.fullName||a.shortName||z.displayName||'',image:a.headshot?.href||(a.id?`https://a.espncdn.com/i/headshots/mma/players/full/${a.id}.png`:'')};});
      if(!fighters.every(f=>saneName(f.name)))continue;
      const note=[c.type?.text,...(c.notes||[]).map(n=>n?.headline||n?.text||'')].filter(Boolean).join(' ');
      out.push({division:weight(note),fighters});
    }
    return out;
  } catch { return []; }
}

function fallbackBouts(url) {
  if(!/\/event\/pfl-tampa\/?$/i.test(url)) return [];
  // Protected copy of the current official PFL homepage lineup. The live PFL
  // homepage parser remains first priority; this prevents source-delivery issues
  // from collapsing Tampa back to only the two ESPN-listed fights.
  return [
    {division:"Women's Featherweight Title",fighters:[{name:'Cris Cyborg',image:''},{name:'Ketlen Vieira',image:''}]},
    {division:'Lightweight',fighters:[{name:'Gadzhi Rabadanov',image:''},{name:'Jakub Kaszuba',image:''}]},
    {division:'Bantamweight',fighters:[{name:'Gustavo Oliveira',image:''},{name:'Marcirley Alves',image:''}]},
    {division:'Light Heavyweight',fighters:[{name:'Luke Trainer',image:''},{name:'Roland Dunlap',image:''}]},
    {division:'Bantamweight',fighters:[{name:'Magomed Magomedov',image:''},{name:'Daniel Marcos',image:''}]},
    {division:"Women's Flyweight",fighters:[{name:'Taila Santos',image:''},{name:'Sabrinna de Sousa',image:''}]},
    {division:'Bantamweight',fighters:[{name:'Movsar Ibragimov',image:''},{name:'Javid Basharat',image:''}]},
    {division:'Lightweight',fighters:[{name:'Dakota Bush',image:''},{name:'Morquez Forest',image:''}]},
    {division:'Lightweight',fighters:[{name:'Natan Schulte',image:''},{name:'Makkasharip Zaynukov',image:''}]},
    {division:'Lightweight',fighters:[{name:'Gino van Steenis',image:''},{name:'Robert Watley',image:''}]},
    {division:'Welterweight',fighters:[{name:'Florim Zendeli',image:''},{name:'Omran Chaaban',image:''}]},
    {division:'Welterweight',fighters:[{name:'Eoin Sheridan',image:''},{name:'James Vake',image:''}]}
  ];
}

function venueFromIndex(eventsHtml,eventName) {
  const plain=text(eventsHtml), wanted=reEsc(eventName), rx=new RegExp(`(?:PFL\\s+)?${wanted}`,'ig');
  for(const m of plain.matchAll(rx)) {
    const after=plain.slice(m.index+m[0].length,m.index+m[0].length+180).trim();
    const candidate=after.split(/\s+(?:MATCHUPS|BUY TICKETS|EVENT DETAILS|REGISTER INTEREST|VIEW RESULTS)\b/i)[0].trim();
    if(!saneVenue(candidate))continue;
    if(/^(?:d\s*:\s*h|Sat|Sun|Mon|Tue|Wed|Thu|Fri)\b/i.test(candidate))continue;
    if(/\b(?:Early Card|Main Card|EVENT INFO|WHERE TO WATCH)\b/i.test(candidate))continue;
    return candidate;
  }
  return 'Venue TBA';
}

async function build(url,eventsHtml,homeHtml) {
  const page=await get(url), plain=text(page), title=eventTitle(page,url);
  const date=parseDate((plain.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?/i)||[])[0]||(plain.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?/i)||[])[0]);
  if(!date)return null; const days=(date-Date.now())/86400000; if(days<-1||days>MAX_DAYS)return null;
  const main=((plain.match(/Main Card\s+(\d{1,2}(?::\d{2})?\s*[AP]M\s*ET)/i)||[])[1]||'').toUpperCase();
  const early=((plain.match(/Early Card\s+(\d{1,2}(?::\d{2})?\s*[AP]M\s*ET)/i)||[])[1]||'').toUpperCase();
  const eventName=title.replace(/^PFL\s*/i,'').trim();
  const venue=venueFromIndex(eventsHtml,eventName);
  const official=homepageBouts(homeHtml,date,url);
  const espn=await espnBouts(date);
  let card=official.length>espn.length?official:espn;
  if(card.length < 3)card=fallbackBouts(url);
  card=card.filter(b=>b.fighters?.length===2&&b.fighters.every(f=>saneName(f.name)));
  if(!card.length)return null;
  if(venue==='Venue TBA'&&card.length===1)return null;
  return{url,title,date,venue,main,early,bouts:card,cardSource:official.length>espn.length?'pfl-home':card.length>espn.length?'fallback':'espn'};
}

const data=await loadData(),cache=await loadPortraitCache(),previous=data.events.filter(e=>e.promotion_key==='pfl');
let eventsHtml,homeHtml;
try{eventsHtml=await get(EVENTS_URL);}catch(error){console.warn(`PFL events page unavailable: ${error.message}`);process.exit(0);}
try{homeHtml=await get(HOME_URL);}catch(error){console.warn(`PFL homepage unavailable: ${error.message}`);homeHtml='';}
const urls=discover(eventsHtml); if(!urls.includes('https://pflmma.com/event/pfl-tampa'))urls.push('https://pflmma.com/event/pfl-tampa');
const built=[]; for(const url of urls)try{const e=await build(url,eventsHtml,homeHtml);if(e)built.push(e);}catch(error){console.warn(`PFL skip ${url}: ${error.message}`);}
if(!built.length){console.warn('No usable PFL events; preserving existing PFL data.');process.exit(0);}

const candidates=built.map(e=>{
  const date=isoDay(e.date),name=e.title.replace(/^PFL\s*/i,'').trim()||'Fight Card';
  const allBouts=e.bouts.map((b,i)=>({order:i+1,label:i===0?'Main Event':i===1?'Co-Main Event':'',weight_class:b.division,fighters:b.fighters.map(x=>fighter(x.name,x.image?{image:x.image,image_source:'espn',image_framing:'standard'}:portraitFor(x.name,previous,cache)))}));
  const split=e.early&&allBouts.length>MAIN_CARD_SIZE?MAIN_CARD_SIZE:allBouts.length;
  const mainBouts=allBouts.slice(0,split);
  const earlyBouts=allBouts.slice(split).map(b=>({...b,label:''}));
  const sections=[{kind:'main',title:'Main Card',time:e.main||'Time TBA',bouts:mainBouts}];
  if(e.early)sections.push({kind:'prelims',title:'Early Card',time:e.early,bouts:earlyBouts});
  return{id:`pfl-${slugify(name)}-${date}`,promotion_key:'pfl',promotion:'PFL',title:name,date,date_label:dateLabel(date),venue:e.venue,broadcast:'ESPN',official_url:e.url,updated_label:updatedLabel(),sections};
});

await mergePromotion('pfl',candidates,{maxEventDrop:1,maxBoutDrop:3});
