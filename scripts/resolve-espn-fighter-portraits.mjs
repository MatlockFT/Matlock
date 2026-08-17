import fs from 'node:fs/promises';
import { DATA_PATH, norm } from './upcoming-events-data.mjs';

const CACHE_PATH = '_data/fighter_portraits.json';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockPortraitResolver/2.6; +https://matlockfighttalk.com/)';
const TIMEOUT = 16000;
const SHERDOG = 'https://www.sherdog.com';
const tracking=/(?:piwik|matomo|analytics|tracking|pixel|beacon)/i;
const badPortrait=/(?:\/articles?\/|\/news\/|\/galleries?\/|\/thumbnails?\/|\/fighters\/(?:bodyshots|headshots)\/default-(?:male|female)\.(?:png|jpe?g|webp)(?:\?|$)|(?:^|[\/_-])(?:banner|sponsor|poster|promo|placeholder)(?:[\/_-]|$))/i;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const VERIFIED_PORTRAIT_HINTS = new Map([
  ['ramazan temirov', {
    url: 'https://www.ufc.com/images/styles/athlete_bio_full_body/s3/2024-11/TEMIROV_RAMAZAN_L_10-12.png?itok=WmQP_Yk4',
    source: 'ufc',
    framing: 'safe'
  }]
]);

const ESPN_ID_HINTS = new Map([
  ['ketlen vieira','4039865'],
  ['javid basharat','4867357'],
  ['morquez forest','5271265']
]);

const SHERDOG_PROFILE_HINTS = new Map([
  ['morquez forest','https://www.sherdog.com/fighter/Morquez-Forest-392364'],
  ['aoriqileng','https://www.sherdog.com/fighter/Qileng-Aori-222519'],
  ['sumudaerji','https://www.sherdog.com/fighter/Su-Mudaerji-228263'],
  ['fares ziam','https://www.sherdog.com/fighter/Fares-Ziam-184241'],
  ['jj aldrich','https://www.sherdog.com/fighter/JJ-Aldrich-75565']
]);

const SHERDOG_NAME_ALIASES = new Map([
  ['aoriqileng','qileng aori'],
  ['sumudaerji','su mudaerji'],
  ['fares ziam','fares ziam'],
  ['jj aldrich','j j aldrich']
]);

async function get(url, asJson=false) {
  let last;
  for (let attempt=0; attempt<2; attempt++) {
    try {
      const response = await fetch(url,{
        redirect:'follow',
        signal:AbortSignal.timeout(TIMEOUT),
        headers:{'user-agent':UA,accept:asJson?'application/json,*/*':'text/html,application/xhtml+xml,*/*'}
      });
      if(response.ok)return asJson?response.json():response.text();
      last=new Error(`${response.status} ${url}`);
    } catch(error){last=error;}
    if(attempt===0)await sleep(300);
  }
  throw last;
}

async function imageWorks(url) {
  if(!url||tracking.test(url)||badPortrait.test(url))return false;
  try{
    const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{'user-agent':UA,accept:'image/*,*/*;q=0.8',range:'bytes=0-2047'}});
    return (response.ok||response.status===206)&&((response.headers.get('content-type')||'').toLowerCase().startsWith('image/')||/\.(png|jpe?g|webp)(?:\?|$)/i.test(response.url));
  }catch{return false;}
}

function decodeHtml(value=''){
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16)))
    .replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(Number(x)))
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
}

function stripHtml(value=''){
  return decodeHtml(String(value).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
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

    const strongSet=new Set(strong);
    let checked=0;
    for(const id of collectCandidateIds(json)){
      if(strongSet.has(id))continue;
      if(++checked>24)break;
      if(await usableEspnId(id,wanted,{requireName:true}))return id;
    }
  }catch{}
  return '';
}

