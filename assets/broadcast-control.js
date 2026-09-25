(() => {
const app=document.querySelector('[data-broadcast-control-app]');if(!app)return;
const RAW_CONFIG='https://raw.githubusercontent.com/MatlockFT/Matlock/main/assets/uploads/broadcast-control.json';
const FALLBACK_CONFIG='/assets/data/broadcast-control.json';
const CONFIG_API_PATH='/contents/assets/uploads/broadcast-control.json';
const NEWS='https://raw.githubusercontent.com/MatlockFT/Matlock/live-news-data/mma-news.json';
const VIDEOS='https://raw.githubusercontent.com/MatlockFT/Matlock/live-news-data/mma-videos.json';
const EVENTS='/assets/data/upcoming-events-live.json';
const DEFAULT={"version":1,"revision":1,"updatedAt":null,"modules":{"news":true,"video":true,"events":true,"ticker":true,"comingUp":true,"music":true},"rundown":["news","news","video","news","event"],"timing":{"newsSeconds":45,"eventSeconds":35,"transitionMs":650,"controlPollSeconds":10},"news":{"maxAgeHours":48,"maxItems":16,"sources":[],"requireContext":true,"contextFacts":4},"video":{"maxAgeHours":48,"maxItems":8,"minSeconds":20,"maxSeconds":600,"volume":50,"channels":[],"playFull":true},"events":{"maxItems":3,"usePosters":true},"audio":{"enabled":true,"musicUrl":"https://opengameart.org/sites/default/files/8bit%20Bossa.mp3","musicVolume":14,"duckVolume":3.5},"ticker":{"enabled":true,"speedSeconds":240,"maxItems":14},"visual":{"flipNews":true,"showRail":true,"showClock":true,"showBadge":true,"showSource":true},"sources":{"customNewsFeeds":[],"customVideoChannels":[]},"hidden":{"news":[],"videos":[],"events":[]},"forceNext":null};
const q=s=>app.querySelector(s),qa=s=>[...app.querySelectorAll(s)];
let state=structuredClone(DEFAULT),saved=structuredClone(DEFAULT),feeds={news:null,videos:null,events:null},contentTab='news',dragIndex=-1,toastTimer=0;

function clone(v){return JSON.parse(JSON.stringify(v))}
function deepMerge(base,extra){const out=clone(base);for(const[k,v]of Object.entries(extra||{})){if(v&&typeof v==='object'&&!Array.isArray(v)&&out[k]&&typeof out[k]==='object'&&!Array.isArray(out[k]))out[k]=deepMerge(out[k],v);else out[k]=v}return out}
function getPath(obj,path){return path.split('.').reduce((a,k)=>a?.[k],obj)}
function setPath(obj,path,value){const p=path.split('.');let a=obj;for(let i=0;i<p.length-1;i++)a=a[p[i]]??={};a[p.at(-1)]=value}
function toast(msg){const el=q('[data-toast]');clearTimeout(toastTimer);el.textContent=msg;el.hidden=false;toastTimer=setTimeout(()=>el.hidden=true,3400)}
function dirty(){return JSON.stringify(state)!==JSON.stringify(saved)}
function markDirty(){q('[data-save-state]').textContent=dirty()?'Unsaved':'Saved';q('[data-save-state]').classList.toggle('is-dirty',dirty());updatePreview()}
function updatePreview(){const frame=q('[data-preview]');try{frame.contentWindow?.postMessage({type:'matlock-broadcast-control-preview',config:state},location.origin)}catch{}}
function scalePreview(){const shell=q('.bc-preview-frame'),frame=q('[data-preview]');if(!shell||!frame)return;const s=shell.clientWidth/1920;shell.style.setProperty('--preview-scale',String(s));}
function normalize(v){return String(v??'').trim()}
function itemId(type,item){if(type==='news')return item.id||item.url;if(type==='video')return item.videoId;if(type==='event')return item.id||[item.promotion,item.title,item.date].join('|');return''}

async function fetchJson(url){const u=new URL(url,location.href);u.searchParams.set('_',Date.now());const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error(r.status);return r.json()}
async function loadAll(){
  q('[data-live-status]').textContent='Loading control…';
  try{
    const [cfg,news,videos,events]=await Promise.all([
      fetchJson(RAW_CONFIG).catch(()=>fetchJson(FALLBACK_CONFIG)),
      fetchJson(NEWS),fetchJson(VIDEOS),fetchJson(EVENTS)
    ]);
    state=deepMerge(DEFAULT,cfg);saved=clone(state);feeds={news,videos,events};renderAll();q('[data-live-status]').textContent='Control online';q('[data-live-status]').dataset.state='live';q('[data-live-config-label]').textContent='Revision '+(state.revision||'—');
  }catch(e){q('[data-live-status]').textContent='Control load failed';q('[data-live-status]').dataset.state='error';toast('Could not load live control data.')}
}
function renderAll(){renderInputs();renderRundown();renderSources();renderMetrics();renderLiveList();q('[data-revision]').textContent=state.revision||'—';markDirty()}
function renderInputs(){
  qa('[data-path]').forEach(el=>{const v=getPath(state,el.dataset.path);if(el.type==='checkbox')el.checked=Boolean(v);else el.value=v??''});
  qa('[data-value-for]').forEach(el=>{const v=getPath(state,el.dataset.valueFor);el.textContent=v+'%'});
}
function renderMetrics(){
  const stories=[feeds.news?.topStory,...(feeds.news?.stories||[])].filter(Boolean);
  const news=stories.filter(x=>Date.now()-Date.parse(x.publishedAt)<=Number(state.news.maxAgeHours||48)*3600000);
  const vids=(feeds.videos?.videos||[]).filter(v=>{const d=Number(v.durationSeconds||0);return Date.now()-Date.parse(v.publishedAt)<=Number(state.video.maxAgeHours||48)*3600000&&d>=state.video.minSeconds&&d<=state.video.maxSeconds});
  const events=(feeds.events?.events||[]).filter(e=>normalize(e.date)>=(new Date().toISOString().slice(0,10)));
  q('[data-metric-news]').textContent=news.length;q('[data-metric-videos]').textContent=vids.length;q('[data-metric-events]').textContent=events.length;q('[data-metric-rundown]').textContent=state.rundown.length;
}
function renderRundown(){
  const host=q('[data-rundown]');host.innerHTML='';
  state.rundown.forEach((type,i)=>{
    const el=document.createElement('div');el.className='bc-rundown-item';el.draggable=true;el.dataset.type=type;el.dataset.index=i;
    el.innerHTML='<i></i><strong>'+type.toUpperCase()+'</strong><button type="button" aria-label="Remove">×</button>';
    el.querySelector('button').onclick=()=>{state.rundown.splice(i,1);renderRundown();renderMetrics();markDirty()};
    el.addEventListener('dragstart',()=>{dragIndex=i;el.classList.add('is-dragging')});
    el.addEventListener('dragend',()=>{dragIndex=-1;el.classList.remove('is-dragging')});
    el.addEventListener('dragover',e=>e.preventDefault());
    el.addEventListener('drop',e=>{e.preventDefault();const to=Number(el.dataset.index);if(dragIndex<0||to===dragIndex)return;const[item]=state.rundown.splice(dragIndex,1);state.rundown.splice(to,0,item);renderRundown();markDirty()});
    host.append(el);
  });
}
function selectedSet(path,allNames){const arr=getPath(state,path)||[];return arr.length?new Set(arr):new Set(allNames)}
function renderSources(){
  const customNews=state.sources?.customNewsFeeds||[];
  const newsNames=[...new Set([...(feeds.news?.sources||[]).map(x=>x.name).filter(Boolean),...customNews.map(x=>x.name).filter(Boolean)])];
  const newsSet=selectedSet('news.sources',newsNames),nh=q('[data-news-sources]');nh.innerHTML='';
  newsNames.forEach(name=>{
    const customIndex=customNews.findIndex(x=>x.name===name);
    const row=document.createElement('div');row.className='bc-source-row';
    row.innerHTML='<label><input type="checkbox"><span>'+escapeHtml(name)+'</span></label><div><small>'+((feeds.news?.sources||[]).find(x=>x.name===name)?.storyCount||0)+' stories</small>'+(customIndex>=0?'<button class="bc-source-delete" type="button" title="Remove custom feed">×</button>':'')+'</div>';
    const input=row.querySelector('input');input.checked=newsSet.has(name);input.onchange=()=>{const now=selectedSet('news.sources',newsNames);input.checked?now.add(name):now.delete(name);state.news.sources=now.size===newsNames.length?[]:[...now];renderSources();markDirty()};
    row.querySelector('.bc-source-delete')?.addEventListener('click',()=>{state.sources.customNewsFeeds.splice(customIndex,1);state.news.sources=(state.news.sources||[]).filter(x=>x!==name);renderSources();markDirty()});
    nh.append(row);
  });
  q('[data-news-source-summary]').textContent=(state.news.sources.length?state.news.sources.length:newsNames.length)+' of '+newsNames.length+' enabled';

  const customVideo=state.sources?.customVideoChannels||[];
  const videoNames=[...new Set([...(feeds.videos?.videos||[]).map(x=>x.channel).filter(Boolean),...customVideo.map(x=>x.name).filter(Boolean)])];
  const videoSet=selectedSet('video.channels',videoNames),vh=q('[data-video-sources]');vh.innerHTML='';
  videoNames.forEach(name=>{
    const count=(feeds.videos?.videos||[]).filter(x=>x.channel===name).length,customIndex=customVideo.findIndex(x=>x.name===name);
    const row=document.createElement('div');row.className='bc-source-row';
    row.innerHTML='<label><input type="checkbox"><span>'+escapeHtml(name)+'</span></label><div><small>'+count+' uploads</small>'+(customIndex>=0?'<button class="bc-source-delete" type="button" title="Remove custom channel">×</button>':'')+'</div>';
    const input=row.querySelector('input');input.checked=videoSet.has(name);input.onchange=()=>{const now=selectedSet('video.channels',videoNames);input.checked?now.add(name):now.delete(name);state.video.channels=now.size===videoNames.length?[]:[...now];renderSources();markDirty()};
    row.querySelector('.bc-source-delete')?.addEventListener('click',()=>{state.sources.customVideoChannels.splice(customIndex,1);state.video.channels=(state.video.channels||[]).filter(x=>x!==name);renderSources();markDirty()});
    vh.append(row);
  });
  q('[data-video-source-summary]').textContent=(state.video.channels.length?state.video.channels.length:videoNames.length)+' of '+videoNames.length+' enabled';
}
function escapeHtml(v){const d=document.createElement('div');d.textContent=v||'';return d.innerHTML}
function liveItems(){
  if(contentTab==='news')return [feeds.news?.topStory,...(feeds.news?.stories||[])].filter(Boolean).slice(0,30).map(x=>({type:'news',item:x,title:x.title,meta:x.source,image:x.image}));
  if(contentTab==='video')return (feeds.videos?.videos||[]).slice(0,30).map(x=>({type:'video',item:x,title:x.title,meta:x.channel,image:x.thumbnail}));
  return (feeds.events?.events||[]).filter(x=>normalize(x.date)>=(new Date().toISOString().slice(0,10))).slice(0,30).map(x=>({type:'event',item:x,title:x.title||x.promotion,meta:[x.promotion,x.date].filter(Boolean).join(' · '),image:x.poster_url}));
}
function renderLiveList(){
  const host=q('[data-live-list]');host.innerHTML='';
  liveItems().forEach(entry=>{
    const id=itemId(entry.type,entry.item),hidden=(state.hidden[entry.type==='video'?'videos':entry.type==='event'?'events':'news']||[]).includes(id);
    const row=document.createElement('article');row.className='bc-live-item';
    row.innerHTML=(entry.image?'<img class="bc-live-thumb" src="'+escapeHtml(entry.image)+'" alt="">':'<div class="bc-live-thumb"></div>')+
      '<div class="bc-live-info"><strong>'+escapeHtml(entry.title)+'</strong><span>'+escapeHtml(entry.meta||'')+'</span></div>'+
      '<div class="bc-live-actions"><button type="button" class="next">Air next</button><button type="button" class="take">Take over</button><button type="button" class="hide '+(hidden?'is-hidden':'')+'">'+(hidden?'Restore':'Hide')+'</button></div>';
    row.querySelector('.next').onclick=()=>force(entry.type,entry.item,'next');
    row.querySelector('.take').onclick=()=>force(entry.type,entry.item,'now');
    row.querySelector('.hide').onclick=()=>toggleHidden(entry.type,id);
    host.append(row);
  });
}
function toggleHidden(type,id){const key=type==='video'?'videos':type==='event'?'events':'news',arr=state.hidden[key]||[],i=arr.indexOf(id);i>=0?arr.splice(i,1):arr.push(id);state.hidden[key]=arr;renderLiveList();markDirty()}
function force(type,item,mode){
  state.forceNext={requestId:String(Date.now()),mode,ref:{type,id:itemId(type,item)}};
  markDirty();saveLive(mode==='now'?'Takeover sent':'Queued for next').catch(()=>{});
}
function customForce(mode){
  const title=q('[data-custom-title]').value.trim();if(!title){toast('Add a headline first.');return}
  const item={type:'custom',title,context:q('[data-custom-context]').value.trim(),image:q('[data-custom-image]').value.trim(),source:q('[data-custom-source]').value.trim()||'MMA MATLOCK',durationSeconds:Number(q('[data-custom-duration]').value||45)};
  state.forceNext={requestId:String(Date.now()),mode,ref:{type:'custom',item}};markDirty();saveLive(mode==='now'?'Custom takeover sent':'Custom card queued').catch(()=>{});
}

function preset(name){
  const p={
    newsroom:{modules:{news:true,video:true,events:true},rundown:['news','news','video','news','event'],timing:{newsSeconds:45,eventSeconds:35},video:{maxSeconds:600}},
    video:{modules:{news:true,video:true,events:true},rundown:['news','video','news','video','event'],timing:{newsSeconds:40,eventSeconds:30},video:{maxSeconds:900}},
    headlines:{modules:{news:true,video:false,events:false},rundown:['news','news','news'],timing:{newsSeconds:50}},
    event:{modules:{news:true,video:true,events:true},rundown:['news','event','news','video','event'],timing:{newsSeconds:40,eventSeconds:50}}
  }[name];if(!p)return;state=deepMerge(state,p);renderAll();toast('Preset loaded into preview.')}
function encode64(text){const bytes=new TextEncoder().encode(text);let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary)}
async function saveLive(success='Broadcast control updated'){
  const auth=window.MatlockBroadcastAuth;
  if(!auth?.isConnected()){auth?.open();toast('Sign in with GitHub to apply changes.');throw new Error('Not signed in')}
  const apply=q('[data-apply-live]');apply.disabled=true;apply.textContent='Applying…';
  try{
    let remote=null;
    try{remote=await auth.githubFetch(CONFIG_API_PATH+'?ref=main')}catch(error){if(error?.status!==404)throw error}
    const next=clone(state);next.version=1;next.revision=Date.now();next.updatedAt=new Date().toISOString();next.updatedBy=auth.getLogin?.()||'Matlock';
    const body={message:'Update live broadcast control',content:encode64(JSON.stringify(next,null,2)+'\n'),branch:'main'};
    if(remote?.sha)body.sha=remote.sha;
    await auth.githubFetch(CONFIG_API_PATH,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    state=next;saved=clone(next);renderAll();q('[data-live-config-label]').textContent='Revision '+state.revision;toast(success);
  }catch(e){
    toast('Apply failed: '+e.message);
    if(e.status===401)window.dispatchEvent(new CustomEvent('matlock-broadcast:auth-expired'));
    throw e;
  }finally{apply.disabled=false;apply.textContent='Apply live'}
}

qa('[data-nav-target]').forEach(btn=>btn.onclick=()=>{qa('[data-nav-target]').forEach(x=>x.classList.toggle('is-active',x===btn));qa('[data-section]').forEach(s=>s.hidden=s.dataset.section!==btn.dataset.navTarget)});
qa('[data-path]').forEach(el=>{const event=el.type==='range'?'input':'change';el.addEventListener(event,()=>{let v=el.type==='checkbox'?el.checked:el.value;if(el.type==='number'||el.type==='range')v=Number(v);setPath(state,el.dataset.path,v);renderInputs();renderMetrics();markDirty()})});
qa('[data-add-segment]').forEach(b=>b.onclick=()=>{state.rundown.push(b.dataset.addSegment);renderRundown();renderMetrics();markDirty()});
qa('[data-preset]').forEach(b=>b.onclick=()=>preset(b.dataset.preset));
qa('[data-content-tab]').forEach(b=>b.onclick=()=>{contentTab=b.dataset.contentTab;qa('[data-content-tab]').forEach(x=>x.classList.toggle('is-active',x===b));renderLiveList()});
q('[data-all-news]').onclick=()=>{state.news.sources=[];renderSources();markDirty()};
q('[data-all-video]').onclick=()=>{state.video.channels=[];renderSources();markDirty()};
q('[data-add-news-source]').onclick=()=>{
  const name=q('[data-custom-news-name]').value.trim(),url=q('[data-custom-news-url]').value.trim();
  let parsed=null;try{parsed=new URL(url)}catch{}
  if(!name||!parsed||parsed.protocol!=='https:'){toast('Add a source name and a valid https RSS/Atom URL.');return}
  state.sources=state.sources||{customNewsFeeds:[],customVideoChannels:[]};
  if(state.sources.customNewsFeeds.some(x=>x.name.toLowerCase()===name.toLowerCase())){toast('That source name already exists.');return}
  state.sources.customNewsFeeds.push({name,feedUrl:parsed.href,siteUrl:parsed.origin+'/',priority:8});
  q('[data-custom-news-name]').value='';q('[data-custom-news-url]').value='';renderSources();markDirty();toast('Custom news feed added. It will populate on the next feed refresh.');
};
q('[data-add-video-source]').onclick=()=>{
  const name=q('[data-custom-video-name]').value.trim(),handle=q('[data-custom-video-handle]').value.trim();
  if(!name||!/^@[A-Za-z0-9._-]+$/.test(handle)){toast('Add a channel name and a YouTube handle beginning with @.');return}
  state.sources=state.sources||{customNewsFeeds:[],customVideoChannels:[]};
  if(state.sources.customVideoChannels.some(x=>x.name.toLowerCase()===name.toLowerCase())){toast('That channel name already exists.');return}
  state.sources.customVideoChannels.push({name,handle});
  q('[data-custom-video-name]').value='';q('[data-custom-video-handle]').value='';renderSources();markDirty();toast('Custom YouTube channel added. It will populate on the next feed refresh.');
};
q('[data-apply-live]').onclick=()=>saveLive().catch(()=>{});
q('[data-reset-draft]').onclick=()=>{state=clone(saved);renderAll();toast('Unsaved changes discarded.')};
q('[data-custom-next]').onclick=()=>customForce('next');q('[data-custom-now]').onclick=()=>customForce('now');
q('[data-preview-reload]').onclick=()=>{const f=q('[data-preview]');f.src='/broadcast/?controlPreview=1&v='+Date.now()};
q('[data-preview]').addEventListener('load',()=>setTimeout(updatePreview,350));
window.addEventListener('resize',scalePreview);new ResizeObserver(scalePreview).observe(q('.bc-preview-frame'));
window.addEventListener('matlock-broadcast:auth',()=>toast('GitHub connected. You can apply changes live.'));
window.addEventListener('beforeunload',e=>{if(!dirty())return;e.preventDefault();e.returnValue=''});
loadAll();scalePreview();
})();