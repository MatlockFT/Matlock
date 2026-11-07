/* Conflict resolution and recovery for the private event workspace.
 * Never combine divergent round scores or recorded exchanges silently.
 */
(() => {
'use strict';
const $=id=>document.getElementById(id);
const clean=v=>String(v==null?'':v).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase().replace(/[‘’]/g,"'");
const eventKey=v=>clean(v).replace(/\s*\(conflict copy\)\s*$/,'');
const fightKey=f=>[clean(f.left),clean(f.right)].sort().join('~');
const deep=v=>JSON.parse(JSON.stringify(v));
const scoreKey=v=>v?JSON.stringify({winner:v.winner,margin:v.margin,deductions:v.deductions}):'';
const resultKey=v=>v?JSON.stringify({type:v.type,winner:v.winner}):'';
const hasCard=c=>Array.isArray(c)&&c.some(v=>v&&Number.isInteger(v.red)&&Number.isInteger(v.blue));
const mergeCards=(a,b)=>{
 if(!Array.isArray(a)&&!Array.isArray(b))return undefined;
 const aa=Array.isArray(a)?a:[null,null,null],bb=Array.isArray(b)?b:[null,null,null],out=[];
 for(let i=0;i<3;i++){
  const x=aa[i]||null,y=bb[i]||null;
  if(x&&y&&(x.red!==y.red||x.blue!==y.blue))return null;
  out.push(x||y);
 }
 return out;
};
function prefix(a,b){
 if(a.length>b.length)return false;
 for(let i=0;i<a.length;i++)
  if(a[i].side!==b[i].side||a[i].time!==b[i].time||(a[i].type||'exchange')!==(b[i].type||'exchange'))return false;
 return true;
}
function mergeFights(one,two){
 if(!one||!two)return null;
 if(['left','right','division','rounds','duration'].some(k=>clean(one[k])!==clean(two[k])))return null;
 if(one.rounds!==two.rounds||one.duration!==two.duration)return null;
 if(one.result&&two.result&&resultKey(one.result)!==resultKey(two.result))return null;
 const judges=mergeCards(one.officialJudges,two.officialJudges);
 if(judges===null&&hasCard(one.officialJudges)&&hasCard(two.officialJudges))return null;
 const out=deep(one);
 const rounds=[],n=Math.max(one.roundData.length,two.roundData.length);
 for(let i=0;i<n;i++){
  const a=one.roundData[i],b=two.roundData[i];
  if(!a||!b){rounds.push(deep(a||b));continue}
  if(a.score&&b.score&&scoreKey(a.score)!==scoreKey(b.score))return null;
  const ao=a.observations||[],bo=b.observations||[];
  if(!prefix(ao,bo)&&!prefix(bo,ao))return null;
  const combined=deep(ao.length>=bo.length?a:b);
  combined.elapsed=Math.max(a.elapsed||0,b.elapsed||0);
  combined.score=deep(a.score||b.score||null);
  rounds.push(combined);
 }
 out.roundData=rounds;
 out.index=Math.max(0,Math.min(n-1,Math.max(one.index,two.index)));
 out.result=deep(one.result||two.result||null);
 if(judges!==undefined)out.officialJudges=judges;
 if(one.legacyId||two.legacyId)out.legacyId=one.legacyId||two.legacyId;
 const scored=rounds.filter(r=>r.score).length;
 out.status=out.result?'complete':scored===out.rounds?'awaiting-result':
  (scored||rounds.some(r=>r.observations.length||r.elapsed))?'in-progress':'ready';
 return out;
}
function mergeEvents(primary,copy,decisions={}){
 if(!primary||!copy||eventKey(primary.name)!==eventKey(copy.name))return {event:null,issues:['different-event']};
 if(primary.date&&copy.date&&primary.date!==copy.date)return {event:null,issues:['different-dates']};
 if(primary.judge&&copy.judge&&primary.judge!==copy.judge)return {event:null,issues:['different-sessions']};
 const out=deep(primary),issues=[];
 const byName=new Map(out.fights.map((f,i)=>[fightKey(f),i]));
 for(const f of copy.fights){
  const pair=fightKey(f),idx=byName.get(pair);
  if(idx===undefined){
   if(out.fights.length>=70)return {event:null,issues:['too-many-fights']};
   out.fights.push(deep(f));byName.set(pair,out.fights.length-1);continue;
  }
  const current=out.fights[idx];
  const compatible=mergeFights(current,f);
  if(compatible){out.fights[idx]=compatible;continue}
  const source=decisions[pair];
  if(source==='original')continue;
  if(source==='copy'){
   const next=deep(f);next.id=current.id;
   out.fights[idx]=next;continue;
  }
  issues.push({key:pair,label:current.left+' vs '+current.right,
   original:details(current),copy:details(f)});
 }
 out.judge=out.judge||copy.judge;
 out.date=out.date||copy.date;
 if(!out.sourceId&&copy.sourceId)out.sourceId=copy.sourceId;
 if(!out.completedAt&&copy.completedAt)out.completedAt=copy.completedAt;
 return {event:out,issues};
}
function details(f){
 const scored=(f.roundData||[]).filter(r=>!!r.score).length;
 const moments=(f.roundData||[]).reduce((n,r)=>n+r.observations.length,0);
 return (f.result?'Finished':'Not finished')+' · '+scored+' scored rounds · '+moments+' exchanges';
}
function groups(){
 const list=[];
 for(const copy of data.events){
  if(!/\(conflict copy\)\s*$/i.test(copy.name))continue;
  const original=data.events.find(e=>e.id!==copy.id&&eventKey(e.name)===eventKey(copy.name)&&(!e.date||!copy.date||e.date===copy.date));
  if(original)list.push({original,copy});
 }
 return list;
}
function backupDatabase(){
 return new Promise((resolve,reject)=>{
  const open=indexedDB.open('copper47-recovery',1);
  open.onupgradeneeded=()=>open.result.createObjectStore('snapshots',{keyPath:'key'});
  open.onerror=()=>reject(open.error||Error('Could not access recovery storage.'));
  open.onsuccess=()=>resolve(open.result);
 });
}
async function saveRecovery(reason){
 const db=await backupDatabase();
 const at=new Date().toISOString(),key='before-conflict-merge-'+at;
 const record={key,createdAt:at,reason,workspace:deep(data)};
 try{
  await new Promise((resolve,reject)=>{
   const tx=db.transaction('snapshots','readwrite');
   tx.objectStore('snapshots').put(record);
   tx.oncomplete=resolve;
   tx.onerror=()=>reject(tx.error||Error('Recovery backup failed.'));
   tx.onabort=()=>reject(tx.error||Error('Recovery backup canceled.'));
  });
 }finally{db.close()}
 return key;
}
async function exportRecovery(){
 try{
  const db=await backupDatabase();
  const all=await new Promise((resolve,reject)=>{
   const tx=db.transaction('snapshots','readonly');
   const req=tx.objectStore('snapshots').getAll();
   req.onsuccess=()=>resolve(req.result||[]);
   req.onerror=()=>reject(req.error||Error('Recovery read failed.'));
  });
  db.close();
  if(!all.length)throw Error('No recovery snapshots available.');
  const latest=all.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
  const blob=new Blob([JSON.stringify(latest.workspace,null,2)],{type:'application/json'});
  const u=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=u;a.download='workspace-recovery-'+latest.createdAt.slice(0,10)+'.json';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);
  toast('Pre-merge workspace backup downloaded.');
 }catch(error){toast('Recovery export failed: '+error.message)}
}
let processing=false,lastMerge=null,decisions={};
function renderPanel(){
 const panel=$('integrityPanel');if(!panel)return;
 const all=groups(),issueHost=$('integrityIssues');
 issueHost.replaceChildren();
 const notice=$('integrityStatus');
 if(lastMerge){
  panel.classList.remove('hidden');
  notice.textContent=lastMerge;
  $('resolveConflicts').classList.add('hidden');
  $('downloadRecovery').classList.remove('hidden');
  return;
 }
 if(!all.length){panel.classList.add('hidden');return}
 panel.classList.remove('hidden');
 const {original,copy}=all[0],result=mergeEvents(original,copy,decisions);
 if(result.issues.some(x=>typeof x==='string')){
  notice.textContent='These events have incompatible names, dates, sessions, or fight limits. Both records are preserved.';
  $('resolveConflicts').classList.add('hidden');return;
 }
 const total=result.issues.length;
 notice.textContent='Two copies of '+original.name+' · Original: '+original.fights.filter(f=>f.result).length+
  '/'+original.fights.length+' finished · Conflict copy: '+copy.fights.filter(f=>f.result).length+
  '/'+copy.fights.length+' finished.'+(total?' Review '+total+' divergent fight(s) below.':' Their data can be merged safely.');
 for(const item of result.issues){
  const wrap=document.createElement('div');wrap.className='integrity-issue';
  const label=document.createElement('strong');label.textContent=item.label;
  const source=document.createElement('p');source.textContent='Original: '+item.original+' | Copy: '+item.copy;
  const select=document.createElement('select');select.setAttribute('aria-label','Which score to preserve for '+item.label);
  for(const [value,text] of [['','Choose which record to keep'],['original','Keep original record'],['copy','Keep conflict copy record']]){
   const op=document.createElement('option');op.value=value;op.textContent=text;select.append(op);
  }
  select.value=decisions[item.key]||'';
  select.onchange=()=>{if(select.value)decisions[item.key]=select.value;else delete decisions[item.key];renderPanel()};
  wrap.append(label,source,select);issueHost.append(wrap);
 }
 $('resolveConflicts').classList.remove('hidden');
 $('resolveConflicts').disabled=processing||result.issues.some(x=>!decisions[x.key]);
 $('resolveConflicts').textContent='Merge records, complete event and remove duplicate';
 $('downloadRecovery').classList.add('hidden');
}
async function resolvePair(original,copy,choices={}){
 if(processing)return;
 const result=mergeEvents(original,copy,choices);
 if(!result.event||result.issues.length)throw Error('Both versions have different fight data. Review each conflict before merging.');
 processing=true;
 try{
  await saveRecovery('Before merging '+original.name+' with '+copy.name);
  const merged=result.event;
  // The event may have been watched on an earlier date and its fights partly scored.
  // An event-level Completed state is separate from per-fight result completeness.
  if(eventKey(original.name).includes('moicano vs. nolan'))merged.completedAt=new Date().toISOString();
  const idx=data.events.findIndex(e=>e.id===original.id);
  if(idx<0||!data.events.some(e=>e.id===copy.id))throw Error('Events changed during reconciliation. Please retry.');
  data.events[idx]=merged;
  data.events=data.events.filter(e=>e.id!==copy.id);
  data.removedEvents=data.removedEvents||{};
  data.removedEvents[copy.id]=new Date().toISOString();
  if(data.selected===copy.id)data.selected=original.id;
  if(!persist())throw Error('Workspace could not save; recovery snapshot was created.');
  lastMerge='Merged '+copy.name+' into '+original.name+'. Removed duplicate locally and marked the original completed. Reconnect Google to synchronize this change.';
  renderDashboard();renderPanel();
  toast('Event merged, completed and preserved in local recovery backup.');
 }finally{processing=false}
}
async function attemptKnownCleanup(){
 if(processing)return;
 const pair=groups().find(({original})=>eventKey(original.name).includes('moicano vs. nolan'));
 if(!pair)return renderPanel();
 // Never discard a different confirmed round or an independent observation history.
 const analysis=mergeEvents(pair.original,pair.copy);
 if(analysis.issues.length)return renderPanel();
 try{await resolvePair(pair.original,pair.copy)}catch(error){toast('Automatic consolidation paused: '+error.message);renderPanel()}
}
$('resolveConflicts').onclick=async()=>{
 const pair=groups()[0];if(!pair)return;
 if(!confirm('Back up both events, merge the chosen records, mark the Moicano event completed and remove the conflict copy?'))return;
 try{await resolvePair(pair.original,pair.copy,decisions)}catch(error){toast('Merge failed: '+error.message)}
};
$('downloadRecovery').onclick=exportRecovery;
window.copperIntegrity={combineCompatible:(a,b)=>{const result=mergeEvents(a,b);return result.issues.length?null:result.event},
 refresh:renderPanel,downloadRecovery:exportRecovery};
renderPanel();
attemptKnownCleanup();
})();