function sherdogProfileMatches(page,name){
  const requested=norm(name);
  const wanted=SHERDOG_NAME_ALIASES.get(requested)||requested;
  const tokens=wanted.split(/\s+/).filter(Boolean);
  const title=norm(decodeHtml((page.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||''));
  if(!title||!wanted)return false;
  if(title===wanted||title.startsWith(`${wanted} `)||title.includes(`${wanted} mma`))return true;
  return tokens.length>1&&tokens.every(token=>title.includes(token));
}

function sherdogProfileImage(page){
  const candidates=[];
  for(const rx of [
    /<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
    /<meta\b[^>]*name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
    /<img\b[^>]*class=["'][^"']*(?:profile_image|fighter)[^"']*["'][^>]*(?:src|data-src)=["']([^"']+)["']/i,
    /<img\b[^>]*(?:src|data-src)=["']([^"']+)["'][^>]*class=["'][^"']*(?:profile_image|fighter)[^"']*["']/i
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

function sherdogSearchProfiles(page,name){
  const requested=norm(name);
  const wanted=SHERDOG_NAME_ALIASES.get(requested)||requested;
  const tokens=wanted.split(/\s+/).filter(Boolean),hits=[];
  const seen=new Set();
  for(const row of page.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const html=row[1],rowText=norm(stripHtml(html));
    for(const link of html.matchAll(/<a\b[^>]*href=["'](\/fighter\/[a-z0-9][a-z0-9-]*-\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
      const href=new URL(link[1],SHERDOG).toString(),label=norm(stripHtml(link[2]));
      if(seen.has(href))continue;
      let score=0;
      if(label===wanted)score=100;
      else if(label&&wanted&&(label.includes(wanted)||wanted.includes(label)))score=90;
      else if(tokens.length>1&&tokens.every(token=>rowText.includes(token)))score=80;
      if(score){seen.add(href);hits.push({href,score});}
    }
  }
  return hits.sort((a,b)=>b.score-a.score).map(hit=>hit.href).slice(0,4);
}

async function sherdogPortraitByName(name){
  const requested=norm(name),profiles=[];
  const hinted=SHERDOG_PROFILE_HINTS.get(requested);
  if(hinted)profiles.push(hinted);

  try{
    const query=SHERDOG_NAME_ALIASES.get(requested)||name;
    const search=await get(`${SHERDOG}/stats/fightfinder?SearchTxt=${encodeURIComponent(query)}`);
    profiles.push(...sherdogSearchProfiles(search,name));
  }catch{}

  for(const profile of [...new Set(profiles)]){
    try{
      const page=await get(profile);
      if(!sherdogProfileMatches(page,name))continue;
      const image=sherdogProfileImage(page);
      if(image&&await imageWorks(image))return image;
    }catch{}
  }
  return '';
}

const data=JSON.parse(await fs.readFile(DATA_PATH,'utf8'));
let cache={};try{cache=JSON.parse(await fs.readFile(CACHE_PATH,'utf8'));}catch{}
delete cache[''];
const fighters=[];
const lookupByName=new Map();
for(const event of data.events||[]){
  for(const section of event.sections||[])for(const bout of section.bouts||[])for(const person of bout.fighters||[]){
    fighters.push(person);
    const key=norm(person.name);
    const cached=key?cache[key]:null;
    if(key&&!person.image&&!cached?.url&&!lookupByName.has(key))lookupByName.set(key,person.name);
  }
}

let added=0,applied=0,cleaned=0,cacheCleaned=0,sherdogAdded=0,verifiedAdded=0,unresolved=0;
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

  const verified=VERIFIED_PORTRAIT_HINTS.get(key);
  if(verified?.url&&await imageWorks(verified.url)){
    cache[key]={url:verified.url,source:verified.source||'external',framing:verified.framing||'safe'};
    verifiedAdded++;
    console.log(`Resolved verified portrait: ${name}`);
    continue;
  }

  const id=await espnIdByName(name);
  if(id){cache[key]={url:`https://a.espncdn.com/i/headshots/mma/players/full/${id}.png`,source:'espn',framing:'standard'};added++;console.log(`Resolved ESPN portrait: ${name} -> ${id}`);continue;}

  const sherdog=await sherdogPortraitByName(name);
  if(sherdog){cache[key]={url:sherdog,source:'sherdog',framing:'safe'};sherdogAdded++;console.log(`Resolved Sherdog portrait: ${name}`);continue;}

  unresolved++;
  console.warn(`Portrait unresolved: ${name}`);
}

for(const person of fighters){
  if(person.image)continue;
  const hit=cache[norm(person.name)];
  if(!hit?.url||badPortrait.test(hit.url))continue;
  person.image=hit.url;person.image_source=hit.source||'';person.image_framing=hit.framing||'';applied++;
}

await fs.writeFile(CACHE_PATH,JSON.stringify(Object.fromEntries(Object.entries(cache).sort(([a],[b])=>a.localeCompare(b))),null,2)+'\n');
if(applied||cleaned)await fs.writeFile(DATA_PATH,JSON.stringify(data,null,2)+'\n');
console.log(`Fallback portrait lookup targeted ${lookupByName.size} currently blank fighter(s); added ${verifiedAdded} verified, ${added} ESPN and ${sherdogAdded} Sherdog portrait(s); applied ${applied}; unresolved ${unresolved}; removed ${cleaned} bad event portrait(s) and ${cacheCleaned} bad cache entr${cacheCleaned===1?'y':'ies'}.`);