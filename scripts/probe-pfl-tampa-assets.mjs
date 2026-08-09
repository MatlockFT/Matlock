import fs from 'node:fs/promises';

const PAGE='https://pflmma.com/event/pfl-tampa';
const OUT='_data/pfl_tampa_asset_probe.json';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const headers={'user-agent':UA,'accept-language':'en-US,en;q=0.9','cache-control':'no-cache'};

async function get(url){
  const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(30000),headers:{...headers,accept:'text/html,application/javascript,*/*'}});
  if(!response.ok)throw new Error(`${response.status} ${url}`);
  return response.text();
}
function decode(s=''){return s.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');}
function unique(values){return [...new Set(values.filter(Boolean))];}
function attrs(tag){const out={};for(const m of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gi))out[m[1].toLowerCase()]=decode(m[3]);return out;}
function absolute(raw,base=PAGE){try{return new URL(raw,base).toString();}catch{return'';}}
function snippets(source,needle,radius=140){
  const out=[];let from=0;
  while(out.length<8){const i=source.toLowerCase().indexOf(needle.toLowerCase(),from);if(i<0)break;out.push(source.slice(Math.max(0,i-radius),Math.min(source.length,i+needle.length+radius)).replace(/\s+/g,' '));from=i+needle.length;}
  return out;
}

const html=await get(PAGE);
const imageTags=[];
for(const m of html.matchAll(/<img\b[^>]*>/gi)){
  const a=attrs(m[0]);
  const raw=a.src||a['data-src']||a['data-lazy-src']||'';
  const url=absolute(raw);
  if(!/fighters\/(?:bodyshots|headshots)\//i.test(url))continue;
  imageTags.push({url,alt:a.alt||'',class:a.class||''});
}
const rawFighterAssets=unique([...html.matchAll(/https?:\\?\/\\?\/[^"'\s)>]*fighters\\?\/(?:bodyshots|headshots)\\?\/[^"'\s)>]+/gi)].map(m=>decode(m[0].replaceAll('\\/','/'))));
const scripts=unique([...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(m=>absolute(decode(m[1])))).filter(url=>/^https?:\/\//i.test(url));

const jsFindings=[];
for(const url of scripts.slice(0,30)){
  try{
    const js=await get(url);
    if(!/(matchup|bodyshots|headshots|fighter|event)/i.test(js))continue;
    const paths=unique([
      ...[...js.matchAll(/["'`]([^"'`]{0,180}(?:matchup|fighters?|events?|ajax|api)[^"'`]{0,180})["'`]/gi)].map(m=>m[1]),
      ...[...js.matchAll(/https?:\/\/[^"'`\s)]+/gi)].map(m=>m[0])
    ]).filter(value=>/(matchup|fighters?|events?|ajax|api)/i.test(value)).slice(0,40);
    if(paths.length)jsFindings.push({url,paths});
  }catch(error){jsFindings.push({url,error:String(error.message||error)});}
}

const result={
  generated_at:new Date().toISOString(),
  page:PAGE,
  html_length:html.length,
  has_morquez:/Morquez\s+Forest/i.test(html),
  has_cyborg:/Cris\s+Cyborg|\bCyborg\b/i.test(html),
  image_tags:imageTags,
  raw_fighter_assets:rawFighterAssets,
  script_urls:scripts,
  morquez_snippets:snippets(html,'Morquez'),
  bodyshot_snippets:snippets(html,'bodyshots'),
  matchup_snippets:snippets(html,'matchup'),
  js_findings:jsFindings
};
await fs.writeFile(OUT,JSON.stringify(result,null,2)+'\n');
console.log(`Wrote ${OUT}: ${imageTags.length} fighter img tag(s), ${rawFighterAssets.length} raw fighter asset(s), ${jsFindings.length} relevant script(s).`);
