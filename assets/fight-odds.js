(() => {
  'use strict';

  const API = 'https://mmamatlock-writer-auth.netlify.app/api/fight-odds';
  const STATIC_ODDS = '/assets/live-ufc-odds.json';
  const currentCards = () => [...document.querySelectorAll('[data-live-odds-matchup]')];

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

  function normalizedName(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g,' ')
      .replace(/[^a-z0-9]+/g,' ').trim().split(' ').sort().join(' ');
  }

  let staticFeed = null;
  let staticFeedFetchedAt = 0;

  async function loadStaticOdds() {
    if (staticFeed && Date.now() - staticFeedFetchedAt < 45000) return staticFeed;
    const response = await fetch(STATIC_ODDS + '?t=' + Date.now(), {
      cache:'no-store',
      credentials:'same-origin',
      headers:{Accept:'application/json'}
    });
    if (!response.ok) throw new Error('static odds unavailable');
    staticFeed = await response.json();
    staticFeedFetchedAt = Date.now();
    return staticFeed;
  }

  async function staticOddsFor(card) {
    const fighterA = normalizedName(card.dataset.liveOddsFighterA || '');
    const fighterB = normalizedName(card.dataset.liveOddsFighterB || '');
    const eventDate = card.dataset.liveOddsEventDate || '';
    if (!fighterA || !fighterB) return null;
    const feed = await loadStaticOdds();
    const events = Array.isArray(feed?.events) ? feed.events : [];
    const candidates = /^\d{4}-\d{2}-\d{2}$/.test(eventDate)
      ? events.filter(event => event.date === eventDate)
      : events;
    for (const event of candidates) {
      for (const fight of event.fights || []) {
        const fighters = fight.fighters || [];
        const a = fighters.find(row => normalizedName(row.name) === fighterA);
        const b = fighters.find(row => normalizedName(row.name) === fighterB);
        if (!a?.moneyline || !b?.moneyline) continue;
        return {
          ok:true,
          available:true,
          source:fight.source || feed.source || 'UFC.com',
          provider:fight.provider || fight.source || feed.source || 'UFC.com',
          fetchedAt:feed.generated_at || new Date().toISOString(),
          eventDate:event.date || null,
          fighterA:{name:card.dataset.liveOddsFighterA || '',moneyline:a.moneyline},
          fighterB:{name:card.dataset.liveOddsFighterB || '',moneyline:b.moneyline}
        };
      }
    }
    return null;
  }

  function setMoneylines(card, moneylineA, moneylineB, meta = {}) {
    const left = card.querySelector('[data-live-odds-side="a"]');
    const right = card.querySelector('[data-live-odds-side="b"]');
    const a = left?.querySelector('[data-live-odds-value]');
    const b = right?.querySelector('[data-live-odds-value]');
    if (a) a.textContent = moneylineA;
    if (b) b.textContent = moneylineB;
    const checked = meta.fetchedAt ? new Date(meta.fetchedAt) : new Date();
    const source = meta.source || 'live feed';
    const provider = meta.provider && meta.provider !== source ? ' · ' + meta.provider : '';
    const title = 'Live moneyline via ' + source + provider + ' · checked ' +
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
    const resolved = new Set();
    if (!Array.isArray(data?.cardOdds) || !data.cardOdds.length) return resolved;
    for (const card of group) {
      const a = normalizedName(card.dataset.liveOddsFighterA);
      const b = normalizedName(card.dataset.liveOddsFighterB);
      const market = data.cardOdds.find(item => {
        const names = (item.fighters || []).map(fighter => normalizedName(fighter.name));
        return names.includes(a) && names.includes(b);
      });
      if (!market) continue;
      const aLine = (market.fighters || []).find(fighter => normalizedName(fighter.name) === a)?.moneyline;
      const bLine = (market.fighters || []).find(fighter => normalizedName(fighter.name) === b)?.moneyline;
      if (!aLine || !bLine) continue;
      setMoneylines(card,aLine,bLine,{
        ...data,
        source:market.source || data.source,
        provider:market.provider || data.provider
      });
      resolved.add(card);
    }
    return resolved;
  }

  async function requestOdds(card) {
    const fighterA = card.dataset.liveOddsFighterA || '';
    const fighterB = card.dataset.liveOddsFighterB || '';
    const date = card.dataset.liveOddsEventDate || '';
    if (!fighterA || !fighterB) return null;

    let apiData = null;
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
      apiData = await response.json().catch(() => null);
      if (response.ok && apiData && (apiData.available || apiData.cardOdds?.length)) return apiData;
    } catch {}

    try {
      const staticData = await staticOddsFor(card);
      if (staticData) return staticData;
    } catch {}

    if (apiData) return apiData;
    throw new Error('odds request failed');
  }

  async function refreshGroup(group) {
    if (!group.length || group.some(card => card.dataset.liveOddsLoading === 'true')) return;
    group.forEach(card => { card.dataset.liveOddsLoading = 'true'; });
    try {
      const representative = group[0];
      const data = await requestOdds(representative);
      const resolved = applyEventCardOdds(group,data);

      if (!resolved.has(representative) && applyResponse(representative,data)) {
        resolved.add(representative);
      }

      await Promise.all(group.filter(card => card !== representative && !resolved.has(card)).map(async card => {
        try {
          if (applyResponse(card,await requestOdds(card))) resolved.add(card);
        } catch {
          setUnavailable(card);
        }
      }));
    } catch {
      group.forEach(card => setUnavailable(card));
    } finally {
      group.forEach(card => { delete card.dataset.liveOddsLoading; });
    }
  }

  function groupedCards() {
    const groups = new Map();
    for (const card of currentCards()) {
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
    const cards = currentCards();
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

  let mutationRefresh = 0;
  const observer = new MutationObserver(mutations => {
    const hasNewFightCard = mutations.some(mutation =>
      [...mutation.addedNodes].some(node =>
        node.nodeType === 1 &&
        (node.matches?.('[data-live-odds-matchup]') || node.querySelector?.('[data-live-odds-matchup]'))
      )
    );
    if (!hasNewFightCard) return;
    window.clearTimeout(mutationRefresh);
    mutationRefresh = window.setTimeout(refreshAll,80);
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});

  document.addEventListener('visibilitychange',() => {
    if (document.visibilityState === 'visible') {
      refreshAll();
      schedule();
    }
  });
})();
