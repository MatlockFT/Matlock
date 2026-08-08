import { dateLabel, fighter, loadData, loadPortraitCache, mergePromotion, portraitFor, updatedLabel } from './upcoming-events-data.mjs';

const SCHEDULE='https://jp.rizinff.com/_ct/17813466';
const ORIGIN='https://jp.rizinff.com';
const UA='Mozilla/5.0 (compatible; MMAMatlockRizinUpdater/3.1; +https://matlockfighttalk.com/)';
const MAX_DAYS=240;
const TRUSTED_IMAGE=/^https:\/\/d1uzk9o9cg136f\.cloudfront\.net\//i;

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const decode=(s='')=>s.replace(/&#x([0-9a-f]+);/gi,(_,x)=>String.fromCodePoint(parseInt(x,16))).replace(/&#(\d+);/g,(_,x)=>String.fromCodePoint(+x)).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#039;|&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
const text=(s='')=>decode(s.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
const reEsc=(s='')=>String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const slugify=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

async function get(url){
  let last;
  for(let i=1;i<=3;i++){
    try{const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(30000),headers:{'user-agent':UA,accept:'text/html,*/*'}});if(r.ok)return await r.text();last=new Error(`${r.status} ${r.statusText} for ${url}`);}catch(e){last=e;}
    if(i<3)await sleep(500*i);
  }
  throw last;
}

