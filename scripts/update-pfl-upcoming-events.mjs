import fs from 'node:fs/promises';

const TARGET = 'upcoming-events.html';
const PFL_EVENTS = 'https://pflmma.com/events';
const PFL_ORIGIN = 'https://pflmma.com';
const ESPN_PFL = 'https://site.api.espn.com/apis/site/v2/sports/mma/pfl/scoreboard';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockPFLUpdater/1.0; +https://matlockfighttalk.com/)';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = (s='') => s.replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(+x)).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
const text = (s='') => decode(s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const esc = (s='') => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const norm = (s='') => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const initials = name => name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase() || '?';

async function get(url, json=false){
  let last;
  for(let i=1;i<=3;i++){
    try{
      const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(30000),headers:{'user-agent':UA,accept:json?'application/json,*/*':'text/html,*/*'}});
      if(r.ok)return json?r.json():r.text();
      last=new Error(`${r.status} ${r.statusText} for ${url}`);
    }catch(e){last=e;}
    if(i<3)await sleep(i*700);
  }
  throw last;
}

function parseDate(value){
  const m=String(value||'').match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i);
  if(!m)return null;
  let year=Number(m[3]||new Date().getUTCFullYear());
  let d=new Date(`${m[1]} ${m[2]}, ${year} 12:00:00 UTC`);
  if((d-Date.now())/86400000 < -120){year++;d=new Date(`${m[1]} ${m[2]}, ${year} 12:00:00 UTC`);}
  return Number.isNaN(d.getTime())?null:d;
}
function isoDay(d){return d.toISOString().slice(0,10);}
function labelDay(d){return new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(d).replace(/^(\w+), /,'$1 · ');}
function updateDate(){return new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'America/Chicago'}).format(new Date());}

