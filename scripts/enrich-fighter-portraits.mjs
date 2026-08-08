import fs from 'node:fs/promises';

const TARGET = 'upcoming-events.html';
const CACHE_PATH = '_data/fighter_portraits.json';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockPortraitResolver/2.0; +https://matlockfighttalk.com/)';
const TIMEOUT = 8000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const decode = (s='') => s.replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(+x)).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
const text = (s='') => decode(s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const norm = (s='') => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const slug = s => norm(s).replace(/\s+/g,'-');
const esc = (s='') => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const imageChecks = new Map();

async function fetchText(url) {
  let last;
  for (let i=0;i<2;i++) {
    try {
      const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{'user-agent':UA,accept:'text/html,application/xhtml+xml,*/*'}});
      if (r.ok) return await r.text();
      last=new Error(`${r.status} ${url}`);
    } catch (e) { last=e; }
    if (i===0) await sleep(250);
  }
  throw last;
}

async function usableImage(url) {
  if (!/^https?:\/\//i.test(url||'')) return false;
  if (imageChecks.has(url)) return imageChecks.get(url);
  const check=(async()=>{
    try {
      let r=await fetch(url,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{'user-agent':UA,accept:'image/*,*/*;q=0.8'}});
      if (!r.ok || !(r.headers.get('content-type')||'').toLowerCase().startsWith('image/')) {
        r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(TIMEOUT),headers:{'user-agent':UA,accept:'image/*,*/*;q=0.8',range:'bytes=0-2047'}});
      }
      if (!r.ok && r.status!==206) return false;
      const type=(r.headers.get('content-type')||'').toLowerCase();
      return type.startsWith('image/') || /\.(png|jpe?g|webp)(?:\?|$)/i.test(r.url);
    } catch { return false; }
  })();
  imageChecks.set(url,check);
  return check;
}

function attrs(tag) {
  const out={};
  for (const m of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gi)) out[m[1].toLowerCase()]=decode(m[3]);
  return out;
}
function imageCandidates(html,name) {
  const n=norm(name), s=slug(name), out=[];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const a=attrs(m[0]);
    const src=a.src||a['data-src']||a['data-lazy-src']||a.srcset?.split(',')[0]?.trim()?.split(/\s+/)[0]||'';
    if (!src) continue;
    const alt=norm(a.alt||''); let score=0;
    if (alt===n) score+=120; else if (alt && (alt.includes(n)||n.includes(alt))) score+=90;
    if (/fighter\s*(image|headshot|photo)/i.test(a.alt||'')) score+=45;
    if (norm(src).includes(n) || src.toLowerCase().includes(s)) score+=45;
    if (/pflmma\.com|pfl-cdn|cloudfront/i.test(src)) score+=15;
    if (/logo|flag|icon|banner|sponsor|placeholder|background/i.test(`${a.alt||''} ${src}`)) score-=120;
    if (score>20) try { out.push({url:new URL(src,'https://pflmma.com').toString(),score}); } catch {}
  }
  const og=(html.match(/<meta\b[^>]*(?:property|name)=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i)||[])[1];
  if (og) out.push({url:decode(og),score:25});
  return out.sort((a,b)=>b.score-a.score);
}
async function resolveFromPfl(name,eventHtml='') {
  const seen=new Set(), pages=[];
  if (eventHtml) pages.push(eventHtml);
  for (const path of [`/all-fighter/${slug(name)}`,`/regular-fighter/${slug(name)}`]) try { pages.push(await fetchText(`https://pflmma.com${path}`)); } catch {}
  for (const page of pages) for (const c of imageCandidates(page,name)) {
    if (seen.has(c.url)) continue; seen.add(c.url);
    if (await usableImage(c.url)) return c.url;
  }
  return '';
}
function sourceFor(url) {
  if (/espncdn\.com/i.test(url)) return 'espn';
  if (/rizin|d1uzk9o9cg136f\.cloudfront\.net/i.test(url)) return 'rizin';
  if (/pflmma\.com|pfl-cdn/i.test(url)) return 'pfl';
  return 'external';
}
const framingFor = source => source==='espn' ? 'standard' : 'safe';

