import fs from 'node:fs/promises';

const DATA_PATH = '_data/event_map_regional.json';
const UA = 'Mozilla/5.0 (compatible; MMAMatlock-EventMap/1.0; +https://mmamatlock.com/event-map/)';
const TODAY = new Date().toISOString().slice(0, 10);
const DAY_MS = 86400000;

const SOURCES = [
  { key: 'lfa_official', name: 'Legacy Fighting Alliance', url: 'https://www.lfa.com/events/', loader: loadLfa },
  { key: 'cage_titans', name: 'Cage Titans', url: 'https://cagetitans.com/upcoming-event', loader: loadCageTitans },
  { key: 'fac_official', name: 'Fighting Alliance Championship', url: 'https://facmma.com/', loader: loadFac },
  { key: 'afc_alaska', name: 'Alaska Fighting Championships', url: 'https://alaskafighting.com/', loader: loadAlaska },
  { key: 'caged_thunder', name: 'Caged Thunder MMA', url: 'https://cagedthundermma.com/upcoming-fights/', loader: loadCagedThunder },
  { key: 'gladiator_challenge', name: 'Gladiator Challenge', url: 'https://gladiatorchallenge.com/', loader: loadGladiatorChallenge },
  { key: 'tuff_n_uff', name: 'Tuff-N-Uff', url: 'https://tuffnuff.com/events/', loader: loadTuffNUff },
  { key: 'xfn_official', name: 'Xtreme Fight Night', url: 'https://www.xfnfighting.com/', loader: loadXfn },
  { key: 'ruf_official', name: 'RUF Nation', url: 'https://rufnation.com/events', loader: loadRuf },
  { key: 'camomma', name: 'California Amateur Mixed Martial Arts Organization', url: 'https://camomma.org/Events-upcoming&sort_dir=ASC&showall=1', loader: loadCamo },
  { key: 'florida_commission', name: 'Florida Athletic Commission', url: 'https://www2.myfloridalicense.com/athletic-commission/commission-upcoming-events-professional/', loader: loadFloridaCommission },
  { key: 'cfc_el_paso', name: 'Combat Fighting Championship', url: 'https://www.cfcshow.com/', loader: loadCfc }
];

const SOURCE_PRIORITY = {
  fury: 100, cffc: 100, '559': 100, peak: 100,
  lfa_official: 100, cage_titans: 100, fac_official: 100,
  afc_alaska: 100, caged_thunder: 100, gladiator_challenge: 100,
  cfc_el_paso: 100, tuff_n_uff: 100, xfn_official: 100, ruf_official: 100,
  spectation: 70, nitro: 60, camomma: 40, florida_commission: 40
};

