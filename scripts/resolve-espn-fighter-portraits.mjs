import fs from 'node:fs/promises';
import { DATA_PATH, norm } from './upcoming-events-data.mjs';

const CACHE_PATH = '_data/fighter_portraits.json';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockPortraitResolver/2.4; +https://matlockfighttalk.com/)';
const TIMEOUT = 20000;
const LOOKUP_HORIZON_DAYS = 21;
const SHERDOG = 'https://www.sherdog.com';
const tracking=/(?:piwik|matomo|analytics|tracking|pixel|beacon)/i;
const badPortrait=/(?:\/articles?\/|\/news\/|\/galleries?\/|\/thumbnails?\/|\/fighters\/(?:bodyshots|headshots)\/default-(?:male|female)\.(?:png|jpe?g|webp)(?:\?|$)|(?:^|[\/_-])(?:banner|sponsor|poster|promo|placeholder)(?:[\/_-]|$))/i;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// These are verified ESPN athlete IDs for fighters whose search results have
// historically been inconsistent in ESPN's search API. They are hints only;
// the portrait URL still has to resolve successfully before it is used.
const ESPN_ID_HINTS = new Map([
  ['ketlen vieira','4039865'],
  ['javid basharat','4867357'],
  ['morquez forest','5271265']
]);

// Last-resort profile hints are used only when a fighter is still blank after
// verified promotion imagery and ESPN resolution. The Sherdog page title must
// match the fighter and the extracted URL must be an actual fighter image.
const SHERDOG_PROFILE_HINTS = new Map([
  ['morquez forest','https://www.sherdog.com/fighter/Morquez-Forest-392364']
]);

async function get(url, asJson=false) {
  let last;
  for (let attempt=0; attempt<2; attempt++) {
    try {
      const response = await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{'user-agent':UA,accept:asJson?'application/json,*/*':'text/html,*/*'}});
      if(response.ok)return asJson?response.json():response.text();
      last=new Error(`${response.status} ${url}`);
    } catch(error){last=error;}
    await sleep(400);
  }
  throw last;
}

async function imageWorks(url) {
  if(!url||tracking.test(url)||badPortrait.test(url))return false;
  try{const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{'user-agent':UA,accept:'image/*,*/*;q=0.8'}});return response.ok&&((response.headers.get('content-type')||'').startsWith('image/')||/\.(png|jpe?g|webp)(?:\?|$)/i.test(response.url));}catch{return false;}
}

function decodeHtml(value=''){
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16)))
    .replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(Number(x)))
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
}

function collectMatchingIds(node,wanted,found=new Set()) {
  if(!node||typeof node!=='object')return found;
  if(Array.isArray(node)){for(const value of node)collectMatchingIds(value,wanted,found);return found;}
  const name=norm(node.displayName||node.fullName||node.name||node.shortName||node.title||''),id=String(node.id||node.uid||'').match(/\d{4,}/g)?.at(-1);
  if(id&&name&&(name===wanted||name.includes(wanted)||wanted.includes(name)))found.add(id);
  for(const value of Object.values(node))collectMatchingIds(value,wanted,found);
  return found;
}

function collectCandidateIds(node,found=new Set()) {
  if(!node||typeof node!=='object')return found;
  if(Array.isArray(node)){for(const value of node)collectCandidateIds(value,found);return found;}
  for(const [key,value] of Object.entries(node)){
    if(/(?:^|_)(?:id|uid)$/i.test(key)||/athlete.*id/i.test(key)){
      for(const id of String(value??'').match(/\d{4,}/g)||[])found.add(id);
    }
    if(value&&typeof value==='object')collectCandidateIds(value,found);
  }
  return found;
}

async function athleteNameCheck(id,wanted) {
  try{
    const json=await get(`https://site.api.espn.com/apis/site/v2/sports/mma/ufc/athletes/${id}`,true);
    const athlete=json?.athlete||json;
    const name=norm(athlete?.displayName||athlete?.fullName||athlete?.name||athlete?.shortName||'');
    if(!name)return null;
    return name===wanted||name.includes(wanted)||wanted.includes(name);
  }catch{return null;}
}

async function usableEspnId(id,wanted,{requireName=false}={}) {
  if(!id)return false;
  const portrait=`https://a.espncdn.com/i/headshots/mma/players/full/${id}.png`;
  if(!(await imageWorks(portrait)))return false;
  const matches=await athleteNameCheck(id,wanted);
  if(matches===false)return false;
  if(requireName&&matches!==true)return false;
  return true;
}

async function espnIdByName(name) {
  const wanted=norm(name),query=encodeURIComponent(name);

  const hinted=ESPN_ID_HINTS.get(wanted);
  if(hinted&&await usableEspnId(hinted,wanted))return hinted;

  try{
    const json=await get(`https://site.web.api.espn.com/apis/search/v2?region=us&lang=en&query=${query}&limit=20`,true);
    const strong=[...collectMatchingIds(json,wanted)];
    for(const id of strong)if(await usableEspnId(id,wanted))return id;

    // ESPN occasionally places the athlete name and athlete ID in neighboring
    // objects instead of the same object. As a fallback, inspect candidate IDs
    // from the search response but require ESPN's athlete endpoint to confirm
    // the exact fighter identity before accepting one.
    const strongSet=new Set(strong);
    let checked=0;
    for(const id of collectCandidateIds(json)){
      if(strongSet.has(id))continue;
      if(++checked>30)break;
      if(await usableEspnId(id,wanted,{requireName:true}))return id;
    }
  }catch{}
  return '';
}

