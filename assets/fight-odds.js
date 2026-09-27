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

  function setCardState(card, data) {
    const left = card.querySelector('[data-live-odds-side="a"]');
    const right = card.querySelector('[data-live-odds-side="b"]');
    const checked = data?.fetchedAt ? new Date(data.fetchedAt) : new Date();

    if (data?.ok && data?.available && data.fighterA?.moneyline && data.fighterB?.moneyline) {
      const a = left?.querySelector('[data-live-odds-value]');
      const b = right?.querySelector('[data-live-odds-value]');
      if (a) a.textContent = data.fighterA.moneyline;
      if (b) b.textContent = data.fighterB.moneyline;
      const provider = data.provider ? ' · ' + data.provider : '';
      const title = 'Live moneyline via ESPN' + provider + ' · checked ' +
        checked.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
      for (const pill of [left,right]) {
        if (!pill) continue;
        pill.dataset.liveOddsState = 'live';
        pill.title = title;
      }
      return;
    }

    const title = data?.reason === 'line-not-posted'
      ? 'Live moneyline has not been posted yet. This card will update automatically.'
      : 'Live moneyline is currently unavailable. The saved fallback remains in place.';
    for (const pill of [left,right]) {
      if (!pill) continue;
      pill.dataset.liveOddsState = 'unavailable';
      pill.title = title;
    }
  }

  async function refreshCard(card) {
    const fighterA = card.dataset.liveOddsFighterA || '';
    const fighterB = card.dataset.liveOddsFighterB || '';
    const date = card.dataset.liveOddsEventDate || '';
    if (!fighterA || !fighterB || card.dataset.liveOddsLoading === 'true') return;

    card.dataset.liveOddsLoading = 'true';
    try {
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
      setCardState(card,data);
    } catch {
      setCardState(card,{ok:false});
    } finally {
      delete card.dataset.liveOddsLoading;
    }
  }

  function refreshAll() {
    if (document.visibilityState === 'hidden') return;
    cards.forEach(refreshCard);
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