const original=await fs.readFile(TARGET,'utf8');
let cache={}; try { cache=JSON.parse(await fs.readFile(CACHE_PATH,'utf8')); } catch {}

const pflNames=new Set();
const eventPages=[];
for (const m of original.matchAll(/<section\b[^>]*class=["'][^"']*upcoming-event-card[^"']*["'][^>]*>[\s\S]*?<\/section>/gi)) {
  const card=m[0];
  if (!/<p\s+class=["']event-promotion["']>\s*PFL\s*<\/p>/i.test(card)) continue;
  for (const n of card.matchAll(/<p\s+class=["']fighter-name["']>([\s\S]*?)<\/p>/gi)) {
    const key=norm(text(n[1])); if (key) pflNames.add(key);
  }
  const url=decode((card.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>Official event page/i)||[])[1]||'');
  if (url && /pflmma\.com/i.test(url)) try { eventPages.push({url,html:await fetchText(url)}); } catch {}
}

const fighters=[...original.matchAll(/<div class=["']fighter["']>([\s\S]*?)<p class=["']fighter-name["']>(.*?)<\/p>\s*<\/div>/gi)].map(m=>({inner:m[1],name:text(m[2])}));
const resolved=new Map();
for (const f of fighters) {
  const key=norm(f.name); if (!key || resolved.has(key)) continue;
  const current=decode((f.inner.match(/<img\b[^>]*data-fighter-photo[^>]*src=["']([^"']+)["']/i)||[])[1]||'');
  let hit=null;
  if (current && await usableImage(current)) {
    const source=sourceFor(current); hit={url:current,source,framing:framingFor(source)};
  } else if (cache[key]?.url && await usableImage(cache[key].url)) {
    hit={url:cache[key].url,source:cache[key].source||sourceFor(cache[key].url),framing:cache[key].framing||framingFor(cache[key].source||sourceFor(cache[key].url))};
  } else if (pflNames.has(key)) {
    const page=eventPages.find(e=>norm(text(e.html)).includes(key));
    const url=await resolveFromPfl(f.name,page?.html||'');
    if (url) { const source=sourceFor(url); hit={url,source,framing:framingFor(source)}; }
  }
  if (hit) cache[key]=hit;
  resolved.set(key,hit);
}

const updated=original.replace(/<div class=["']fighter["']>([\s\S]*?)<p class=["']fighter-name["']>(.*?)<\/p>\s*<\/div>/gi,(full,inner,nameHtml)=>{
  const name=text(nameHtml), hit=resolved.get(norm(name)); if (!hit) return full;
  const fallback=text((inner.match(/<span\b[^>]*class=["']fighter-fallback["'][^>]*>([\s\S]*?)<\/span>/i)||[])[1]||'');
  const photo=`<div class="fighter-photo"><span class="fighter-fallback" aria-hidden="true">${esc(fallback)}</span><img data-fighter-photo data-portrait-source="${esc(hit.source)}" data-portrait-framing="${esc(hit.framing)}" src="${esc(hit.url)}" alt="${esc(name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></div>`;
  const replaced=/<div class=["']fighter-photo[^"']*["'][^>]*>[\s\S]*?<\/div>/i.test(inner) ? inner.replace(/<div class=["']fighter-photo[^"']*["'][^>]*>[\s\S]*?<\/div>/i,photo) : photo+inner;
  return `<div class="fighter">${replaced}<p class="fighter-name">${nameHtml}</p></div>`;
});

await fs.writeFile(CACHE_PATH,JSON.stringify(Object.fromEntries(Object.entries(cache).sort(([a],[b])=>a.localeCompare(b))),null,2)+'\n');
if (updated!==original) await fs.writeFile(TARGET,updated);
console.log(`Portrait enrichment complete: ${[...resolved.values()].filter(Boolean).length}/${resolved.size} unique fighters resolved.`);
