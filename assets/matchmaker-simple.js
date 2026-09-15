(async function () {
  'use strict';

  const root = document.querySelector('[data-matchmaker-simple]');
  const E = window.MatlockMatchmaker;
  const P = window.MatlockMatchmakerPublic;
  if (!root || !E || !P) return;

  const $ = selector => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const safeUrl = value => {
    try {
      const url = new URL(value, location.origin);
      return ['http:', 'https:'].includes(url.protocol) ? esc(url.href) : '';
    } catch {
      return '';
    }
  };

  const labels = ['BEST FIT', 'ALSO MAKES SENSE', 'ANOTHER OPTION'];
  let data;
  let fighterIndex = new Map();

  function status(message) {
    const node = $('[data-mm-status]');
    if (node) node.textContent = message;
  }

  function context(event) {
    return { event, asOf: data.generatedAt, locks: [], overrides: {} };
  }

  function rankText(fighter, event) {
    const rank = E.rank(fighter, context(event));
    return rank === 0 ? 'Champion' : rank == null ? 'Unranked' : `#${rank}`;
  }

  function participantImage(event, id) {
    return event.bouts.flatMap(bout => bout.fighters || []).find(entry => entry.id === id)?.image || '';
  }

  function placeholder(className) {
    return `<span class="${className} mm-simple-placeholder" aria-hidden="true"><svg viewBox="0 0 160 180"><ellipse cx="80" cy="57" rx="28" ry="35"/><path d="M22 180v-42q0-29 34-38l24 14 24-14q34 9 34 38v42z"/></svg></span>`;
  }

  function photo(fighter, event, className, width, height) {
    const src = participantImage(event, fighter.id) || fighter.image;
    if (!src) return placeholder(className);
    return `<img class="${className}" src="${safeUrl(src)}" alt="" width="${width}" height="${height}" loading="lazy" decoding="async" onerror="this.hidden=true">`;
  }

  function resultText(value) {
    if (value === 'W') return 'WIN';
    if (value === 'L') return 'LOSS';
    if (value === 'D') return 'DRAW';
    if (value === 'NC') return 'NO CONTEST';
    return String(value || 'RESULT');
  }

  function publicRecommendations(fighter, event) {
    const ctx = context(event);
    const recommendations = E.recommendations(fighter, data.fighters, ctx).slice(0, 3);
    return P.filterRecommendations(fighter, recommendations, E, ctx);
  }

  function opponentRow(recommendation, event, index) {
    const opponent = recommendation.fighter;
    return `
      <li class="mm-simple-match${index === 0 ? ' is-primary' : ''}">
        <span class="mm-simple-match-order">0${index + 1}</span>
        <span class="mm-simple-opponent-slot" aria-hidden="true">${photo(opponent, event, 'mm-simple-opponent-photo', 58, 68)}</span>
        <div class="mm-simple-match-copy">
          <small>${labels[index]}</small>
          <strong>${esc(opponent.name)}</strong>
          <span>${esc(opponent.record || '—')} · ${esc(rankText(opponent, event))}</span>
        </div>
      </li>`;
  }

  function fighterCard(entry, event) {
    const fighter = fighterIndex.get(entry.id);
    if (!fighter || !fighter.active) return '';
    const ctx = context(event);
    const structuredHistoryEnabled = Boolean(data.sources?.meetings);
    const historyVerified = !structuredHistoryEnabled || fighter.meetingCoverage?.verified === true;
    const recommendations = historyVerified ? publicRecommendations(fighter, event) : [];
    const matchups = !historyVerified
      ? '<li class="mm-simple-no-match">Prior-opponent history is still being verified for this fighter.</li>'
      : recommendations.length
        ? recommendations.map((recommendation, index) => opponentRow(recommendation, event, index)).join('')
        : '<li class="mm-simple-no-match">No clear available matchup right now.</li>';

    return `
      <article class="mm-simple-file">
        <span class="mm-simple-pin" aria-hidden="true"></span>
        <header class="mm-simple-fighter-head">
          <span class="mm-simple-fighter-slot" aria-hidden="true">${photo(fighter, event, 'mm-simple-fighter-photo', 116, 132)}</span>
          <div>
            <p class="mm-simple-result mm-simple-result-${esc(String(entry.result || '').toLowerCase())}">${esc(resultText(entry.result))}</p>
            <h2>${esc(fighter.name)}</h2>
            <p class="mm-simple-fighter-meta">${esc(fighter.record || '—')} · ${esc(rankText(fighter, event))}</p>
            <p class="mm-simple-division">${esc(E.division(fighter, ctx))}</p>
          </div>
        </header>
        <div class="mm-simple-next-label"><span>Next plausible matchups</span></div>
        <ol class="mm-simple-matches">${matchups}</ol>
      </article>`;
  }

  function uniqueParticipants(event) {
    const seen = new Set();
    const list = [];
    for (const entry of event.bouts.flatMap(bout => bout.fighters || [])) {
      if (!entry?.id || seen.has(entry.id)) continue;
      seen.add(entry.id);
      list.push(entry);
    }
    return list;
  }

  function renderEvent(id) {
    const event = data.events.find(item => item.id === id) || data.events[0];
    if (!event) return;

    $('[data-mm-event]').value = event.id;
    $('[data-mm-event-name]').textContent = event.title || 'Completed UFC event';
    $('[data-mm-event-date]').textContent = event.date || '—';
    const source = $('[data-mm-event-source]');
    if (source && event.source) source.href = safeUrl(event.source);

    const participants = uniqueParticipants(event).filter(entry => fighterIndex.get(entry.id)?.active);
    $('[data-mm-grid]').innerHTML = participants.map(entry => fighterCard(entry, event)).join('') || '<p class="mm-simple-empty">No active fighters found for this event.</p>';
    $('[data-mm-count]').textContent = `${participants.length} FIGHTERS`;

    const url = new URL(location.href);
    url.searchParams.set('event', event.id);
    history.replaceState(null, '', url);
    status('');
  }

  async function load() {
    const local = root.dataset.feed;
    const live = root.dataset.liveFeed;
    let response;
    try {
      response = await fetch(local, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Local feed ${response.status}`);
    } catch {
      response = await fetch(live, { cache: 'no-store' });
    }
    if (!response.ok) throw new Error(`Matchmaker feed ${response.status}`);
    data = await response.json();
    if (!Array.isArray(data.events) || !Array.isArray(data.fighters)) throw new Error('Invalid Matchmaker data');
    fighterIndex = new Map(data.fighters.map(fighter => [fighter.id, fighter]));

    const select = $('[data-mm-event]');
    select.innerHTML = data.events.map(event => `<option value="${esc(event.id)}">${esc(event.title)} · ${esc(event.date)}</option>`).join('');
    select.addEventListener('change', () => renderEvent(select.value));

    const requested = new URL(location.href).searchParams.get('event');
    renderEvent(data.events.some(event => event.id === requested) ? requested : data.events[0]?.id);
    root.querySelector('[data-mm-app]').hidden = false;
  }

  try {
    await load();
  } catch (error) {
    console.error(error);
    status('Matchup recommendations are temporarily unavailable.');
  }
})();