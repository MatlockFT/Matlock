import { dateLabel, fighter, loadData, loadPortraitCache, mergePromotion, portraitFor, updatedLabel } from './upcoming-events-data.mjs';

const ORIGIN = 'https://pflmma.com';
const EVENTS_URL = `${ORIGIN}/events`;
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/mma/pfl/scoreboard';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockPFLUpdater/3.0; +https://matlockfighttalk.com/)';
const MAX_DAYS = 240;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = (s='') => s.replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(+x)).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
const text = (s='') => decode(s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const norm = (s='') => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const slugify = s => norm(s).replace(/\s+/g,'-');
const BAD_TEXT = /\b(?:main card|early card|event info|where to watch|matchups?|buy tickets?|register interest|view results?|hours?|minutes?|seconds?)\b/i;
const saneName = name => { const n=String(name||'').replace(/\s+/g,' ').trim(); return n.length>=2 && n.length<=60 && !BAD_TEXT.test(n) && !/\d{1,2}:\d{2}/.test(n); };
const saneVenue = value => { const v=String(value||'').replace(/\s+/g,' ').trim(); return v.length>=3 && v.length<=120 && !BAD_TEXT.test(v) && !/^d\s*:\s*h\s*:/i.test(v); };

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

function weight(note='') {
  const m=note.match(/\b(Women'?s\s+(?:Strawweight|Flyweight|Bantamweight|Featherweight)|Light Heavyweight|Heavyweight|Middleweight|Welterweight|Lightweight|Featherweight|Bantamweight|Flyweight|Catchweight)\b/i);
  return m ? m[1].replace(/women'?s/i,"Women's") + (/title|championship/i.test(note)?' Title':'') : 'Weight class TBA';
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

function fallbackBouts(url,page) {
  if(!/\/event\/pfl-tampa\/?$/i.test(url)) return [];
  return [
    {division:"Women's Featherweight Title",fighters:[{name:'Cris Cyborg',image:''},{name:'Ketlen Vieira',image:''}]},
    {division:'Lightweight',fighters:[{name:'Gadzhi Rabadanov',image:''},{name:'Jakub Kaszuba',image:''}]}
  ];
}

async function build(url,eventsHtml) {
  const page=await get(url), plain=text(page);
  const title=(plain.match(/\bPFL\s+[A-Z][A-Za-z .'-]{2,50}\b/)||[])[0]||'PFL Event';
  const date=parseDate((plain.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?/i)||[])[0]||(plain.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?/i)||[])[0]);
  if(!date)return null; const days=(date-Date.now())/86400000; if(days<-1||days>MAX_DAYS)return null;
  const main=((plain.match(/Main Card\s+(\d{1,2}(?::\d{2})?\s*[AP]M\s*ET)/i)||[])[1]||'').toUpperCase();
  const early=((plain.match(/Early Card\s+(\d{1,2}(?::\d{2})?\s*[AP]M\s*ET)/i)||[])[1]||'').toUpperCase();
  let venue='Venue TBA', eventName=title.replace(/^PFL\s*/i,'').trim(), around=text(eventsHtml);
  const lm=around.match(new RegExp(`PFL\\s+${eventName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s+([^|]{3,100}?)(?=\\s+(?:MATCHUPS|BUY TICKETS|EVENT DETAILS|REGISTER INTEREST|VIEW RESULTS|$))`,'i'));
  if(lm&&saneVenue(lm[1]))venue=lm[1].trim();
  let card=await espnBouts(date); if(!card.length)card=fallbackBouts(url,page); card=card.filter(b=>b.fighters?.length===2&&b.fighters.every(f=>saneName(f.name))); if(!card.length)return null;
  if(venue==='Venue TBA'&&card.length===1)return null;
  return{url,title,date,venue,main,early,bouts:card};
}

const data=await loadData(),cache=await loadPortraitCache(),previous=data.events.filter(e=>e.promotion_key==='pfl');
let eventsHtml; try{eventsHtml=await get(EVENTS_URL);}catch(error){console.warn(`PFL events page unavailable: ${error.message}`);process.exit(0);}
const urls=discover(eventsHtml); if(!urls.includes('https://pflmma.com/event/pfl-tampa'))urls.push('https://pflmma.com/event/pfl-tampa');
const built=[]; for(const url of urls)try{const e=await build(url,eventsHtml);if(e)built.push(e);}catch(error){console.warn(`PFL skip ${url}: ${error.message}`);}
if(!built.length){console.warn('No usable PFL events; preserving existing PFL data.');process.exit(0);}

const candidates=built.map(e=>{
  const date=isoDay(e.date),name=e.title.replace(/^PFL\s*/i,'').trim()||'Fight Card';
  const bouts=e.bouts.map((b,i)=>({order:i+1,label:i===0?'Main Event':i===1?'Co-Main Event':'',weight_class:b.division,fighters:b.fighters.map(x=>fighter(x.name,x.image?{image:x.image,image_source:'espn',image_framing:'standard'}:portraitFor(x.name,previous,cache)))}));
  const sections=[{kind:'main',title:'Main Card',time:e.main||'Time TBA',bouts}];
  if(e.early)sections.push({kind:'prelims',title:'Early Card',time:e.early,bouts:[]});
  return{id:`pfl-${slugify(name)}-${date}`,promotion_key:'pfl',promotion:'PFL',title:name,date,date_label:dateLabel(date),venue:e.venue,broadcast:'ESPN',official_url:e.url,updated_label:updatedLabel(),sections};
});

await mergePromotion('pfl',candidates,{maxEventDrop:1,maxBoutDrop:3});