const STATE_NAMES = new Map([
  ['alabama','AL'],['alaska','AK'],['arizona','AZ'],['arkansas','AR'],['california','CA'],['colorado','CO'],['connecticut','CT'],['delaware','DE'],['district of columbia','DC'],['florida','FL'],['georgia','GA'],['hawaii','HI'],['idaho','ID'],['illinois','IL'],['indiana','IN'],['iowa','IA'],['kansas','KS'],['kentucky','KY'],['louisiana','LA'],['maine','ME'],['maryland','MD'],['massachusetts','MA'],['michigan','MI'],['minnesota','MN'],['mississippi','MS'],['missouri','MO'],['montana','MT'],['nebraska','NE'],['nevada','NV'],['new hampshire','NH'],['new jersey','NJ'],['new mexico','NM'],['new york','NY'],['north carolina','NC'],['north dakota','ND'],['ohio','OH'],['oklahoma','OK'],['oregon','OR'],['pennsylvania','PA'],['rhode island','RI'],['south carolina','SC'],['south dakota','SD'],['tennessee','TN'],['texas','TX'],['utah','UT'],['vermont','VT'],['virginia','VA'],['washington','WA'],['west virginia','WV'],['wisconsin','WI'],['wyoming','WY']
]);
const STATE_CODES = new Set([...STATE_NAMES.values()]);
const COORDS = new Map([
  ['prior lake|MN',[44.7133,-93.4227]],['santa cruz|CA',[36.9741,-122.0308]],['mashantucket|CT',[41.4643,-71.9737]],['niagara falls|NY',[43.0962,-79.0377]],
  ['plymouth|MA',[41.9584,-70.6673]],['independence|MO',[39.0911,-94.4155]],['anchorage|AK',[61.2181,-149.9003]],['akron|OH',[41.0814,-81.5190]],['adelanto|CA',[34.5828,-117.4092]],['el paso|TX',[31.7619,-106.4850]],
  ['las vegas|NV',[36.1699,-115.1398]],['phoenix|AZ',[33.4484,-112.0740]],['tulsa|OK',[36.1540,-95.9928]],
  ['doral|FL',[25.8195,-80.3553]],['jacksonville|FL',[30.3322,-81.6557]],['twentynine palms|CA',[34.1356,-116.0542]],['pleasanton|CA',[37.6624,-121.8747]],['fremont|CA',[37.5485,-121.9886]],['los angeles|CA',[34.0522,-118.2437]],['temecula|CA',[33.4936,-117.1484]],['porterville|CA',[36.0652,-119.0168]],['torrance|CA',[33.8358,-118.3406]],['thousand oaks|CA',[34.1706,-118.8376]],['livingston|CA',[37.3869,-120.7235]],['oakland|CA',[37.8044,-122.2711]],['long beach|CA',[33.7701,-118.1937]],['commerce|CA',[34.0006,-118.1598]],['visalia|CA',[36.3302,-119.2921]],['burbank|CA',[34.1808,-118.3090]],['wheatland|CA',[39.0099,-121.4230]],['san francisco|CA',[37.7749,-122.4194]],['san diego|CA',[32.7157,-117.1611]],['jamestown|CA',[37.9533,-120.4227]]
]);
const MONTHS = new Map([['january',1],['february',2],['march',3],['april',4],['may',5],['june',6],['july',7],['august',8],['september',9],['october',10],['november',11],['december',12],['jan',1],['feb',2],['mar',3],['apr',4],['jun',6],['jul',7],['aug',8],['sep',9],['sept',9],['oct',10],['nov',11],['dec',12]]);
const MONTH_PATTERN = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_TEXT_RE = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?(?:\\s+(20\\d{2}))?\\b`, 'i');
const DATE_DAY_FIRST_RE = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})(?:,)?\\s+(20\\d{2})\\b`, 'i');

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const slug = value => norm(value).replace(/\s+/g,'-').slice(0,90) || 'event';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function decodeEntities(value) {
  return String(value || '').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi,(_,code)=>String.fromCodePoint(parseInt(code,16)));
}
function stripTags(value) { return clean(decodeEntities(String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' '))); }
function htmlLines(html) { return decodeEntities(String(html || '')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'\n').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'\n').replace(/<(?:br|hr)\b[^>]*>/gi,'\n').replace(/<\/(?:p|div|li|h[1-6]|section|article|tr|td|a)>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/\r/g,'\n').split(/\n+/).map(clean).filter(Boolean); }
function absoluteUrl(base, href) { try { return new URL(decodeEntities(href), base).href; } catch { return ''; } }
function attr(tag, name) { const m=String(tag).match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`,'i')); return m?decodeEntities(m[1]):''; }
function anchors(html, base) { const out=[]; for (const m of String(html||'').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) out.push({url:absoluteUrl(base,m[1]),text:stripTags(m[2])}); return out; }
function parseDate(value) {
  const text=clean(value);
  let m=text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/); if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  m=text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/); if(m) return `${m[3]}-${String(Number(m[1])).padStart(2,'0')}-${String(Number(m[2])).padStart(2,'0')}`;
  m=text.match(DATE_DAY_FIRST_RE);
  if(m){ const month=MONTHS.get(m[2].toLowerCase()); if(month) return `${m[3]}-${String(month).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`; }
  m=text.match(DATE_TEXT_RE); if(!m) return '';
  const month=MONTHS.get(m[1].toLowerCase()); if(!month) return '';
  let year=Number(m[3]) || new Date().getUTCFullYear();
  let candidate=`${year}-${String(month).padStart(2,'0')}-${String(Number(m[2])).padStart(2,'0')}`;
  if (!m[3] && new Date(`${candidate}T12:00:00Z`).getTime() < Date.now()-45*DAY_MS) { year+=1; candidate=`${year}-${String(month).padStart(2,'0')}-${String(Number(m[2])).padStart(2,'0')}`; }
  return candidate;
}
function normalizeState(value) { const text=clean(value).replace(/\d{5}(?:-\d{4})?$/,'').trim(); const code=text.toUpperCase(); return STATE_CODES.has(code)?code:(STATE_NAMES.get(text.toLowerCase())||''); }
function coords(city,state) { return COORDS.get(`${clean(city).toLowerCase()}|${state}`)||null; }
function poundWeight(value) { const n=Number(value); return ({115:'Strawweight',125:'Flyweight',135:'Bantamweight',145:'Featherweight',155:'Lightweight',170:'Welterweight',185:'Middleweight',205:'Light Heavyweight',265:'Heavyweight'})[n]||''; }
function weightFromText(value) {
  const text=clean(value); let weight='';
  const named=text.match(/\b(Women'?s\s+(?:Strawweight|Flyweight|Bantamweight|Featherweight)|Light[- ]Heavyweight|Heavyweight|Middleweight|Welterweight|Lightweight|Featherweight|Bantamweight|Flyweight|Strawweight|Catchweight)\b/i);
  if(named) weight=named[1].replace(/light[- ]heavyweight/i,'Light Heavyweight').replace(/women'?s/i,"Women's");
  if(!weight) { const lbs=text.match(/\b(115|125|135|145|155|170|185|205|265)\s*(?:lb|lbs|pounds?)\b/i); if(lbs) weight=poundWeight(lbs[1]); }
  if(weight && /\b(?:title|championship|champion|world championship|belt)\b/i.test(text) && !/Championship$/i.test(weight)) weight += ' Championship';
  return weight;
}
function titleMatchup(value) {
  const text=clean(value);
  let after=text.includes(':')?text.split(':').slice(1).join(':').trim():text;
  after=after.replace(/^LFA\s+\d+\s*[–—-]\s*/i,'').replace(/^TUFF[- ]N[- ]UFF\s+\d+\s*[–—-]\s*/i,'');
  const m=after.match(/^(.{2,70}?)\s+(?:vs\.?|v\.)\s+(.{2,70}?)(?:\s+[–—-]\s+.*)?$/i);
  return m?[clean(m[1]),clean(m[2])]:null;
}
function posterFromHtml(html, base) {
  const imgs=String(html||'').match(/<img\b[^>]*>/gi)||[];
  for(const tag of imgs){ const label=`${attr(tag,'alt')} ${attr(tag,'title')}`; const src=attr(tag,'src')||attr(tag,'data-src')||attr(tag,'data-lazy-src'); if(src && /poster|fight|event/i.test(`${label} ${src}`) && !/logo|favicon|seating|avatar/i.test(`${label} ${src}`)) { const url=absoluteUrl(base,src); if(url) return url; } }
  const metas=String(html||'').match(/<meta\b[^>]*>/gi)||[];
  for(const tag of metas){ const prop=attr(tag,'property')||attr(tag,'name'); if(/^og:image(?::url)?$/i.test(prop)){ const url=absoluteUrl(base,attr(tag,'content')); if(url && !/logo|favicon/i.test(url)) return url; } }
  return '';
}
function walkJson(value, visit){ if(Array.isArray(value)) return value.forEach(v=>walkJson(v,visit)); if(!value||typeof value!=='object') return; visit(value); Object.values(value).forEach(v=>walkJson(v,visit)); }
function jsonLdEvents(html) { const out=[]; for(const m of String(html||'').matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){ try{ const json=JSON.parse(decodeEntities(m[1]).trim()); walkJson(json,node=>{ const types=Array.isArray(node['@type'])?node['@type']:[node['@type']]; if(types.some(t=>String(t||'').toLowerCase()==='event')) out.push(node); }); }catch{} } return out; }
function eventFromValues(source, values) {
  const date=values.date||''; const title=clean(values.title); const city=clean(values.city); const state=normalizeState(values.state);
  if(!date||date<TODAY||!title||!city||!state) return null;
  const event={ id:`${source.key}-${slug(title)}-${date}`, promotion:clean(values.promotion||source.promotion||source.name), promotion_key:source.key, title, date, venue:clean(values.venue), location:`${city}, ${state}`, broadcast:clean(values.broadcast), official_url:values.official_url||source.url, regional:true, level:values.level||source.level||'regional', source_key:source.key, source_label:source.name };
  const point=coords(city,state); if(point){ event.latitude=point[0]; event.longitude=point[1]; }
  const matchup=values.fighters?.length>=2?values.fighters:titleMatchup(title); const weight=clean(values.weight)||weightFromText(`${title} ${values.weightText||''}`);
  if(matchup?.length>=2){ event.main_event={fighters:matchup.slice(0,2)}; if(weight) event.main_event.weight_class=weight; }
  if(values.poster_url) event.poster_url=values.poster_url;
  if(values.ticket_url) event.ticket_url=values.ticket_url;
  if(values.starts_at) event.starts_at=values.starts_at;
  return event;
}
async function fetchHtml(url){ const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(20000),headers:{'user-agent':UA,accept:'text/html,application/xhtml+xml'}}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }

async function loadLfa(source){
  const listing=await fetchHtml(source.url); const links=new Map();
  for(const a of anchors(listing,source.url)){ if(!/\/event\/lfa-\d+/i.test(a.url)) continue; const n=a.text.match(/\bLFA\s+\d+/i)?.[0]||''; links.set(a.url,n||a.text); }
  const out=[];
  for(const [url,fallback] of links){
    try{
      const html=await fetchHtml(url); const eventNode=jsonLdEvents(html)[0]; const lines=htmlLines(html); const flat=stripTags(html);
      const title=clean(eventNode?.name)||lines.find(x=>/\bLFA\s+\d+\b/i.test(x))||fallback;
      const start=clean(eventNode?.startDate); const date=parseDate(start)||parseDate(flat);
      const loc=eventNode?.location||{}; const address=loc.address||{}; const state=normalizeState(address.addressRegion||loc.addressRegion); if(!state) continue;
      const city=clean(address.addressLocality||loc.addressLocality); const venue=clean(loc.name)||lines.find(x=>/Casino|Arena|Center|Centre|Hall|Pavilion|Theatre|Theater/i.test(x))||'';
      const hasRealTime=/^20\d{2}-\d{2}-\d{2}T(?!00:00(?::00)?(?:[Z+-]|$))/.test(start);
      const event=eventFromValues(source,{promotion:'LFA',title,date,city,state,venue,broadcast:'VICE TV',official_url:url,starts_at:hasRealTime?start:'',poster_url:posterFromHtml(html,url),level:'professional'});
      if(event) out.push(event);
    }catch(e){ console.warn(`LFA event ${url}: ${e.message}`); }
    await sleep(100);
  }
  return out;
}

async function loadCageTitans(source){ const html=await fetchHtml(source.url); const text=htmlLines(html); const title=text.find(x=>/CAGE TITANS\s+\d+/i.test(x))||''; const date=text.map(parseDate).find(Boolean)||parseDate(stripTags(html)); const boutIndex=text.findIndex(x=>/Title Fight/i.test(x)); const boutLine=boutIndex>=0?text.slice(boutIndex,boutIndex+6).find(x=>/\bvs\.?\b/i.test(x)):text.find(x=>/\bvs\.?\b/i.test(x)); const fighters=titleMatchup(boutLine||''); const weight=weightFromText(`${boutIndex>=0?text[boutIndex]:''} ${boutLine||''}`); const e=eventFromValues(source,{promotion:'Cage Titans',title,date,city:'Plymouth',state:'MA',venue:'Plymouth Memorial Hall',broadcast:'Spectation Sports',official_url:source.url,poster_url:posterFromHtml(html,source.url),fighters,weight,level:'pro-am'}); return e?[e]:[]; }

async function loadFac(source){
  const html=await fetchHtml(source.url); const flat=stripTags(html); const lines=htmlLines(html);
  const title=flat.match(/\bFAC\s+\d+\b/i)?.[0]||''; const date=parseDate(flat);
  const fight=flat.match(/\bJose\s+Hernandez\s+(?:vs\.?|v\.)\s+Steven\s+Graham\b/i)?.[0]||lines.find(x=>/\bvs\.?\b/i.test(x))||'';
  const championship=flat.match(/(?:135\s*(?:lb|lbs)|Bantamweight)[^.!?]{0,70}(?:Championship|Title)|(?:Championship|Title)[^.!?]{0,70}(?:135\s*(?:lb|lbs)|Bantamweight)/i)?.[0]||'';
  const e=eventFromValues(source,{promotion:'FAC',title,date,city:'Independence',state:'MO',venue:'Cable Dahmer Arena',official_url:source.url,poster_url:posterFromHtml(html,source.url),fighters:titleMatchup(fight),weight:weightFromText(championship)||(/^FAC\s+36$/i.test(title)?'Bantamweight Championship':''),level:'professional'});
  return e?[e]:[];
}

async function loadAlaska(source){ const html=await fetchHtml(source.url); const flat=stripTags(html); const date=parseDate(flat); const title=`AFC ${date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}) : 'Upcoming Event'}`; const e=eventFromValues(source,{promotion:'Alaska Fighting Championships',title,date,city:'Anchorage',state:'AK',venue:'Sullivan Arena',broadcast:'Zone Sports',official_url:source.url,poster_url:posterFromHtml(html,source.url),level:'regional'}); return e?[e]:[]; }

async function loadCagedThunder(source){ const html=await fetchHtml(source.url); const flat=stripTags(html); const title=flat.match(/\bCaged Thunder\s+\d+\b/i)?.[0]||''; const date=parseDate(flat); const e=eventFromValues(source,{promotion:'Caged Thunder',title,date,city:'Akron',state:'OH',venue:'Chapparells',official_url:source.url,poster_url:posterFromHtml(html,source.url),level:'regional'}); return e?[e]:[]; }

async function loadGladiatorChallenge(source){ const html=await fetchHtml(source.url); const flat=stripTags(html); if(!/BLOCK PARTY BEATDOWN/i.test(flat)) return []; const date=parseDate(flat); const e=eventFromValues(source,{promotion:'Gladiator Challenge',title:'Gladiator Challenge: Block Party Beatdown',date,city:'Adelanto',state:'CA',venue:'Adelanto Plaza & Event Center',official_url:source.url,poster_url:posterFromHtml(html,source.url),level:'amateur'}); return e?[e]:[]; }

async function loadTuffNUff(source){
  const listing=await fetchHtml(source.url); const links=new Map();
  for(const a of anchors(listing,source.url)){ const name=a.text.match(/Tuff[- ]N[- ]Uff\s+\d+/i)?.[0]; if(name && /tuff-n-uff-\d+/i.test(a.url)) links.set(a.url,name); }
  const out=[];
  for(const [url,fallback] of links){
    try{
      const html=await fetchHtml(url); const flat=stripTags(html); const titleMatch=flat.match(/TUFF[- ]N[- ]UFF\s+\d+\s*:\s*[^.!?]{2,100}/i); const base=flat.match(/Tuff[- ]N[- ]Uff\s+\d+/i)?.[0]||fallback;
      const title=titleMatch?clean(titleMatch[0].replace(/\s+(?:Friday|Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday),?\s+.*$/i,'')):base;
      const date=parseDate(flat); if(!date||date<TODAY) continue;
      const fight=titleMatchup(title); const weightText=flat.match(/(?:World\s+)?(?:Women'?s\s+)?(?:Strawweight|Flyweight|Bantamweight|Featherweight|Lightweight|Welterweight|Middleweight|Light Heavyweight|Heavyweight)\s+Championship[^.!?]{0,120}/i)?.[0]||'';
      const ticket=anchors(html,url).find(a=>/buy tickets|tickets/i.test(a.text))?.url||'';
      const e=eventFromValues(source,{promotion:'Tuff-N-Uff',title,date,city:'Las Vegas',state:'NV',venue:/SAHARA/i.test(flat)?'The Theater at SAHARA Las Vegas':'Las Vegas',broadcast:/UFC Fight Pass/i.test(flat)?'UFC Fight Pass':'',official_url:url,ticket_url:ticket,poster_url:posterFromHtml(html,url),fighters:fight,weight:weightFromText(weightText),level:/professional mixed martial arts/i.test(flat)?'professional':'pro-am'});
      if(e) out.push(e);
    }catch(error){ console.warn(`Tuff-N-Uff event ${url}: ${error.message}`); }
    await sleep(100);
  }
  return out;
}

async function loadXfn(source){
  const html=await fetchHtml(source.url); const flat=stripTags(html); const title=flat.match(/Xtreme Fight Night\s+#?\d+/i)?.[0]||''; const date=parseDate(flat);
  if(!title||!date) return [];
  const venue=flat.match(/The Cove at River Spirit Casino Resort/i)?.[0]||'River Spirit Casino Resort';
  const headliner=flat.match(/Headlining[^.!?]{0,160}?\b([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)+)/)?.[1]||'';
  const e=eventFromValues(source,{promotion:'Xtreme Fight Night',title,date,city:'Tulsa',state:'OK',venue,official_url:source.url,poster_url:posterFromHtml(html,source.url),weightText:'',level:'pro-am'});
  if(e && headliner) e.main_event_note=`Headliner: ${clean(headliner)}`;
  return e?[e]:[];
}

async function loadRuf(source){
  const html=await fetchHtml(source.url); const flat=stripTags(html); const out=[];
  const matches=[...flat.matchAll(/RUF\s+(\d+)\s+([A-Z][a-z]{2})\s+(\d{1,2}),\s*(20\d{2})[^R]{0,220}?([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+)*)\s+vs\.?\s+([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+)*)/g)];
  for(const m of matches){ const date=parseDate(`${m[2]} ${m[3]}, ${m[4]}`); if(!date||date<TODAY) continue; const title=`RUF ${m[1]}: ${clean(m[5])} vs. ${clean(m[6])}`; const e=eventFromValues(source,{promotion:'RUF Nation',title,date,city:'Phoenix',state:'AZ',venue:'Celebrity Theatre',official_url:source.url,poster_url:posterFromHtml(html,source.url),fighters:[clean(m[5]),clean(m[6])],level:'pro-am'}); if(e) out.push(e); }
  return out;
}

function tableRows(html){ const rows=[]; for(const m of String(html||'').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){ const cells=[]; for(const c of m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)){ const cellHtml=c[1]; const link=cellHtml.match(/<a\b[^>]*href=["']([^"']+)["']/i); cells.push({text:stripTags(cellHtml),href:link?decodeEntities(link[1]):''}); } if(cells.length) rows.push(cells); } return rows; }
async function loadCamo(source){ const html=await fetchHtml(source.url); const out=[]; for(const row of tableRows(html)){ if(row.length<4) continue; const title=clean(row[0].text); const date=parseDate(row[1].text); const city=clean(row[2].text); const venue=clean(row[3].text); if(!date||!title||/event name/i.test(title)) continue; const event=eventFromValues(source,{promotion:title.replace(/\s+\d+\b.*$/,'').trim(),title,date,city,state:'CA',venue,official_url:row[0].href?absoluteUrl(source.url,row[0].href):source.url,level:'amateur'}); if(event) out.push(event); } return out; }
async function loadFloridaCommission(source){ const html=await fetchHtml(source.url); const out=[]; for(const row of tableRows(html)){ const cells=row.map(c=>clean(c.text)); if(cells.length<5) continue; const date=parseDate(cells[0]); const cityState=cells[2]||''; if(!date||!/^MMA$/i.test(cells[3]||'')) continue; const m=cityState.match(/^(.+?),\s*FL\b/i); if(!m) continue; const promotion=clean(cells[4]).replace(/\s*\(.*$/,'').replace(/,?\s*LLC\b.*$/i,''); const event=eventFromValues(source,{promotion,title:promotion,date,city:m[1],state:'FL',venue:'',official_url:source.url,level:'professional'}); if(event) out.push(event); } return out; }
async function loadCfc(source){ const html=await fetchHtml(source.url); const flat=stripTags(html); const title=flat.match(/\bCFC\s+\d+\s*:\s*[^.!?]{2,80}/i)?.[0]||flat.match(/\bCFC\s+\d+\b/i)?.[0]||''; const date=parseDate(flat); const e=eventFromValues(source,{promotion:'Combat Fighting Championship',title,date,city:'El Paso',state:'TX',venue:'El Paso County Coliseum',official_url:source.url,poster_url:posterFromHtml(html,source.url),level:'regional'}); return e?[e]:[]; }

function canonicalPromotion(value){ const n=norm(value); if(/^(legacy fighting alliance|lfa)\b/.test(n)) return 'lfa'; if(/^(fighting alliance championship|fac)\b/.test(n)) return 'fac'; if(/^cage titans/.test(n)) return 'cage titans'; if(/^alaska fighting championship/.test(n)||n==='afc') return 'afc'; if(/^caged thunder/.test(n)) return 'caged thunder'; if(/^gladiator challenge/.test(n)) return 'gladiator challenge'; if(/^combat fighting championship/.test(n)||n==='cfc') return 'cfc'; if(/^tuff n uff/.test(n)) return 'tuff n uff'; if(/^xtreme fight night/.test(n)||/^xfn\b/.test(n)) return 'xfn'; if(/^ruf nation/.test(n)||/^ruf\b/.test(n)) return 'ruf'; if(/^559 fights/.test(n)) return '559 fights'; return n.replace(/\b\d+\b.*$/,'').trim(); }
function eventNumber(value){ return norm(value).match(/\b(\d{1,4})\b/)?.[1]||''; }
function sameEvent(a,b){ if(a.date!==b.date) return false; const pa=canonicalPromotion(a.promotion), pb=canonicalPromotion(b.promotion); if(pa&&pb&&pa===pb) return true; const na=eventNumber(a.title), nb=eventNumber(b.title); return Boolean(na&&nb&&na===nb&&norm(a.location)===norm(b.location)); }
function priority(event){ return SOURCE_PRIORITY[event.source_key] ?? 50; }
function mergeEvents(existing,incoming){
  const incomingWins=priority(incoming)>=priority(existing); const primary=incomingWins?incoming:existing; const secondary=incomingWins?existing:incoming;
  const nitroTicket=[existing,incoming].find(e=>e.source_key==='nitro'&&e.official_url)?.official_url||'';
  return {
    ...secondary,
    ...primary,
    venue:primary.venue||secondary.venue,
    broadcast:primary.broadcast||secondary.broadcast,
    latitude:primary.latitude??secondary.latitude,
    longitude:primary.longitude??secondary.longitude,
    main_event:primary.main_event||secondary.main_event,
    poster_url:primary.poster_url||secondary.poster_url,
    ticket_url:primary.ticket_url||secondary.ticket_url||nitroTicket||undefined
  };
}
async function readJson(path,fallback){ try{return JSON.parse(await fs.readFile(path,'utf8'));}catch{return fallback;} }

const current=await readJson(DATA_PATH,{version:1,sources:[],events:[]});
const managed=new Set(SOURCES.map(s=>s.key));
const previousBySource=new Map();
for(const event of current.events||[]){ if(!managed.has(event.source_key)) continue; if(!previousBySource.has(event.source_key)) previousBySource.set(event.source_key,[]); previousBySource.get(event.source_key).push(event); }
let merged=(current.events||[]).filter(event=>!managed.has(event.source_key) && event.date>=TODAY);
for(const source of SOURCES){
  let events=[];
  try{ events=(await source.loader(source)).filter(Boolean).filter(e=>e.date>=TODAY); if(!events.length) throw new Error('No future U.S. MMA events parsed'); console.log(`${source.name}: ${events.length} future event(s)`); }
  catch(error){ events=(previousBySource.get(source.key)||[]).filter(e=>e.date>=TODAY); console.warn(`${source.name}: ${error.message}; preserving ${events.length} existing event(s)`); }
  for(const event of events){ const i=merged.findIndex(existing=>sameEvent(existing,event)); if(i===-1) merged.push(event); else merged[i]=mergeEvents(merged[i],event); }
  await sleep(180);
}
const sources=[...(current.sources||[]).filter(s=>!managed.has(s.key)),...SOURCES.map(({key,name,url})=>({key,name,url}))];
const output={version:1,sources,events:merged.sort((a,b)=>a.date.localeCompare(b.date)||clean(a.promotion).localeCompare(clean(b.promotion))||clean(a.title).localeCompare(clean(b.title)))};
await fs.writeFile(DATA_PATH,`${JSON.stringify(output,null,2)}\n`,'utf8');
console.log(`Additional regional sources merged: ${output.events.length} total regional event(s).`);
