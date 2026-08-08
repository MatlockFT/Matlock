import fs from 'node:fs/promises';

const beforePath = process.argv[2] || '/tmp/upcoming-events.before.json';
const afterPath = process.argv[3] || '_data/upcoming_events.json';
const logPath = process.argv[4] || '_data/upcoming_events_changes.json';
const MAX_CHANGES = 300;

const norm = (s='') => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const eventKey = e => `${e?.promotion_key || ''}|${e?.official_url || e?.id || ''}`;
const boutCount = e => (e?.sections || []).reduce((n,s)=>n+(s.bouts||[]).length,0);
const fighterNames = bout => (bout?.fighters || []).map(f=>String(f?.name||'').trim()).filter(Boolean);
const pairKey = bout => fighterNames(bout).map(norm).sort().join('|');
const boutLabel = bout => fighterNames(bout).join(' vs ');
const clean = v => String(v ?? '').replace(/\s+/g,' ').trim();

async function readJson(path, fallback=null) {
  try { return JSON.parse(await fs.readFile(path,'utf8')); }
  catch { return fallback; }
}

function flattenBouts(event) {
  const out=[];
  for (const section of event?.sections || []) for (const bout of section.bouts || []) out.push({
    ...bout,
    section_kind: section.kind || '',
    section_title: section.title || '',
    section_time: section.time || '',
    pair_key: pairKey(bout)
  });
  return out;
}

function portraitMap(event) {
  const out=new Map();
  for (const section of event?.sections || []) for (const bout of section.bouts || []) for (const f of bout.fighters || []) {
    const key=norm(f?.name); if (!key) continue;
    out.set(key,{name:clean(f.name),image:clean(f.image),source:clean(f.image_source),framing:clean(f.image_framing)});
  }
  return out;
}

const before = await readJson(beforePath,{events:[]});
const after = await readJson(afterPath,{events:[]});
const existing = await readJson(logPath,{schema_version:1,generated_at:null,changes:[]});
if (!Array.isArray(before?.events) || !Array.isArray(after?.events)) throw new Error('Event diff requires valid before/after event arrays.');

const now = new Date().toISOString();
const changes=[];
function add(type,event,summary,details={}) {
  changes.push({
    id: `${now}|${event?.id || 'event'}|${type}|${changes.length+1}`,
    at: now,
    type,
    event_id: event?.id || '',
    promotion: event?.promotion || event?.promotion_key?.toUpperCase() || '',
    event_title: event?.title || '',
    event_date: event?.date || '',
    summary,
    details
  });
}

const oldByKey=new Map(before.events.map(e=>[eventKey(e),e]));
const newByKey=new Map(after.events.map(e=>[eventKey(e),e]));

for (const [key,event] of newByKey) if (!oldByKey.has(key)) add('event_added',event,`${event.promotion || ''} ${event.title} added to Upcoming Events.`,{bout_count:boutCount(event),venue:event.venue||'',date:event.date||''});
for (const [key,event] of oldByKey) if (!newByKey.has(key)) add('event_removed',event,`${event.promotion || ''} ${event.title} removed from Upcoming Events.`,{bout_count:boutCount(event),venue:event.venue||'',date:event.date||''});

for (const [key,next] of newByKey) {
  const old=oldByKey.get(key); if (!old) continue;
  for (const [field,label] of [['title','title'],['date','date'],['venue','venue'],['broadcast','broadcast']]) {
    if (clean(old[field]) !== clean(next[field])) add(`${field}_changed`,next,`${next.promotion || ''} ${next.title}: ${label} changed.`,{from:old[field]||'',to:next[field]||''});
  }

  const oldSections=new Map((old.sections||[]).map(s=>[s.kind||s.title,s]));
  for (const section of next.sections||[]) {
    const prev=oldSections.get(section.kind||section.title); if (!prev) continue;
    if (clean(prev.time) !== clean(section.time)) add('start_time_changed',next,`${next.promotion || ''} ${next.title}: ${section.title || 'card'} start time changed.`,{section:section.title||'',from:prev.time||'',to:section.time||''});
  }

  const oldBouts=flattenBouts(old),newBouts=flattenBouts(next);
  const oldByPair=new Map(oldBouts.filter(b=>b.pair_key).map(b=>[b.pair_key,b]));
  const newByPair=new Map(newBouts.filter(b=>b.pair_key).map(b=>[b.pair_key,b]));
  const matchedOld=new Set(),matchedNew=new Set();

  for (const [pair,b] of newByPair) {
    const prev=oldByPair.get(pair); if (!prev) continue;
    matchedOld.add(prev); matchedNew.add(b);
    if (prev.order !== b.order || prev.section_kind !== b.section_kind) add('bout_moved',next,`${boutLabel(b)} moved on ${next.title}.`,{from_order:prev.order,to_order:b.order,from_section:prev.section_title,to_section:b.section_title});
    if (clean(prev.weight_class) !== clean(b.weight_class)) add('bout_weight_changed',next,`${boutLabel(b)} weight/class changed.`,{from:prev.weight_class||'',to:b.weight_class||''});
  }

  const oldUnmatched=oldBouts.filter(b=>!matchedOld.has(b));
  const newUnmatched=newBouts.filter(b=>!matchedNew.has(b));
  const usedOld=new Set(),usedNew=new Set();
  for (const nb of newUnmatched) {
    const ob=oldUnmatched.find(x=>!usedOld.has(x) && x.order===nb.order && x.section_kind===nb.section_kind);
    if (!ob) continue;
    usedOld.add(ob); usedNew.add(nb);
    add('bout_changed',next,`${boutLabel(ob)} changed to ${boutLabel(nb)} on ${next.title}.`,{order:nb.order,section:nb.section_title,from:fighterNames(ob),to:fighterNames(nb)});
  }
  for (const b of newUnmatched) if (!usedNew.has(b)) add('bout_added',next,`${boutLabel(b)} added to ${next.title}.`,{order:b.order,section:b.section_title,weight_class:b.weight_class||''});
  for (const b of oldUnmatched) if (!usedOld.has(b)) add('bout_removed',next,`${boutLabel(b)} removed from ${next.title}.`,{order:b.order,section:b.section_title,weight_class:b.weight_class||''});

  const oldPortraits=portraitMap(old),newPortraits=portraitMap(next);
  for (const [name,p] of newPortraits) {
    const prev=oldPortraits.get(name); if (!prev) continue;
    if (!prev.image && p.image) add('portrait_added',next,`${p.name} portrait added.`,{fighter:p.name,source:p.source||''});
    else if (prev.image && p.image && prev.image!==p.image) add('portrait_changed',next,`${p.name} portrait source changed.`,{fighter:p.name,from_source:prev.source||'',to_source:p.source||''});
  }
}

const previousChanges=Array.isArray(existing?.changes)?existing.changes:[];
const output={schema_version:1,generated_at:changes.length?now:(existing?.generated_at||null),changes:[...changes,...previousChanges].slice(0,MAX_CHANGES)};
await fs.writeFile(logPath,JSON.stringify(output,null,2)+'\n');
console.log(changes.length ? `Recorded ${changes.length} meaningful upcoming-event change(s).` : 'No meaningful upcoming-event changes detected.');
