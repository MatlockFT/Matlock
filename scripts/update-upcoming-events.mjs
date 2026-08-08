import fs from 'node:fs/promises';

const TARGET = 'upcoming-events.html';
const UFC_ORIGIN = 'https://www.ufc.com';
const UFC_EVENTS = `${UFC_ORIGIN}/events`;
const PFL_ORIGIN = 'https://pflmma.com';
const PFL_EVENTS = `${PFL_ORIGIN}/events`;
const ESPN_UFC = 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard';
const ESPN_PFL = 'https://site.api.espn.com/apis/site/v2/sports/mma/pfl/scoreboard';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockUpcomingEvents/2.0; +https://matlockfighttalk.com/)';
const TIMEOUT = 30000;
const ATTEMPTS = 3;
const MAX_FUTURE_DAYS = 240;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = (s='') => s.replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(+x)).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
const text = (s='') => decode(s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const esc = (s='') => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const norm = (s='') => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const initials = name => name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase() || '?';
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

async function get(url, json=false) {
  let err;
  for (let i=1;i<=ATTEMPTS;i++) {
    try {
      const r = await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{'user-agent':UA,accept:json?'application/json,*/*':'text/html,application/xhtml+xml,*/*'}});
      if (r.ok) return json ? r.json() : r.text();
      err = new Error(`${r.status} ${r.statusText} for ${url}`);
    } catch (e) { err=e; }
    if (i<ATTEMPTS) await sleep(700*i);
  }
  throw err;
}

function jsonLd(html){
  const out=[];
  for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{const j=JSON.parse(decode(m[1]).trim()); if(Array.isArray(j))out.push(...j); else if(j?.['@graph'])out.push(...j['@graph']); else out.push(j);}catch{}
  }
  return out;
}
function meta(html,key){
  for(const t of html.matchAll(/<meta\b[^>]*>/gi)){
    const a={}; for(const m of t[0].matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gi))a[m[1].toLowerCase()]=decode(m[3]);
    if((a.property||a.name||'').toLowerCase()===key.toLowerCase()) return (a.content||'').trim();
  }
  return '';
}
function parseDateLoose(value, yearHint=new Date().getUTCFullYear()){
  if(!value)return null;
  let d=new Date(value); if(!Number.isNaN(d.getTime()))return d;
  const m=String(value).match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i);
  if(!m)return null;
  d=new Date(`${m[1]} ${m[2]}, ${m[3]||yearHint} 12:00:00 UTC`);
  return Number.isNaN(d.getTime())?null:d;
}
function isoDay(date){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function dayLabel(date){return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(date).replace(/^(\w+), /,'$1 · ');}
function updateDate(){return new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'long',day:'numeric',year:'numeric'}).format(new Date());}
function futureEnough(date){const days=(date.getTime()-Date.now())/86400000;return days>=-1&&days<=MAX_FUTURE_DAYS;}

function existingPortraits(html){
  const map=new Map();
  for(const m of html.matchAll(/<img\b[^>]*data-fighter-photo[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']+)["'][^>]*>/gi))map.set(norm(decode(m[2])),decode(m[1]));
  for(const m of html.matchAll(/<img\b[^>]*alt=["']([^"']+)["'][^>]*data-fighter-photo[^>]*src=["']([^"']+)["'][^>]*>/gi))map.set(norm(decode(m[1])),decode(m[2]));
  return map;
}

