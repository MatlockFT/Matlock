(() => {
const NEWS_REMOTE="https://raw.githubusercontent.com/MatlockFT/Matlock/live-news-data/mma-news.json";
const NEWS_FALLBACK="/assets/data/mma-news.json";
const VIDEOS_REMOTE="https://raw.githubusercontent.com/MatlockFT/Matlock/live-news-data/mma-videos.json";
const VIDEOS_FALLBACK="/assets/data/mma-videos.json";
const EVENTS="/assets/data/upcoming-events-live.json";
const REFRESH_MS=300000;
const NEWS_MAX_AGE_MS=48*60*60*1000;
const VIDEO_MAX_AGE_MS=48*60*60*1000;
const NEWS_MS=45000;
const EVENT_MS=35000;
const VIDEO_MIN_SECONDS=20;
const VIDEO_MAX_SECONDS=600;
const BED_VOLUME=.14;
const BED_DUCK_VOLUME=.035;
const VIDEO_VOLUME=50;
const TRANSITION_MS=650;

const q=s=>document.querySelector(s);
const els={
  stage:q("[data-stage]"),feature:q("[data-feature-grid]"),blur:q("[data-visual-blur]"),
  image:q("[data-story-image]"),videoShell:q("[data-video-shell]"),
  title:q("[data-title]"),context:q("[data-context]"),source:q("[data-source]"),time:q("[data-time]"),
  eyebrow:q("[data-eyebrow]"),badge:q("[data-visual-badge]"),progress:q("[data-progress]"),
  ticker:q("[data-ticker-track]"),event:q("[data-next-event]"),clock:q("[data-clock]"),
  coverage:q("[data-coverage]"),coverageText:q("[data-coverage-text]"),rail:q("[data-rail-items]"),
  visual:q("[data-visual-panel]"),bed:q("[data-music-bed]")
};

let slides=[],index=0,timer=0,videoWatchdog=0,eventCache=[];
let transitioning=false,currentSlide=null,videoPlayer=null,bedFadeTimer=0;
let ytReadyResolve;
const ytReady=new Promise(resolve=>{ytReadyResolve=resolve});
if(window.YT?.Player)ytReadyResolve(window.YT);
const previousReady=window.onYouTubeIframeAPIReady;
window.onYouTubeIframeAPIReady=()=>{try{previousReady?.()}catch{}ytReadyResolve(window.YT)};

const safeDate=v=>{const d=new Date(v||"");return Number.isNaN(d.getTime())?null:d};
const fresh=(v,maxAge)=>{const d=safeDate(v);return d&&Date.now()-d.getTime()<=maxAge&&d.getTime()<=Date.now()+5*60*1000};

async function getJson(url){
  const u=new URL(url,location.href);
  u.searchParams.set("_",Math.floor(Date.now()/60000));
  const r=await fetch(u,{cache:"no-store",headers:{accept:"application/json"}});
  if(!r.ok)throw new Error(r.status);
  return r.json();
}
async function getWithFallback(primary,fallback){try{return await getJson(primary)}catch{return getJson(fallback)}}

function relativeTime(v){
  const d=safeDate(v);if(!d)return"LIVE";
  const m=Math.max(0,Math.round((Date.now()-d.getTime())/60000));
  if(m<2)return"JUST NOW";if(m<60)return m+" MIN AGO";
  const h=Math.round(m/60);if(h<24)return h+" HR AGO";
  return d.toLocaleDateString("en-US",{month:"short",day:"numeric"}).toUpperCase();
}
function imageFor(story){return story.image||story.imageUrl||story.thumbnail||story.ogImage||""}
function escapeHtml(v){const d=document.createElement("div");d.textContent=v||"";return d.innerHTML}
function scalar(v){
  if(v===null||v===undefined)return"";
  if(typeof v==="string"||typeof v==="number")return String(v).trim();
  if(Array.isArray(v))return v.map(scalar).filter(Boolean).join(", ");
  if(typeof v==="object"&&Array.isArray(v.fighters))return v.fighters.map(scalar).filter(Boolean).join(" vs. ");
  return"";
}
function cleanContext(value){
  let text=scalar(value).replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
  text=text.replace(/\bRead the Full Article Here\b.*$/i,"").replace(/\bAdvertisement\b/gi," ").replace(/\s+/g," ").trim();
  if(!text)return"";
  const codeLike=/(?:function\s*\(|=>|\bconst\s+\w+\s*=|\bvar\s+\w+\s*=|window\.|document\.|webpack|__NEXT_DATA__|application\/ld\+json|<\/?script|\{\s*["'][\w-]+["']\s*:)/i;
  const punctuation=(text.match(/[{};=<>]/g)||[]).length;
  if(codeLike.test(text)||punctuation>Math.max(8,text.length*.035))return"";
  return text.slice(0,460);
}
function contextFacts(value){
  const text=cleanContext(value);if(!text)return[];
  const resultStyle=(text.match(/\bdef\./gi)||[]).length>=2&&text.includes("—");
  let parts=resultStyle
    ? text.split(/\s+—\s+/)
    : text.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(])/);
  parts=parts.map(x=>x.trim()).filter(x=>x.length>=25&&!cleanContext(x).includes("[object Object]"));
  if(!parts.length)parts=[text];
  const out=[];
  for(const part of parts){
    const clean=cleanContext(part);if(!clean)continue;
    out.push(clean.length>170?clean.slice(0,167).trim()+"…":clean);
    if(out.length>=4)break;
  }
  return out;
}
function renderFacts(label,facts){
  if(!facts.length){els.context.innerHTML="";return}
  els.context.innerHTML='<div class="context-label">'+escapeHtml(label)+'</div>'+
    facts.map(f=>'<div class="context-fact">'+escapeHtml(f)+'</div>').join("");
}
function bestNewsContext(s){
  const candidates=[s.context,s.excerpt,s.summary,s.description];
  for(const candidate of candidates){
    const clean=cleanContext(candidate);
    if(clean.length>=75)return clean;
  }
  return"";
}

function newsSlides(news){
  const seen=new Set();
  return [news?.topStory,...(news?.stories||[])]
    .filter(Boolean)
    .map(s=>({...s,_context:bestNewsContext(s)}))
    .filter(s=>s.title&&s.url&&s._context&&fresh(s.publishedAt,NEWS_MAX_AGE_MS))
    .filter(s=>{const k=s.id||s.url;if(seen.has(k))return false;seen.add(k);return true})
    .slice(0,16)
    .map(s=>({type:"news",title:s.title,context:s._context,source:s.source||"Combat Sports",publishedAt:s.publishedAt,image:imageFor(s),url:s.url,relatedSources:s.relatedSources||[],coverageCount:s.coverageCount||1}));
}
function videoSlides(feed){
  return (feed?.videos||[])
    .filter(v=>{
      const duration=Number(v?.durationSeconds||0);
      return v?.title&&v?.videoId&&fresh(v.publishedAt,VIDEO_MAX_AGE_MS)&&v.embeddable!==false&&v.liveBroadcastContent!=="live"&&duration>=VIDEO_MIN_SECONDS&&duration<=VIDEO_MAX_SECONDS;
    })
    .slice(0,8)
    .map(v=>({type:"video",title:v.title,source:v.channel||"YouTube",publishedAt:v.publishedAt,image:v.thumbnail||"",videoId:v.videoId,durationSeconds:Number(v.durationSeconds||0)}));
}
function mainEventText(e){
  const raw=e?.main_event;
  if(raw&&typeof raw==="object"){
    const fighters=Array.isArray(raw.fighters)?raw.fighters.map(scalar).filter(Boolean):[];
    const matchup=fighters.length>=2?fighters.join(" vs. "):scalar(raw.name||raw.title);
    const wc=scalar(raw.weight_class);
    return[matchup,wc].filter(Boolean).join(" — ");
  }
  return scalar(raw);
}
function eventFacts(e){
  const facts=[];
  const main=mainEventText(e);if(main)facts.push("Main event: "+main);
  const venue=scalar(e.venue),location=scalar(e.location);
  if(venue||location)facts.push([venue,location].filter(Boolean).join(" · "));
  const broadcast=scalar(e.broadcast);if(broadcast)facts.push("Watch: "+broadcast);
  return facts;
}
function eventSlides(events){
  return events.slice(0,3).map(e=>({
    type:"event",title:scalar(e.title)||scalar(e.promotion)||"Upcoming Event",
    source:scalar(e.promotion)||"MMA",publishedAt:"",image:scalar(e.poster_url)||scalar(e.image)||"",
    event:e,context:eventFacts(e)
  }));
}
function buildSlides(news,videos,events){
  const headlines=newsSlides(news),clips=videoSlides(videos),cards=eventSlides(events),out=[];
  let ni=0,vi=0,ei=0;
  while(ni<headlines.length){
    out.push(headlines[ni++]);
    if(ni<headlines.length)out.push(headlines[ni++]);
    if(clips.length)out.push(clips[vi++%clips.length]);
    if(ni<headlines.length)out.push(headlines[ni++]);
    if(cards.length)out.push(cards[ei++%cards.length]);
  }
  if(!out.length)out.push(...clips,...cards);
  return out;
}
function renderTicker(news){
  const items=[news?.topStory,...(news?.stories||[])].filter(Boolean).filter(s=>s.title&&fresh(s.publishedAt,NEWS_MAX_AGE_MS)).slice(0,14);
  if(!items.length){els.ticker.innerHTML="<span>Waiting for fresh combat sports headlines…</span>";return}
  const html=items.map(s=>"<span>"+escapeHtml(s.title)+"</span>").join("");
  els.ticker.innerHTML=html+html;
}

function startBed(){
  if(!els.bed)return;
  els.bed.volume=BED_VOLUME;
  const p=els.bed.play();if(p?.catch)p.catch(()=>{});
}
function fadeBed(target,duration=900){
  if(!els.bed)return;
  clearInterval(bedFadeTimer);
  const start=Number(els.bed.volume||0),steps=Math.max(1,Math.round(duration/50));
  let step=0;
  bedFadeTimer=setInterval(()=>{
    step+=1;els.bed.volume=Math.max(0,Math.min(1,start+(target-start)*(step/steps)));
    if(step>=steps)clearInterval(bedFadeTimer);
  },50);
}
document.addEventListener("click",startBed,{once:true});

function resetVideoHost(){
  try{videoPlayer?.destroy()}catch{}
  videoPlayer=null;
  clearTimeout(videoWatchdog);videoWatchdog=0;
  els.videoShell.innerHTML='<div id="broadcast-youtube-player"></div>';
}
function fadeVideoOut(done){
  if(!videoPlayer||typeof videoPlayer.getVolume!=="function"){done();return}
  let start=VIDEO_VOLUME;
  try{start=Number(videoPlayer.getVolume())||VIDEO_VOLUME}catch{}
  let step=0;
  const steps=12;
  const iv=setInterval(()=>{
    step+=1;
    const volume=Math.max(0,Math.round(start*(1-step/steps)));
    try{videoPlayer.setVolume(volume)}catch{}
    if(step>=steps){clearInterval(iv);done()}
  },60);
}
function beginProgress(ms){
  els.progress.style.transition="none";els.progress.style.width="0";
  requestAnimationFrame(()=>{els.progress.style.transition="width "+ms+"ms linear";els.progress.style.width="100%"});
}
async function startVideo(slide){
  els.stage.classList.add("video-mode");
  els.image.src="";els.image.style.display="none";els.blur.style.backgroundImage="none";
  fadeBed(BED_DUCK_VOLUME,800);
  const YT=await Promise.race([ytReady,new Promise(resolve=>setTimeout(()=>resolve(null),9000))]);
  if(!YT?.Player){timer=setTimeout(advance,12000);return}
  resetVideoHost();
  videoPlayer=new YT.Player("broadcast-youtube-player",{
    videoId:slide.videoId,
    playerVars:{autoplay:1,controls:0,rel:0,playsinline:1,fs:0,iv_load_policy:3},
    events:{
      onReady:event=>{
        try{event.target.setVolume(VIDEO_VOLUME);event.target.unMute();event.target.playVideo()}catch{}
      },
      onStateChange:event=>{
        if(event.data===YT.PlayerState.PLAYING){
          let seconds=slide.durationSeconds;
          try{seconds=Number(event.target.getDuration())||seconds}catch{}
          const ms=Math.max(1000,seconds*1000);
          beginProgress(ms);
          clearTimeout(videoWatchdog);
          videoWatchdog=setTimeout(()=>transitionAdvance(true),(seconds+18)*1000);
        }
        if(event.data===YT.PlayerState.ENDED)transitionAdvance(false);
      },
      onError:()=>setTimeout(()=>transitionAdvance(false),1200)
    }
  });
}
function setMediaImage(url){
  resetVideoHost();els.stage.classList.remove("video-mode");
  els.image.src=url||"";els.image.alt="";
  const safe=url?String(url).replace(/"/g,"%22"):"";
  els.blur.style.backgroundImage=safe?'url("'+safe+'")':"radial-gradient(circle at 50% 40%,#242424,#090909 70%)";
  els.image.style.display=url?"block":"none";
}
function parseEventDate(e){
  const start=scalar(e?.starts_at);
  if(start){const d=safeDate(start);if(d)return{date:d,hasTime:true}}
  const day=scalar(e?.date);
  if(/^\d{4}-\d{2}-\d{2}$/.test(day)){
    const d=new Date(day+"T12:00:00");
    return Number.isNaN(d.getTime())?null:{date:d,hasTime:false};
  }
  const d=safeDate(day);return d?{date:d,hasTime:false}:null;
}
function formatEventDate(e){
  const parsed=parseEventDate(e);if(!parsed)return"Date TBA";
  const opts=parsed.hasTime
    ? {timeZone:"America/Chicago",weekday:"long",month:"long",day:"numeric",hour:"numeric",minute:"2-digit"}
    : {weekday:"long",month:"long",day:"numeric"};
  return parsed.date.toLocaleString("en-US",opts)+(parsed.hasTime?" CT":"");
}
function renderEventVisual(slide){
  resetVideoHost();els.stage.classList.remove("video-mode");
  els.visual.querySelector(".event-board")?.remove();
  if(slide.image){setMediaImage(slide.image);return}
  els.image.src="";els.image.style.display="none";els.blur.style.backgroundImage="none";
  const e=slide.event||{},box=document.createElement("div");box.className="event-board";
  box.innerHTML='<div class="story-kicker">UPCOMING EVENT</div><h2>'+escapeHtml(slide.source||"MMA")+'</h2><div class="event-date">'+escapeHtml(formatEventDate(e))+'</div><div class="event-detail">'+escapeHtml(slide.title||"")+'</div>';
  els.visual.append(box);
}
function renderRail(){
  const upcoming=[];
  for(let offset=0;offset<slides.length&&upcoming.length<3;offset++){
    const s=slides[(index+offset)%slides.length];if(!s)continue;upcoming.push(s);
  }
  els.rail.innerHTML=upcoming.map(s=>'<div class="rail-item"><div class="rail-type">'+escapeHtml(s.type==="video"?"VIDEO":s.type==="event"?"EVENT":"NEWS")+'</div><div class="rail-title">'+escapeHtml(s.title||"")+'</div><div class="rail-source">'+escapeHtml(s.source||"")+'</div></div>').join("");
}

function renderSlideNow(s){
  currentSlide=s;
  els.stage.classList.remove("event-mode","layout-flip","video-mode");
  els.visual.querySelector(".event-board")?.remove();
  if(s.type==="news"&&index%2===0)els.stage.classList.add("layout-flip");
  if(s.type==="video")startVideo(s);
  else if(s.type==="event"){els.stage.classList.add("event-mode");renderEventVisual(s)}
  else setMediaImage(s.image);

  els.title.textContent=s.title||"Combat Sports Update";
  els.title.classList.toggle("is-long",String(s.title||"").length>92);
  els.source.textContent=(s.source||"Combat Sports").toUpperCase();
  els.time.textContent=s.type==="event"?"UPCOMING":relativeTime(s.publishedAt);
  els.eyebrow.textContent=s.type==="video"?"LATEST VIDEO":s.type==="event"?"FIGHT CALENDAR":"NEWS UPDATE";
  els.badge.textContent=s.type==="video"?"NOW PLAYING":s.type==="event"?"UP NEXT":"LATEST";

  if(s.type==="news")renderFacts("WHAT WE KNOW",contextFacts(s.context));
  else if(s.type==="event")renderFacts("EVENT DETAILS",Array.isArray(s.context)?s.context:contextFacts(s.context));
  else els.context.innerHTML="";

  const related=(s.relatedSources||[]).slice(0,3);
  if(s.type==="news"&&related.length){els.coverage.hidden=false;els.coverageText.textContent=related.join(" • ")}
  else els.coverage.hidden=true;

  renderRail();
  if(s.type!=="video"){
    fadeBed(BED_VOLUME,1000);
    const duration=s.type==="event"?EVENT_MS:NEWS_MS;
    beginProgress(duration);
    clearTimeout(timer);timer=setTimeout(advance,duration);
  }
}
function transitionTo(s){
  if(transitioning)return;
  transitioning=true;clearTimeout(timer);clearTimeout(videoWatchdog);
  const swap=()=>{
    els.stage.classList.add("is-switching");
    setTimeout(()=>{
      if(currentSlide?.type==="video")resetVideoHost();
      renderSlideNow(s);
      requestAnimationFrame(()=>requestAnimationFrame(()=>els.stage.classList.remove("is-switching")));
      setTimeout(()=>{transitioning=false},TRANSITION_MS);
    },TRANSITION_MS);
  };
  if(currentSlide?.type==="video"&&videoPlayer)fadeVideoOut(swap);else swap();
}
function transitionAdvance(forceFade){
  if(transitioning)return;
  const next=slides[index%slides.length];index=(index+1)%slides.length;
  if(forceFade&&videoPlayer){transitioning=true;fadeVideoOut(()=>{transitioning=false;transitionTo(next)})}
  else transitionTo(next);
}
function advance(){
  if(!slides.length||transitioning)return;
  const s=slides[index%slides.length];index=(index+1)%slides.length;transitionTo(s);
}

function chicagoDateKey(){
  const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const get=t=>parts.find(p=>p.type===t)?.value||"";
  return get("year")+"-"+get("month")+"-"+get("day");
}
function normalizedEvents(data){
  const list=Array.isArray(data?.events)?data.events:[],today=chicagoDateKey();
  return list.filter(x=>{
    const day=scalar(x?.date);
    if(/^\d{4}-\d{2}-\d{2}$/.test(day))return day>=today;
    const parsed=parseEventDate(x);return parsed&&parsed.date.getTime()>Date.now()-6*60*60*1000;
  }).sort((a,b)=>String(scalar(a.starts_at)||scalar(a.date)).localeCompare(String(scalar(b.starts_at)||scalar(b.date))));
}
async function load(){
  const [news,videos,eventData]=await Promise.all([
    getWithFallback(NEWS_REMOTE,NEWS_FALLBACK).catch(()=>({stories:[]})),
    getWithFallback(VIDEOS_REMOTE,VIDEOS_FALLBACK).catch(()=>({videos:[]})),
    getJson(EVENTS).catch(()=>({events:[]}))
  ]);
  eventCache=normalizedEvents(eventData);
  const nextSlides=buildSlides(news,videos,eventCache);
  if(nextSlides.length)slides=nextSlides;
  renderTicker(news);
  const next=eventCache[0];if(next)els.event.textContent="NEXT: "+String(scalar(next.promotion)||"EVENT").toUpperCase()+" · "+String(scalar(next.date)||"");
  if(!currentSlide&&!timer)advance();
}
function clock(){els.clock.textContent=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",hour:"numeric",minute:"2-digit",second:"2-digit"}).format(new Date())+" CT"}

startBed();clock();setInterval(clock,1000);load();setInterval(load,REFRESH_MS);
})();