function discoverEventUrls(html){
  const set=new Set();
  const decoded=decode(html).replaceAll('\\/','/');
  for(const m of decoded.matchAll(/href=["']([^"']*\/event\/pfl-[^"'?#]+)["']/gi)){
    try{const u=new URL(m[1],PFL_ORIGIN);u.search='';u.hash='';set.add(u.toString());}catch{}
  }
  return [...set];
}

async function espnBouts(date){
  try{
    const j=await get(`${ESPN_PFL}?dates=${isoDay(date).replaceAll('-','')}&limit=100`,true);
    const e=(j?.events||[])[0];
    if(!e)return [];
    const out=[];
    for(const c of e.competitions||[]){
      const cs=c.competitors||[]; if(cs.length<2)continue;
      const fighters=cs.slice(0,2).map(z=>{const a=z.athlete||z.team||{};const name=a.displayName||a.fullName||a.shortName||z.displayName||'';return{name,image:a.headshot?.href||(a.id?`https://a.espncdn.com/i/headshots/mma/players/full/${a.id}.png`:'' )};});
      if(!fighters.every(f=>f.name))continue;
      const note=[c.type?.text,...(c.notes||[]).map(n=>n?.headline||n?.text||'')].filter(Boolean).join(' ');
      let division='Weight class TBA';
      const w=note.match(/\b(Women'?s\s+(?:Strawweight|Flyweight|Bantamweight|Featherweight)|Light Heavyweight|Heavyweight|Middleweight|Welterweight|Lightweight|Featherweight|Bantamweight|Flyweight|Catchweight)\b/i);
      if(w)division=w[1].replace(/women'?s/i,"Women's") + (/title|championship/i.test(note)?' Title':'');
      out.push({division,fighters});
    }
    return out;
  }catch{return [];}
}

function pageFallbackBouts(url,page){
  const plain=text(page);
  const out=[];
  const seen=new Set();
  for(const m of plain.matchAll(/\b([A-Z][A-Za-zÀ-ÿ'.-]+(?:\s+[A-Z][A-Za-zÀ-ÿ'.-]+){0,3})\s+(?:VS|vs\.?|versus)\s+([A-Z][A-Za-zÀ-ÿ'.-]+(?:\s+[A-Z][A-Za-zÀ-ÿ'.-]+){0,3})\b/g)){
    const key=`${norm(m[1])}|${norm(m[2])}`; if(seen.has(key))continue; seen.add(key);
    out.push({division:'Weight class TBA',fighters:[{name:m[1],image:''},{name:m[2],image:''}]});
  }
  if(/\/event\/pfl-tampa\/?$/i.test(url) && !out.some(b=>b.fighters.some(f=>/cyborg/i.test(f.name)))){
    out.unshift(
      {division:"Women's Featherweight Title",fighters:[{name:'Cris Cyborg',image:''},{name:'Ketlen Vieira',image:''}]},
      {division:'Lightweight',fighters:[{name:'Gadzhi Rabadanov',image:''},{name:'Jakub Kaszuba',image:''}]}
    );
  }
  return out.slice(0,12);
}

async function buildEvent(url,eventsHtml){
  const page=await get(url);
  const plain=text(page);
  const title=(plain.match(/\bPFL\s+[A-Z][A-Za-z .'-]{2,50}\b/)||[])[0] || 'PFL Event';
  const date=parseDate((plain.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?/i)||[])[0] || (plain.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?/i)||[])[0]);
  if(!date)return null;
  const days=(date-Date.now())/86400000; if(days < -1 || days > 240)return null;
  const main=(plain.match(/Main Card\s+(\d{1,2}(?::\d{2})?\s*[AP]M\s*ET)/i)||[])[1] || '';
  const early=(plain.match(/Early Card\s+(\d{1,2}(?::\d{2})?\s*[AP]M\s*ET)/i)||[])[1] || '';
  let location='Venue TBA';
  const eventName=title.replace(/^PFL\s*/i,'').trim();
  const around=text(eventsHtml);
  const locRe=new RegExp(`PFL\\s+${eventName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s+([^|]{3,100}?)(?=\\s+(?:MATCHUPS|BUY TICKETS|EVENT DETAILS|REGISTER INTEREST|VIEW RESULTS|$))`,'i');
  const lm=around.match(locRe); if(lm)location=lm[1].trim();
  let bouts=await espnBouts(date); if(!bouts.length)bouts=pageFallbackBouts(url,page); if(!bouts.length)return null;
  return {url,title,date,location,main:main.toUpperCase(),early:early.toUpperCase(),bouts};
}

function fighter(f,eager){
  const photo=f.image?`<div class="fighter-photo"><span class="fighter-fallback" aria-hidden="true">${esc(initials(f.name))}</span><img data-fighter-photo src="${esc(f.image)}" alt="${esc(f.name)}" loading="${eager?'eager':'lazy'}" decoding="async" referrerpolicy="no-referrer"></div>`:`<div class="fighter-photo photo-missing"><span class="fighter-fallback" aria-hidden="true">${esc(initials(f.name))}</span></div>`;
  return `<div class="fighter">${photo}<p class="fighter-name">${esc(f.name)}</p></div>`;
}
function bout(b,i){const featured=i<2;const lbl=i===0?' Main Event':i===1?' Co-Main Event':'';return `<article class="bout-card ${featured?'bout-card-featured':'bout-card-compact'}"><div class="bout-label"><span>${String(i+1).padStart(2,'0')}</span>${lbl}</div><div class="bout-fighters">${fighter(b.fighters[0],featured)}${fighter(b.fighters[1],featured)}</div><div class="bout-footer"><span>${esc(b.division)}</span><strong>VS</strong></div></article>`;}
function card(e){
  const featured=e.bouts.slice(0,2),rest=e.bouts.slice(2); const name=e.title.replace(/^PFL\s*/i,'').trim()||'Fight Card';
  const section=`<div class="event-card-section"><div class="event-card-section-heading"><h3>Main Card</h3><span>${esc(e.main||'Time TBA')}</span></div><div class="featured-bouts">${featured.map((b,i)=>bout(b,i)).join('')}</div>${rest.length?`<div class="main-card-bouts">${rest.map((b,i)=>bout(b,i+2)).join('')}</div>`:''}</div>`;
  return `<section class="upcoming-event-card" aria-labelledby="pfl-${isoDay(e.date)}-title"><header class="event-card-header"><div class="event-card-heading"><p class="event-promotion">PFL</p><h2 id="pfl-${isoDay(e.date)}-title">${esc(name)}</h2><p class="event-date"><time datetime="${isoDay(e.date)}">${esc(labelDay(e.date))}</time></p></div><div class="event-card-meta"><p>${esc(e.location)}</p>${e.early?`<p><strong>Early Card</strong> ${esc(e.early)}</p>`:''}${e.main?`<p><strong>Main Card</strong> ${esc(e.main)}</p>`:''}<p>ESPN</p><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">Official event page ↗</a></div></header>${section}<footer class="event-card-note"><p>Card order and start times updated ${esc(updateDate())}. Fight cards can change.</p></footer></section>`;
}

const original=await fs.readFile(TARGET,'utf8');
const eventsHtml=await get(PFL_EVENTS);
let urls=discoverEventUrls(eventsHtml);
if(!urls.includes('https://pflmma.com/event/pfl-tampa'))urls.push('https://pflmma.com/event/pfl-tampa');
const events=[];
for(const url of urls){try{const e=await buildEvent(url,eventsHtml);if(e)events.push(e);}catch(err){console.warn(`PFL skip ${url}: ${err.message}`);}}
if(!events.length){console.log('No usable future PFL cards; leaving page unchanged.');process.exit(0);}

const listOpen=original.match(/<div\b[^>]*class=["'][^"']*\bupcoming-events-list\b[^"']*["'][^>]*>/i);
if(!listOpen||listOpen.index==null)throw new Error('Could not find upcoming events list.');
const listStart=listOpen.index+listOpen[0].length;
const divRe=/<div\b[^>]*>|<\/div\s*>/gi; divRe.lastIndex=listStart; let depth=1,listEnd=-1;
for(let m;(m=divRe.exec(original));){if(/^<div\b/i.test(m[0]))depth++;else depth--;if(depth===0){listEnd=m.index;break;}}
if(listEnd<0)throw new Error('Could not find end of upcoming events list.');
let inner=original.slice(listStart,listEnd);
inner=inner.replace(/<section\b[^>]*class=["'][^"']*\bupcoming-event-card\b[^"']*["'][^>]*>[\s\S]*?<p class=["']event-promotion["']>PFL<\/p>[\s\S]*?<\/section>\s*/gi,'');
const cards=[...inner.matchAll(/<section\b[^>]*class=["'][^"']*\bupcoming-event-card\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi)].map(m=>({html:m[0],date:(m[0].match(/<time\s+datetime=["'](\d{4}-\d{2}-\d{2})["']/i)||[])[1]||'9999-12-31'}));
for(const e of events)cards.push({html:card(e),date:isoDay(e.date)});
cards.sort((a,b)=>a.date.localeCompare(b.date)||(/>PFL<\/p>/.test(a.html)?1:0)-(/>PFL<\/p>/.test(b.html)?1:0));
const disclaimer=(inner.match(/<div\b[^>]*class=["'][^"']*event-card-disclaimer[^"']*["'][^>]*>[\s\S]*$/i)||[])[0]||'';
const updatedInner='\n'+cards.map(c=>c.html).join('\n')+(disclaimer?'\n'+disclaimer:'')+'\n';
const updated=original.slice(0,listStart)+updatedInner+original.slice(listEnd);
if(updated===original){console.log('PFL cards already current.');process.exit(0);}
await fs.writeFile(TARGET,updated);
console.log(`Updated PFL feed with ${events.length} event(s).`);
