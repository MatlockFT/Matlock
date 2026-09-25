(() => {
const NEWS_REMOTE="https://raw.githubusercontent.com/MatlockFT/Matlock/live-news-data/mma-news.json";
const NEWS_FALLBACK="/assets/data/mma-news.json";
const VIDEOS_REMOTE="https://raw.githubusercontent.com/MatlockFT/Matlock/live-news-data/mma-videos.json";
const VIDEOS_FALLBACK="/assets/data/mma-videos.json";
const EVENTS="/assets/data/upcoming-events-live.json";
const CONTROL_REMOTE="https://raw.githubusercontent.com/MatlockFT/Matlock/main/assets/uploads/system/broadcast-control.json";
const CONTROL_FALLBACK="/assets/data/broadcast-control.json";
const FEED_REFRESH_MS=300000;

const DEFAULT_CONTROL={
  version:1,revision:1,updatedAt:null,
  modules:{news:true,video:true,events:true,ticker:true,comingUp:true,music:true},
  rundown:["news","news","video","news","event"],
  timing:{newsSeconds:45,eventSeconds:35,transitionMs:650,controlPollSeconds:10},
  news:{maxAgeHours:48,maxItems:16,sources:[],requireContext:true,contextFacts:4},
  video:{maxAgeHours:48,maxItems:8,minSeconds:20,maxSeconds:600,volume:50,channels:[],playFull:true},
  events:{maxItems:3,usePosters:true},
  audio:{enabled:true,musicUrl:"https://opengameart.org/sites/default/files/8bit%20Bossa.mp3",musicVolume:14,duckVolume:3.5},
  ticker:{enabled:true,speedSeconds:240,maxItems:14},
  visual:{flipNews:true,showRail:true,showClock:true,showBadge:true,showSource:true},
  hidden:{news:[],videos:[],events:[]},
  forceNext:null
};

const q=s=>document.querySelector(s);
const els={
  root:q("[data-broadcast]"),stage:q("[data-stage]"),feature:q("[data-feature-grid]"),blur:q("[data-visual-blur]"),
  image:q("[data-story-image]"),videoShell:q("[data-video-shell]"),title:q("[data-title]"),context:q("[data-context]"),
  source:q("[data-source]"),time:q("[data-time]"),eyebrow:q("[data-eyebrow]"),badge:q("[data-visual-badge]"),
  progress:q("[data-progress]"),ticker:q("[data-ticker-track]"),tickerFooter:q("footer.ticker"),event:q("[data-next-event]"),
  clock:q("[data-clock]"),coverage:q("[data-coverage]"),coverageText:q("[data-coverage-text]"),rail:q("[data-rail-items]"),
  lowerRail:q(".lower-rail"),visual:q("[data-visual-panel]"),bed:q("[data-music-bed]"),storyMeta:q(".story-meta")
};

let control=structuredClone(DEFAULT_CONTROL),previewControl=null;
let newsCache={stories:[]},videoCache={videos:[]},eventCache=[];
let slides=[],index=0,timer=0,videoWatchdog=0,transitioning=false,currentSlide=null,videoPlayer=null,bedFadeTimer=0;
let controlTimer=0,lastControlRevision=0;
let ytReadyResolve;const ytReady=new Promise(resolve=>{ytReadyResolve=resolve});
if(window.YT?.Player)ytReadyResolve(window.YT);
const previousReady=window.onYouTubeIframeAPIReady;
window.onYouTubeIframeAPIReady=()=>{try{previousReady?.()}catch{}ytReadyResolve(window.YT)};

const clone=v=>JSON.parse(JSON.stringify(v));
function deepMerge(base,extra){const out=clone(base);for(const[k,v]of Object.entries(extra||{})){if(v&&typeof v==="object"&&!Array.isArray(v)&&out[k]&&typeof out[k]==="object"&&!Array.isArray(out[k]))out[k]=deepMerge(out[k],v);else out[k]=v}return out}
function cfg(){return previewControl||control}
const safeDate=v=>{const d=new Date(v||"");return Number.isNaN(d.getTime())?null:d};
const fresh=(v,hours)=>{const d=safeDate(v);return d&&Date.now()-d.getTime()<=Number(hours||48)*3600000&&d.getTime()<=Date.now()+5*60*1000};
function scalar(v){if(v===null||v===undefined)return"";if(typeof v==="string"||typeof v==="number")return String(v).trim();if(Array.isArray(v))return v.map(scalar).filter(Boolean).join(", ");if(typeof v==="object"&&Array.isArray(v.fighters))return v.fighters.map(scalar).filter(Boolean).join(" vs. ");return""}
function itemId(type,item){if(type==="news")return item.id||item.url;if(type==="video")return item.videoId;if(type==="event")return item.id||[item.promotion,item.title,item.date].join("|");return item.id||""}
function isHidden(type,item){const key=type==="video"?"videos":type==="event"?"events":"news";return (cfg().hidden?.[key]||[]).includes(itemId(type,item))}
async function getJson(url){const u=new URL(url,location.href);u.searchParams.set("_",Date.now());const r=await fetch(u,{cache:"no-store",headers:{accept:"application/json"}});if(!r.ok)throw new Error(r.status);return r.json()}
async function getWithFallback(primary,fallback){try{return await getJson(primary)}catch{return getJson(fallback)}}
function relativeTime(v){const d=safeDate(v);if(!d)return"LIVE";const m=Math.max(0,Math.round((Date.now()-d.getTime())/60000));if(m<2)return"JUST NOW";if(m<60)return m+" MIN AGO";const h=Math.round(m/60);if(h<24)return h+" HR AGO";return d.toLocaleDateString("en-US",{month:"short",day:"numeric"}).toUpperCase()}
function imageFor(story){return story.image||story.imageUrl||story.thumbnail||story.ogImage||""}
function escapeHtml(v){const d=document.createElement("div");d.textContent=v||"";return d.innerHTML}
function cleanContext(value){
  let text=scalar(value).replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
  text=text.replace(/\bRead the Full Article Here\b.*$/i,"").replace(/\bAdvertisement\b/gi," ").replace(/\s+/g," ").trim();
  if(!text)return"";
  const codeLike=/(?:function\s*\(|=>|\bconst\s+\w+\s*=|\bvar\s+\w+\s*=|window\.|document\.|webpack|__NEXT_DATA__|application\/ld\+json|<\/?script|\{\s*["'][\w-]+["']\s*:)/i;
  const punctuation=(text.match(/[{};=<>]/g)||[]).length;
  if(codeLike.test(text)||punctuation>Math.max(8,text.length*.035))return"";
  return text.slice(0,700);
}
function contextFacts(value){
  const text=cleanContext(value);if(!text)return[];
  const resultStyle=(text.match(/\bdef\./gi)||[]).length>=2&&text.includes("—");
  let parts=resultStyle?text.split(/\s+—\s+/):text.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(])/);
  parts=parts.map(x=>x.trim()).filter(x=>x.length>=25&&x!=="[object Object]");
  if(!parts.length)parts=[text];
  const limit=Math.max(1,Math.min(6,Number(cfg().news?.contextFacts||4))),out=[];
  for(const part of parts){const clean=cleanContext(part);if(!clean)continue;out.push(clean.length>180?clean.slice(0,177).trim()+"…":clean);if(out.length>=limit)break}
  return out;
}
function renderFacts(label,facts){
  if(!facts.length){els.context.innerHTML="";return}
  els.context.innerHTML='<div class="context-label">'+escapeHtml(label)+'</div>'+facts.map(f=>'<div class="context-fact">'+escapeHtml(f)+'</div>').join("");
}
function bestNewsContext(s){for(const candidate of [s.context,s.excerpt,s.summary,s.description]){const clean=cleanContext(candidate);if(clean.length>=60)return clean}return""}

function newsSlides(){
  if(!cfg().modules.news)return[];
  const enabled=cfg().news.sources||[],seen=new Set();
  return [newsCache?.topStory,...(newsCache?.stories||[])]
    .filter(Boolean)
    .map(s=>({...s,_context:bestNewsContext(s)}))
    .filter(s=>s.title&&s.url&&fresh(s.publishedAt,cfg().news.maxAgeHours))
    .filter(s=>!enabled.length||enabled.includes(s.source))
    .filter(s=>!cfg().news.requireContext||s._context)
    .filter(s=>!isHidden("news",s))
    .filter(s=>{const k=s.id||s.url;if(seen.has(k))return false;seen.add(k);return true})
    .slice(0,Math.max(0,Number(cfg().news.maxItems||16)))
    .map(s=>({type:"news",id:itemId("news",s),title:s.title,context:s._context,source:s.source||"Combat Sports",publishedAt:s.publishedAt,image:imageFor(s),url:s.url,relatedSources:s.relatedSources||[]}));
}
function videoSlides(){
  if(!cfg().modules.video)return[];
  const channels=cfg().video.channels||[];
  return (videoCache?.videos||[])
    .filter(v=>{
      const duration=Number(v?.durationSeconds||0);
      return v?.title&&v?.videoId&&fresh(v.publishedAt,cfg().video.maxAgeHours)&&v.embeddable!==false&&v.liveBroadcastContent!=="live"&&duration>=Number(cfg().video.minSeconds||0)&&duration<=Number(cfg().video.maxSeconds||3600);
    })
    .filter(v=>!channels.length||channels.includes(v.channel))
    .filter(v=>!isHidden("video",v))
    .slice(0,Math.max(0,Number(cfg().video.maxItems||8)))
    .map(v=>({type:"video",id:v.videoId,title:v.title,source:v.channel||"YouTube",publishedAt:v.publishedAt,image:v.thumbnail||"",videoId:v.videoId,durationSeconds:Number(v.durationSeconds||0)}));
}
function mainEventText(e){const raw=e?.main_event;if(raw&&typeof raw==="object"){const fighters=Array.isArray(raw.fighters)?raw.fighters.map(scalar).filter(Boolean):[];const matchup=fighters.length>=2?fighters.join(" vs. "):scalar(raw.name||raw.title);const wc=scalar(raw.weight_class);return[matchup,wc].filter(Boolean).join(" — ")}return scalar(raw)}
function parseEventDate(e){const start=scalar(e?.starts_at);if(start){const d=safeDate(start);if(d)return{date:d,hasTime:true}}const day=scalar(e?.date);if(/^\d{4}-\d{2}-\d{2}$/.test(day)){const d=new Date(day+"T12:00:00");return Number.isNaN(d.getTime())?null:{date:d,hasTime:false}}const d=safeDate(day);return d?{date:d,hasTime:false}:null}
function formatEventDate(e){const p=parseEventDate(e);if(!p)return"Date TBA";const opts=p.hasTime?{timeZone:"America/Chicago",weekday:"long",month:"long",day:"numeric",hour:"numeric",minute:"2-digit"}:{weekday:"long",month:"long",day:"numeric"};return p.date.toLocaleString("en-US",opts)+(p.hasTime?" CT":"")}
function eventFacts(e){const facts=["When: "+formatEventDate(e)],main=mainEventText(e);if(main)facts.push("Main event: "+main);const venue=scalar(e.venue),location=scalar(e.location);if(venue||location)facts.push([venue,location].filter(Boolean).join(" · "));const broadcast=scalar(e.broadcast);if(broadcast)facts.push("Watch: "+broadcast);return facts}
function eventSlides(){
  if(!cfg().modules.events)return[];
  return eventCache.filter(e=>!isHidden("event",e)).slice(0,Math.max(0,Number(cfg().events.maxItems||3))).map(e=>({type:"event",id:itemId("event",e),title:scalar(e.title)||scalar(e.promotion)||"Upcoming Event",source:scalar(e.promotion)||"MMA",publishedAt:"",image:cfg().events.usePosters?(scalar(e.poster_url)||scalar(e.image)||""):"",event:e,context:eventFacts(e)}));
}
function buildSlides(){
  const queues={news:newsSlides(),video:videoSlides(),event:eventSlides()},out=[];
  const pattern=(cfg().rundown||[]).filter(x=>["news","video","event"].includes(x));
  const recipe=pattern.length?pattern:["news"];
  let safety=0;
  while((queues.news.length||queues.video.length||queues.event.length)&&safety<100){
    let moved=false;
    for(const type of recipe){if(queues[type]?.length){out.push(queues[type].shift());moved=true}}
    if(!moved)break;safety++;
  }
  return out;
}
function renderTicker(){
  const items=[newsCache?.topStory,...(newsCache?.stories||[])].filter(Boolean).filter(s=>s.title&&fresh(s.publishedAt,cfg().news.maxAgeHours)).filter(s=>!isHidden("news",s)).slice(0,Math.max(3,Number(cfg().ticker.maxItems||14)));
  if(!items.length){els.ticker.innerHTML="<span>Waiting for fresh combat sports headlines…</span>";return}
  const html=items.map(s=>"<span>"+escapeHtml(s.title)+"</span>").join("");els.ticker.innerHTML=html+html;
}
function renderRail(){
  if(!cfg().modules.comingUp||!cfg().visual.showRail){els.rail.innerHTML="";return}
  const upcoming=[];for(let o=0;o<slides.length&&upcoming.length<3;o++){const s=slides[(index+o)%slides.length];if(s)upcoming.push(s)}
  els.rail.innerHTML=upcoming.map(s=>'<div class="rail-item"><div class="rail-type">'+escapeHtml(s.type==="video"?"VIDEO":s.type==="event"?"EVENT":s.type==="custom"?"MANUAL":"NEWS")+'</div><div class="rail-title">'+escapeHtml(s.title||"")+'</div><div class="rail-source">'+escapeHtml(s.source||"")+'</div></div>').join("");
}
function applyDisplay(){
  const c=cfg(),tickerOn=Boolean(c.modules.ticker&&c.ticker.enabled!==false),railOn=Boolean(c.modules.comingUp&&c.visual.showRail);
  els.tickerFooter.style.display=tickerOn?"grid":"none";
  els.root.style.gridTemplateRows=tickerOn?"72px 912px 96px":"72px 1008px 0px";
  els.lowerRail.style.display=railOn?"grid":"none";
  els.stage.style.gridTemplateRows=railOn?"1fr 148px":"1fr 0px";
  els.clock.style.display=c.visual.showClock?"block":"none";
  els.badge.style.display=c.visual.showBadge?"block":"none";
  els.storyMeta.style.display=c.visual.showSource?"flex":"none";
  els.ticker.style.animationDuration=Math.max(20,Number(c.ticker.speedSeconds||240))+"s";
  renderTicker();renderRail();configureBed();
}
function rebuildSlides(){slides=buildSlides();if(index>=slides.length)index=0;applyDisplay()}
function chicagoDateKey(){const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const get=t=>parts.find(p=>p.type===t)?.value||"";return get("year")+"-"+get("month")+"-"+get("day")}
function normalizedEvents(data){const list=Array.isArray(data?.events)?data.events:[],today=chicagoDateKey();return list.filter(x=>{const day=scalar(x?.date);if(/^\d{4}-\d{2}-\d{2}$/.test(day))return day>=today;const p=parseEventDate(x);return p&&p.date.getTime()>Date.now()-6*3600000}).sort((a,b)=>String(scalar(a.starts_at)||scalar(a.date)).localeCompare(String(scalar(b.starts_at)||scalar(b.date)))}

function configureBed(){
  const c=cfg(),on=Boolean(c.modules.music&&c.audio.enabled&&c.audio.musicUrl);
  if(!els.bed)return;
  if(els.bed.dataset.src!==c.audio.musicUrl){els.bed.dataset.src=c.audio.musicUrl||"";els.bed.src=c.audio.musicUrl||""}
  if(!on){els.bed.pause();return}
  const target=(currentSlide?.type==="video"?Number(c.audio.duckVolume||0):Number(c.audio.musicVolume||0))/100;
  els.bed.volume=Math.max(0,Math.min(1,target));
  const p=els.bed.play();if(p?.catch)p.catch(()=>{});
}
function fadeBed(targetPercent,duration=900){if(!els.bed||!cfg().modules.music||!cfg().audio.enabled)return;clearInterval(bedFadeTimer);const target=Number(targetPercent||0)/100,start=Number(els.bed.volume||0),steps=Math.max(1,Math.round(duration/50));let step=0;bedFadeTimer=setInterval(()=>{step++;els.bed.volume=Math.max(0,Math.min(1,start+(target-start)*(step/steps)));if(step>=steps)clearInterval(bedFadeTimer)},50)}
document.addEventListener("click",configureBed,{once:true});

function resetVideoHost(){try{videoPlayer?.destroy()}catch{}videoPlayer=null;clearTimeout(videoWatchdog);videoWatchdog=0;els.videoShell.innerHTML='<div id="broadcast-youtube-player"></div>'}
function fadeVideoOut(done){if(!videoPlayer||typeof videoPlayer.getVolume!=="function"){done();return}let start=Number(cfg().video.volume||50);try{start=Number(videoPlayer.getVolume())||start}catch{}let step=0;const steps=12,iv=setInterval(()=>{step++;try{videoPlayer.setVolume(Math.max(0,Math.round(start*(1-step/steps))))}catch{}if(step>=steps){clearInterval(iv);done()}},60)}
function beginProgress(ms){els.progress.style.transition="none";els.progress.style.width="0";requestAnimationFrame(()=>{els.progress.style.transition="width "+ms+"ms linear";els.progress.style.width="100%"})}
async function startVideo(slide){
  els.stage.classList.add("video-mode");els.image.src="";els.image.style.display="none";els.blur.style.backgroundImage="none";fadeBed(cfg().audio.duckVolume,800);
  const YT=await Promise.race([ytReady,new Promise(resolve=>setTimeout(()=>resolve(null),9000))]);if(!YT?.Player){timer=setTimeout(advance,12000);return}
  resetVideoHost();
  videoPlayer=new YT.Player("broadcast-youtube-player",{videoId:slide.videoId,playerVars:{autoplay:1,controls:0,rel:0,playsinline:1,fs:0,iv_load_policy:3},events:{
    onReady:event=>{try{event.target.mute();event.target.setVolume(Number(cfg().video.volume||50));event.target.playVideo();setTimeout(()=>{try{event.target.setVolume(Number(cfg().video.volume||50));event.target.unMute()}catch{}},650)}catch{}},
    onStateChange:event=>{if(event.data===YT.PlayerState.PLAYING){let sec=slide.durationSeconds;try{sec=Number(event.target.getDuration())||sec}catch{}beginProgress(Math.max(1000,sec*1000));clearTimeout(videoWatchdog);videoWatchdog=setTimeout(()=>transitionAdvance(true),(sec+18)*1000)}if(event.data===YT.PlayerState.ENDED)transitionAdvance(false)},
    onError:()=>setTimeout(()=>transitionAdvance(false),1200)
  }});
}
function setMediaImage(url){resetVideoHost();els.stage.classList.remove("video-mode");els.image.src=url||"";els.image.alt="";const safe=url?String(url).replace(/"/g,"%22"):"";els.blur.style.backgroundImage=safe?'url("'+safe+'")':"radial-gradient(circle at 50% 40%,#242424,#090909 70%)";els.image.style.display=url?"block":"none"}
function renderEventVisual(slide){resetVideoHost();els.stage.classList.remove("video-mode");els.visual.querySelector(".event-board")?.remove();if(slide.image){setMediaImage(slide.image);return}els.image.src="";els.image.style.display="none";els.blur.style.backgroundImage="none";const e=slide.event||{},box=document.createElement("div");box.className="event-board";box.innerHTML='<div class="story-kicker">UPCOMING EVENT</div><h2>'+escapeHtml(slide.source||"MMA")+'</h2><div class="event-date">'+escapeHtml(formatEventDate(e))+'</div><div class="event-detail">'+escapeHtml(slide.title||"")+'</div>';els.visual.append(box)}

function renderSlideNow(s){
  currentSlide=s;els.stage.classList.remove("event-mode","layout-flip","video-mode");els.visual.querySelector(".event-board")?.remove();
  if((s.type==="news"||s.type==="custom")&&cfg().visual.flipNews&&index%2===0)els.stage.classList.add("layout-flip");
  if(s.type==="video")startVideo(s);else if(s.type==="event"){els.stage.classList.add("event-mode");renderEventVisual(s)}else setMediaImage(s.image);
  els.title.textContent=s.title||"Combat Sports Update";els.title.classList.toggle("is-long",String(s.title||"").length>92);
  els.source.textContent=(s.source||"Combat Sports").toUpperCase();els.time.textContent=s.type==="event"?"UPCOMING":s.type==="custom"?"MANUAL":relativeTime(s.publishedAt);
  els.eyebrow.textContent=s.type==="video"?"LATEST VIDEO":s.type==="event"?"FIGHT CALENDAR":s.type==="custom"?"MANUAL UPDATE":"NEWS UPDATE";
  els.badge.textContent=s.type==="video"?"NOW PLAYING":s.type==="event"?"UP NEXT":s.type==="custom"?"DESK":"LATEST";
  if(s.type==="news")renderFacts("WHAT WE KNOW",contextFacts(s.context));else if(s.type==="event")renderFacts("EVENT DETAILS",Array.isArray(s.context)?s.context:contextFacts(s.context));else if(s.type==="custom")renderFacts("UPDATE",contextFacts(s.context));else els.context.innerHTML="";
  const related=(s.relatedSources||[]).slice(0,3);if(s.type==="news"&&related.length){els.coverage.hidden=false;els.coverageText.textContent=related.join(" • ")}else els.coverage.hidden=true;
  renderRail();applyDisplay();
  if(s.type!=="video"){fadeBed(cfg().audio.musicVolume,1000);const duration=s.type==="event"?Number(cfg().timing.eventSeconds||35)*1000:s.type==="custom"?Number(s.durationSeconds||45)*1000:Number(cfg().timing.newsSeconds||45)*1000;beginProgress(duration);clearTimeout(timer);timer=setTimeout(advance,duration)}
}
function transitionTo(s){if(!s||transitioning)return;transitioning=true;clearTimeout(timer);clearTimeout(videoWatchdog);const ms=Math.max(0,Number(cfg().timing.transitionMs||0));const swap=()=>{els.stage.classList.add("is-switching");setTimeout(()=>{if(currentSlide?.type==="video")resetVideoHost();renderSlideNow(s);requestAnimationFrame(()=>requestAnimationFrame(()=>els.stage.classList.remove("is-switching")));setTimeout(()=>{transitioning=false},ms)},ms)};if(currentSlide?.type==="video"&&videoPlayer)fadeVideoOut(swap);else swap()}
function transitionAdvance(forceFade){if(transitioning)return;const next=slides[index%slides.length];index=(index+1)%Math.max(1,slides.length);if(forceFade&&videoPlayer){transitioning=true;fadeVideoOut(()=>{transitioning=false;transitionTo(next)})}else transitionTo(next)}
function advance(){if(!slides.length||transitioning)return;const s=slides[index%slides.length];index=(index+1)%slides.length;transitionTo(s)}

function resolveForce(ref){
  if(!ref)return null;
  if(ref.type==="custom"&&ref.item)return{...ref.item,type:"custom",id:"custom-"+Date.now()};
  if(ref.type==="news"){const all=[newsCache?.topStory,...(newsCache?.stories||[])].filter(Boolean),x=all.find(item=>itemId("news",item)===ref.id);if(!x)return null;return{type:"news",id:itemId("news",x),title:x.title,context:bestNewsContext(x),source:x.source||"Combat Sports",publishedAt:x.publishedAt,image:imageFor(x),relatedSources:x.relatedSources||[]}}
  if(ref.type==="video"){const x=(videoCache?.videos||[]).find(item=>itemId("video",item)===ref.id);if(!x)return null;return{type:"video",id:x.videoId,title:x.title,source:x.channel||"YouTube",publishedAt:x.publishedAt,image:x.thumbnail||"",videoId:x.videoId,durationSeconds:Number(x.durationSeconds||0)}}
  if(ref.type==="event"){const x=eventCache.find(item=>itemId("event",item)===ref.id);if(!x)return null;return{type:"event",id:itemId("event",x),title:scalar(x.title)||scalar(x.promotion)||"Upcoming Event",source:scalar(x.promotion)||"MMA",image:cfg().events.usePosters?(scalar(x.poster_url)||""):"",event:x,context:eventFacts(x)}}
  return null;
}
const IS_CONTROL_PREVIEW=new URLSearchParams(location.search).get("controlPreview")==="1";
function forceStorageKey(){return IS_CONTROL_PREVIEW?"matlock-broadcast:seen-force-preview":"matlock-broadcast:seen-force-live"}
function seenForceId(){try{return localStorage.getItem(forceStorageKey())||""}catch{return""}}
function markForceSeen(id){try{localStorage.setItem(forceStorageKey(),id)}catch{}}
function processForce(){
  const force=cfg().forceNext;if(!force?.requestId||force.requestId===seenForceId())return;
  const item=resolveForce(force.ref);if(!item)return;
  if(force.mode==="now"&&transitioning){setTimeout(processForce,Math.max(250,Number(cfg().timing.transitionMs||650)+100));return}
  markForceSeen(force.requestId);
  if(force.mode==="now")transitionTo(item);else slides.splice(index,0,item);
}

async function refreshFeeds(){
  const [news,videos,events]=await Promise.all([
    getWithFallback(NEWS_REMOTE,NEWS_FALLBACK).catch(()=>newsCache),
    getWithFallback(VIDEOS_REMOTE,VIDEOS_FALLBACK).catch(()=>videoCache),
    getJson(EVENTS).catch(()=>({events:eventCache}))
  ]);
  newsCache=news||newsCache;videoCache=videos||videoCache;eventCache=normalizedEvents(events||{events:[]});rebuildSlides();processForce();
  const next=eventCache[0];if(next)els.event.textContent="NEXT: "+String(scalar(next.promotion)||"EVENT").toUpperCase()+" · "+String(scalar(next.date)||"");
  if(!currentSlide&&!timer)advance();
}
async function refreshControl(){
  if(previewControl){scheduleControlPoll();return}
  try{
    const next=deepMerge(DEFAULT_CONTROL,await getWithFallback(CONTROL_REMOTE,CONTROL_FALLBACK));
    const changed=JSON.stringify(next)!==JSON.stringify(control);control=next;
    if(changed){lastControlRevision=Number(control.revision||0);rebuildSlides();processForce()}
  }catch{}
  scheduleControlPoll();
}
function scheduleControlPoll(){clearTimeout(controlTimer);controlTimer=setTimeout(refreshControl,Math.max(5,Number(cfg().timing.controlPollSeconds||10))*1000)}

function reportPreviewState(stateName,message=""){
  if(!IS_CONTROL_PREVIEW||window.parent===window)return;
  try{window.parent.postMessage({type:"matlock-broadcast-preview-state",state:stateName,message,slideCount:slides.length,currentType:currentSlide?.type||null},location.origin)}catch{}
}
window.addEventListener("message",event=>{
  if(event.origin!==location.origin)return;
  const m=event.data;if(!m||m.type!=="matlock-broadcast-control-preview"||!m.config||!IS_CONTROL_PREVIEW)return;
  previewControl=deepMerge(DEFAULT_CONTROL,m.config);
  if(m.feeds){
    if(m.feeds.news)newsCache=m.feeds.news;
    if(m.feeds.videos)videoCache=m.feeds.videos;
    if(m.feeds.events)eventCache=normalizedEvents(m.feeds.events);
  }
  rebuildSlides();processForce();configureBed();
  if(!slides.length){
    clearTimeout(timer);clearTimeout(videoWatchdog);
    currentSlide=null;els.title.textContent="No eligible content in this draft";els.eyebrow.textContent="PROGRAM MONITOR";els.source.textContent="MMA MATLOCK";els.time.textContent="PREVIEW";
    renderFacts("CHECK FILTERS",["Enable at least one content module and make sure the freshness/source filters leave eligible stories, videos, or events."]);
    setMediaImage("");reportPreviewState("empty");return;
  }
  if(m.restart||!currentSlide){
    clearTimeout(timer);clearTimeout(videoWatchdog);transitioning=false;
    if(currentSlide?.type==="video")resetVideoHost();
    index=0;currentSlide=null;
    const next=slides[index%slides.length];index=(index+1)%slides.length;
    renderSlideNow(next);
  }
  reportPreviewState("ready");
});
if(!IS_CONTROL_PREVIEW)previewControl=null;
else reportPreviewState("connected");

async function boot(){
  try{
    control=deepMerge(DEFAULT_CONTROL,await getWithFallback(CONTROL_REMOTE,CONTROL_FALLBACK));lastControlRevision=Number(control.revision||0);
    applyDisplay();configureBed();await refreshFeeds();scheduleControlPoll();setInterval(refreshFeeds,FEED_REFRESH_MS);
    if(IS_CONTROL_PREVIEW)reportPreviewState(slides.length?"ready":"empty");
  }catch(error){
    if(IS_CONTROL_PREVIEW)reportPreviewState("error",error?.message||"Renderer failed to start");
  }
}
function clock(){els.clock.textContent=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",hour:"numeric",minute:"2-digit",second:"2-digit"}).format(new Date())+" CT"}
clock();setInterval(clock,1000);boot();
})();