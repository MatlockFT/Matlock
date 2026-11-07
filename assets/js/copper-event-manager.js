/* Private workspace: event completion, published-card lookup and bulk import. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
let catalog=[],selected=null,busy=false,searchText='';
const txt=v=>String(v==null?'':v).trim().replace(/\s+/g,' ');
const norm=v=>txt(v).normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'");
const pair=(a,b)=>[norm(a),norm(b)].sort().join('~');
const cardName=e=>[txt(e.promotion),txt(e.title)].filter(Boolean).join(' — ')||txt(e.name)||'Unnamed event';
const elem=(tag,value,klass)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=value;if(klass)n.className=klass;return n;};
const countDone=e=>e.fights.filter(f=>!!f.result).length;
function readCard(src){
 if(!Array.isArray(src?.sections))return [];
 const out=[],seen=new Set();
 for(const section of src.sections)for(const b of section?.bouts||[]){
  if(!Array.isArray(b.fighters)||b.fighters.length!==2)continue;
  const a=txt(b.fighters[0]?.name),c=txt(b.fighters[1]?.name);
  if(!a||!c||norm(a)===norm(c)||seen.has(pair(a,c)))continue;
  seen.add(pair(a,c));
  const division=(txt(b.weight_class||b.division||'Unspecified division')
   .replace(/\s+Bout$/i,'').replace(/\s+(?:Interim\s+)?Title$/i,'')||'Unspecified division').slice(0,100);
  const isUfc=norm(src.promotion_key)==='ufc'||/^ufc(?:\s|$)/i.test(txt(src.promotion));
  const title=/(?:interim\s+)?title/i.test(txt(b.weight_class));
  const main=/main event/i.test(txt(b.label));
  out.push({left:a,right:c,division,rounds:isUfc&&(main||title)?5:3,duration:300});
 }
 return out.slice(0,70);
}
function addMatches(eventItem,matches){
 const existing=new Set(eventItem.fights.map(f=>pair(f.left,f.right)));
 let added=0;
 for(const b of matches){
  const id=pair(b.left,b.right);
  if(!b.left||!b.right||norm(b.left)===norm(b.right)||existing.has(id)||eventItem.fights.length>=70)continue;
  eventItem.fights.push(newFight(b.left.slice(0,150),b.right.slice(0,150),txt(b.division||'Unspecified division').slice(0,100),b.rounds,b.duration));
  existing.add(id);added++;
 }
 return added;
}
function makeEvent(name,date,sourceId){
 if(data.events.length>=200)throw Error('200-event workspace limit reached. Export your backup first.');
 const e={id:uid(),name:txt(name).slice(0,180),date:date||'',judge:'',fights:[]};
 if(sourceId)e.sourceId=txt(sourceId).slice(0,200);
 data.events.unshift(e);return e;
}
function finishImport(target,matches){
 const count=addMatches(target,matches);
 data.selected=target.id;persist();closeModal();renderDashboard();
 toast(count+' matchups added. Existing fights were preserved; duplicates skipped. Verify corners and round rules.');
}
function importSelected(){
 if(!selected)return toast('Choose an event.');
 const matches=readCard(selected);
 if(!matches.length)return toast('This listing has no usable matchups.');
 const sourceId=txt(selected.id),name=cardName(selected),date=txt(selected.date);
 let target=data.events.find(e=>sourceId&&e.sourceId===sourceId);
 if(!target)target=data.events.find(e=>e.date===date&&norm(e.name)===norm(name));
 if(target?.completedAt)return toast('Reopen the completed event before updating its fight card.');
 if(target&&!confirm('This event already exists. Add only missing matchups and preserve all scores and fight order?'))return;
 try{if(!target)target=makeEvent(name,date,sourceId);else if(sourceId&&!target.sourceId)target.sourceId=sourceId;finishImport(target,matches)}
 catch(error){toast(error.message)}
}
function csvFields(line){
 let result=[],field='',quoted=false;
 for(let i=0;i<line.length;i++){const c=line[i];
  if(c==='"'){if(quoted&&line[i+1]==='"'){field+='"';i++}else quoted=!quoted}
  else if(c===','&&!quoted){result.push(txt(field));field=''}
  else field+=c;
 }
 if(quoted)throw Error('Unclosed quote in CSV row.');
 result.push(txt(field));return result;
}
function parseLines(raw){
 if(raw.length>140000)throw Error('Maximum import text size is 140 KB.');
 const lines=raw.replace(/^\uFEFF/,'').split(/\r?\n/).map(txt).filter(Boolean);
 if(lines.length>150)throw Error('Too many rows (maximum 70 matchups).');
 const out=[];
 for(const line of lines){
  if(/^(?:red|fighter\s*[1a])\s*(?:corner|fighter)?\s*[,|\t]/i.test(line))continue;
  let c;
  if(line.includes('\t'))c=line.split('\t').map(txt);
  else if(line.includes('|')){c=line.split('|').map(txt);const m=c[0].match(/^(.+?)\s+(?:vs?\.?|versus)\s+(.+)$/i);if(m)c=[txt(m[1]),txt(m[2]),...c.slice(1)]}
  else if(line.includes(','))c=csvFields(line);
  else{const m=line.match(/^(.+?)\s+(?:vs?\.?|versus)\s+(.+)$/i);if(!m)throw Error('Use Red vs Blue | Division | 3. Could not read: '+line.slice(0,70));c=[txt(m[1]),txt(m[2])]}
  if(c.length<2||!c[0]||!c[1]||c[0].length>150||c[1].length>150)throw Error('Each row requires two fighter names (150 characters max).');
  const rounds=c[3]||(['3','5'].includes(c[2])?c[2]:'3');
  const division=['3','5'].includes(c[2])?'Unspecified division':(c[2]||'Unspecified division');
  const minutes=Number(c[4]||5);
  if(!['3','5'].includes(String(rounds)))throw Error('Rounds must be 3 or 5.');
  if(![3,5,10].includes(minutes))throw Error('Round duration must be 3, 5 or 10 minutes.');
  out.push({left:c[0],right:c[1],division:division.slice(0,100),rounds:Number(rounds),duration:minutes*60});
 }
 if(!out.length||out.length>70)throw Error('Enter between 1 and 70 matchups.');
 return out;
}
function importPasted(){
 try{
  const matches=parseLines($('pasteCard').value);
  const useCurrent=$('pasteDestination').value==='current'&&!!event();
  const target=useCurrent?event():makeEvent($('pasteEventName').value||'Imported event',$('pasteEventDate').value);
  if(target.completedAt)throw Error('Reopen this completed event first.');
  finishImport(target,matches);
 }catch(error){toast(error.message)}
}
async function readUpload(){
 const file=$('cardFile').files?.[0];
 try{
  if(!file)return;
  if(file.size>140000)throw Error('Maximum file size is 140 KB.');
  const raw=await file.text();
  if(/\.json$/i.test(file.name)){
   const json=JSON.parse(raw),src=Array.isArray(json?.events)?json.events[0]:json;
   let matches=[];
   if(Array.isArray(src?.sections))matches=readCard(src);
   else if(Array.isArray(src?.bouts)||Array.isArray(src?.fights))matches=(src.bouts||src.fights).map(b=>{
    const fighters=b.fighters||[b.left||b.red,b.right||b.blue];
    return {left:txt(fighters[0]?.name||fighters[0]),right:txt(fighters[1]?.name||fighters[1]),
     division:txt(b.division||b.weight_class||'Unspecified division'),
     rounds:[3,5].includes(+b.rounds)?+b.rounds:3,duration:[180,300,600].includes(+b.duration)?+b.duration:300};
   }).filter(b=>b.left&&b.right);
   if(!matches.length)throw Error('No matchups found in JSON.');
   $('pasteEventName').value=src?.sections?cardName(src):txt(src?.name||src?.title||'Imported event');
   if(/^\d{4}-\d{2}-\d{2}$/.test(src?.date||''))$('pasteEventDate').value=src.date;
   $('pasteCard').value=matches.map(b=>[b.left,b.right,b.division,b.rounds,b.duration/60].join('\t')).join('\n');
  }else $('pasteCard').value=raw;
  $('pasteDetails').open=true;toast('Card loaded. Review the text and import.');
 }catch(error){toast('Import error: '+error.message)}
 finally{$('cardFile').value=''}
}
function preview(){
 const wrap=$('importPreview');wrap.replaceChildren();
 $('importSelectedEvent').disabled=!selected;
 if(!selected){wrap.append(elem('p','Select an event to preview its matchups.','muted'));return}
 const bouts=readCard(selected);
 wrap.append(elem('div',cardName(selected)+' · '+bouts.length+' matchups','import-card-heading'));
 for(const b of bouts)wrap.append(elem('div',b.left+' vs '+b.right+' · '+b.division+' · '+b.rounds+' rounds','import-fight-line'));
 wrap.append(elem('p','Check red/blue assignments and fight duration before scoring. Non-UFC cards may use different rules.','muted import-disclaimer'));
}
function search(){
 if(busy)return;
 const matched=catalog.filter(e=>norm(cardName(e)).includes(norm(searchText))||norm(e.date).includes(norm(searchText)))
  .sort((a,b)=>(a.date||'').localeCompare(b.date||'')).slice(0,30);
 $('lookupStatus').textContent=catalog.length?matched.length+' events shown from published cards. Matchups may change.':
  'No published event cards available. Paste or upload a card below.';
 const list=$('lookupResults');list.replaceChildren();
 for(const c of matched){
  const b=elem('button',undefined,'lookup-card'+(c.id===selected?.id?' selected':''));
  b.type='button';b.append(elem('strong',cardName(c)),elem('span',(c.date||'Date TBA')+' · '+readCard(c).length+' matchups'));
  b.onclick=()=>{selected=c;search();preview()};
  list.append(b);
 }
}
const AUTO_CARD_KEY='copper47.auto-today.v1';
function dateHere(){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const get=k=>parts.find(p=>p.type===k)?.value||'';
 return get('year')+'-'+get('month')+'-'+get('day');
}
function prioritizeUfc(a,b){
 const rank=e=>norm(e.promotion_key)==='ufc'||/^ufc(?:\s|$)/i.test(txt(e.promotion))?0:1;
 return rank(a)-rank(b);
}
function findExistingCard(card){
 const sourceId=txt(card.id),name=cardName(card),matches=readCard(card),first=matches[0]&&pair(matches[0].left,matches[0].right);
 return data.events.find(e=>(sourceId&&e.sourceId===sourceId)||
  (e.date===card.date&&(norm(e.name)===norm(name)||!!first&&e.fights.some(f=>pair(f.left,f.right)===first))));
}
function offerToday(){
 const panel=$('todayCardPanel'),name=$('todayCardName'),status=$('todayCardStatus'),button=$('loadTodayCard');
 if(!panel)return;
 const date=dateHere();
 const found=catalog.filter(c=>c.date===date).sort(prioritizeUfc)[0];
 if(!found){
  panel.classList.remove('hidden');
  name.textContent='No scheduled card found for today';
  status.textContent=catalog.length?'No matching event in the current published schedule. Search upcoming events or paste a card.':
    'The event catalog could not be loaded. Check your connection or import a card manually.';
  button.textContent='Search event cards';button.onclick=openModal;return;
 }
 panel.classList.remove('hidden');
 const fights=readCard(found),existing=findExistingCard(found);
 name.textContent=cardName(found)+' · '+found.date;
 status.textContent=fights.length+' scheduled matchups from the site catalog'+
   (existing?' · '+existing.fights.length+' already in the workspace':' · not yet in the workspace')+
   ' · source card may change before the event.';
 button.textContent=existing?'Open event':'Load today’s card';
 button.onclick=()=>{if(existing){selectEvent(existing.id);return}importTodayCard(found,false)};
}
function importTodayCard(card,automatic){
 try{
  const existing=findExistingCard(card);
  if(existing){if(!automatic)selectEvent(existing.id);return}
  const bouts=readCard(card);
  if(!bouts.length)throw Error('No scheduled bouts found.');
  const target=makeEvent(cardName(card),card.date,card.id);
  const added=addMatches(target,bouts);
  if(!added)throw Error('No fights could be imported.');
  data.selected=target.id;
  if(!persist())throw Error('Local browser storage could not save the card.');
  renderDashboard();offerToday();
  toast(added+' bouts loaded for today. Verify the final card before scoring.');
 }catch(error){toast('Today’s card was not imported: '+error.message)}
}
function maybeAutoLoadToday(){
 const today=catalog.filter(c=>c.date===dateHere()).sort(prioritizeUfc)[0];
 if(!today||findExistingCard(today))return;
 if(localStorage.getItem(AUTO_CARD_KEY)==='false')return;
 importTodayCard(today,true);
}
async function fetchCards(){
 if(busy)return;
 busy=true;$('lookupStatus').textContent='Checking published event listings…';
 const sources=['/assets/data/copper-card-catalog.json','/assets/data/upcoming-events-live.json'];
 let failure='';
 try{
  for(const source of sources){
   const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
   try{
    const r=await fetch(source,{cache:'no-store',credentials:'same-origin',signal:ctrl.signal});
    if(!r.ok)throw Error('HTTP '+r.status);
    const payload=await r.json();
    if(!Array.isArray(payload?.events))throw Error('Invalid schedule format');
    catalog=payload.events.filter(c=>readCard(c).length).slice(0,250);
    if(!catalog.length)throw Error('No events with scheduled fights');
    busy=false;search();offerToday();maybeAutoLoadToday();return;
   }catch(error){failure=error.message}finally{clearTimeout(timer)}
  }
  catalog=[];$('lookupResults').replaceChildren();
  $('lookupStatus').textContent='Card lookup unavailable ('+failure+'). Use pasted matchups or file import.';
  offerToday();
 }finally{busy=false}
}
function openModal(){
 $('importEventOverlay').classList.remove('hidden');
 $('pasteDestination').replaceChildren();
 const op=elem('option','Create new event');op.value='new';$('pasteDestination').append(op);
 if(event()){const op2=elem('option','Add to current: '+(event().name||'unnamed event'));op2.value='current';$('pasteDestination').append(op2)}
 selected=null;searchText='';$('lookupSearch').value='';$('pasteDetails').open=false;preview();fetchCards();$('lookupSearch').focus();
}
function closeModal(){$('importEventOverlay').classList.add('hidden')}
function completeEvent(){
 const e=event();if(!e)return;
 if(e.completedAt){
  if(!confirm('Reopen this event? Existing rounds and results stay unchanged.'))return;
  delete e.completedAt;persist();renderDashboard();toast('Event reopened.');return;
 }
 if(!e.fights.length)return toast('Add at least one fight before completing an event.');
 const remaining=e.fights.length-countDone(e);
 const prompt=remaining?'Complete this event with '+remaining+' fight(s) still unfinished? Those fight records will be preserved.':
  'Mark this event completed? All fights have saved results.';
 if(!confirm(prompt))return;
 e.completedAt=new Date().toISOString();persist();renderDashboard();toast('Event moved to Completed.');
}
function render(){
 const list=$('events');if(!list)return;
 const buttons=[...list.children];
 if(buttons.length===data.events.length){
  list.replaceChildren();
  const active=[],finished=[];
  data.events.forEach((e,i)=>{
   const b=buttons[i],line=b.querySelector('small');
   if(line)line.textContent=(e.date||'No date')+' · '+countDone(e)+'/'+e.fights.length+' finished';
   b.append(elem('span',e.completedAt?'Completed':'Active','event-state '+(e.completedAt?'is-done':'is-active')));
   (e.completedAt?finished:active).push(b);
  });
  list.append(elem('div','Active · '+active.length,'event-group-title'));
  if(active.length)list.append(...active);else list.append(elem('div','No active events','event-group-empty'));
  if(finished.length){
   const details=elem('details',undefined,'completed-events');
   details.open=data.events.some(e=>e.completedAt&&e.id===data.selected);
   details.append(elem('summary','Completed · '+finished.length),...finished);
   list.append(details);
  }
 }
 const e=event();
 $('completeEvent').classList.toggle('hidden',!e);
 $('eventProgress').classList.toggle('hidden',!e);
 if(!e){window.copperIntegrity?.refresh();return;}
 $('completeEvent').textContent=e.completedAt?'Reopen event':'Mark event completed';
 $('completeEvent').classList.toggle('primary',!e.completedAt);
 $('eventProgress').textContent=(e.completedAt?'Completed '+new Date(e.completedAt).toLocaleDateString():'Active event')
  +' · '+countDone(e)+' of '+e.fights.length+' fights finished'
  +(!e.completedAt&&e.fights.length&&countDone(e)===e.fights.length?' · Ready to close':'');
 window.copperIntegrity?.refresh();
}
$('importCardBtn').onclick=openModal;
$('closeImportEvent').onclick=closeModal;
$('importSelectedEvent').onclick=importSelected;
$('lookupSearch').oninput=e=>{searchText=e.target.value;search()};
$('refreshCards').onclick=fetchCards;
$('pasteImport').onclick=importPasted;
$('cardFile').onchange=readUpload;
$('completeEvent').onclick=completeEvent;
$('autoLoadCard').checked=localStorage.getItem(AUTO_CARD_KEY)!=='false';
$('autoLoadCard').onchange=()=>{
 localStorage.setItem(AUTO_CARD_KEY,$('autoLoadCard').checked?'true':'false');
 if($('autoLoadCard').checked)maybeAutoLoadToday();
};
$('importEventOverlay').onclick=e=>{if(e.target===$('importEventOverlay'))closeModal()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('importEventOverlay').classList.contains('hidden')){e.preventDefault();e.stopImmediatePropagation();closeModal()}},true);
window.copperEvents={render,readCard,offerToday};
render();
fetchCards();
})();