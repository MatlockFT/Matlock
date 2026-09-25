(() => {
const NEWS_REMOTE="https://api.github.com/repos/MatlockFT/Matlock/releases/tags/mma-news-data";
const NEWS_FALLBACK="/assets/data/mma-news.json";
const EVENTS="/assets/data/upcoming-events-live.json";
const SLIDE_MS=12000, REFRESH_MS=300000;
const q=s=>document.querySelector(s);
const els={media:q("[data-media]"),title:q("[data-title]"),deck:q("[data-deck]"),source:q("[data-source]"),time:q("[data-time]"),eyebrow:q("[data-eyebrow]"),progress:q("[data-progress]"),ticker:q("[data-ticker-track]"),event:q("[data-next-event]"),clock:q("[data-clock]")};
let slides=[],index=0,timer=0;
const safeDate=v=>{const d=new Date(v||"");return Number.isNaN(d.getTime())?null:d};
async function getJson(url){const u=new URL(url,location.href);u.searchParams.set("_",Math.floor(Date.now()/60000));const r=await fetch(u,{cache:"no-store",headers:{accept:"application/json"}});if(!r.ok)throw new Error(r.status);const j=await r.json();return typeof j.body==="string"&&j.tag_name?JSON.parse(j.body):j}
function relativeTime(v){const d=safeDate(v);if(!d)return"LIVE";const m=Math.max(0,Math.round((Date.now()-d.getTime())/60000));if(m<2)return"JUST NOW";if(m<60)return m+" MIN AGO";const h=Math.round(m/60);if(h<24)return h+" HR AGO";return d.toLocaleDateString("en-US",{month:"short",day:"numeric"}).toUpperCase()}
function imageFor(story){return story.image||story.imageUrl||story.thumbnail||story.ogImage||""}
function buildSlides(news){
 const seen=new Set();
 const stories=[news?.topStory,...(news?.stories||[])].filter(Boolean).filter(s=>s.title&&s.url).filter(s=>{const k=s.id||s.url;if(seen.has(k))return false;seen.add(k);return true}).slice(0,12).map(s=>({type:"news",title:s.title,deck:s.summary||s.description||"",source:s.source||"Combat Sports",publishedAt:s.publishedAt,image:imageFor(s)}));
 let posts=[];try{posts=JSON.parse(q("#matlock-posts")?.textContent||"[]")}catch{}
 const merged=[];const max=Math.max(stories.length,posts.length);
 for(let i=0;i<max;i++){if(stories[i])merged.push(stories[i]);if(i%2===1&&posts[Math.floor(i/2)])merged.push(posts[Math.floor(i/2)])}
 return merged.length?merged:[...posts];
}
function renderTicker(news){
 const items=[news?.topStory,...(news?.stories||[])].filter(Boolean).filter(s=>s.title).slice(0,14);
 const html=items.map(s=>"<span>"+escapeHtml(s.title)+"</span>").join("");
 els.ticker.innerHTML=html+html;
}
function escapeHtml(v){const d=document.createElement("div");d.textContent=v||"";return d.innerHTML}
function renderSlide(s){
 els.media.classList.add("fade-out");setTimeout(()=>{
   els.media.style.backgroundImage=s.image?'url("'+String(s.image).replace(/"/g,"%22")+'")':"radial-gradient(circle at 72% 35%,#363636,#111 52%,#050505)";
   els.title.textContent=s.title||"MMA Matlock";
   els.deck.textContent=s.deck||"";
   els.deck.style.display=s.deck?"block":"none";
   els.source.textContent=(s.source||"MMA Matlock").toUpperCase();
   els.time.textContent=relativeTime(s.publishedAt);
   els.eyebrow.textContent=s.type==="article"?"FROM MMA MATLOCK":"LATEST";
   els.media.classList.remove("fade-out");els.media.classList.remove("active");void els.media.offsetWidth;els.media.classList.add("active");
 },450);
 els.progress.style.transition="none";els.progress.style.width="0";requestAnimationFrame(()=>{els.progress.style.transition="width "+SLIDE_MS+"ms linear";els.progress.style.width="100%"});
}
function advance(){if(!slides.length)return;renderSlide(slides[index%slides.length]);index++;clearTimeout(timer);timer=setTimeout(advance,SLIDE_MS)}
async function load(){
 let news;try{news=await getJson(NEWS_REMOTE)}catch{try{news=await getJson(NEWS_FALLBACK)}catch{news={stories:[]}}}
 slides=buildSlides(news);renderTicker(news);
 try{const ev=await getJson(EVENTS);const list=Array.isArray(ev.events)?ev.events:[];const next=list.filter(x=>x.date&&new Date(x.date+"T23:59:59")>new Date()).sort((a,b)=>String(a.date).localeCompare(String(b.date)))[0];if(next)els.event.textContent="NEXT: "+String(next.promotion||"EVENT").toUpperCase()+" · "+String(next.date||"")}catch{}
 if(!timer)advance();
}
function clock(){els.clock.textContent=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",hour:"numeric",minute:"2-digit",second:"2-digit"}).format(new Date())+" CT"}
clock();setInterval(clock,1000);load();setInterval(load,REFRESH_MS);
})();