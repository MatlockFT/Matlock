import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOpponentQuality } from './opponent-quality.mjs';
import { parseSherdogCareerProfile, parseUfcFightCareerProfile } from '../../_netlify-auth/netlify/functions/_writer-career-fallback.mjs';

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

test('Sherdog history counts exclude amateur draws and validate the pro ledger',()=>{
  const source='<h1>Mason Iacobellis</h1><p>Wins 1 KO / TKO 0 SUBMISSIONS 1 DECISIONS 0 Losses 0</p>'+
    '<h2>FIGHT HISTORY - PRO</h2><table><tr><td>win</td><td>Demo Opponent</td><td>Jan / 02 / 2024</td><td>Submission</td><td>1</td><td>1:00</td></tr></table>'+
    '<h2>FIGHT HISTORY - AMATEUR</h2><p>Draws 3</p>';
  const profile=parseSherdogCareerProfile(source);
  assert.equal(profile.record,'1-0-0');
  assert.equal(profile.historyComplete,true);
});

test('UFCFight completeness remains independent of Sherdog record logic',()=>{
  const source='<h2>Test Fighter</h2><p>W-L-D 1-0-0 WINS 1 KO / TKO 1 SUB 0 DECISIONS 0 LOSSES 0</p>'+
    '<h2>Fight History</h2><table><tr><td>Jan / 02 / 2024</td><td>Opponent</td><td>W KO (Punches)</td></tr></table>';
  const profile=parseUfcFightCareerProfile(source);
  assert.equal(profile?.record,'1-0-0');
  assert.equal(profile?.historyComplete,true);
});
