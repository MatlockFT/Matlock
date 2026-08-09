import fs from 'node:fs/promises';
import { DATA_PATH, norm } from './upcoming-events-data.mjs';

const CACHE_PATH='_data/fighter_portraits.json';
const UA='Mozilla/5.0 (compatible; MMAMatlockPortraitResolver/3.1; +https://matlockfighttalk.com/)';
const TIMEOUT=8000;
const tracking=/(?:piwik|matomo|google-analytics|googletagmanager|doubleclick|analytics|tracking|pixel|beacon|\/collect(?:[/?]|$)|\/track(?:[/?]|$))/i;
const badPortrait=/(?:\/articles?\/|\/news\/|\/galleries?\/|\/thumbnails?\/|(?:^|[\/_-])(?:banner|sponsor|poster|promo|placeholder)(?:[\/_-]|$))/i;
const pflAssetHost=/(?:pflmma\.com|pfl-cdn|pflmma-prod\.s3(?:\.us-east-1)?\.amazonaws\.com)/i;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function fetchText(url){let last;for(let i=0;i<2;i++){try{const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{'user-agent':UA,accept:'text/html,application/xhtml+xml,*/*'}});if(r.ok)return await r.text();last=new Error(`${r.status} ${url}`);}catch(e){last=e;}if(i===0)await sleep(250);}throw last;}
async function usableImage(url){if(!/^https?:\/\//i.test(url||'')||tracking.test(url)||badPortrait.test(url))return false;try{let r=await fetch(url,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{'user-agent':UA,accept:'image/*,*/*;q=0.8'}});if(!r.ok||!(r.headers.get('content-type')||'').toLowerCase().startsWith('image/'))r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{'user-agent':UA,accept:'image/*,*/*;q=0.8',range:'bytes=0-2047'}});if(!r.ok&&r.status!==206)return false;const type=(r.headers.get('content-type')||'').toLowerCase();return type.startsWith('image/')||/\.(png|jpe?g|webp)(?:\?|$)/i.test(r.url);}catch{return false;}}
const decode=(s='')=>s.replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(+x)).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
function attrs(tag){const out={};for(const m of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gi))out[m[1].toLowerCase()]=decode(m[3]);return out;}
function plainText(html=''){return decode(String(html).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();}
function slug(name){return norm(name).replace(/\s+/g,'-');}
function slugCandidates(name){const base=slug(name),set=new Set([base]);set.add(base.replace(/-(de|da|do|dos|das)-/g,'-$1'));return [...set].filter(Boolean);}
function pflImageCandidates(html,name){
  const requested=norm(name),page=norm(plainText(html));
  const tokens=requested.split(/\s+/).filter(Boolean);
  if(tokens.length&&!tokens.every(token=>page.includes(token)))return[];
  const out=[];
  for(const m of html.matchAll(/<img\b[^>]*>/gi)){
    const a=attrs(m[0]),raw=a.src||a['data-src']||a['data-lazy-src']||a.srcset?.split(',')[0]?.trim()?.split(/\s+/)[0]||'';
    if(!raw||tracking.test(raw)||badPortrait.test(raw))continue;
    let url;try{url=new URL(raw,'https://pflmma.com').toString();}catch{continue;}
    if(!pflAssetHost.test(url))continue;
    let score=0;
    if(/\/fighters\/bodyshots\//i.test(url))score+=500;
    else if(/\/fighters\/headshots\//i.test(url))score+=350;
    else continue;
    const alt=norm(a.alt||'');
    if(alt===requested)score+=150;else if(alt&&(alt.includes(requested)||requested.includes(alt)))score+=90;
    if(/flag|logo|icon|banner|sponsor|placeholder|background/i.test(`${a.alt||''} ${url}`))score-=600;
    if(score>0)out.push({url,score});
  }
  return out.sort((a,b)=>b.score-a.score);
}
async function resolveFromPfl(name){
  const paths=[];
  for(const s of slugCandidates(name))for(const prefix of ['/fighter/','/all-fighter/','/regular-fighter/','/wt-fighter/'])paths.push(`${prefix}${s}`);
  for(const path of paths)try{const page=await fetchText(`https://pflmma.com${path}`);for(const candidate of pflImageCandidates(page,name))if(await usableImage(candidate.url))return candidate.url;}catch{}
  return'';
}
function sourceFor(url){if(/espncdn\.com/i.test(url))return'espn';if(/d1uzk9o9cg136f\.cloudfront\.net|rizin/i.test(url))return'rizin';if(pflAssetHost.test(url))return'pfl';if(/sherdog\.com/i.test(url))return'sherdog';return'external';}
const framingFor=source=>source==='espn'?'standard':'safe';

const data=JSON.parse(await fs.readFile(DATA_PATH,'utf8'));
let cache={};try{cache=JSON.parse(await fs.readFile(CACHE_PATH,'utf8'));}catch{}
delete cache[''];
const fighters=[];for(const event of data.events||[])for(const section of event.sections||[])for(const bout of section.bouts||[])for(const person of bout.fighters||[])fighters.push({person,promotion:event.promotion_key});

let changedData=false,changedCache=false;
for(const {person,promotion} of fighters){
  const key=norm(person.name);if(!key)continue;

  // PFL cards should use PFL's own fighter assets whenever they are available.
  // This intentionally replaces ESPN/external/article images instead of preserving them.
  if(promotion==='pfl'){
    const official=await resolveFromPfl(person.name);
    if(official){
      const hit={url:official,source:'pfl',framing:'safe'};
      if(cache[key]?.url!==hit.url||cache[key]?.source!=='pfl'||cache[key]?.framing!=='safe'){cache[key]=hit;changedCache=true;}
      if(person.image!==hit.url||person.image_source!=='pfl'||person.image_framing!=='safe'){person.image=hit.url;person.image_source='pfl';person.image_framing='safe';changedData=true;}
      continue;
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

if(changedCache)await fs.writeFile(CACHE_PATH,JSON.stringify(Object.fromEntries(Object.entries(cache).sort(([a],[b])=>a.localeCompare(b))),null,2)+'\n');
if(changedData)await fs.writeFile(DATA_PATH,JSON.stringify(data,null,2)+'\n');
console.log(`Portrait enrichment complete. Data changed: ${changedData}; cache changed: ${changedCache}.`);
