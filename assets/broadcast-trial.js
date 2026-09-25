(() => {
const NEWS_REMOTE="https://raw.githubusercontent.com/MatlockFT/Matlock/live-news-data/mma-news.json";
const NEWS_FALLBACK="/assets/data/mma-news.json";
const VIDEOS_REMOTE="https://raw.githubusercontent.com/MatlockFT/Matlock/live-news-data/mma-videos.json";
const VIDEOS_FALLBACK="/assets/data/mma-videos.json";
const EVENTS="/assets/data/upcoming-events-live.json";
const SLIDE_MS=12000, REFRESH_MS=300000;
const NEWS_MAX_AGE_MS=48*60*60*1000, VIDEO_MAX_AGE_MS=48*60*60*1000;
const q=s=>document.querySelector(s);
const els={media:q("[data-media]"),title:q("[data-title]"),deck:q("[data-deck]"),source:q("[data-source]"),time:q("[data-time]"),eyebrow:q("[data-eyebrow]"),progress:q("[data-progress]"),ticker:q("[data-ticker-track]"),event:q("[data-next-event]"),clock:q("[data-clock]")};
let slides=[],index=0,timer=0;
const safeDate=v=>{const d=new Date(v||"");return Number.isNaN(d.getTime())?null:d};
const fresh=(v,maxAge)=>{const d=safeDate(v);return d&&Date.now()-d.getTime()<=maxAge&&d.getTime()<=Date.now()+5*60*1000};
async function getJson(url){const u=new URL(url,location.href);u.searchParams.set("_",Math.floor(Date.now()/60000));const r=await fetch(u,{cache:"no-store",headers:{accept:"application/json"}});if(!r.ok)throw new Error(r.status);return r.json()}
async function getWithFallback(primary,fallback){try{return await getJson(primary)}catch{return getJson(fallback)}}
function relativeTime(v){const d=safeDate(v);if(!d)return"LIVE";const m=Math.max(0,Math.round((Date.now()-d.getTime())/60000));if(m<2)return"JUST NOW";if(m<60)return m+" MIN AGO";const h=Math.round(m/60);if(h<24)return h+" HR AGO";return d.toLocaleDateString("en-US",{month:"short",day:"numeric"}).toUpperCase()}
function imageFor(story){return story.image||story.imageUrl||story.thumbnail||story.ogImage||""}
function newsSlides(news){
 const seen=new Set();
 return [news?.topStory,...(news?.stories||[])]
  .filter(Boolean)
  .filter(s=>s.title&&s.url&&fresh(s.publishedAt,NEWS_MAX_AGE_MS))
  .filter(s=>{const k=s.id||s.url;if(seen.has(k))return false;seen.add(k);return true})
  .slice(0,18)
  .map(s=>({type:"news",title:s.title,deck:s.excerpt||s.summary||s.description||"",source:s.source||"Combat Sports",publishedAt:s.publishedAt,image:imageFor(s),url:s.url}));
}
function videoSlides(feed){
 return (feed?.videos||[])
  .filter(v=>v?.title&&v?.videoId&&fresh(v.publishedAt,VIDEO_MAX_AGE_MS))
  .slice(0,10)
  .map(v=>({type:"video",title:v.title,deck:"Latest upload from "+(v.channel||"MMA YouTube"),source:v.channel||"YouTube",publishedAt:v.publishedAt,image:v.thumbnail||"",url:"https://www.youtube.com/watch?v="+v.videoId}));
}
function buildSlides(news,videos){
 const headlines=newsSlides(news), clips=videoSlides(videos), mixed=[];
 let vi=0;
 headlines.forEach((story,i)=>{mixed.push(story);if((i+1)%3===0&&clips.length)mixed.push(clips[vi++%clips.length])});
 if(!headlines.length)mixed.push(...clips);
 return mixed;
}
function renderTicker(news){
 const items=[news?.topStory,...(news?.stories||[])].filter(Boolean).filter(s=>s.title&&fresh(s.publishedAt,NEWS_MAX_AGE_MS)).slice(0,14);
 if(!items.length){els.ticker.innerHTML="<span>Waiting for fresh combat sports headlines…</span>";return}
 const html=items.map(s=>"<span>"+escapeHtml(s.title)+"</span>").join("");
 els.ticker.innerHTML=html+html;
}
function escapeHtml(v){const d=document.createElement("div");d.textContent=v||"";return d.innerHTML}
function renderSlide(s){
 els.media.classList.add("fade-out");setTimeout(()=>{
   els.media.style.backgroundImage=s.image?'url("'+String(s.image).replace(/"/g,"%22")+'")':"radial-gradient(circle at 72% 35%,#363636,#111 52%,#050505)";
   els.title.textContent=s.title||"Combat Sports Update";
   els.deck.textContent=s.deck||"";
   els.deck.style.display=s.deck?"block":"none";
   els.source.textContent=(s.source||"Combat Sports").toUpperCase();
   els.time.textContent=relativeTime(s.publishedAt);
   els.eyebrow.textContent=s.type==="video"?"LATEST VIDEO":"LATEST NEWS";
   els.media.classList.remove("fade-out");els.media.classList.remove("active");void els.media.offsetWidth;els.media.classList.add("active");
 },450);
 els.progress.style.transition="none";els.progress.style.width="0";requestAnimationFrame(()=>{els.progress.style.transition="width "+SLIDE_MS+"ms linear";els.progress.style.width="100%"});
}
function advance(){if(!slides.length)return;renderSlide(slides[index%slides.length]);index++;clearTimeout(timer);timer=setTimeout(advance,SLIDE_MS)}
async function load(){
 const [news,videos]=await Promise.all([
  getWithFallback(NEWS_REMOTE,NEWS_FALLBACK).catch(()=>({stories:[]})),
  getWithFallback(VIDEOS_REMOTE,VIDEOS_FALLBACK).catch(()=>({videos:[]}))
 ]);
 slides=buildSlides(news,videos);renderTicker(news);
 try{const ev=await getJson(EVENTS);const list=Array.isArray(ev.events)?ev.events:[];const next=list.filter(x=>x.date&&new Date(x.date+"T23:59:59")>new Date()).sort((a,b)=>String(a.date).localeCompare(String(b.date)))[0];if(next)els.event.textContent="NEXT: "+String(next.promotion||"EVENT").toUpperCase()+" · "+String(next.date||"")}catch{}
 if(!timer)advance();
}
function clock(){els.clock.textContent=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",hour:"numeric",minute:"2-digit",second:"2-digit"}).format(new Date())+" CT"}
clock();setInterval(clock,1000);load();setInterval(load,REFRESH_MS);
})();