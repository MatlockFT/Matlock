import fs from 'node:fs/promises';
import { DATA_PATH, norm } from './upcoming-events-data.mjs';

const CACHE_PATH='_data/fighter_portraits.json';
const UA='Mozilla/5.0 (compatible; MMAMatlockPortraitResolver/3.0; +https://matlockfighttalk.com/)';
const TIMEOUT=8000;
const tracking=/(?:piwik|matomo|google-analytics|googletagmanager|doubleclick|analytics|tracking|pixel|beacon|\/collect(?:[/?]|$)|\/track(?:[/?]|$))/i;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function fetchText(url){let last;for(let i=0;i<2;i++){try{const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{'user-agent':UA,accept:'text/html,application/xhtml+xml,*/*'}});if(r.ok)return await r.text();last=new Error(`${r.status} ${url}`);}catch(e){last=e;}if(i===0)await sleep(250);}throw last;}
async function usableImage(url){if(!/^https?:\/\//i.test(url||'')||tracking.test(url))return false;try{let r=await fetch(url,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{'user-agent':UA,accept:'image/*,*/*;q=0.8'}});if(!r.ok||!(r.headers.get('content-type')||'').toLowerCase().startsWith('image/'))r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{'user-agent':UA,accept:'image/*,*/*;q=0.8',range:'bytes=0-2047'}});if(!r.ok&&r.status!==206)return false;const type=(r.headers.get('content-type')||'').toLowerCase();return type.startsWith('image/')||/\.(png|jpe?g|webp)(?:\?|$)/i.test(r.url);}catch{return false;}}
const decode=(s='')=>s.replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(+x)).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&#39;|&apos;/gi,"'");
function attrs(tag){const out={};for(const m of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gi))out[m[1].toLowerCase()]=decode(m[3]);return out;}
function slug(name){return norm(name).replace(/\s+/g,'-');}
function imageCandidates(html,name){const n=norm(name),s=slug(name),out=[];for(const m of html.matchAll(/<img\b[^>]*>/gi)){const a=attrs(m[0]),src=a.src||a['data-src']||a['data-lazy-src']||a.srcset?.split(',')[0]?.trim()?.split(/\s+/)[0]||'';if(!src||tracking.test(src))continue;const alt=norm(a.alt||'');let score=0;if(alt===n)score+=120;else if(alt&&(alt.includes(n)||n.includes(alt)))score+=90;if(norm(src).includes(n)||src.toLowerCase().includes(s))score+=45;if(/pflmma\.com|pfl-cdn|cloudfront/i.test(src))score+=15;if(/logo|flag|icon|banner|sponsor|placeholder|background/i.test(`${a.alt||''} ${src}`))score-=120;if(score>20)try{out.push({url:new URL(src,'https://pflmma.com').toString(),score});}catch{}}return out.sort((a,b)=>b.score-a.score);}
async function resolveFromPfl(name){for(const path of [`/all-fighter/${slug(name)}`,`/regular-fighter/${slug(name)}`])try{const page=await fetchText(`https://pflmma.com${path}`);for(const candidate of imageCandidates(page,name))if(await usableImage(candidate.url))return candidate.url;}catch{}return'';}
function sourceFor(url){if(/espncdn\.com/i.test(url))return'espn';if(/d1uzk9o9cg136f\.cloudfront\.net|rizin/i.test(url))return'rizin';if(/pflmma\.com|pfl-cdn/i.test(url))return'pfl';return'external';}
const framingFor=source=>source==='espn'?'standard':'safe';

const data=JSON.parse(await fs.readFile(DATA_PATH,'utf8'));
let cache={};try{cache=JSON.parse(await fs.readFile(CACHE_PATH,'utf8'));}catch{}
delete cache[''];
const fighters=[];for(const event of data.events||[])for(const section of event.sections||[])for(const bout of section.bouts||[])for(const person of bout.fighters||[])fighters.push({person,promotion:event.promotion_key});

let changedData=false,changedCache=false;
for(const {person,promotion} of fighters){
  const key=norm(person.name);if(!key)continue;
  if(person.image&&await usableImage(person.image)){if(!cache[key]?.url){const source=person.image_source||sourceFor(person.image);cache[key]={url:person.image,source,framing:person.image_framing||framingFor(source)};changedCache=true;}continue;}
  let hit=cache[key];if(hit?.url&&!(await usableImage(hit.url)))hit=null;
  if(!hit&&promotion==='pfl'){const url=await resolveFromPfl(person.name);if(url){const source=sourceFor(url);hit={url,source,framing:framingFor(source)};cache[key]=hit;changedCache=true;}}
  if(hit){person.image=hit.url;person.image_source=hit.source||sourceFor(hit.url);person.image_framing=hit.framing||framingFor(person.image_source);changedData=true;}
}

if(changedCache)await fs.writeFile(CACHE_PATH,JSON.stringify(Object.fromEntries(Object.entries(cache).sort(([a],[b])=>a.localeCompare(b))),null,2)+'\n');
if(changedData)await fs.writeFile(DATA_PATH,JSON.stringify(data,null,2)+'\n');
console.log(`Portrait enrichment complete. Data changed: ${changedData}; cache changed: ${changedCache}.`);
