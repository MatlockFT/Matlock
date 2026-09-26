(() => {
const app=document.querySelector('[data-broadcast-control-app]');if(!app)return;
const RAW_CONFIG='https://raw.githubusercontent.com/MatlockFT/Matlock/main/assets/uploads/system/broadcast-control.json';
const FALLBACK_CONFIG='/assets/data/broadcast-control.json';
const CONFIG_API_PATH='/contents/assets/uploads/system/broadcast-control.json';
const NEWS='https://raw.githubusercontent.com/MatlockFT/Matlock/live-news-data/mma-news.json';
const NEWS_FALLBACK='/assets/data/mma-news.json';
const VIDEOS='https://raw.githubusercontent.com/MatlockFT/Matlock/live-news-data/mma-videos.json';
const VIDEOS_FALLBACK='/assets/data/mma-videos.json';
const EVENTS='/assets/data/upcoming-events-live.json';
const DEFAULT={"version":1,"revision":1,"updatedAt":null,"modules":{"news":true,"video":true,"events":true,"ticker":true,"comingUp":true,"music":true},"rundown":["news","news","video","news","event"],"timing":{"newsSeconds":45,"eventSeconds":35,"transitionMs":650,"controlPollSeconds":10},"news":{"maxAgeHours":48,"maxItems":16,"sources":[],"requireContext":true,"contextFacts":4},"video":{"maxAgeHours":48,"maxItems":8,"minSeconds":20,"maxSeconds":600,"volume":50,"channels":[],"playFull":true},"events":{"maxItems":3,"usePosters":true},"audio":{"enabled":true,"musicUrl":"https://opengameart.org/sites/default/files/8bit%20Bossa.mp3","musicVolume":14,"duckVolume":3.5},"ticker":{"enabled":true,"speedSeconds":240,"maxItems":14},"visual":{"layout":"splitDesk","videoWidth":64,"articleCardSeconds":9,"articleCharsPerCard":340,"flipNews":false,"showRail":true,"showClock":true,"showBadge":true,"showSource":true},"sources":{"customNewsFeeds":[],"customVideoChannels":[],"removedNewsSources":[],"removedVideoChannels":[]},"programming":{"mode":"auto","manualQueue":[]},"hidden":{"news":[],"videos":[],"events":[]},"forceNext":null};
const q=s=>app.querySelector(s),qa=s=>[...app.querySelectorAll(s)];
let state=structuredClone(DEFAULT),saved=structuredClone(DEFAULT),feeds={news:null,videos:null,events:null},contentTab='news',dragIndex=-1,toastTimer=0,feedWarnings=[],previewReady=false,previewLoadTimer=0,previewSyncTimer=0,previewFrameLoaded=false,feedsReady=false,previewQueue=null,previewMuted=true,programPoolTab='all',programSearch='',programDrag=null,programPlaceholder=null;

function clone(v){return JSON.parse(JSON.stringify(v))}
function deepMerge(base,extra){const out=clone(base);for(const[k,v]of Object.entries(extra||{})){if(v&&typeof v==='object'&&!Array.isArray(v)&&out[k]&&typeof out[k]==='object'&&!Array.isArray(out[k]))out[k]=deepMerge(out[k],v);else out[k]=v}return out}
function getPath(obj,path){return path.split('.').reduce((a,k)=>a?.[k],obj)}
function setPath(obj,path,value){const p=path.split('.');let a=obj;for(let i=0;i<p.length-1;i++)a=a[p[i]]??={};a[p.at(-1)]=value}
function toast(msg){const el=q('[data-toast]');clearTimeout(toastTimer);el.textContent=msg;el.hidden=false;toastTimer=setTimeout(()=>el.hidden=true,3400)}
function dirty(){return JSON.stringify(state)!==JSON.stringify(saved)}
function markDirty({restartPreview=false}={}){
  const pending=dirty(),save=q('[data-save-state]'),apply=q('[data-apply-live]');
  save.textContent=pending?'Pending changes':'Live';
  save.classList.toggle('is-dirty',pending);
  apply.disabled=!pending;
  apply.dataset.pending=String(pending);
  apply.textContent=pending?'Apply changes live':'Live is current';
  qa('[data-save-config]').forEach(button=>{
    button.disabled=!pending;
    button.dataset.pending=String(pending);
    button.textContent=pending?'Save config':'Saved';
  });
  renderDraftState();
  updatePreview(restartPreview);
}
function normalize(v){return String(v??'').trim()}
function itemId(type,item){if(type==='news')return item.id||item.url;if(type==='video')return item.videoId;if(type==='event')return item.id||[item.promotion,item.title,item.date].join('|');return''}

function setPreviewStatus(text,stateName='connecting'){
  const mode=q('[data-preview-mode]'),renderer=q('[data-preview-renderer]'),overlay=q('[data-preview-overlay]'),status=q('[data-preview-status]');
  if(mode)mode.textContent=text;
  if(renderer){
    renderer.textContent=stateName==='ready'?'ONLINE':stateName==='empty'?'EMPTY':stateName==='error'?'ERROR':'CONNECTING';
    renderer.classList.toggle('is-live',stateName==='ready');
    renderer.classList.toggle('is-error',stateName==='error');
  }
  if(status)status.textContent=text;
  if(overlay){
    if(stateName==='error')overlay.hidden=false;
    else if(stateName==='ready'||stateName==='empty'||previewFrameLoaded)overlay.hidden=true;
  }
}
function scaleProgramMonitor(){
  const shell=q('[data-preview-shell]'),frame=q('[data-program-monitor-frame]');if(!shell||!frame)return;
  const scale=Math.min(shell.clientWidth/1920,shell.clientHeight/1080);
  shell.style.setProperty('--preview-scale',String(scale||.2));
}
function previewPayload(restart=false){
  return {
    type:'matlock-broadcast-control-preview',
    config:state,
    feeds:{news:feeds.news||{stories:[]},videos:feeds.videos||{videos:[]},events:feeds.events||{events:[]}},
    restart:Boolean(restart),
    previewMuted:Boolean(previewMuted)
  };
}
function updatePreview(restart=false){
  const frame=q('[data-program-monitor-frame]'),program=q('[data-preview-program]');
  if(program)program.textContent=dirty()?'DRAFT':'LIVE';
  if(!frame?.contentWindow)return false;
  if(!feedsReady){setPreviewStatus('Renderer loaded. Waiting for current feeds…','connecting');return false}
  const payload=previewPayload(restart);
  try{
    const api=frame.contentWindow.MatlockBroadcastPreview;
    if(api&&typeof api.apply==='function'){
      const result=api.apply(payload)||{};
      previewQueue=result.queue||null;renderQueue();renderProgramOutput();renderProgramManualQueue();
      previewReady=true;
      clearInterval(previewSyncTimer);
      if(result.state==='empty')setPreviewStatus('Renderer online, but this draft has no eligible content.','empty');
      else setPreviewStatus('Renderer online · '+Number(result.slideCount||0)+' programmed items','ready');
      return true;
    }
  }catch(error){}
  try{
    frame.contentWindow.postMessage(payload,location.origin);
    if(!previewReady)setPreviewStatus('Renderer loaded. Syncing current draft…','connecting');
    return false;
  }catch(error){
    setPreviewStatus('Program monitor could not receive the draft: '+error.message,'error');
    return false;
  }
}
function startPreviewSync(){
  clearInterval(previewSyncTimer);
  let attempts=0;
  const sync=()=>{
    if(previewReady||attempts>=30){clearInterval(previewSyncTimer);return}
    attempts++;updatePreview(attempts===1);
  };
  sync();previewSyncTimer=setInterval(sync,500);
}
function restartProgramMonitor(){
  const frame=q('[data-program-monitor-frame]');if(!frame)return;
  previewReady=false;previewFrameLoaded=false;previewQueue=null;renderQueue();
  const overlay=q('[data-preview-overlay]');if(overlay)overlay.hidden=false;
  setPreviewStatus('Restarting the real broadcast renderer…','connecting');
  clearTimeout(previewLoadTimer);clearInterval(previewSyncTimer);
  frame.src='/broadcast/?controlPreview=1&embedded=1&v='+Date.now();
}
async function fetchJson(url){const u=new URL(url,location.href);u.searchParams.set('_',Date.now());const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error(r.status);return r.json()}
async function loadAll(){
  const status=q('[data-live-status]');status.textContent='Loading control…';feedWarnings=[];
  let cfg=clone(DEFAULT);
  try{cfg=await fetchJson(RAW_CONFIG)}catch{try{cfg=await fetchJson(FALLBACK_CONFIG)}catch{feedWarnings.push('control fallback')}}
  const [news,videos,events]=await Promise.all([
    fetchJson(NEWS).catch(()=>fetchJson(NEWS_FALLBACK)).catch(()=>{feedWarnings.push('news');return {sources:[],stories:[]}}),
    fetchJson(VIDEOS).catch(()=>fetchJson(VIDEOS_FALLBACK)).catch(()=>{feedWarnings.push('videos');return {videos:[]}}),
    fetchJson(EVENTS).catch(()=>{feedWarnings.push('events');return {events:[]}})
  ]);
  state=deepMerge(DEFAULT,cfg);saved=clone(state);feeds={news,videos,events};feedsReady=true;renderAll();
  if(feedWarnings.length){status.textContent='Control online · '+feedWarnings.length+' feed issue'+(feedWarnings.length===1?'':'s');status.dataset.state='partial'}
  else{status.textContent='Control online';status.dataset.state='live'}
  q('[data-live-config-label]').textContent='Revision '+(state.revision||'—');
}
function renderAll(){renderInputs();renderRundown();renderSources();renderMetrics();renderLiveList();renderQueue();renderProgramming();renderPresetState();q('[data-revision]').textContent=state.revision||'—';markDirty()}
function renderInputs(){
  qa('[data-path]').forEach(el=>{const v=getPath(state,el.dataset.path);if(el.type==='checkbox')el.checked=Boolean(v);else el.value=v??''});
  qa('[data-value-for]').forEach(el=>{const v=getPath(state,el.dataset.valueFor);el.textContent=v+'%'});
  const split=state.visual?.layout==='splitDesk',width=Math.max(50,Math.min(76,Number(state.visual?.videoWidth||64)));
  const map=q('[data-layout-map-main]');if(map)map.style.gridTemplateColumns=width+'fr '+(100-width)+'fr';
  const note=q('[data-rundown-mode-note]');if(note)note.textContent=split?'Split Desk: video runs continuously in its own lane. News and Event blocks control the right-hand reader rotation.':'Classic layout: News, Video, and Event blocks rotate through the full main stage.';
}
const PRESETS={
  newsroom:{label:'Newsroom',modules:{news:true,video:true,events:true},rundown:['news','news','video','news','event'],timing:{newsSeconds:45,eventSeconds:35},video:{maxSeconds:600}},
  video:{label:'Video heavy',modules:{news:true,video:true,events:true},rundown:['news','video','news','video','event'],timing:{newsSeconds:40,eventSeconds:30},video:{maxSeconds:900}},
  headlines:{label:'Headlines only',modules:{news:true,video:false,events:false},rundown:['news','news','news'],timing:{newsSeconds:50}},
  event:{label:'Event day',modules:{news:true,video:true,events:true},rundown:['news','event','news','video','event'],timing:{newsSeconds:40,eventSeconds:50}}
};
function subsetMatches(target,subset){
  if(Array.isArray(subset))return Array.isArray(target)&&JSON.stringify(target)===JSON.stringify(subset);
  if(subset&&typeof subset==='object')return Object.entries(subset).every(([key,value])=>subsetMatches(target?.[key],value));
  return target===subset;
}
function activePresetName(){
  const hit=Object.entries(PRESETS).find(([,preset])=>{
    const {label,...definition}=preset;
    return subsetMatches(state,definition);
  });
  return hit?.[0]||'custom';
}
function renderPresetState(){
  const active=activePresetName();
  qa('[data-preset]').forEach(btn=>{
    const on=btn.dataset.preset===active;
    btn.classList.toggle('is-active',on);btn.setAttribute('aria-pressed',String(on));
    const em=btn.querySelector('em');if(em)em.textContent=on?(dirty()?'Loaded · pending':'Live preset'):'Load preset';
  });
}
function renderDraftState(){
  const active=activePresetName(),pending=dirty(),preset=PRESETS[active];
  const strip=q('[data-draft-strip]'),title=q('[data-draft-title]'),status=q('[data-draft-status]'),host=q('[data-draft-rundown]');
  if(!strip||!title||!status||!host)return;
  strip.classList.toggle('is-dirty',pending);
  title.textContent=(preset?.label||'Custom program')+(pending?' · DRAFT':' · LIVE');
  status.textContent=pending?'Changes are loaded in the preview. Click Apply changes live to send them to OBS.':'This is the saved program OBS is polling now.';
  const mode=programMode(),count=manualProgramQueue().length;
  host.innerHTML='<span class="bc-draft-segment" data-type="'+mode+'">'+mode.toUpperCase()+'</span>'+(count?'<span class="bc-draft-segment" data-type="manual">'+count+' MANUAL</span>':'');
  renderPresetState();
}
function renderMetrics(){
  const removedNews=new Set(state.sources?.removedNewsSources||[]),removedVideo=new Set(state.sources?.removedVideoChannels||[]);
  const enabledNews=state.news.sources||[],enabledVideo=state.video.channels||[];
  const stories=[feeds.news?.topStory,...(feeds.news?.stories||[])].filter(Boolean);
  const news=stories.filter(x=>Date.now()-Date.parse(x.publishedAt)<=Number(state.news.maxAgeHours||48)*3600000).filter(x=>!removedNews.has(x.source)).filter(x=>!enabledNews.length||enabledNews.includes(x.source));
  const vids=(feeds.videos?.videos||[]).filter(v=>{const d=Number(v.durationSeconds||0);return Date.now()-Date.parse(v.publishedAt)<=Number(state.video.maxAgeHours||48)*3600000&&d>=state.video.minSeconds&&d<=state.video.maxSeconds}).filter(v=>!removedVideo.has(v.channel)).filter(v=>!enabledVideo.length||enabledVideo.includes(v.channel));
  const events=(feeds.events?.events||[]).filter(e=>normalize(e.date)>=(new Date().toISOString().slice(0,10)));
  q('[data-metric-news]').textContent=news.length;q('[data-metric-videos]').textContent=vids.length;q('[data-metric-events]').textContent=events.length;q('[data-metric-rundown]').textContent=manualProgramQueue().length;
}
function renderRundown(){
  const host=q('[data-rundown]');host.innerHTML='';
  state.rundown.forEach((type,i)=>{
    const el=document.createElement('div');el.className='bc-rundown-item';el.draggable=true;el.dataset.type=type;el.dataset.index=i;
    el.innerHTML='<i></i><strong>'+type.toUpperCase()+'</strong><button type="button" aria-label="Remove">×</button>';
    el.querySelector('button').onclick=()=>{state.rundown.splice(i,1);renderRundown();renderMetrics();markDirty({restartPreview:true})};
    el.addEventListener('dragstart',()=>{dragIndex=i;el.classList.add('is-dragging')});
    el.addEventListener('dragend',()=>{dragIndex=-1;el.classList.remove('is-dragging')});
    el.addEventListener('dragover',e=>e.preventDefault());
    el.addEventListener('drop',e=>{e.preventDefault();const to=Number(el.dataset.index);if(dragIndex<0||to===dragIndex)return;const[item]=state.rundown.splice(dragIndex,1);state.rundown.splice(to,0,item);renderRundown();markDirty()});
    host.append(el);
  });
}
function selectedSet(path,allNames){const arr=getPath(state,path)||[];return arr.length?new Set(arr):new Set(allNames)}
function removeSource(kind,name){
  state.sources=state.sources||{};
  const removedKey=kind==='news'?'removedNewsSources':'removedVideoChannels';
  const selectionKey=kind==='news'?'news.sources':'video.channels';
  const removed=new Set(state.sources[removedKey]||[]);removed.add(name);state.sources[removedKey]=[...removed];
  setPath(state,selectionKey,(getPath(state,selectionKey)||[]).filter(x=>x!==name));
  renderSources();renderMetrics();markDirty({restartPreview:true});
}
function restoreSource(kind,name){
  const removedKey=kind==='news'?'removedNewsSources':'removedVideoChannels';
  state.sources[removedKey]=(state.sources?.[removedKey]||[]).filter(x=>x!==name);
  renderSources();renderMetrics();markDirty({restartPreview:true});
}
function removedSourceBlock(kind,names){
  if(!names.length)return'';
  return '<div class="bc-source-removed"><span>Removed</span><div class="bc-source-restore-list">'+names.map(name=>'<button type="button" data-restore-source="'+kind+'" data-source-name="'+encodeURIComponent(name)+'">Restore '+escapeHtml(name)+'</button>').join('')+'</div></div>';
}
function renderSources(){
  state.sources=state.sources||{customNewsFeeds:[],customVideoChannels:[],removedNewsSources:[],removedVideoChannels:[]};
  state.sources.removedNewsSources=state.sources.removedNewsSources||[];
  state.sources.removedVideoChannels=state.sources.removedVideoChannels||[];

  const customNews=state.sources.customNewsFeeds||[];
  const allNewsNames=[...new Set([...(feeds.news?.sources||[]).map(x=>x.name).filter(Boolean),...customNews.map(x=>x.name).filter(Boolean)])];
  const removedNews=[...new Set(state.sources.removedNewsSources)].filter(name=>allNewsNames.includes(name));
  const newsNames=allNewsNames.filter(name=>!removedNews.includes(name));
  const newsSet=selectedSet('news.sources',newsNames),nh=q('[data-news-sources]');nh.innerHTML='';
  newsNames.forEach(name=>{
    const row=document.createElement('div');row.className='bc-source-row';
    row.innerHTML='<label><input type="checkbox"><span>'+escapeHtml(name)+'</span></label><div><small>'+((feeds.news?.sources||[]).find(x=>x.name===name)?.storyCount||0)+' stories</small><button class="bc-source-remove" type="button">Remove</button></div>';
    const input=row.querySelector('input');input.checked=newsSet.has(name);input.onchange=()=>{const now=selectedSet('news.sources',newsNames);input.checked?now.add(name):now.delete(name);state.news.sources=now.size===newsNames.length?[]:[...now];renderSources();markDirty({restartPreview:true})};
    row.querySelector('.bc-source-remove').onclick=()=>removeSource('news',name);
    nh.append(row);
  });
  nh.insertAdjacentHTML('beforeend',removedSourceBlock('news',removedNews));
  nh.querySelectorAll('[data-restore-source="news"]').forEach(btn=>btn.onclick=()=>restoreSource('news',decodeURIComponent(btn.dataset.sourceName)));
  q('[data-news-source-summary]').textContent=newsNames.length+' active'+(removedNews.length?' · '+removedNews.length+' removed':'');

  const customVideo=state.sources.customVideoChannels||[];
  const allVideoNames=[...new Set([...(feeds.videos?.channels||[]),...(feeds.videos?.videos||[]).map(x=>x.channel).filter(Boolean),...customVideo.map(x=>x.name).filter(Boolean)])];
  const removedVideo=[...new Set(state.sources.removedVideoChannels)].filter(name=>allVideoNames.includes(name));
  const videoNames=allVideoNames.filter(name=>!removedVideo.includes(name));
  const videoSet=selectedSet('video.channels',videoNames),vh=q('[data-video-sources]');vh.innerHTML='';
  videoNames.forEach(name=>{
    const count=(feeds.videos?.videos||[]).filter(x=>x.channel===name).length;
    const row=document.createElement('div');row.className='bc-source-row';
    row.innerHTML='<label><input type="checkbox"><span>'+escapeHtml(name)+'</span></label><div><small>'+count+' uploads</small><button class="bc-source-remove" type="button">Remove</button></div>';
    const input=row.querySelector('input');input.checked=videoSet.has(name);input.onchange=()=>{const now=selectedSet('video.channels',videoNames);input.checked?now.add(name):now.delete(name);state.video.channels=now.size===videoNames.length?[]:[...now];renderSources();markDirty({restartPreview:true})};
    row.querySelector('.bc-source-remove').onclick=()=>removeSource('video',name);
    vh.append(row);
  });
  vh.insertAdjacentHTML('beforeend',removedSourceBlock('video',removedVideo));
  vh.querySelectorAll('[data-restore-source="video"]').forEach(btn=>btn.onclick=()=>restoreSource('video',decodeURIComponent(btn.dataset.sourceName)));
  q('[data-video-source-summary]').textContent=videoNames.length+' active'+(removedVideo.length?' · '+removedVideo.length+' removed':'');
}

function programMode(){const mode=state.programming?.mode;return ['auto','hybrid','manual'].includes(mode)?mode:'auto'}
function manualProgramQueue(){
  state.programming=state.programming||{mode:'auto',manualQueue:[]};
  state.programming.manualQueue=Array.isArray(state.programming.manualQueue)?state.programming.manualQueue:[];
  return state.programming.manualQueue;
}
function programKey(type,item){return type+'|'+itemId(type,item)}
function programUrl(type,item){
  if(type==='video'&&item?.videoId)return 'https://www.youtube.com/watch?v='+encodeURIComponent(item.videoId);
  return item?.url||item?.siteUrl||'';
}
function compactProgramItem(type,item){
  if(type==='news')return{
    id:item.id||item.url||'',title:item.title||'',source:item.source||'Combat Sports',url:item.url||'',publishedAt:item.publishedAt||'',
    image:item.image||item.imageUrl||item.thumbnail||item.ogImage||'',context:item.context||item.excerpt||item.summary||item.description||'',
    contextBlocks:Array.isArray(item.contextBlocks)?item.contextBlocks:[],excerpt:item.excerpt||'',relatedSources:Array.isArray(item.relatedSources)?item.relatedSources:[]
  };
  if(type==='video')return{
    videoId:item.videoId||'',title:item.title||'',channel:item.channel||item.source||'YouTube',publishedAt:item.publishedAt||'',
    thumbnail:item.thumbnail||item.image||'',durationSeconds:Number(item.durationSeconds||0),embeddable:item.embeddable!==false,liveBroadcastContent:item.liveBroadcastContent||''
  };
  if(type==='event')return clone(item);
  return clone(item);
}
function snapshotProgramEntry(type,item){
  return {type,id:itemId(type,item),item:compactProgramItem(type,item)};
}
function poolEntries(){
  const seen=new Set(),out=[];
  const push=(type,item)=>{
    if(!item)return;
    const id=itemId(type,item);if(!id)return;
    const key=type+'|'+id;if(seen.has(key))return;seen.add(key);
    const title=type==='event'?(item.title||item.promotion||'Upcoming event'):(item.title||'Untitled');
    const source=type==='video'?(item.channel||'YouTube'):type==='event'?(item.promotion||'MMA'):(item.source||'Combat Sports');
    out.push({type,item,title,source,url:programUrl(type,item),publishedAt:item.publishedAt||item.date||'',durationSeconds:Number(item.durationSeconds||0)});
  };
  [feeds.news?.topStory,...(feeds.news?.stories||[])].filter(Boolean).forEach(x=>push('news',x));
  (feeds.videos?.videos||[]).forEach(x=>push('video',x));
  (feeds.events?.events||[]).filter(x=>normalize(x.date)>=(new Date().toISOString().slice(0,10))).forEach(x=>push('event',x));
  return out;
}
function programQueuedCount(type,item){
  const key=programKey(type,item);
  return manualProgramQueue().filter(entry=>(entry.type+'|'+entry.id)===key).length;
}
function programAge(value){
  const t=Date.parse(value);if(!Number.isFinite(t))return'';
  const sec=Math.max(0,Math.round((Date.now()-t)/1000));
  if(sec<60)return sec+'s';if(sec<3600)return Math.floor(sec/60)+'m';if(sec<86400)return Math.floor(sec/3600)+'h';return Math.floor(sec/86400)+'d';
}
function programDuration(seconds){
  const total=Math.max(0,Math.round(Number(seconds)||0));if(!total)return'';
  const m=Math.floor(total/60),s=String(total%60).padStart(2,'0');return m+':'+s;
}
function programEntryMarkup(entry,{queueIndex=null}={}){
  const type=entry.type,item=entry.item||entry,raw=item||{},title=type==='event'?(raw.title||raw.promotion||'Upcoming event'):(raw.title||'Untitled');
  const thumb=raw.thumbnail||raw.image||raw.imageUrl||raw.ogImage||raw.poster_url||'';
  const source=type==='video'?(raw.channel||raw.source||'YouTube'):type==='event'?(raw.promotion||raw.source||'MMA'):(raw.source||'Combat Sports');
  const url=programUrl(type,raw),meta=[];
  meta.push('<span class="bc-program-type">'+escapeHtml(type)+'</span>');
  if(source)meta.push(url?'<a href="'+escapeHtml(url)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(source)+' ↗</a>':'<span>'+escapeHtml(source)+'</span>');
  const age=programAge(raw.publishedAt||raw.date);if(age)meta.push('<span>'+escapeHtml(age)+'</span>');
  const duration=programDuration(raw.durationSeconds);if(duration)meta.push('<span>'+escapeHtml(duration)+'</span>');
  if(queueIndex===null){
    const count=programQueuedCount(type,raw);if(count)meta.push('<span class="bc-program-queued">IN QUEUE ×'+count+'</span>');
  }else{
    const count=manualProgramQueue().filter(x=>x.type===entry.type&&x.id===entry.id).length;if(count>1)meta.push('<span class="bc-program-queued">REUSED ×'+count+'</span>');
  }
  const titleHtml=url?'<a class="bc-program-title" href="'+escapeHtml(url)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(title)+'</a>':'<span class="bc-program-title">'+escapeHtml(title)+'</span>';
  const action=queueIndex===null?'<button type="button" data-program-add>Add</button>':'<button type="button" class="remove" data-program-remove>Remove</button>';
  const thumbHtml=queueIndex===null?'<div class="bc-program-thumb'+(thumb?'':' is-empty')+'">'+(thumb?'<img src="'+escapeHtml(thumb)+'" alt="" loading="lazy">':'<span>'+escapeHtml(type.toUpperCase())+'</span>')+'</div>':'';
  return thumbHtml+'<div class="bc-program-grip" aria-hidden="true">⠿</div><div class="bc-program-main">'+titleHtml+'<div class="bc-program-meta">'+meta.join('')+'</div></div><div class="bc-program-item-actions">'+action+'</div>';
}
function currentOutputGroups(){
  if(!previewQueue)return[];
  if(previewQueue.mode==='splitDesk')return[
    {label:'ARTICLE / EVENT LANE',items:previewQueue.article||[]},
    {label:'VIDEO LANE',items:previewQueue.video||[]}
  ];
  return[{label:'PROGRAM ORDER',items:previewQueue.program||[]}];
}
function renderProgramOutput(){
  const host=q('[data-program-output]');if(!host)return;
  const mode=programMode(),groups=currentOutputGroups();
  q('[data-program-output-note]').textContent=mode==='manual'?'Renderer output from your manual queue.':mode==='hybrid'?'Your priorities plus current Auto fill.':'Auto-selected items currently eligible to air.';
  if(!previewQueue){host.innerHTML='<div class="bc-program-empty">Waiting for the renderer queue…</div>';return}
  host.innerHTML=groups.map(group=>{
    const rows=(group.items||[]).slice(0,40).map((item,i)=>queueRow(item,i)).join('');
    return '<div class="bc-program-output-group"><span>'+escapeHtml(group.label)+'</span>'+(rows||'<div class="bc-program-empty">No eligible items in this lane.</div>')+'</div>';
  }).join('');
}
function renderProgramPool(){
  const host=q('[data-program-pool]');if(!host)return;
  const search=programSearch.toLowerCase(),manual=manualProgramQueue();
  let items=poolEntries();
  if(programPoolTab!=='all')items=items.filter(x=>x.type===programPoolTab);
  if(search)items=items.filter(x=>(x.title+' '+x.source).toLowerCase().includes(search));
  items=items.slice(0,120);
  q('[data-program-pool-count]').textContent=items.length;
  qa('[data-program-pool-tab]').forEach(btn=>btn.classList.toggle('is-active',btn.dataset.programPoolTab===programPoolTab));
  if(!items.length){host.innerHTML='<div class="bc-program-empty">No pool items match this view.</div>';return}
  host.innerHTML='';
  items.forEach(entry=>{
    const row=document.createElement('article');row.className='bc-program-item bc-program-pool-item';row.draggable=true;row.dataset.programPoolKey=programKey(entry.type,entry.item);
    row.innerHTML=programEntryMarkup(entry);
    row.querySelector('[data-program-add]').onclick=()=>addProgramEntry(entry.type,entry.item);
    row.addEventListener('dragstart',event=>{
      programDrag={kind:'pool',entry:snapshotProgramEntry(entry.type,entry.item)};
      row.classList.add('is-dragging');event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData('text/plain',entry.title);
    });
    row.addEventListener('dragend',()=>{row.classList.remove('is-dragging');cleanupProgramDrag()});
    host.append(row);
  });
}
function ensureProgramPlaceholder(){
  if(programPlaceholder)return programPlaceholder;
  programPlaceholder=document.createElement('div');programPlaceholder.className='bc-program-drop-slot';return programPlaceholder;
}
function cleanupProgramDrag(){
  q('[data-program-manual-queue]')?.classList.remove('is-drop-active');
  programPlaceholder?.remove();programDrag=null;
}
function queueDropIndex(host,event){
  const rows=[...host.querySelectorAll('.bc-program-item')].filter(row=>row!==event.target.closest('.is-dragging'));
  const y=event.clientY;
  for(let i=0;i<rows.length;i++){const rect=rows[i].getBoundingClientRect();if(y<rect.top+rect.height/2)return i}
  return rows.length;
}
function positionProgramPlaceholder(host,index){
  const slot=ensureProgramPlaceholder(),rows=[...host.querySelectorAll('.bc-program-item')];
  const ref=rows[index]||null;host.insertBefore(slot,ref);
}
function addProgramEntry(type,item,index=manualProgramQueue().length){
  const queue=manualProgramQueue(),entry=snapshotProgramEntry(type,item);
  index=Math.max(0,Math.min(queue.length,index));queue.splice(index,0,entry);
  if(programMode()==='auto')state.programming.mode='hybrid';
  renderProgramming();markDirty({restartPreview:true});toast(programMode()==='manual'?'Added to manual loop.':'Added as a manual priority.');
}
function removeProgramEntry(index){
  manualProgramQueue().splice(index,1);renderProgramming();markDirty({restartPreview:true});
}
function moveProgramEntry(from,to){
  const queue=manualProgramQueue();if(from<0||from>=queue.length)return;
  const [entry]=queue.splice(from,1);if(from<to)to--;to=Math.max(0,Math.min(queue.length,to));queue.splice(to,0,entry);
  renderProgramming();markDirty({restartPreview:true});
}
function renderProgramManualQueue(){
  const host=q('[data-program-manual-queue]');if(!host)return;
  const queue=manualProgramQueue(),mode=programMode(),head=q('[data-program-manual-head]');
  head.hidden=false;
  const headLabel=head.querySelector('span'),headNote=head.querySelector('small');
  if(headLabel)headLabel.textContent=mode==='auto'?'SAVED MANUAL QUEUE · INACTIVE':'YOUR PRIORITY QUEUE';
  if(headNote)headNote.textContent=mode==='auto'?'Drop anything here to switch to Hybrid':mode==='manual'?'Drag to set the exact looping order':'Drag to reorder · Auto fills behind';
  host.hidden=false;host.classList.toggle('is-inactive',mode==='auto');
  q('[data-program-clear]').disabled=!queue.length;
  q('[data-program-queue-count]').textContent=mode==='auto'?(previewQueue?(previewQueue.article?.length||0)+(previewQueue.video?.length||0)+(previewQueue.program?.length||0):0):queue.length;
  host.innerHTML='';
  if(!queue.length){host.innerHTML='<div class="bc-program-empty">Drop articles, videos or events here. '+(mode==='auto'?'Your first drop switches the draft to Hybrid.':mode==='manual'?'Nothing will air until you add something.':'Auto will fill the channel until you add priorities.')+'</div>'}
  queue.forEach((entry,index)=>{
    const row=document.createElement('article');row.className='bc-program-item bc-program-queue-item';row.draggable=true;row.dataset.programQueueIndex=String(index);row.innerHTML=programEntryMarkup(entry,{queueIndex:index});
    row.querySelector('[data-program-remove]').onclick=()=>removeProgramEntry(index);
    row.addEventListener('dragstart',event=>{
      programDrag={kind:'queue',index};row.classList.add('is-dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',entry.id||'queue');
    });
    row.addEventListener('dragend',()=>{row.classList.remove('is-dragging');cleanupProgramDrag()});
    host.append(row);
  });
  host.ondragover=event=>{
    if(!programDrag)return;event.preventDefault();host.classList.add('is-drop-active');event.dataTransfer.dropEffect=programDrag.kind==='pool'?'copy':'move';
    positionProgramPlaceholder(host,queueDropIndex(host,event));
  };
  host.ondragleave=event=>{if(!host.contains(event.relatedTarget)){host.classList.remove('is-drop-active');programPlaceholder?.remove()}};
  host.ondrop=event=>{
    if(!programDrag)return;event.preventDefault();
    const slot=programPlaceholder,children=[...host.children],dropIndex=slot?children.indexOf(slot):queue.length,drag=programDrag;
    if(drag.kind==='pool'){const entry=drag.entry;const snapshot=entry.item||{};const type=entry.type;const queueNow=manualProgramQueue();queueNow.splice(Math.max(0,Math.min(queueNow.length,dropIndex)),0,entry);if(programMode()==='auto')state.programming.mode='hybrid';}
    else moveProgramEntry(drag.index,dropIndex);
    cleanupProgramDrag();
    if(drag.kind==='pool'){renderProgramming();markDirty({restartPreview:true});toast('Added to the manual priority queue.')}
  };
}
function renderProgramming(){
  if(!q('[data-program-pool]'))return;
  const mode=programMode(),copy={
    auto:['AUTO','Fresh eligible content programs itself. Dragging something into the queue automatically switches to Hybrid.'],
    hybrid:['HYBRID','Your manual priorities air first; fresh Auto content fills the loop behind them.'],
    manual:['MANUAL','Only your queue is allowed to air. The pool still refreshes, but it cannot change the loop.']
  }[mode];
  q('[data-program-mode-title]').textContent=copy[0];q('[data-program-mode-copy]').textContent=copy[1];
  q('[data-program-queue-help]').textContent=mode==='auto'?'The renderer-generated queue is read-only until you add a manual priority.':mode==='hybrid'?'Drag priorities into any order. Auto content fills behind them.':'This queue loops indefinitely in your order.';
  qa('[data-program-mode]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.programMode===mode)));
  q('[data-program-auto-head]').hidden=false;
  q('[data-program-split-note]').hidden=state.visual?.layout!=='splitDesk';
  renderProgramPool();renderProgramManualQueue();renderProgramOutput();
}
function queueAge(value){
  const t=Date.parse(value);if(!Number.isFinite(t))return'';
  const sec=Math.max(0,Math.round((Date.now()-t)/1000));
  if(sec<60)return sec+'s ago';if(sec<3600)return Math.floor(sec/60)+'m ago';if(sec<86400)return Math.floor(sec/3600)+'h ago';return Math.floor(sec/86400)+'d ago';
}
function queueDuration(seconds){
  const total=Math.max(0,Math.round(Number(seconds)||0));if(!total)return'';
  const m=Math.floor(total/60),s=String(total%60).padStart(2,'0');return m+':'+s;
}
function safeQueueUrl(value){
  try{const url=new URL(String(value||''));return /^https?:$/.test(url.protocol)?url.href:''}catch{return''}
}
function queueHost(value){
  try{return new URL(String(value||'')).hostname.replace(/^www\./,'')}catch{return''}
}
function queueRow(entry,index){
  const meta=[],url=safeQueueUrl(entry?.url),source=escapeHtml(entry?.source||''),host=queueHost(url);
  if(entry?.source){
    meta.push(url?'<a class="bc-queue-source-link" href="'+escapeHtml(url)+'" target="_blank" rel="noopener noreferrer">'+source+' ↗</a>':'<b>'+source+'</b>');
  }
  if(host)meta.push('<span>'+escapeHtml(host)+'</span>');
  if(entry?.type)meta.push('<span class="bc-queue-type">'+escapeHtml(entry.type)+'</span>');
  const age=queueAge(entry?.publishedAt);if(age)meta.push('<span>'+escapeHtml(age)+'</span>');
  const duration=queueDuration(entry?.durationSeconds);if(duration)meta.push('<span>'+escapeHtml(duration)+'</span>');
  if(Number(entry?.repeatCount||0)>1)meta.push('<span class="bc-queue-repeat">REUSED ×'+Number(entry.repeatCount)+'</span>');
  if(url)meta.push('<a class="bc-queue-open" href="'+escapeHtml(url)+'" target="_blank" rel="noopener noreferrer">OPEN SOURCE ↗</a>');
  const title=escapeHtml(entry?.title||'Untitled');
  const titleHtml=url?'<a class="bc-queue-item-title bc-queue-item-title-link" href="'+escapeHtml(url)+'" target="_blank" rel="noopener noreferrer">'+title+'</a>':'<strong class="bc-queue-item-title">'+title+'</strong>';
  return '<article class="bc-queue-item"><div class="bc-queue-item-index">'+String(index+1).padStart(2,'0')+'</div><div class="bc-queue-item-main">'+titleHtml+'<div class="bc-queue-item-meta">'+meta.join('')+'</div></div></article>';
}
function renderQueueList(selector,items){
  const host=q(selector);if(!host)return;
  host.innerHTML=items?.length?items.map(queueRow).join(''):'<div class="bc-queue-empty">Nothing is queued in this lane.</div>';
}
function renderQueueNow(selector,label,item){
  const host=q(selector);if(!host)return;
  if(!item){host.hidden=true;host.innerHTML='';return}
  const url=safeQueueUrl(item.url),title=escapeHtml(item.title||''),source=escapeHtml(item.source||'');
  const body=url?'<a href="'+escapeHtml(url)+'" target="_blank" rel="noopener noreferrer">'+title+'</a>':'<span>'+title+'</span>';
  const sourceHtml=url?'<a class="bc-queue-source-link" href="'+escapeHtml(url)+'" target="_blank" rel="noopener noreferrer">'+source+' ↗</a>':source;
  const reused=Number(item.repeatCount||0)>1?'<span class="bc-queue-repeat">REUSED ×'+Number(item.repeatCount)+'</span>':'';
  host.hidden=false;host.innerHTML='<strong>'+escapeHtml(label)+'</strong>'+body+' · '+sourceHtml+reused;
}
function renderQueue(){
  const stateEl=q('[data-queue-state]'),modeEl=q('[data-queue-mode]');
  if(!stateEl||!modeEl)return;
  const queue=previewQueue;
  if(!queue){
    stateEl.textContent='SYNCING';
    modeEl.textContent='Waiting for the broadcast renderer to return the exact draft queue.';
    ['article','video','ticker','program'].forEach(name=>{const count=q('[data-queue-'+name+'-count]');if(count)count.textContent='0'});
    renderQueueList('[data-queue-article]',[]);renderQueueList('[data-queue-video]',[]);renderQueueList('[data-queue-ticker]',[]);renderQueueList('[data-queue-program]',[]);
    return;
  }
  const split=queue.mode==='splitDesk';
  stateEl.textContent=dirty()?'DRAFT QUEUE':'LIVE-CONFIG QUEUE';
  modeEl.textContent=split?'Split Desk · article and video lanes rotate independently.':'Classic layout · one main program queue.';
  const article=queue.article||[],video=queue.video||[],ticker=queue.ticker||[],program=queue.program||[];
  q('[data-queue-article-count]').textContent=article.length;
  q('[data-queue-video-count]').textContent=video.length;
  q('[data-queue-ticker-count]').textContent=ticker.length;
  q('[data-queue-program-count]').textContent=program.length;
  q('[data-queue-card="article"]').hidden=!split;
  q('[data-queue-card="video"]').hidden=!split;
  q('[data-queue-classic-card]').hidden=split;
  renderQueueNow('[data-queue-article-now]','ON AIR',queue.currentArticle);
  renderQueueNow('[data-queue-video-now]','ON AIR',queue.currentVideo);
  renderQueueNow('[data-queue-program-now]','ON AIR',queue.currentProgram);
  renderQueueList('[data-queue-article]',article);
  renderQueueList('[data-queue-video]',video);
  renderQueueList('[data-queue-ticker]',ticker);
  renderQueueList('[data-queue-program]',program);
}
function installSectionSaveButtons(){
  qa('.bc-section-head').forEach(head=>{
    if(head.querySelector('[data-save-config]'))return;
    const button=document.createElement('button');
    button.type='button';button.className='bc-button bc-section-save';button.dataset.saveConfig='';
    button.textContent='Saved';button.disabled=true;
    button.onclick=()=>saveLive('Broadcast configuration saved').catch(()=>{});
    head.append(button);
  });
}

function escapeHtml(v){const d=document.createElement('div');d.textContent=v||'';return d.innerHTML}
function liveItems(){
  if(contentTab==='news')return [feeds.news?.topStory,...(feeds.news?.stories||[])].filter(Boolean).slice(0,30).map(x=>({type:'news',item:x,title:x.title,meta:x.source,image:x.image}));
  if(contentTab==='video')return (feeds.videos?.videos||[]).slice(0,30).map(x=>({type:'video',item:x,title:x.title,meta:x.channel,image:x.thumbnail}));
  return (feeds.events?.events||[]).filter(x=>normalize(x.date)>=(new Date().toISOString().slice(0,10))).slice(0,30).map(x=>({type:'event',item:x,title:x.title||x.promotion,meta:[x.promotion,x.date].filter(Boolean).join(' · '),image:x.poster_url}));
}
function renderLiveList(){
  const host=q('[data-live-list]');if(!host)return;host.innerHTML='';
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
  const p=PRESETS[name];if(!p)return;
  const {label,...changes}=p;state=deepMerge(state,changes);renderInputs();renderRundown();renderMetrics();renderPresetState();renderLiveList();renderProgramming();markDirty({restartPreview:true});
  toast(dirty()?label+' loaded. Review the preview, then Apply changes live.':label+' is already live.');
}
function encode64(text){const bytes=new TextEncoder().encode(text);let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary)}
async function saveLive(success='Broadcast control updated'){
  const auth=window.MatlockBroadcastAuth;
  if(!auth?.isConnected()){auth?.open();toast('Sign in with GitHub to apply changes.');throw new Error('Not signed in')}
  const apply=q('[data-apply-live]');apply.disabled=true;apply.textContent='Applying…';
  qa('[data-save-config]').forEach(button=>{button.disabled=true;button.textContent='Saving…'});
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
  }finally{markDirty()}
}

qa('[data-nav-target]').forEach(btn=>btn.onclick=()=>{qa('[data-nav-target]').forEach(x=>x.classList.toggle('is-active',x===btn));qa('[data-section]').forEach(s=>s.hidden=s.dataset.section!==btn.dataset.navTarget)});
qa('[data-path]').forEach(el=>{const event=el.type==='range'?'input':'change';el.addEventListener(event,()=>{let v=el.type==='checkbox'?el.checked:el.value;if(el.type==='number'||el.type==='range')v=Number(v);setPath(state,el.dataset.path,v);renderInputs();renderMetrics();markDirty({restartPreview:/^(modules|news\.sources|video\.channels|events\.|visual\.layout)/.test(el.dataset.path)})})});
qa('[data-add-segment]').forEach(b=>b.onclick=()=>{state.rundown.push(b.dataset.addSegment);renderRundown();renderMetrics();markDirty({restartPreview:true})});
qa('[data-preset]').forEach(b=>b.onclick=()=>preset(b.dataset.preset));
qa('[data-content-tab]').forEach(b=>b.onclick=()=>{contentTab=b.dataset.contentTab;qa('[data-content-tab]').forEach(x=>x.classList.toggle('is-active',x===b));renderLiveList()});
q('[data-all-news]').onclick=()=>{state.news.sources=[];renderSources();markDirty({restartPreview:true})};
q('[data-all-video]').onclick=()=>{state.video.channels=[];renderSources();markDirty({restartPreview:true})};
q('[data-add-news-source]').onclick=()=>{
  const name=q('[data-custom-news-name]').value.trim(),url=q('[data-custom-news-url]').value.trim();
  let parsed=null;try{parsed=new URL(url)}catch{}
  if(!name||!parsed||parsed.protocol!=='https:'){toast('Add a source name and a valid https RSS/Atom URL.');return}
  state.sources=state.sources||{customNewsFeeds:[],customVideoChannels:[]};
  const existingNews=state.sources.customNewsFeeds.find(x=>x.name.toLowerCase()===name.toLowerCase());
  if(existingNews){state.sources.removedNewsSources=(state.sources.removedNewsSources||[]).filter(x=>x!==existingNews.name);renderSources();markDirty({restartPreview:true});toast('Source restored.');return}
  state.sources.customNewsFeeds.push({name,feedUrl:parsed.href,siteUrl:parsed.origin+'/',priority:8});
  q('[data-custom-news-name]').value='';q('[data-custom-news-url]').value='';renderSources();markDirty();toast('Custom news feed added. It will populate on the next feed refresh.');
};
q('[data-add-video-source]').onclick=()=>{
  const name=q('[data-custom-video-name]').value.trim(),handle=q('[data-custom-video-handle]').value.trim();
  if(!name||!/^@[A-Za-z0-9._-]+$/.test(handle)){toast('Add a channel name and a YouTube handle beginning with @.');return}
  state.sources=state.sources||{customNewsFeeds:[],customVideoChannels:[]};
  const existingVideo=state.sources.customVideoChannels.find(x=>x.name.toLowerCase()===name.toLowerCase());
  if(existingVideo){state.sources.removedVideoChannels=(state.sources.removedVideoChannels||[]).filter(x=>x!==existingVideo.name);renderSources();markDirty({restartPreview:true});toast('Channel restored.');return}
  state.sources.customVideoChannels.push({name,handle});
  q('[data-custom-video-name]').value='';q('[data-custom-video-handle]').value='';renderSources();markDirty();toast('Custom YouTube channel added. It will populate on the next feed refresh.');
};
qa('[data-program-mode]').forEach(btn=>btn.onclick=()=>{
  state.programming=state.programming||{mode:'auto',manualQueue:[]};state.programming.mode=btn.dataset.programMode;
  renderProgramming();markDirty({restartPreview:true});
});
qa('[data-program-pool-tab]').forEach(btn=>btn.onclick=()=>{programPoolTab=btn.dataset.programPoolTab;renderProgramPool()});
q('[data-program-search]')?.addEventListener('input',event=>{programSearch=event.target.value.trim();renderProgramPool()});
q('[data-program-clear]')?.addEventListener('click',()=>{if(!manualProgramQueue().length)return;state.programming.manualQueue=[];renderProgramming();markDirty({restartPreview:true});toast('Manual queue cleared.')});
q('[data-apply-live]').onclick=()=>saveLive().catch(()=>{});
q('[data-reset-draft]').onclick=()=>{state=clone(saved);renderAll();updatePreview(true);toast('Draft discarded. Preview restored to the live program.')};
q('[data-custom-next]').onclick=()=>customForce('next');q('[data-custom-now]').onclick=()=>customForce('now');
function renderPreviewAudioButton(){
  const button=q('[data-preview-audio]');if(!button)return;
  button.setAttribute('aria-pressed',String(previewMuted));
  button.textContent=previewMuted?'🔇 Preview muted':'🔊 Preview audio';
}
function setPreviewMuted(value){
  previewMuted=Boolean(value);
  try{localStorage.setItem('matlock-broadcast-control:preview-muted',previewMuted?'1':'0')}catch{}
  renderPreviewAudioButton();
  updatePreview(false);
}
try{previewMuted=localStorage.getItem('matlock-broadcast-control:preview-muted')!=='0'}catch{previewMuted=true}
renderPreviewAudioButton();
q('[data-preview-audio]').onclick=()=>setPreviewMuted(!previewMuted);
q('[data-preview-restart]').onclick=restartProgramMonitor;
const monitorFrame=q('[data-program-monitor-frame]');
monitorFrame?.addEventListener('load',()=>{
  previewReady=false;previewFrameLoaded=true;
  const overlay=q('[data-preview-overlay]');if(overlay)overlay.hidden=true;
  setPreviewStatus('Renderer loaded. Syncing current draft…','connecting');scaleProgramMonitor();
  clearTimeout(previewLoadTimer);
  previewLoadTimer=setTimeout(startPreviewSync,50);
});
window.addEventListener('message',event=>{
  if(event.origin!==location.origin)return;
  const message=event.data;if(!message||message.type!=='matlock-broadcast-preview-state')return;
  if(message.queue){previewQueue=message.queue;renderQueue();renderProgramOutput();renderProgramManualQueue()}
  if(message.state==='connected'){
    setPreviewStatus('Renderer connected. Loading program…','connecting');
    updatePreview(true);
  }else if(message.state==='ready'){
    previewReady=true;clearInterval(previewSyncTimer);setPreviewStatus(message.slideCount?('Renderer online · '+message.slideCount+' programmed items'):'Renderer online · no eligible items','ready');
  }else if(message.state==='empty'){
    if(!feedsReady){previewReady=false;setPreviewStatus('Renderer online. Waiting for current feeds…','connecting');startPreviewSync();return}
    previewReady=true;clearInterval(previewSyncTimer);setPreviewStatus('Renderer online, but this draft has no eligible content.','empty');
  }else if(message.state==='error'){
    previewReady=false;setPreviewStatus(message.message||'Broadcast renderer error.','error');
  }
});
window.addEventListener('resize',scaleProgramMonitor);
if(window.ResizeObserver){new ResizeObserver(scaleProgramMonitor).observe(q('[data-preview-shell]'))}
window.addEventListener('matlock-broadcast:auth',()=>toast('GitHub connected. You can apply changes live.'));
window.addEventListener('beforeunload',e=>{if(!dirty())return;e.preventDefault();e.returnValue=''});
installSectionSaveButtons();scaleProgramMonitor();loadAll();
})();