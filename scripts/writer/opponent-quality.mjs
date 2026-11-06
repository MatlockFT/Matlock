// Matlock Opponent Quality v1 — transparent, all-career, point-in-time metric.
// Not a Fight Matrix or Tapology score. No bookmaker odds, promotion multipliers,
// future fight results or subjective fighter rankings enter this calculation.
const DAY_MS=86400000;
const lookbackDays=1095;
const validResults=new Set(['W','L','D']);

function normalized(value) {
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/['’]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
}

function canonicalUrl(value) {
  return String(value||'').replace(/\/$/,'').toLowerCase();
}

function before(history, date) {
  return (Array.isArray(history)?history:[])
    .filter(fight=> /^\d{4}-\d{2}-\d{2}$/.test(String(fight?.date||''))
      && fight.date<date && validResults.has(String(fight.result||'').toUpperCase()))
    .sort((a,b)=>b.date.localeCompare(a.date));
}

function form(history,date) {
  const prior=before(history,date);
  const windowStart=new Date(Date.parse(date+'T00:00:00Z')-lookbackDays*DAY_MS)
    .toISOString().slice(0,10);
  const recent=prior.filter(fight=>fight.date>=windowStart).slice(0,6);
  const weighted=list=>list.reduce((n,row)=>n+(row.result==='W'?1:row.result==='D'?.5:0),0);
  // A 3-3 / 2-2 Bayesian prior avoids 2-0 newcomers appearing stronger
  // than experienced fighters merely because of a perfect tiny sample.
  return {
    career:(weighted(prior)+3)/(prior.length+6),
    recent:(weighted(recent)+2)/(recent.length+4),
    careerBouts:prior.length,
    recentBouts:recent.length,
    prior
  };
}

function findProfile(row, records) {
  const name=normalized(row?.opponent||row?.opponentName);
  if(!name) return null;
  const record=records.get(name);
  if(!record || record.historyComplete!==true || !Array.isArray(record.history)) return null;
  // URLs disambiguate equal fighter names. Do not trust another profile with
  // a matching name but a different Sherdog ID.
  const needed=canonicalUrl(row?.opponentSourceUrl);
  const actual=canonicalUrl(record.sourceUrl);
  if(needed && (!actual || needed!==actual)) return null;
  return record;
}

export function calculateOpponentQuality(history, opponentRecords) {
  const bouts=(Array.isArray(history)?history:[])
    .filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(String(row?.date||'')) && row.opponent);
  if(!bouts.length || !(opponentRecords instanceof Map)) return null;
  const scored=[];
  let secondOrderSeen=0,secondOrderEligible=0;
  for(const bout of bouts) {
    const profile=findProfile(bout,opponentRecords);
    if(!profile) return null; // Never quietly present a partial-career average.
    const own=form(profile.history,bout.date);
    const previous=own.prior.slice(0,6);
    const known=[];
    for(const earlier of previous) {
      const target=findProfile(earlier,opponentRecords);
      if(!target) continue;
      const basis=form(target.history,earlier.date);
      known.push(.7*basis.career+.3*basis.recent);
    }
    secondOrderSeen+=known.length;
    secondOrderEligible+=previous.length;
    // Require at least two validated second-hop records and half the sample.
    const useSchedule=previous.length>=2 &&
      known.length>=Math.max(2,Math.ceil(previous.length/2));
    const score=useSchedule
      ? 100*(.56*own.career+.24*own.recent+.20*(known.reduce((a,b)=>a+b,0)/known.length))
      : 100*(.7*own.career+.3*own.recent);
    scored.push({date:bout.date,score,secondOrder:useSchedule,priorBouts:own.careerBouts});
  }
  scored.sort((a,b)=>b.date.localeCompare(a.date));
  const mean=rows=>Math.round(10*rows.reduce((sum,row)=>sum+row.score,0)/rows.length)/10;
  return {
    version:1,
    score:mean(scored),
    recent6:mean(scored.slice(0,6)),
    bouts:scored.length,
    verifiedOpponents:scored.length,
    secondOrderBouts:scored.filter(row=>row.secondOrder).length,
    secondOrderHistoryCoverage:secondOrderEligible
      ? Math.round(secondOrderSeen/secondOrderEligible*100) : 0,
    complete:true,
    method:'pre-bout Bayesian career form (70%) + recent form (30%); verified second-hop schedule adjusts weight to 56/24/20',
    note:'Scores are 0–100 points, not win probabilities or independent percentiles.'
  };
}