function sherdogProfileMatches(page,name){
  const wanted=norm(name);
  const title=norm(decodeHtml((page.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||''));
  if(!title||!wanted)return false;
  return title===wanted||title.startsWith(`${wanted} `)||title.includes(`${wanted} mma`);
}

function sherdogProfileImage(page){
  const candidates=[];
  for(const rx of [
    /<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
    /<meta\b[^>]*name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
    /<img\b[^>]*class=["'][^"']*(?:profile_image|fighter)[^"']*["'][^>]*src=["']([^"']+)["']/i,
    /<img\b[^>]*src=["']([^"']+)["'][^>]*class=["'][^"']*(?:profile_image|fighter)[^"']*["']/i
  ]){
    const hit=page.match(rx)?.[1];
    if(hit)candidates.push(decodeHtml(hit));
  }
  for(const candidate of candidates){
    try{
      const url=new URL(candidate,SHERDOG).toString();
      if(/(?:\/image_crop\/[^/]+\/[^/]+\/_images\/fighter\/|\/_images\/fighter\/)/i.test(url)&&!tracking.test(url)&&!badPortrait.test(url))return url;
    }catch{}
  }
  return '';
}

async function sherdogPortraitByName(name){
  const wanted=norm(name),profile=SHERDOG_PROFILE_HINTS.get(wanted);
  if(!profile)return '';
  try{
    const page=await get(profile);
    if(!sherdogProfileMatches(page,name))return '';
    const image=sherdogProfileImage(page);
    if(image&&await imageWorks(image))return image;
  }catch{}
  return '';
}

function eventNeedsPortraitLookup(event, now=Date.now()) {
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(event?.date||''))return false;
  const eventTime=Date.parse(`${event.date}T12:00:00Z`);
  if(Number.isNaN(eventTime))return false;
  const ageDays=(eventTime-now)/86400000;
  return ageDays>=-1&&ageDays<=LOOKUP_HORIZON_DAYS;
}

const data=JSON.parse(await fs.readFile(DATA_PATH,'utf8'));
let cache={};try{cache=JSON.parse(await fs.readFile(CACHE_PATH,'utf8'));}catch{}
delete cache[''];
const fighters=[];
const lookupByName=new Map();
for(const event of data.events||[]){
  const shouldLookup=eventNeedsPortraitLookup(event);
  for(const section of event.sections||[])for(const bout of section.bouts||[])for(const person of bout.fighters||[]){
    fighters.push(person);
    const key=norm(person.name);
    if(shouldLookup&&key&&!lookupByName.has(key))lookupByName.set(key,person.name);
  }
}

let added=0,applied=0,cleaned=0,cacheCleaned=0,sherdogAdded=0;
for(const person of fighters){
  if(person.image&&badPortrait.test(person.image)){
    person.image='';person.image_source='';person.image_framing='';cleaned++;
  }
}

for(const [key,name] of lookupByName){
  if(cache[key]?.url&&badPortrait.test(cache[key].url)){delete cache[key];cacheCleaned++;}
  if(cache[key]?.url)continue;
  const existing=fighters.find(f=>norm(f.name)===key&&f.image&&!tracking.test(f.image)&&!badPortrait.test(f.image));
  if(existing){cache[key]={url:existing.image,source:existing.image_source||'external',framing:existing.image_framing||'safe'};continue;}

  const id=await espnIdByName(name);
  if(id){cache[key]={url:`https://a.espncdn.com/i/headshots/mma/players/full/${id}.png`,source:'espn',framing:'standard'};added++;console.log(`Resolved ESPN portrait: ${name} -> ${id}`);continue;}

  const sherdog=await sherdogPortraitByName(name);
  if(sherdog){cache[key]={url:sherdog,source:'sherdog',framing:'safe'};sherdogAdded++;console.log(`Resolved Sherdog fallback portrait: ${name}`);}
}

for(const person of fighters){
  if(person.image)continue;const hit=cache[norm(person.name)];if(!hit?.url||badPortrait.test(hit.url))continue;
  person.image=hit.url;person.image_source=hit.source||'';person.image_framing=hit.framing||'';applied++;
}

await fs.writeFile(CACHE_PATH,JSON.stringify(Object.fromEntries(Object.entries(cache).sort(([a],[b])=>a.localeCompare(b))),null,2)+'\n');
if(applied||cleaned)await fs.writeFile(DATA_PATH,JSON.stringify(data,null,2)+'\n');
console.log(`Fallback portrait lookup checked ${lookupByName.size} near-term fighter(s) within ${LOOKUP_HORIZON_DAYS} days; added ${added} ESPN and ${sherdogAdded} Sherdog portrait(s); applied ${applied}; removed ${cleaned} bad event portrait(s) and ${cacheCleaned} bad cache entr${cacheCleaned===1?'y':'ies'}.`);
