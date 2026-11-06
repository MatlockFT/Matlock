import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOpponentQuality } from './opponent-quality.mjs';

const fighter=(name,url,history=[])=>({
  name,sourceUrl:url,historyComplete:true,history
});
const row=(date,result,opponent,opponentSourceUrl)=>({date,result,opponent,opponentSourceUrl});
const profileUrl=name=>'https://www.sherdog.com/fighter/'+name.replaceAll(' ','-')+'-100';

test('grades the full career, not only recent five bouts',()=>{
  const opponents=new Map();
  const history=[];
  for(let n=1;n<=8;n++){
    const name='Opponent '+n;
    const url=profileUrl(name);
    opponents.set(name.toLowerCase(),fighter(name,url,[]));
    history.push(row('2025-'+String(n).padStart(2,'0')+'-15','W',name,url));
  }
  const result=calculateOpponentQuality(history,opponents);
  assert.equal(result.bouts,8);
  assert.equal(result.verifiedOpponents,8);
  assert.equal(result.score,50);
  assert.equal(result.recent6,50);
});

test('never uses fights on or after the matchup date to rate an opponent',()=>{
  const a=profileUrl('Opponent A');
  const old=[row('2023-01-01','W','Earlier'),row('2024-01-01','L','Earlier')];
  const given=[row('2024-05-01','L','Opponent A',a)];
  const before=calculateOpponentQuality(given,new Map([['opponent a',fighter('Opponent A',a,old)]]));
  const after=calculateOpponentQuality(given,new Map([['opponent a',fighter('Opponent A',a,[
    ...old,row('2024-05-01','W','Same Day'),row('2024-08-01','W','Later'),
    row('2025-01-01','W','Later'),row('2026-01-01','W','Later')
  ])]]));
  assert.deepEqual({score:after.score,recent6:after.recent6},{score:before.score,recent6:before.recent6});
});

test('small sample is shrunk to neutral, and prior winning form is rewarded',()=>{
  const a=profileUrl('Opponent A'), b=profileUrl('Opponent B');
  const all=Array.from({length:12},(_,i)=>row('2023-'+String(i+1).padStart(2,'0')+'-01','W','Earlier'));
  const common=row('2024-01-01','W','Opponent A',a);
  const strong=calculateOpponentQuality([common],new Map([['opponent a',fighter('Opponent A',a,all)]]));
  const debut=calculateOpponentQuality([row('2024-01-01','L','Opponent B',b)],new Map([['opponent b',fighter('Opponent B',b,[])]]));
  assert.ok(strong.score>debut.score);
  assert.equal(debut.score,50);
});

test('incomplete and mismatched opponent profiles cannot produce a rating',()=>{
  const a=profileUrl('Opponent A');
  const fight=row('2024-01-01','W','Opponent A',a);
  assert.equal(calculateOpponentQuality([fight],new Map()),null);
  assert.equal(calculateOpponentQuality([fight],new Map([['opponent a',{...fighter('Opponent A',a,[]),historyComplete:false}]])),null);
  assert.equal(calculateOpponentQuality([fight],new Map([['opponent a',fighter('Opponent A',profileUrl('Other Fighter'),[])]])),null);
});

test('draws count half, no contests do not enter the form denominator',()=>{
  const a=profileUrl('Opponent A');
  const all=[
    row('2023-01-01','D','Earlier'),
    row('2023-02-01','NC','Earlier')
  ];
  const draw=calculateOpponentQuality([row('2024-01-01','W','Opponent A',a)],new Map([['opponent a',fighter('Opponent A',a,all)]]));
  assert.equal(draw.score,50);
});
