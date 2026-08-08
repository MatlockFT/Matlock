import fs from 'node:fs/promises';

const TARGET = 'upcoming-events.html';
const EVENT_DATE = '2026-08-07';
const REMOVE_AFTER = new Date('2026-08-09T05:00:00Z');

const bouts = {
  main: [
    ['Bryan Battle','Dalton Rosta','Middleweight'],
    ['Dovlet Yagshimuradov','Simeon Powell','Light Heavyweight'],
    ['Josh Silveira','Aaron Jeffery','Middleweight'],
    ['Lewis McGrillen','Brandon Lewis','Bantamweight'],
    ['Josh Fremd','Jhony Gregory','Middleweight']
  ],
  prelims: [
    ['Denis Goltsov','Hasan Mezhiev','Heavyweight'],
    ['Cheyden Leialoha','Robbie Ring','Featherweight'],
    ['Cheyanne Bowers','Elora Dana',"Women's Flyweight"],
    ['Michael Boylan','Landry Ward','Lightweight'],
    ['Valentin Moldavsky','Bruno Cappelozza','Light Heavyweight'],
    ['Jonathan Martin','Wilson Lopshire','Catchweight (160 lbs)'],
    ['Eduardo Neves','Maxwell Djantou Nana','Heavyweight'],
    ['Trukon Carson','Trey Waters','Welterweight']
  ]
};

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const initials = name => name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
const fighter = name => `<div class="fighter"><div class="fighter-photo photo-missing"><span class="fighter-fallback" aria-hidden="true">${initials(name)}</span></div><p class="fighter-name">${esc(name)}</p></div>`;
const bout = ([a,b,w],n,featured=false) => `<article class="bout-card ${featured?'bout-card-featured':'bout-card-compact'}"><div class="bout-label"><span>${String(n).padStart(2,'0')}</span>${n===1?' Main Event':n===2?' Co-Main Event':''}</div><div class="bout-fighters">${fighter(a)}${fighter(b)}</div><div class="bout-footer"><span>${esc(w)}</span><strong>VS</strong></div></article>`;

function cardMarkup(){
  const mainFeatured=bouts.main.slice(0,2).map((b,i)=>bout(b,i+1,true)).join('');
  const mainRest=bouts.main.slice(2).map((b,i)=>bout(b,i+3,false)).join('');
  const prelims=bouts.prelims.map((b,i)=>bout(b,i+6,false)).join('');
  return `<section class="upcoming-event-card" aria-labelledby="pfl-charlotte-aug-7-title"><header class="event-card-header"><div class="event-card-heading"><p class="event-promotion">PFL</p><h2 id="pfl-charlotte-aug-7-title">Charlotte</h2><p class="event-date"><time datetime="${EVENT_DATE}">Friday · August 7, 2026</time></p></div><div class="event-card-meta"><p>Bojangles Coliseum · Charlotte, North Carolina</p><p><strong>Early Card</strong> 6:30 PM ET</p><p><strong>Main Card</strong> 10:00 PM ET</p><p>ESPN App · ESPN</p><a href="https://pflmma.com/event/pfl-charlotte" target="_blank" rel="noopener noreferrer">Official event page ↗</a></div></header><div class="event-card-section"><div class="event-card-section-heading"><h3>Main Card</h3><span>10:00 PM ET</span></div><div class="featured-bouts">${mainFeatured}</div><div class="main-card-bouts">${mainRest}</div></div><div class="event-card-section event-card-prelims"><div class="event-card-section-heading"><h3>Early Card</h3><span>6:30 PM ET</span></div><div class="prelim-bouts">${prelims}</div></div><footer class="event-card-note"><p>Card order and start times updated August 7, 2026. Fight cards can change.</p></footer></section>`;
}

let html=await fs.readFile(TARGET,'utf8');
const cardRe=/\n?<section class="upcoming-event-card" aria-labelledby="pfl-charlotte-aug-7-title">[\s\S]*?<\/section>\n?/;
html=html.replace(cardRe,'\n');

if(new Date() < REMOVE_AFTER){
  const marker='<div class="upcoming-events-list">';
  const i=html.indexOf(marker);
  if(i<0) throw new Error('Could not find upcoming-events-list');
  const insert=i+marker.length;
  html=html.slice(0,insert)+'\n'+cardMarkup()+html.slice(insert);
}

await fs.writeFile(TARGET,html);
console.log(new Date() < REMOVE_AFTER ? 'PFL Charlotte live card ensured.' : 'PFL Charlotte fallback expired.');
