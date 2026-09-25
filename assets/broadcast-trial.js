(() => {
const NEWS_REMOTE="https://raw.githubusercontent.com/MatlockFT/Matlock/live-news-data/mma-news.json";
const NEWS_FALLBACK="/assets/data/mma-news.json";
const VIDEOS_REMOTE="https://raw.githubusercontent.com/MatlockFT/Matlock/live-news-data/mma-videos.json";
const VIDEOS_FALLBACK="/assets/data/mma-videos.json";
const EVENTS="/assets/data/upcoming-events-live.json";
const REFRESH_MS=300000;
const NEWS_MAX_AGE_MS=48*60*60*1000, VIDEO_MAX_AGE_MS=48*60*60*1000;
const NEWS_MS=30000, VIDEO_MS=75000, EVENT_MS=40000;
const q=s=>document.querySelector(s);
const els={
 stage:q("[data-stage]"),blur:q("[data-visual-blur]"),image:q("[data-story-image]"),video:q("[data-video-frame]"),
 title:q("[data-title]"),context:q("[data-context]"),source:q("[data-source]"),time:q("[data-time]"),
 eyebrow:q("[data-eyebrow]"),badge:q("[data-visual-badge]"),progress:q("[data-progress]"),
 ticker:q("[data-ticker-track]"),event:q("[data-next-event]"),clock:q("[data-clock]"),
 coverage:q("[data-coverage]"),coverageText:q("[data-coverage-text]"),rail:q("[data-rail-items]"),visual:q("[data-visual-panel]")
};
let slides=[],index=0,timer=0,newsCache=null,eventCache=[];
const safeDate=v=>{const d=new Date(v||"");return Number.isNaN(d.getTime())?null:d};
const fresh=(v,maxAge)=>{const d=safeDate(v);return d&&Date.now()-d.getTime()<=maxAge&&d.getTime()<=Date.now()+5*60*1000};
async function getJson(url){const u=new URL(url,location.href);u.searchParams.set("_",Math.floor(Date.now()/60000));const r=await fetch(u,{cache:"no-store",headers:{accept:"application/json"}});if(!r.ok)throw new Error(r.status);return r.json()}
async function getWithFallback(primary,fallback){try{return await getJson(primary)}catch{return getJson(fallback)}}
function relativeTime(v){const d=safeDate(v);if(!d)return"LIVE";const m=Math.max(0,Math.round((Date.now()-d.getTime())/60000));if(m<2)return"JUST NOW";if(m<60)return m+" MIN AGO";const h=Math.round(m/60);if(h<24)return h+" HR AGO";return d.toLocaleDateString("en-US",{month:"short",day:"numeric"}).toUpperCase()}
function imageFor(story){return story.image||story.imageUrl||story.thumbnail||story.ogImage||""}
function newsSlides(news){
 const seen=new Set();
 return [news?.topStory,...(news?.stories||[])]
  .filter(Boolean).filter(s=>s.title&&s.url&&fresh(s.publishedAt,NEWS_MAX_AGE_MS))
  .filter(s=>{const k=s.id||s.url;if(seen.has(k))return false;seen.add(k);return true})
  .slice(0,16)
  .map(s=>({type:"news",title:s.title,context:s.context||s.excerpt||s.summary||s.description||"",source:s.source||"Combat Sports",publishedAt:s.publishedAt,image:imageFor(s),url:s.url,relatedSources:s.relatedSources||[],coverageCount:s.coverageCount||1}));
}
function videoSlides(feed){
 return (feed?.videos||[]).filter(v=>v?.title&&v?.videoId&&fresh(v.publishedAt,VIDEO_MAX_AGE_MS)&&v.embeddable!==false).slice(0,8)
  .map(v=>({type:"video",title:v.title,context:"Playing a recent upload from "+(v.channel||"an MMA channel")+".",source:v.channel||"YouTube",publishedAt:v.publishedAt,image:v.thumbnail||"",videoId:v.videoId,durationSeconds:v.durationSeconds||0}));
}
function eventSlides(events){
 return events.slice(0,3).map(e=>({type:"event",title:e.title||e.promotion||"Upcoming Event",context:[e.main_event,e.venue,e.broadcast].filter(Boolean).join(" • "),source:e.promotion||"MMA",publishedAt:e.starts_at||e.date,image:"",event:e}));
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
function escapeHtml(v){const d=document.createElement("div");d.textContent=v||"";return d.innerHTML}
function setMediaImage(url){
 els.video.src="";els.stage.classList.remove("video-mode");
 els.image.src=url||"";els.image.alt="";
 const safe=url?String(url).replace(/"/g,"%22"):"";
 els.blur.style.backgroundImage=safe?'url("'+safe+'")':"radial-gradient(circle at 50% 40%,#242424,#090909 70%)";
 els.image.style.display=url?"block":"none";
}
function setVideo(slide){
 els.stage.classList.add("video-mode");
 els.image.src="";els.blur.style.backgroundImage="none";
 const origin=encodeURIComponent(location.origin);
 els.video.src="https://www.youtube.com/embed/"+encodeURIComponent(slide.videoId)+"?autoplay=1&mute=1&controls=1&rel=0&playsinline=1&modestbranding=1&enablejsapi=1&origin="+origin;
}
function renderEventVisual(slide){
 els.video.src="";els.stage.classList.remove("video-mode");els.image.src="";els.image.style.display="none";els.blur.style.backgroundImage="none";
 els.visual.querySelector(".event-board")?.remove();
 const box=document.createElement("div");box.className="event-board";
 const e=slide.event||{};
 const date=safeDate(e.starts_at||e.date);
 box.innerHTML="<div class=\"story-kicker\">UPCOMING EVENT</div><h2>"+escapeHtml(e.promotion||"MMA")+"</h2><div class=\"event-date\">"+escapeHtml(date?date.toLocaleString("en-US",{timeZone:"America/Chicago",weekday:"long",month:"long",day:"numeric",hour:"numeric",minute:"2-digit"})+" CT":String(e.date||"Date TBA"))+"</div><div class=\"event-detail\">"+escapeHtml(e.title||"")+"</div>";
 els.visual.append(box);
}
function renderRail(){
 const upcoming=[];
 for(let offset=0;offset<slides.length&&upcoming.length<3;offset++){
  const s=slides[(index+offset)%slides.length];if(!s)continue;
  upcoming.push(s);
 }
 els.rail.innerHTML=upcoming.map(s=>"<div class=\"rail-item\"><div class=\"rail-type\">"+escapeHtml(s.type==="video"?"VIDEO":s.type==="event"?"EVENT":"NEWS")+"</div><div class=\"rail-title\">"+escapeHtml(s.title||"")+"</div><div class=\"rail-source\">"+escapeHtml(s.source||"")+"</div></div>").join("");
}
function renderSlide(s){
 els.stage.classList.remove("event-mode","layout-flip");
 els.visual.querySelector(".event-board")?.remove();
 if(s.type==="news"&&index%2===0)els.stage.classList.add("layout-flip");
 if(s.type==="video")setVideo(s);else if(s.type==="event"){els.stage.classList.add("event-mode");renderEventVisual(s)}else setMediaImage(s.image);
 els.title.textContent=s.title||"Combat Sports Update";
 els.title.classList.toggle("is-long",String(s.title||"").length>92);
 els.context.textContent=s.context||"";
 els.context.style.display=s.context?"block":"none";
 els.source.textContent=(s.source||"Combat Sports").toUpperCase();
 els.time.textContent=s.type==="event"?"UPCOMING":relativeTime(s.publishedAt);
 els.eyebrow.textContent=s.type==="video"?"LATEST VIDEO":s.type==="event"?"FIGHT CALENDAR":"NEWS UPDATE";
 els.badge.textContent=s.type==="video"?"PLAYING VIDEO":s.type==="event"?"UP NEXT":"LATEST";
 const related=(s.relatedSources||[]).slice(0,3);
 if(s.type==="news"&&related.length){els.coverage.hidden=false;els.coverageText.textContent=related.join(" • ")}else els.coverage.hidden=true;
 renderRail();
 const duration=s.type==="video"?Math.min(VIDEO_MS,Math.max(45000,(s.durationSeconds||75)*1000)):s.type==="event"?EVENT_MS:NEWS_MS;
 els.progress.style.transition="none";els.progress.style.width="0";
 requestAnimationFrame(()=>{els.progress.style.transition="width "+duration+"ms linear";els.progress.style.width="100%"});
 clearTimeout(timer);timer=setTimeout(advance,duration);
}
function advance(){if(!slides.length)return;const s=slides[index%slides.length];index=(index+1)%slides.length;renderSlide(s)}
function normalizedEvents(data){
 const list=Array.isArray(data?.events)?data.events:[];
 return list.filter(x=>x.date&&new Date(x.date+"T23:59:59")>new Date()).sort((a,b)=>String(a.starts_at||a.date).localeCompare(String(b.starts_at||b.date)));
}
async function load(){
 const [news,videos,eventData]=await Promise.all([
  getWithFallback(NEWS_REMOTE,NEWS_FALLBACK).catch(()=>({stories:[]})),
  getWithFallback(VIDEOS_REMOTE,VIDEOS_FALLBACK).catch(()=>({videos:[]})),
  getJson(EVENTS).catch(()=>({events:[]}))
 ]);
 newsCache=news;eventCache=normalizedEvents(eventData);
 slides=buildSlides(news,videos,eventCache);renderTicker(news);
 const next=eventCache[0];if(next)els.event.textContent="NEXT: "+String(next.promotion||"EVENT").toUpperCase()+" · "+String(next.date||"");
 if(!timer)advance();
}
function clock(){els.clock.textContent=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",hour:"numeric",minute:"2-digit",second:"2-digit"}).format(new Date())+" CT"}
clock();setInterval(clock,1000);load();setInterval(load,REFRESH_MS);
})();