function weightFrom(s=''){
  const t=text(s); const m=t.match(/\b(Women'?s\s+(?:Strawweight|Flyweight|Bantamweight|Featherweight)|Light Heavyweight|Heavyweight|Middleweight|Welterweight|Lightweight|Featherweight|Bantamweight|Flyweight|Strawweight|Catchweight|Catch Weight)\b/i);
  if(!m)return 'Weight class TBA';
  let w=m[1].replace(/women'?s/i,"Women's").replace(/Catch Weight/i,'Catchweight');
  if(/title bout|championship|world championship|title fight/i.test(t))w+=' Title';
  return w;
}

async function espnBouts(api,date){
  try{
    const j=await get(`${api}?dates=${isoDay(date).replaceAll('-','')}&limit=100`,true);
    const events=j?.events||[]; if(!events.length)return {bouts:[],venue:'',broadcast:''};
    const e=events[0]; const bouts=[]; const names=new Set();
    for(const c of e.competitions||[]){
      const cs=c.competitors||[]; if(cs.length<2)continue;
      const fighters=cs.slice(0,2).map(z=>{const a=z.athlete||z.team||{};const name=a.displayName||a.fullName||a.shortName||z.displayName||'';return{name,image:a.headshot?.href||(a.id?`https://a.espncdn.com/i/headshots/mma/players/full/${a.id}.png`:''),href:''};});
      if(!fighters.every(x=>x.name))continue;
      const note=[c.type?.text,c.type?.abbreviation,...(c.notes||[]).map(x=>x?.headline||x?.text||'')].filter(Boolean).join(' ');
      bouts.push({section:'main',division:weightFrom(note),fighters});
      for(const b of c.broadcasts||[])for(const n of b.names||[])if(n)names.add(n);
    }
    const v=(e.competitions||[])[0]?.venue||e.venue||{}; const a=v.address||{}; const tail=[a.city||a.addressLocality,a.state||a.region||a.addressRegion].filter(Boolean).join(', ');
    return {bouts,venue:[v.fullName||v.name,tail].filter(Boolean).join(' · '),broadcast:[...names].join(' · ')};
  }catch(e){console.warn(`ESPN lookup failed ${api} ${isoDay(date)}: ${e.message}`);return {bouts:[],venue:'',broadcast:''};}
}

function ufcEventUrls(html){
  const d=decode(html).replaceAll('\\/','/'); const set=new Set();
  for(const m of d.matchAll(/(?:href\s*=\s*["'])?((?:https?:\/\/(?:www\.)?ufc\.com)?\/event\/[a-z0-9][a-z0-9-]*)(?=[?#["'<>\s\\]|$)/gi)){
    try{const u=new URL(m[1],UFC_ORIGIN); if(!/^(?:www\.)?ufc\.com$/i.test(u.hostname))continue; if(/contender|dwcs|ultimate-fighter|road-to-ufc|fight-pass/i.test(u.pathname))continue; if(!/^\/event\/(?:ufc-|noche-ufc|ufc-noche)/i.test(u.pathname))continue;u.protocol='https:';u.hostname='www.ufc.com';u.search='';u.hash='';u.pathname=u.pathname.replace(/\/$/,'');set.add(u.toString());}catch{}
  }
  return [...set].slice(0,24);
}
function ufcDate(html,url){
  for(const x of jsonLd(html)){if(x?.startDate&&!Number.isNaN(Date.parse(x.startDate)))return new Date(x.startDate);}
  const m=html.match(/["']startDate["']\s*:\s*["']([^"']+)["']/i); if(m?.[1]&&!Number.isNaN(Date.parse(decode(m[1]))))return new Date(decode(m[1]));
  const s=new URL(url).pathname.match(/(january|february|march|april|may|june|july|august|september|october|november|december)-(\d{1,2})-(\d{4})/i); return s?new Date(`${s[1]} ${s[2]}, ${s[3]} 12:00:00 UTC`):null;
}
function ufcLocation(html){
  for(const x of jsonLd(html)){const l=x?.location;if(!l)continue;const n=typeof l==='string'?l:l.name||'';const a=l.address||{};const tail=[a.addressLocality,a.addressRegion].filter(Boolean).join(', ');if(n&&tail&&!n.includes(tail))return `${n} · ${tail}`;if(n)return n;if(tail)return tail;}
  return 'Venue TBA';
}
function ufcTitle(html,url){let s=meta(html,'og:title').replace(/\s*\|\s*UFC.*$/i,'').trim();if(!s)s=text((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||'');return s||new URL(url).pathname.split('/').filter(Boolean).at(-1).replaceAll('-',' ');}
function ufcTimes(html){const p=text(html).replace(/\bEDT\b|\bEST\b/g,'ET');const out={};for(const[k,l]of[['early','Early Prelims'],['prelims','Prelims'],['main','Main Card']]){const m=p.match(new RegExp(`${l}.{0,140}?(\\d{1,2}:\\d{2}\\s*[AP]M\\s*(?:ET|CT|MT|PT))`,'i'));if(m)out[k]=m[1].replace(/\s+/g,' ').toUpperCase();}return out;}
function ufcBroadcast(html){const p=text(html).toLowerCase();const opts=['Paramount+','ESPN+','ESPN','ABC','CBS','ESPN2','UFC Fight Pass'];return opts.filter(x=>p.includes(x.toLowerCase())).slice(0,3).join(' · ')||'Broadcast TBA';}
function ufcBouts(html){
  const markers=[]; for(const m of html.matchAll(/<(?:h2|h3|div|span|p)\b[^>]*>([\s\S]{0,220}?)<\/(?:h2|h3|div|span|p)>/gi)){const t=text(m[1]);const s=/^Early Prelims?$/i.test(t)?'early':/^Prelims?$/i.test(t)?'prelims':/^Main Card$/i.test(t)?'main':null;if(s)markers.push({i:m.index,s});}
  const starts=[...html.matchAll(/<div\b[^>]*class=["'][^"']*\bc-listing-fight__content\b[^"']*["'][^>]*>/gi)].map(m=>m.index); const out=[];
  for(let z=0;z<starts.length;z++){const start=starts[z],chunk=html.slice(start,starts[z+1]??html.length);const fighters=[];for(const m of chunk.matchAll(/<a\b[^>]*href=["'](\/athlete\/[a-z0-9][a-z0-9-]*\/?)["'][^>]*>([\s\S]*?)<\/a>/gi)){const name=text(m[2]);if(!name||name.length>70)continue;const href=new URL(m[1],UFC_ORIGIN).toString();if(!fighters.some(x=>x.href===href))fighters.push({name,href,image:''});if(fighters.length===2)break;}if(fighters.length!==2)continue;let section='main';for(const mk of markers){if(mk.i>start)break;section=mk.s;}const division=text((chunk.match(/class=["'][^"']*c-listing-fight__class-text[^"']*["'][^>]*>([\s\S]*?)<\//i)||[])[1]||'')||weightFrom(chunk);out.push({section,division,fighters});}
  return out;
}
async function getUfc(){
  const urls=ufcEventUrls(await get(UFC_EVENTS)); const events=[];
  for(const url of urls){try{const html=await get(url);const date=ufcDate(html,url);if(!date||!futureEnough(date))continue;let bouts=ufcBouts(html);if(!bouts.length)continue;const e=await espnBouts(ESPN_UFC,date);if(e.bouts.length){for(const b of bouts){const match=e.bouts.find(x=>x.fighters.some(f=>b.fighters.some(g=>norm(g.name)===norm(f.name))));if(match){b.fighters=b.fighters.map(f=>{const q=match.fighters.find(x=>norm(x.name)===norm(f.name));return q?{...f,image:q.image}:{...f};});if(b.division==='Weight class TBA')b.division=match.division;}}}events.push({promotion:'UFC',url,date,title:ufcTitle(html,url),location:ufcLocation(html)||e.venue||'Venue TBA',times:ufcTimes(html),broadcast:ufcBroadcast(html)||e.broadcast||'Broadcast TBA',bouts});}catch(err){console.warn(`UFC skip ${url}: ${err.message}`);}}
  return events;
}

function pflEventCards(html){
  const starts=[...html.matchAll(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi)].map(m=>({i:m.index,label:text(m[1])})).filter(x=>/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+/i.test(x.label));
  const out=[]; const year=new Date().getUTCFullYear();
  for(let i=0;i<starts.length;i++){
    const chunk=html.slice(starts[i].i,starts[i+1]?.i??Math.min(html.length,starts[i].i+12000));
    const name=text((chunk.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)||[])[1]||''); if(!/^PFL\b/i.test(name))continue;
    const date=parseDateLoose(starts[i].label,year); if(!date||!futureEnough(date))continue;
    const venue=text((chunk.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)||[])[1]||'')||'Venue TBA';
    const link=(chunk.match(/href=["']([^"']*\/event\/[^"']+)["']/i)||[])[1]||''; let url=PFL_EVENTS; try{if(link)url=new URL(link,PFL_ORIGIN).toString();}catch{}
    const plain=text(chunk); const tm=plain.match(/(\d{1,2}(?::\d{2})?\s*pm\s*ET)\s*Early Card\s*\|\s*(\d{1,2}(?::\d{2})?\s*pm\s*ET)\s*Main Card/i);
    const times={}; if(tm){times.prelims=tm[1].replace(/\bpm\b/i,'PM').replace(/\bam\b/i,'AM').toUpperCase();times.main=tm[2].replace(/\bpm\b/i,'PM').replace(/\bam\b/i,'AM').toUpperCase();}
    out.push({promotion:'PFL',url,date,title:name,location:venue,times,broadcast:'ESPN',bouts:[]});
  }
  return out;
}
async function getPfl(){
  const html=await get(PFL_EVENTS); const events=pflEventCards(html); const out=[];
  for(const event of events){
    const e=await espnBouts(ESPN_PFL,event.date); let bouts=e.bouts;
    if(!bouts.length){
      try{const page=await get(event.url); const imgs=[...page.matchAll(/<img\b[^>]*alt=["']([^"']+)["'][^>]*src=["']([^"']+)["'][^>]*>/gi)].map(m=>({name:decode(m[1]).trim(),image:decode(m[2])})).filter(x=>x.name&&!/banner|logo|event|icon/i.test(x.name)); const seen=new Set(); const fighters=imgs.filter(x=>!seen.has(norm(x.name))&&seen.add(norm(x.name))).slice(0,4);for(let i=0;i+1<fighters.length;i+=2)bouts.push({section:'main',division:'Weight class TBA',fighters:[{...fighters[i],href:''},{...fighters[i+1],href:''}]});}catch{}
    }
    if(!bouts.length)continue;
    const mainCount=Math.min(4,bouts.length); bouts=bouts.map((b,i)=>({...b,section:i<mainCount?'main':'prelims'}));
    out.push({...event,location:event.location||e.venue||'Venue TBA',broadcast:e.broadcast||event.broadcast,bouts});
  }
  return out;
}

function titleParts(event){
  if(event.promotion==='PFL')return {promotion:'PFL',matchup:event.title.replace(/^PFL\s*/i,'').trim()||'Fight Card'};
  const t=event.title; const n=t.match(/^(UFC\s+\d+)\s*[:\-]?\s*(.*)$/i); if(n)return{promotion:n[1].toUpperCase(),matchup:n[2]||'Fight Card'};const f=t.match(/^(UFC\s+Fight\s+Night)\s*[:\-]?\s*(.*)$/i);if(f)return{promotion:'UFC Fight Night',matchup:f[2]||'Fight Card'};return{promotion:'UFC',matchup:t.replace(/^UFC\s*[:\-]?\s*/i,'')||'Fight Card'};
}
function fighterMarkup(f,eager,portraits){const image=f.image||portraits.get(norm(f.name))||'';const photo=image?`<div class="fighter-photo"><span class="fighter-fallback" aria-hidden="true">${esc(initials(f.name))}</span><img data-fighter-photo src="${esc(image)}" alt="${esc(f.name)}" loading="${eager?'eager':'lazy'}" decoding="async" referrerpolicy="no-referrer"></div>`:`<div class="fighter-photo photo-missing"><span class="fighter-fallback" aria-hidden="true">${esc(initials(f.name))}</span></div>`;return `<div class="fighter">${photo}<p class="fighter-name">${esc(f.name)}</p></div>`;}
function boutMarkup(b,index,featured,portraits){const label=index===0?' Main Event':index===1&&featured?' Co-Main Event':'';return `<article class="bout-card ${featured?'bout-card-featured':'bout-card-compact'}"><div class="bout-label"><span>${String(index+1).padStart(2,'0')}</span>${label}</div><div class="bout-fighters">${fighterMarkup(b.fighters[0],featured,portraits)}${fighterMarkup(b.fighters[1],featured,portraits)}</div><div class="bout-footer"><span>${esc(b.division)}</span><strong>VS</strong></div></article>`;}
function sectionMarkup(name,key,bouts,start,time,portraits){if(!bouts.length)return'';if(key==='main'){const featured=bouts.slice(0,2),rest=bouts.slice(2);return `<div class="event-card-section"><div class="event-card-section-heading"><h3>Main Card</h3><span>${esc(time||'Time TBA')}</span></div><div class="featured-bouts">${featured.map((b,i)=>boutMarkup(b,start+i,true,portraits)).join('')}</div>${rest.length?`<div class="main-card-bouts">${rest.map((b,i)=>boutMarkup(b,start+featured.length+i,false,portraits)).join('')}</div>`:''}</div>`;}return `<div class="event-card-section event-card-prelims"><div class="event-card-section-heading"><h3>${esc(name)}</h3><span>${esc(time||'Time TBA')}</span></div><div class="prelim-bouts">${bouts.map((b,i)=>boutMarkup(b,start+i,false,portraits)).join('')}</div></div>`;}
function eventMarkup(event,portraits){const{promotion,matchup}=titleParts(event);const id=`${slugify(promotion)}-${isoDay(event.date)}-title`;const main=event.bouts.filter(b=>b.section==='main'),pre=event.bouts.filter(b=>b.section==='prelims'),early=event.bouts.filter(b=>b.section==='early');let off=0;const sections=[];if(main.length){sections.push(sectionMarkup('Main Card','main',main,off,event.times.main,portraits));off+=main.length;}if(pre.length){sections.push(sectionMarkup(event.promotion==='PFL'?'Early Card':'Prelims','prelims',pre,off,event.times.prelims,portraits));off+=pre.length;}if(early.length){sections.push(sectionMarkup('Early Prelims','early',early,off,event.times.early,portraits));off+=early.length;}const meta=[`<p>${esc(event.location)}</p>`];if(event.times.early)meta.push(`<p><strong>Early Prelims</strong> ${esc(event.times.early)}</p>`);if(event.times.prelims)meta.push(`<p><strong>${event.promotion==='PFL'?'Early Card':'Prelims'}</strong> ${esc(event.times.prelims)}</p>`);if(event.times.main)meta.push(`<p><strong>Main Card</strong> ${esc(event.times.main)}</p>`);meta.push(`<p>${esc(event.broadcast||'Broadcast TBA')}</p>`);meta.push(`<a href="${esc(event.url)}" target="_blank" rel="noopener noreferrer">Official event page ↗</a>`);return `<section class="upcoming-event-card" aria-labelledby="${id}"><header class="event-card-header"><div class="event-card-heading"><p class="event-promotion">${esc(promotion)}</p><h2 id="${id}">${esc(matchup)}</h2><p class="event-date"><time datetime="${isoDay(event.date)}">${esc(dayLabel(event.date))}</time></p></div><div class="event-card-meta">${meta.join('')}</div></header>${sections.join('')}<footer class="event-card-note"><p>Card order and start times updated ${esc(updateDate())}. Fight cards can change.</p></footer></section>`;}
function replaceList(html,inner){const open=html.match(/<div\b[^>]*class=["'][^"']*\bupcoming-events-list\b[^"']*["'][^>]*>/i);if(!open||open.index==null)throw new Error('Could not locate .upcoming-events-list');const start=open.index+open[0].length;const re=/<div\b[^>]*>|<\/div\s*>/gi;re.lastIndex=start;let depth=1;for(let t;(t=re.exec(html));){if(/^<div\b/i.test(t[0]))depth++;else depth--;if(depth===0)return html.slice(0,start)+'\n'+inner+'\n'+html.slice(t.index);}throw new Error('Could not find closing event list tag');}

const original=await fs.readFile(TARGET,'utf8'); const portraits=existingPortraits(original);
const [ufc,pfl]=await Promise.all([getUfc(),getPfl()]);
if(!ufc.length)throw new Error('No usable UFC events found; refusing to replace feed.');
const all=[...ufc,...pfl].sort((a,b)=>a.date-b.date||a.promotion.localeCompare(b.promotion));
const key=new Set(); const unique=all.filter(e=>{const k=`${e.promotion}|${isoDay(e.date)}|${norm(e.title)}`;if(key.has(k))return false;key.add(k);return true;});
const updated=replaceList(original,unique.map(e=>eventMarkup(e,portraits)).join('\n'));
if(updated===original){console.log(`Upcoming feed already current: ${ufc.length} UFC, ${pfl.length} PFL.`);process.exit(0);}
await fs.writeFile(TARGET,updated);
console.log(`Updated ${TARGET}: ${ufc.length} UFC event(s), ${pfl.length} PFL event(s).`);
