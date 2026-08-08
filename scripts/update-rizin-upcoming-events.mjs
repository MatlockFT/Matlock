import fs from 'node:fs/promises';

const TARGET = 'upcoming-events.html';
const CACHE_PATH = '_data/fighter_portraits.json';
const SCHEDULE = 'https://jp.rizinff.com/_ct/17813466';
const ORIGIN = 'https://jp.rizinff.com';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockRizinUpdater/1.0; +https://matlockfighttalk.com/)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = (s='') => s.replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(+x)).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
const strip = (s='') => decode(s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const esc = (s='') => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const reEsc = (s='') => String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const norm = (s='') => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const initials = name => name.split(/\s+/).filter(Boolean).slice(0,3).map(x=>x[0]).join('').toUpperCase() || '?';

async function get(url){
  let last;
  for(let i=1;i<=3;i++){
    try{
      const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(30000),headers:{'user-agent':UA,accept:'text/html,*/*'}});
      if(r.ok)return await r.text();
      last=new Error(`${r.status} ${r.statusText} for ${url}`);
    }catch(e){last=e;}
    if(i<3)await sleep(500*i);
  }
  throw last;
}

function hrefs(html,labelPattern){
  const out=[];
  for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
    const label=strip(m[2]); if(!labelPattern.test(label))continue;
    const h=(m[1].match(/href=["']([^"']+)["']/i)||[])[1]; if(!h)continue;
    try{const u=new URL(decode(h),ORIGIN);u.search='';u.hash='';out.push(u.toString());}catch{}
  }
  return [...new Set(out)];
}

