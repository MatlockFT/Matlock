(() => {
  'use strict';

  const API = 'https://mmamatlock-writer-auth.netlify.app/api/fight-odds';
  const cards = [...document.querySelectorAll('[data-live-odds-matchup]')];
  if (!cards.length && !document.querySelector('.fc-last5-record')) return;

  function numericLastFive(value) {
    const raw = String(value || '').trim().toUpperCase().replace(/\s+/g,'');
    if (!/^(?:W|L|D|NC){1,5}$/.test(raw)) return null;
    const results = raw.match(/NC|W|L|D/g) || [];
    const wins = results.filter(value => value === 'W').length;
    const losses = results.filter(value => value === 'L').length;
    const third = results.filter(value => value === 'D' || value === 'NC').length;
    return wins + '-' + losses + (third ? '-' + third : '');
  }

  document.querySelectorAll('.fc-last5-record').forEach(node => {
    const numeric = numericLastFive(node.textContent);
    if (numeric) node.textContent = numeric;
  });

  if (!cards.length) return;

  function normalizedName(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g,' ')
      .replace(/[^a-z0-9]+/g,' ').trim().split(' ').sort().join(' ');
  }

  function setMoneylines(card, moneylineA, moneylineB, meta = {}) {
    const left = card.querySelector('[data-live-odds-side="a"]');
    const right = card.querySelector('[data-live-odds-side="b"]');
    const a = left?.querySelector('[data-live-odds-value]');
    const b = right?.querySelector('[data-live-odds-value]');
    if (a) a.textContent = moneylineA;
    if (b) b.textContent = moneylineB;
    const checked = meta.fetchedAt ? new Date(meta.fetchedAt) : new Date();
    const provider = meta.provider ? ' · ' + meta.provider : '';
    const title = 'Live moneyline via ESPN' + provider + ' · checked ' +
      checked.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    for (const pill of [left,right]) {
      if (!pill) continue;
      pill.dataset.liveOddsState = 'live';
      pill.title = title;
    }
  }

  function setUnavailable(card, reason) {
    const title = reason === 'line-not-posted'
      ? 'Live moneyline has not been posted yet. This card will update automatically.'
      : 'Live moneyline is currently unavailable. The saved fallback remains in place.';
    for (const pill of card.querySelectorAll('[data-live-odds-side]')) {
      pill.dataset.liveOddsState = 'unavailable';
      pill.title = title;
    }
  }

  function applyResponse(card, data) {
    if (data?.ok && data?.available && data.fighterA?.moneyline && data.fighterB?.moneyline) {
      setMoneylines(card,data.fighterA.moneyline,data.fighterB.moneyline,data);
      return true;
    }
    setUnavailable(card,data?.reason);
    return false;
  }

  function applyEventCardOdds(group, data) {
    if (!Array.isArray(data?.cardOdds) || !data.cardOdds.length) return false;
    for (const card of group) {
      const a = normalizedName(card.dataset.liveOddsFighterA);
      const b = normalizedName(card.dataset.liveOddsFighterB);
      const market = data.cardOdds.find(item => {
        const names = (item.fighters || []).map(fighter => normalizedName(fighter.name));
        return names.includes(a) && names.includes(b);
      });
      if (!market) {
        setUnavailable(card,'line-not-posted');
        continue;
      }
      const aLine = (market.fighters || []).find(fighter => normalizedName(fighter.name) === a)?.moneyline;
      const bLine = (market.fighters || []).find(fighter => normalizedName(fighter.name) === b)?.moneyline;
      if (aLine && bLine) setMoneylines(card,aLine,bLine,{...data,provider:market.provider});
      else setUnavailable(card,'line-not-posted');
    }
    return true;
  }

  async function requestOdds(card) {
    const fighterA = card.dataset.liveOddsFighterA || '';
    const fighterB = card.dataset.liveOddsFighterB || '';
    const date = card.dataset.liveOddsEventDate || '';
    if (!fighterA || !fighterB) return null;
    const params = new URLSearchParams({fighterA,fighterB});
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) params.set('date',date);
    const response = await fetch(API + '?' + params.toString(),{
      method:'GET',
      mode:'cors',
      credentials:'omit',
      cache:'no-store',
      headers:{Accept:'application/json'}
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error('odds request failed');
    return data;
  }

  async function refreshGroup(group) {
    if (!group.length || group.some(card => card.dataset.liveOddsLoading === 'true')) return;
    group.forEach(card => { card.dataset.liveOddsLoading = 'true'; });
    try {
      const representative = group[0];
      const data = await requestOdds(representative);
      if (!applyEventCardOdds(group,data)) {
        applyResponse(representative,data);
        await Promise.all(group.slice(1).map(async card => {
          try {
            applyResponse(card,await requestOdds(card));
          } catch {
            setUnavailable(card);
          }
        }));
      }
    } catch {
      group.forEach(card => setUnavailable(card));
    } finally {
      group.forEach(card => { delete card.dataset.liveOddsLoading; });
    }
  }

  function groupedCards() {
    const groups = new Map();
    for (const card of cards) {
      const date = card.dataset.liveOddsEventDate || '';
      const key = /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? 'date:' + date
        : 'fight:' + (card.dataset.liveOddsFighterA || '') + '|' + (card.dataset.liveOddsFighterB || '');
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(card);
    }
    return [...groups.values()];
  }

  function refreshAll() {
    if (document.visibilityState === 'hidden') return;
    groupedCards().forEach(refreshGroup);
  }

  function pollDelay() {
    const dates = cards.map(card => card.dataset.liveOddsEventDate)
      .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .map(value => new Date(value + 'T12:00:00').getTime());
    if (!dates.length) return 5 * 60 * 1000;
    const nearest = Math.min(...dates.map(value => Math.abs(value - Date.now())));
    if (nearest <= 2 * 24 * 60 * 60 * 1000) return 60 * 1000;
    if (nearest <= 8 * 24 * 60 * 60 * 1000) return 3 * 60 * 1000;
    return 10 * 60 * 1000;
  }

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      refreshAll();
      schedule();
    },pollDelay());
  }

  refreshAll();
  schedule();

  document.addEventListener('visibilitychange',() => {
    if (document.visibilityState === 'visible') {
      refreshAll();
      schedule();
    }
  });
})();
