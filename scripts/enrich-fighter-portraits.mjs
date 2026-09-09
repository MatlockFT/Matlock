import fs from 'node:fs/promises';
import { DATA_PATH, norm } from './upcoming-events-data.mjs';

const CACHE_PATH='_data/fighter_portraits.json';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const TIMEOUT=8000;
const tracking=/(?:piwik|matomo|google-analytics|googletagmanager|doubleclick|analytics|tracking|pixel|beacon|\/collect(?:[/?]|$)|\/track(?:[/?]|$))/i;
const badPortrait=/(?:\/articles?\/|\/news\/|\/galleries?\/|\/thumbnails?\/|\/fighters\/(?:bodyshots|headshots)\/default-(?:male|female)\.(?:png|jpe?g|webp)(?:\?|$)|(?:^|[\/_-])(?:banner|sponsor|poster|promo|placeholder)(?:[\/_-]|$))/i;
const pflAssetHost=/(?:pflmma\.com|pfl-cdn|pflmma-prod\.s3(?:\.us-east-1)?\.amazonaws\.com)/i;
const pflBodyshot=/\/fighters\/bodyshots\//i;
const pflHeadshot=/\/fighters\/headshots\//i;
const pflProfileRoutes=['fighter','wt-fighter'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const browserHeaders={
  'user-agent':UA,
  'accept-language':'en-US,en;q=0.9',
  'cache-control':'no-cache'
};

async function fetchText(url){let last;for(let i=0;i<2;i++){try{const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{...browserHeaders,accept:'text/html,application/xhtml+xml,*/*'}});if(r.ok)return await r.text();last=new Error(`${r.status} ${url}`);}catch(e){last=e;}if(i===0)await sleep(250);}throw last;}
async function usableImage(url){if(!/^https?:\/\//i.test(url||'')||tracking.test(url)||badPortrait.test(url))return false;try{let r=await fetch(url,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{...browserHeaders,accept:'image/*,*/*;q=0.8'}});if(!r.ok||!(r.headers.get('content-type')||'').toLowerCase().startsWith('image/'))r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{...browserHeaders,accept:'image/*,*/*;q=0.8',range:'bytes=0-2047'}});if(!r.ok&&r.status!==206)return false;const type=(r.headers.get('content-type')||'').toLowerCase();return type.startsWith('image/')||/\.(png|jpe?g|webp)(?:\?|$)/i.test(r.url);}catch{return false;}}
const decode=(s='')=>s.replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(+x)).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
function attrs(tag){const out={};for(const m of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gi))out[m[1].toLowerCase()]=decode(m[3]);return out;}
function slug(name){return norm(name).replace(/\s+/g,'-');}
function slugCandidates(name){
  const base=slug(name),set=new Set([base]);
  set.add(base.replace(/-(de|da|do|dos|das)-/g,'-$1'));
  set.add(base.replace(/-(van|von)-/g,'-$1'));
  return [...set].filter(Boolean);
}
function profileMatches(html,name){
  const requested=norm(name);
  const title=decode((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'').replace(/\s+/g,' ').trim();
  const og=decode((html.match(/<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i)||[])[1]||'').replace(/\s+/g,' ').trim();
  for(const value of [title,og]){
    const n=norm(value.split('|')[0]);
    if(n===requested||n.startsWith(`${requested} `))return true;
  }
  return false;
}
function nameMatchesLabel(label,requested){
  const value=norm(label||'');
  return !!value&&(value===requested||value.includes(requested)||requested.includes(value));
}
function pflImageCandidates(html,name){
  const requested=norm(name),bodyshots=[],headshots=[];
  for(const m of html.matchAll(/<img\b[^>]*>/gi)){
    const a=attrs(m[0]),raw=a.src||a['data-src']||a['data-lazy-src']||a.srcset?.split(',')[0]?.trim()?.split(/\s+/)[0]||'';
    if(!raw||tracking.test(raw)||badPortrait.test(raw))continue;
    let url;try{url=new URL(raw,'https://pflmma.com').toString();}catch{continue;}
    if(!pflAssetHost.test(url))continue;
    const label=a.alt||a.title||a['aria-label']||'';
    const named=nameMatchesLabel(label,requested);
    if(/flag|logo|icon|banner|sponsor|placeholder|background/i.test(`${label} ${url}`))continue;

    // A verified fighter profile can safely supply its dedicated bodyshot when
    // there is only one plausible bodyshot on the page. If there are several,
    // require PFL to label the image with the fighter's name. Matchup headshots
    // are only accepted when explicitly named because otherwise they can belong
    // to the opponent shown beside the profile owner.
    if(pflBodyshot.test(url))bodyshots.push({url,score:named?1250:1000,named});
    else if(pflHeadshot.test(url)&&named)headshots.push({url,score:800,named:true});
  }

  const namedBodyshots=bodyshots.filter(candidate=>candidate.named);
  if(namedBodyshots.length)return [...namedBodyshots,...headshots].sort((a,b)=>b.score-a.score);
  if(bodyshots.length===1)return [...bodyshots,...headshots].sort((a,b)=>b.score-a.score);
  return headshots.sort((a,b)=>b.score-a.score);
}
async function resolveFromPfl(name){
  for(const s of slugCandidates(name))for(const route of pflProfileRoutes)try{
    const page=await fetchText(`https://pflmma.com/${route}/${s}`);
    if(!profileMatches(page,name))continue;
    for(const candidate of pflImageCandidates(page,name))if(await usableImage(candidate.url))return candidate.url;
  }catch{}
  return'';
}
function sourceFor(url){if(/espncdn\.com/i.test(url))return'espn';if(/d1uzk9o9cg136f\.cloudfront\.net|rizin/i.test(url))return'rizin';if(pflAssetHost.test(url))return'pfl';if(/sherdog\.com/i.test(url))return'sherdog';return'external';}
const framingFor=source=>source==='espn'?'standard':'safe';

const data=JSON.parse(await fs.readFile(DATA_PATH,'utf8'));
let cache={};try{cache=JSON.parse(await fs.readFile(CACHE_PATH,'utf8'));}catch{}
delete cache[''];
const fighters=[];for(const event of data.events||[])for(const section of event.sections||[])for(const bout of section.bouts||[])for(const person of bout.fighters||[])fighters.push({person,promotion:event.promotion_key,eventId:event.id});

let changedData=false,changedCache=false;

// A single portrait URL cannot represent two different fighters on the same PFL
// card. Clear every ambiguous assignment and let verified PFL/ESPN resolution
// rebuild those portraits instead of guessing which side is correct.
const pflUrls=new Map();
for(const item of fighters){
  const {person,promotion,eventId}=item;
  if(promotion!=='pfl'||!person.image||person.image_source!=='pfl')continue;
  const key=`${eventId}|${person.image}`;
  if(!pflUrls.has(key))pflUrls.set(key,[]);
  pflUrls.get(key).push(person);
}
for(const people of pflUrls.values()){
  const names=new Set(people.map(person=>norm(person.name)).filter(Boolean));
  if(names.size<2)continue;
  for(const person of people){
    const key=norm(person.name),badUrl=person.image;
    person.image='';person.image_source='';person.image_framing='';changedData=true;
    if(cache[key]?.url===badUrl){delete cache[key];changedCache=true;}
    console.warn(`Cleared duplicate PFL portrait assignment for ${person.name}.`);
  }
}

for(const {person,promotion} of fighters){
  const key=norm(person.name);if(!key)continue;

  if(promotion==='pfl'){
    // Once a PFL bodyshot has been identity-checked on a previous run, keep it.
    // Re-fetching the fighter profile every 15 minutes adds latency and creates
    // unnecessary opportunities for a transient PFL response to disturb good data.
    if(person.image_source==='pfl'&&pflBodyshot.test(person.image||'')&&await usableImage(person.image)){
      if(!cache[key]?.url||badPortrait.test(cache[key].url)){
        cache[key]={url:person.image,source:'pfl',framing:'safe'};
        changedCache=true;
      }
      continue;
    }

    const official=await resolveFromPfl(person.name);
    if(official){
      const hit={url:official,source:'pfl',framing:'safe'};

      // The event may prefer a verified PFL bodyshot, but do not throw away an
      // already-known good ESPN/Sherdog/external portrait in the shared cache.
      // That cached image is the recovery path if PFL later changes its markup,
      // serves a placeholder, or the event-specific mapping becomes ambiguous.
      const cached=cache[key];
      const preserveFallback=!!(cached?.url&&cached.source!=='pfl'&&!badPortrait.test(cached.url)&&await usableImage(cached.url));
      if(!preserveFallback&&(cache[key]?.url!==hit.url||cache[key]?.source!=='pfl'||cache[key]?.framing!=='safe')){cache[key]=hit;changedCache=true;}

      if(person.image!==hit.url||person.image_source!=='pfl'||person.image_framing!=='safe'){person.image=hit.url;person.image_source='pfl';person.image_framing='safe';changedData=true;}
      continue;
    }

    // Headshots pulled from matchup modules are unsafe unless PFL explicitly
    // names the image. Remove old unverified assignments created by the previous
    // resolver so a known-good ESPN/Sherdog portrait can be restored downstream.
    if(person.image_source==='pfl'&&pflHeadshot.test(person.image||'')){
      const badUrl=person.image;
      person.image='';person.image_source='';person.image_framing='';changedData=true;
      if(cache[key]?.url===badUrl){delete cache[key];changedCache=true;}
    }
  }

  if(person.image&&await usableImage(person.image)){
    const source=person.image_source||sourceFor(person.image);
    if(!cache[key]?.url||badPortrait.test(cache[key].url)){cache[key]={url:person.image,source,framing:person.image_framing||framingFor(source)};changedCache=true;}
    continue;
  }

  if(person.image){person.image='';person.image_source='';person.image_framing='';changedData=true;}
  let hit=cache[key];
  if(hit?.url&&(badPortrait.test(hit.url)||!(await usableImage(hit.url)))){delete cache[key];hit=null;changedCache=true;}
  if(hit){person.image=hit.url;person.image_source=hit.source||sourceFor(hit.url);person.image_framing=hit.framing||framingFor(person.image_source);changedData=true;}
}

// Any promotion can occasionally expose an ambiguous or mislabeled image. Never
// let one bad portrait stop the entire event refresh: if two different fighters
// on the same event resolve to the exact same image, clear that image from every
// conflicting fighter and remove the matching cache entries. The UI will fall
// back to its normal blank/initials state until a later run finds a verified image.
const eventPortraits=new Map();
for(const {person,eventId} of fighters){
  const name=norm(person.name),url=person.image;
  if(!name||!url)continue;
  const key=`${eventId}|${url}`;
  if(!eventPortraits.has(key))eventPortraits.set(key,[]);
  eventPortraits.get(key).push(person);
}
for(const people of eventPortraits.values()){
  const names=new Set(people.map(person=>norm(person.name)).filter(Boolean));
  if(names.size<2)continue;
  for(const person of people){
    const key=norm(person.name),badUrl=person.image;
    person.image='';person.image_source='';person.image_framing='';changedData=true;
    if(cache[key]?.url===badUrl){delete cache[key];changedCache=true;}
    console.warn(`Cleared ambiguous duplicate portrait assignment for ${person.name}.`);
  }
}

if(changedCache)await fs.writeFile(CACHE_PATH,JSON.stringify(Object.fromEntries(Object.entries(cache).sort(([a],[b])=>a.localeCompare(b))),null,2)+'\n');
if(changedData)await fs.writeFile(DATA_PATH,JSON.stringify(data,null,2)+'\n');
console.log(`Portrait enrichment complete. Data changed: ${changedData}; cache changed: ${changedCache}.`);