function parseEventDate(html){
  const plain=strip(html);
  const m=plain.match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if(!m)return null;
  return {year:+m[1],month:+m[2],day:+m[3]};
}
function isoDay(d){return `${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`;}
function labelDay(d){return new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(d.year,d.month-1,d.day,12))).replace(/^(\w+), /,'$1 · ');}
function parseStart(html,date){
  const plain=strip(html);
  const m=plain.match(/(?:／|\s)(\d{1,2}):(\d{2})開始/);
  if(!m)return {jst:'Time TBA',et:'Time TBA'};
  const hour=+m[1],min=+m[2];
  const utc=new Date(Date.UTC(date.year,date.month-1,date.day,hour-9,min));
  const et=new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/New_York',timeZoneName:'short'}).format(utc);
  return {jst:`${hour}:${String(min).padStart(2,'0')} JST`,et};
}
function eventTitle(html){
  const h=(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||'';
  return strip(h).replace(/\s*大会情報[／/]チケット.*$/,'').replace(/^超RIZIN/i,'Super RIZIN').trim() || 'RIZIN Event';
}
function venue(html){
  const m=html.match(/<h3\b[^>]*>\s*会場\s*<\/h3>[\s\S]{0,900}?<a\b[^>]*>([\s\S]*?)<\/a>/i);
  if(m)return strip(m[1]);
  const p=strip(html); const f=p.match(/会場\s+([^。]{2,80}?)(?=\s+(?:アクセス|電車|バス|主催|Google|〒))/);
  return f?f[1].trim():'Venue TBA';
}
function broadcast(html){
  const p=strip(html);
  const names=['RIZIN 100 CLUB','RIZIN LIVE','ABEMA','U-NEXT','スカパー！','Sky PerfecTV'];
  const found=names.filter(n=>p.includes(n)).map(n=>n==='スカパー！'?'Sky PerfecTV':n);
  return [...new Set(found)].join(' · ') || 'RIZIN PPV';
}
function cardUrl(eventHtml){
  const urls=hrefs(eventHtml,/対戦カード/);
  return urls.find(u=>/_ct\/\d+/.test(u))||'';
}
function profileUrl(cardHtml,jpName){
  for(const m of cardHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
    if(strip(m[2])!==jpName)continue;
    const h=(m[1].match(/href=["']([^"']+)["']/i)||[])[1]; if(!h)continue;
    try{return new URL(decode(h),ORIGIN).toString();}catch{}
  }
  return '';
}
function imageFromProfile(html,jpName){
  for(const m of html.matchAll(/<img\b[^>]*>/gi)){
    const tag=m[0]; const alt=decode((tag.match(/alt=["']([^"']*)["']/i)||[])[1]||'');
    if(alt && alt!==jpName && !alt.includes(jpName))continue;
    const src=decode((tag.match(/(?:data-src|src)=["']([^"']+)["']/i)||[])[1]||'');
    if(!src||/logo|banner|icon|ads/i.test(src))continue;
    try{return new URL(src,ORIGIN).toString();}catch{}
  }
  return '';
}
function englishFromProfile(html,jpName){
  const p=strip(html);
  const direct=p.match(new RegExp(`${reEsc(jpName)}\\s+([A-Za-z][A-Za-z0-9À-ÿ.'’\\- ]{1,70}?)(?=\\s+(?:出身地|生年月日|身長|リーチ|体重|所属|国籍))`));
  if(direct)return direct[1].trim();
  const labelled=p.match(new RegExp(`名前[:：]?\\s*(?:\\|\\s*)?${reEsc(jpName)}\\s+([A-Za-z][A-Za-z0-9À-ÿ.'’\\- ]{1,70})`));
  return labelled?labelled[1].trim():jpName;
}
async function fighterInfo(cardHtml,jpName,cache){
  const url=profileUrl(cardHtml,jpName);
  if(url){
    try{
      const page=await get(url); const name=englishFromProfile(page,jpName); const image=imageFromProfile(page,jpName);
      if(image)cache[norm(name)]={url:image,source:'rizin',framing:'safe'};
      return {name,image};
    }catch{}
  }
  return {name:jpName,image:''};
}
function parseFights(cardHtml){
  const matches=[...cardHtml.matchAll(/<h2\b[^>]*>\s*第(\d+)試合[／/]\s*([^<]+?)\s+vs\.?\s+([^<]+?)\s*<\/h2>/gi)];
  return matches.map((m,i)=>{
    const end=matches[i+1]?.index??cardHtml.length; const chunk=cardHtml.slice(m.index,end);
    const kg=(strip(chunk).match(/（\s*([0-9.]+)kg\s*）/)||[])[1]||'';
    return {fightNo:+m[1],jp1:strip(m[2]),jp2:strip(m[3]),weight:kg?`${kg} kg`:'RIZIN MMA'};
  }).sort((a,b)=>b.fightNo-a.fightNo);
}
function fighterMarkup(f,eager){
  const photo=f.image?`<div class="fighter-photo"><span class="fighter-fallback" aria-hidden="true">${esc(initials(f.name))}</span><img data-fighter-photo data-portrait-source="rizin" data-portrait-framing="safe" src="${esc(f.image)}" alt="${esc(f.name)}" loading="${eager?'eager':'lazy'}" decoding="async" referrerpolicy="no-referrer"></div>`:`<div class="fighter-photo photo-missing"><span class="fighter-fallback" aria-hidden="true">${esc(initials(f.name))}</span></div>`;
  return `<div class="fighter">${photo}<p class="fighter-name">${esc(f.name)}</p></div>`;
}
function boutMarkup(b,i){
  const featured=i<2; const label=i===0?' Main Event':'';
  return `<article class="bout-card ${featured?'bout-card-featured':'bout-card-compact'}"><div class="bout-label"><span>${String(i+1).padStart(2,'0')}</span>${label}</div><div class="bout-fighters">${fighterMarkup(b.fighters[0],featured)}${fighterMarkup(b.fighters[1],featured)}</div><div class="bout-footer"><span>${esc(b.weight)}</span><strong>VS</strong></div></article>`;
}
function cardMarkup(e){
  const featured=e.bouts.slice(0,2),rest=e.bouts.slice(2);
  return `<section class="upcoming-event-card" data-auto-promotion="rizin" aria-labelledby="rizin-${isoDay(e.date)}-title"><header class="event-card-header"><div class="event-card-heading"><p class="event-promotion">RIZIN</p><h2 id="rizin-${isoDay(e.date)}-title">${esc(e.title)}</h2><p class="event-date"><time datetime="${isoDay(e.date)}">${esc(labelDay(e.date))}</time></p></div><div class="event-card-meta"><p>${esc(e.venue)}</p><p><strong>Start</strong> ${esc(e.start.et)} · ${esc(e.start.jst)}</p><p>${esc(e.broadcast)}</p><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">Official event page ↗</a></div></header><div class="event-card-section"><div class="event-card-section-heading"><h3>Fight Card</h3><span>${esc(e.start.et)}</span></div><div class="featured-bouts">${featured.map((b,i)=>boutMarkup(b,i)).join('')}</div>${rest.length?`<div class="main-card-bouts">${rest.map((b,i)=>boutMarkup(b,i+2)).join('')}</div>`:''}</div><footer class="event-card-note"><p>Card order and start times updated automatically from RIZIN. Fight cards can change.</p></footer></section>`;
}

let cache={}; try{cache=JSON.parse(await fs.readFile(CACHE_PATH,'utf8'));}catch{}
const scheduleHtml=await get(SCHEDULE);
let eventUrls=hrefs(scheduleHtml,/大会情報[／/]チケット/);
for(const u of ['https://jp.rizinff.com/_ct/17833730'])if(!eventUrls.includes(u))eventUrls.push(u);
const events=[];
for(const url of eventUrls){
  try{
    const page=await get(url); const date=parseEventDate(page); if(!date)continue;
    const noon=Date.UTC(date.year,date.month-1,date.day,12); const days=(noon-Date.now())/86400000; if(days<-1||days>240)continue;
    const cu=cardUrl(page); if(!cu)continue; const ch=await get(cu); const raw=parseFights(ch); if(!raw.length)continue;
    const bouts=[];
    for(const r of raw){
      const f1=await fighterInfo(ch,r.jp1,cache); await sleep(90); const f2=await fighterInfo(ch,r.jp2,cache); await sleep(90);
      bouts.push({weight:r.weight,fighters:[f1,f2]});
    }
    events.push({url,title:eventTitle(page),date,venue:venue(page),start:parseStart(page,date),broadcast:broadcast(page),bouts});
  }catch(err){console.warn(`RIZIN skip ${url}: ${err.message}`);}
}
if(!events.length){console.log('No usable future RIZIN cards; leaving page unchanged.');process.exit(0);}

const original=await fs.readFile(TARGET,'utf8');
const listOpen=original.match(/<div\b[^>]*class=["'][^"']*\bupcoming-events-list\b[^"']*["'][^>]*>/i);
if(!listOpen||listOpen.index==null)throw new Error('Could not find upcoming events list.');
const listStart=listOpen.index+listOpen[0].length;
const divRe=/<div\b[^>]*>|<\/div\s*>/gi; divRe.lastIndex=listStart; let depth=1,listEnd=-1;
for(let m;(m=divRe.exec(original));){if(/^<div\b/i.test(m[0]))depth++;else depth--;if(depth===0){listEnd=m.index;break;}}
if(listEnd<0)throw new Error('Could not find end of upcoming events list.');
let inner=original.slice(listStart,listEnd);
inner=inner.replace(/<section\b[^>]*data-auto-promotion=["']rizin["'][^>]*>[\s\S]*?<\/section>\s*/gi,'');
for(const e of events.sort((a,b)=>isoDay(a.date).localeCompare(isoDay(b.date)))){
  const date=isoDay(e.date); let insertAt=inner.length;
  for(const m of inner.matchAll(/<section\b[^>]*class=["'][^"']*upcoming-event-card[^"']*["'][^>]*>[\s\S]*?<time\s+datetime=["'](\d{4}-\d{2}-\d{2})["']/gi)){
    if(m[1]>date){insertAt=m.index;break;}
  }
  if(insertAt===inner.length){const d=inner.search(/<div\b[^>]*class=["'][^"']*event-card-disclaimer/i);if(d>=0)insertAt=d;}
  inner=inner.slice(0,insertAt)+'\n'+cardMarkup(e)+'\n'+inner.slice(insertAt);
}
const updated=original.slice(0,listStart)+inner+original.slice(listEnd);
await fs.writeFile(TARGET,updated);
await fs.writeFile(CACHE_PATH,JSON.stringify(Object.fromEntries(Object.entries(cache).sort(([a],[b])=>a.localeCompare(b))),null,2)+'\n');
console.log(`Updated RIZIN feed with ${events.length} event(s).`);
