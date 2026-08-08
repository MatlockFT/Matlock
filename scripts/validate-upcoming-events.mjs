import fs from 'node:fs/promises';

const beforePath=process.argv[2]||'';
const dataPath=process.argv[3]||'_data/upcoming_events.json';
const templatePath=process.argv[4]||'upcoming-events.html';
const failures=[];
const tracking=/(?:piwik|matomo|google-analytics|googletagmanager|doubleclick|analytics|tracking|pixel|beacon|acs01\.rvlvr\.co|\/collect(?:[/?]|$)|\/track(?:[/?]|$))/i;
const banned=/\b(EVENT INFO|WHERE TO WATCH|BUY TICKETS|MATCHUPS|MAIN CARD SATURDAY|EARLY CARD SATURDAY|d\s*:\s*h\s*:\s*m\s*:\s*s)\b/i;
const today=new Date().toISOString().slice(0,10);

async function readJson(path){try{return JSON.parse(await fs.readFile(path,'utf8'));}catch(error){failures.push(`Could not parse ${path}: ${error.message}`);return null;}}
function countBouts(event){return(event.sections||[]).reduce((n,s)=>n+(s.bouts||[]).length,0);}
function eventKey(e){return`${e.promotion_key}|${e.official_url||e.id}`;}

function validateData(data,label){
  if(!data||!Array.isArray(data.events)){failures.push(`${label}: events must be an array.`);return;}
  if(data.schema_version!==1)failures.push(`${label}: unsupported schema_version ${data.schema_version}.`);
  const ids=new Set(),keys=new Set();
  for(const event of data.events){
    if(!event||!event.id||!event.title||!/^20\d{2}-\d{2}-\d{2}$/.test(event.date||''))failures.push(`${label}: event missing id/title/date.`);
    if(!/^(ufc|pfl|rizin)$/.test(event.promotion_key||''))failures.push(`${label}: ${event.id||'event'} has invalid promotion_key.`);
    if(ids.has(event.id))failures.push(`${label}: duplicate event id ${event.id}.`);ids.add(event.id);
    const key=eventKey(event);if(keys.has(key))failures.push(`${label}: duplicate promotion/source event ${key}.`);keys.add(key);
    if(!event.official_url||!/^https?:\/\//i.test(event.official_url))failures.push(`${label}: ${event.id} missing official URL.`);
    if(!Array.isArray(event.sections)||!event.sections.length){failures.push(`${label}: ${event.id} has no sections.`);continue;}
    const bouts=event.sections.flatMap(s=>s.bouts||[]);if(!bouts.length)failures.push(`${label}: ${event.id} has no bouts.`);
    const orders=new Set();
    for(const section of event.sections){
      if(!section.title||!section.kind)failures.push(`${label}: ${event.id} has malformed section.`);
      for(const bout of section.bouts||[]){
        if(!Number.isInteger(bout.order)||bout.order<1)failures.push(`${label}: ${event.id} has invalid bout order.`);
        if(orders.has(bout.order))failures.push(`${label}: ${event.id} repeats bout order ${bout.order}.`);orders.add(bout.order);
        if(!Array.isArray(bout.fighters)||bout.fighters.length!==2){failures.push(`${label}: ${event.id} bout ${bout.order} does not have two fighters.`);continue;}
        for(const fighter of bout.fighters){
          const name=String(fighter?.name||'').trim();
          if(!name||name.length>80||banned.test(name))failures.push(`${label}: ${event.id} has suspicious fighter name "${name}".`);
          if(fighter?.image&&(!/^https?:\/\//i.test(fighter.image)||tracking.test(fighter.image)))failures.push(`${label}: ${event.id} has invalid portrait for ${name}.`);
          if(fighter?.image_framing&&!/^(standard|safe)$/.test(fighter.image_framing))failures.push(`${label}: ${event.id} has invalid framing for ${name}.`);
        }
      }
    }
  }
  for(let i=1;i<data.events.length;i++)if(data.events[i-1].date>data.events[i].date)failures.push(`${label}: events are not sorted by date.`);
}

const after=await readJson(dataPath);validateData(after,'current data');
let before=null;if(beforePath){try{before=JSON.parse(await fs.readFile(beforePath,'utf8'));}catch{before=null;}}
if(before?.events&&after?.events){
  const afterByKey=new Map(after.events.map(e=>[eventKey(e),e]));
  for(const old of before.events){
    if(!old.date||old.date<=today)continue;
    const next=afterByKey.get(eventKey(old));if(!next)continue;
    const oldCount=countBouts(old),newCount=countBouts(next);
    if(oldCount>=4&&newCount<Math.max(2,oldCount-3))failures.push(`Candidate collapsed ${old.promotion} ${old.title}: ${oldCount} -> ${newCount} bouts.`);
  }
  const oldFuture=before.events.filter(e=>e.date>today).length,newFuture=after.events.filter(e=>e.date>today).length;
  if(oldFuture>=3&&newFuture<Math.max(1,oldFuture-2))failures.push(`Future event count collapsed: ${oldFuture} -> ${newFuture}.`);
}

let template='';try{template=await fs.readFile(templatePath,'utf8');}catch(error){failures.push(`Could not read ${templatePath}: ${error.message}`);}
if(template){
  if(!/site\.data\.upcoming_events\.events/.test(template))failures.push('Upcoming Events template does not render unified data.');
  if(/site\.data\.ufc_events|assign\s+pfl_|assign\s+sac\b|assign\s+sacr\b|assign\s+sacp\b/i.test(template))failures.push('Legacy hard-coded/old event data references remain in Upcoming Events template.');
  const opens=(template.match(/\{%\s*(?:for|if|unless|case)\b/gi)||[]).length,closes=(template.match(/\{%\s*end(?:for|if|unless|case)\b/gi)||[]).length;
  if(opens!==closes)failures.push(`Upcoming Events Liquid blocks are unbalanced: ${opens} opens, ${closes} closes.`);
}

if(failures.length){console.error('Upcoming Events validation failed:');for(const failure of failures)console.error(`- ${failure}`);process.exit(1);}
console.log(`Upcoming Events validation passed: ${after.events.length} event(s), ${after.events.reduce((n,e)=>n+countBouts(e),0)} bout(s).`);