function links(html,labelPattern){
  const out=[];
  for(const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
    if(!labelPattern.test(text(m[2])))continue;
    const h=(m[1].match(/href=["']([^"']+)["']/i)||[])[1];if(!h)continue;
    try{const u=new URL(decode(h),ORIGIN);u.search='';u.hash='';out.push(u.toString());}catch{}
  }
  return [...new Set(out)];
}
function eventDate(html){const m=text(html).match(/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/);return m?{year:+m[1],month:+m[2],day:+m[3]}:null;}
const isoDay=d=>`${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`;
function startTime(html,date){const m=text(html).match(/(?:／|\s)(\d{1,2}):(\d{2})開始/);if(!m)return{jst:'Time TBA',et:'Time TBA'};const hour=+m[1],min=+m[2],utc=new Date(Date.UTC(date.year,date.month-1,date.day,hour-9,min));return{jst:`${hour}:${String(min).padStart(2,'0')} JST`,et:new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/New_York',timeZoneName:'short'}).format(utc)};}
function eventTitle(html){const h=(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||'';return text(h).replace(/\s*大会情報[／/]チケット.*$/,'').replace(/^超RIZIN/i,'Super RIZIN').trim()||'RIZIN Event';}
function venue(html){const m=html.match(/<h3\b[^>]*>\s*会場\s*<\/h3>[\s\S]{0,900}?<a\b[^>]*>([\s\S]*?)<\/a>/i);if(m)return text(m[1]);const f=text(html).match(/会場\s+([^。]{2,80}?)(?=\s+(?:アクセス|電車|バス|主催|Google|〒))/);return f?f[1].trim():'Venue TBA';}
function broadcast(html){const p=text(html),names=['RIZIN 100 CLUB','RIZIN LIVE','ABEMA','U-NEXT','スカパー！','Sky PerfecTV'];return [...new Set(names.filter(n=>p.includes(n)).map(n=>n==='スカパー！'?'Sky PerfecTV':n))].join(' · ')||'RIZIN PPV';}
const cardUrls=html=>links(html,/対戦カード/).filter(u=>/_ct\/\d+/.test(u));
function eventIdentity(title=''){
  const normalized=String(title).replace(/超RIZIN/gi,'Super RIZIN');
  let m=normalized.match(/RIZIN\s*LANDMARK\s*(\d+)/i);if(m)return{type:'landmark',number:m[1]};
  m=normalized.match(/Super\s*RIZIN\.?\s*(\d+)/i);if(m)return{type:'super',number:m[1]};
  m=normalized.match(/RIZIN\.?\s*(\d+)/i);if(m)return{type:'numbered',number:m[1]};
  return null;
}
function cardMatchesEvent(cardHtml,title){
  const id=eventIdentity(title);if(!id)return false;
  const p=text(cardHtml).replace(/超RIZIN/gi,'Super RIZIN');
  if(id.type==='landmark')return new RegExp(`RIZIN\\s*LANDMARK\\s*${reEsc(id.number)}\\b`,'i').test(p);
  if(id.type==='super')return new RegExp(`Super\\s*RIZIN\\.?\\s*${reEsc(id.number)}\\b`,'i').test(p);
  return new RegExp(`(?:^|\\s)RIZIN\\.?\\s*${reEsc(id.number)}\\b`,'i').test(p);
}
function profileUrl(cardHtml,jpName){for(const m of cardHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){if(text(m[2])!==jpName)continue;const h=(m[1].match(/href=["']([^"']+)["']/i)||[])[1];if(h)try{return new URL(decode(h),ORIGIN).toString();}catch{}}return'';}
function profileImage(html,jpName){
  const candidates=[];
  for(const m of html.matchAll(/<img\b[^>]*>/gi)){
    const tag=m[0],alt=decode((tag.match(/alt=["']([^"']*)["']/i)||[])[1]||''),raw=decode((tag.match(/(?:data-src|src)=["']([^"']+)["']/i)||[])[1]||'');
    if(!raw)continue;let src;try{src=new URL(raw,ORIGIN).toString();}catch{continue;}if(!TRUSTED_IMAGE.test(src))continue;
    let score=0;if(alt===jpName)score+=100;else if(alt&&alt.includes(jpName))score+=60;if(/_(?:xlarge|large|normal)\.(?:jpg|png)(?:\?|$)/i.test(src))score+=30;if(/logo|banner|icon|ads|sponsor/i.test(`${alt} ${src}`))score-=100;
    if(score>0)candidates.push({src,score});
  }
  return candidates.sort((a,b)=>b.score-a.score)[0]?.src||'';
}
function englishName(html,jpName){const p=text(html);let m=p.match(new RegExp(`${reEsc(jpName)}\\s+([A-Za-z][A-Za-z0-9À-ÿ.'’\\- ]{1,70}?)(?=\\s+(?:出身地|生年月日|身長|リーチ|体重|所属|国籍))`));if(m)return m[1].trim();m=p.match(new RegExp(`名前[:：]?\\s*(?:\\|\\s*)?${reEsc(jpName)}\\s+([A-Za-z][A-Za-z0-9À-ÿ.'’\\- ]{1,70})`));return m?m[1].trim():jpName;}
async function resolveFighter(cardHtml,jpName,previous,cache){const url=profileUrl(cardHtml,jpName);if(url)try{const page=await get(url),name=englishName(page,jpName),image=profileImage(page,jpName);if(image)return fighter(name,{image,image_source:'rizin',image_framing:'safe'});return fighter(name,portraitFor(name,previous,cache));}catch{}return fighter(jpName,portraitFor(jpName,previous,cache));}
function fights(cardHtml){
  const numbered=[...cardHtml.matchAll(/<h2\b[^>]*>\s*第(\d+)試合[／/]\s*([^<]+?)\s+vs\.?\s+([^<]+?)\s*<\/h2>/gi)];
  if(numbered.length)return numbered.map((m,i)=>{const chunk=cardHtml.slice(m.index,numbered[i+1]?.index??cardHtml.length),kg=(text(chunk).match(/（\s*([0-9.]+)kg\s*）/)||[])[1]||'';return{fightNo:+m[1],jp1:text(m[2]),jp2:text(m[3]),weight:kg?`${kg} kg`:'RIZIN MMA'};}).sort((a,b)=>b.fightNo-a.fightNo);
  const plain=[...cardHtml.matchAll(/<h2\b[^>]*>\s*([^<]{1,100}?)\s+vs\.?\s+([^<]{1,100}?)\s*<\/h2>/gi)];
  return plain.map((m,i)=>{const chunk=cardHtml.slice(m.index,plain[i+1]?.index??cardHtml.length),kg=(text(chunk).match(/（\s*([0-9.]+)kg\s*）/)||[])[1]||'';return{fightNo:i+1,jp1:text(m[1]),jp2:text(m[2]),weight:kg?`${kg} kg`:'RIZIN MMA'};});
}

const data=await loadData(),cache=await loadPortraitCache(),previous=data.events.filter(e=>e.promotion_key==='rizin');
let scheduleHtml;try{scheduleHtml=await get(SCHEDULE);}catch(error){console.warn(`RIZIN schedule unavailable: ${error.message}`);process.exit(0);}
const eventUrls=links(scheduleHtml,/大会情報[／/]チケット/);for(const seed of ['https://jp.rizinff.com/_ct/17833730'])if(!eventUrls.includes(seed))eventUrls.push(seed);
const candidates=[];
for(const url of eventUrls){
  try{
    const page=await get(url),date=eventDate(page);if(!date)continue;const days=(Date.UTC(date.year,date.month-1,date.day,12)-Date.now())/86400000;if(days<-1||days>MAX_DAYS)continue;
    const title=eventTitle(page);let ch='',matchedCardUrl='';
    for(const cu of cardUrls(page)){
      try{const candidate=await get(cu);if(cardMatchesEvent(candidate,title)){ch=candidate;matchedCardUrl=cu;break;}}catch{}
    }
    if(!ch){console.warn(`RIZIN skip ${url}: no event-matching published fight card found`);continue;}
    const raw=fights(ch);if(!raw.length)continue;
    const bouts=[];let order=1;for(const r of raw){const f1=await resolveFighter(ch,r.jp1,previous,cache);await sleep(60);const f2=await resolveFighter(ch,r.jp2,previous,cache);await sleep(60);const boutOrder=order++;bouts.push({order:boutOrder,label:boutOrder===1?'Main Event':'',weight_class:r.weight,fighters:[f1,f2]});}
    const iso=isoDay(date),start=startTime(page,date);
    candidates.push({id:`rizin-${slugify(title)}-${iso}`,promotion_key:'rizin',promotion:'RIZIN',title,date:iso,date_label:dateLabel(iso),venue:venue(page),broadcast:broadcast(page),official_url:url,updated_label:updatedLabel(),sections:[{kind:'main',title:'Fight Card',time:start.et==='Time TBA'?'Time TBA':`${start.et} · ${start.jst}`,bouts}],source_card_url:matchedCardUrl});
  }catch(error){console.warn(`RIZIN skip ${url}: ${error.message}`);}
}
if(!candidates.length){console.warn('No usable RIZIN events; preserving existing RIZIN data.');process.exit(0);}
await mergePromotion('rizin',candidates,{maxEventDrop:1,maxBoutDrop:3});
