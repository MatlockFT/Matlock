import fs from 'node:fs/promises';
import { DATA_PATH, norm } from './upcoming-events-data.mjs';

const CACHE_PATH = '_data/fighter_portraits.json';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockPortraitResolver/2.1; +https://matlockfighttalk.com/)';
const TIMEOUT = 20000;
const tracking=/(?:piwik|matomo|analytics|tracking|pixel|beacon)/i;
const badPortrait=/(?:\/articles?\/|\/news\/|\/galleries?\/|\/thumbnails?\/|\/fighters\/(?:bodyshots|headshots)\/default-(?:male|female)\.(?:png|jpe?g|webp)(?:\?|$)|(?:^|[\/_-])(?:banner|sponsor|poster|promo|placeholder)(?:[\/_-]|$))/i;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

function collectMatchingIds(node,wanted,found=new Set()) {
  if(!node||typeof node!=='object')return found;
  if(Array.isArray(node)){for(const value of node)collectMatchingIds(value,wanted,found);return found;}
  const name=norm(node.displayName||node.fullName||node.name||node.shortName||node.title||''),id=String(node.id||node.uid||'').match(/\d{4,}/)?.[0];
  if(id&&name&&(name===wanted||name.includes(wanted)||wanted.includes(name)))found.add(id);
  for(const value of Object.values(node))collectMatchingIds(value,wanted,found);
  return found;
}

async function espnIdByName(name) {
  const wanted=norm(name),query=encodeURIComponent(name);
  try{
    const json=await get(`https://site.web.api.espn.com/apis/search/v2?region=us&lang=en&query=${query}&limit=20`,true);
    for(const id of collectMatchingIds(json,wanted)){const portrait=`https://a.espncdn.com/i/headshots/mma/players/full/${id}.png`;if(await imageWorks(portrait))return id;}
  }catch{}
  return '';
}

const data=JSON.parse(await fs.readFile(DATA_PATH,'utf8'));
let cache={};try{cache=JSON.parse(await fs.readFile(CACHE_PATH,'utf8'));}catch{}
delete cache[''];
const fighters=[];
for(const event of data.events||[])for(const section of event.sections||[])for(const bout of section.bouts||[])for(const person of bout.fighters||[])fighters.push(person);

let added=0,applied=0,cleaned=0,cacheCleaned=0;
for(const person of fighters){
  if(person.image&&badPortrait.test(person.image)){
    person.image='';person.image_source='';person.image_framing='';cleaned++;
  }
}

const byName=new Map();
for(const person of fighters){const key=norm(person.name);if(key&&!byName.has(key))byName.set(key,person.name);}
for(const [key,name] of byName){
  if(cache[key]?.url&&badPortrait.test(cache[key].url)){delete cache[key];cacheCleaned++;}
  if(cache[key]?.url)continue;
  const existing=fighters.find(f=>norm(f.name)===key&&f.image&&!tracking.test(f.image)&&!badPortrait.test(f.image));
  if(existing){cache[key]={url:existing.image,source:existing.image_source||'external',framing:existing.image_framing||'safe'};continue;}
  const id=await espnIdByName(name);if(!id)continue;
  cache[key]={url:`https://a.espncdn.com/i/headshots/mma/players/full/${id}.png`,source:'espn',framing:'standard'};added++;console.log(`Resolved ESPN portrait: ${name} -> ${id}`);
}

for(const person of fighters){
  if(person.image)continue;const hit=cache[norm(person.name)];if(!hit?.url||badPortrait.test(hit.url))continue;
  person.image=hit.url;person.image_source=hit.source||'';person.image_framing=hit.framing||'';applied++;
}

await fs.writeFile(CACHE_PATH,JSON.stringify(Object.fromEntries(Object.entries(cache).sort(([a],[b])=>a.localeCompare(b))),null,2)+'\n');
if(applied||cleaned)await fs.writeFile(DATA_PATH,JSON.stringify(data,null,2)+'\n');
console.log(`ESPN name lookup added ${added} portrait(s); applied ${applied} cached portrait(s); removed ${cleaned} bad event portrait(s) and ${cacheCleaned} bad cache entr${cacheCleaned===1?'y':'ies'}.`);
