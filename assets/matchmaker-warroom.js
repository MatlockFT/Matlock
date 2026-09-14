(function () {
  'use strict';

  const E = window.MatlockMatchmaker;
  if (!E) return;

  const nativeFetch = window.fetch.bind(window);
  let root = null;
  let data = null;
  let frame = 0;
  let lastCandidateId = '';
  let lastManual = false;

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const esc = value => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  function isMatchmakerFeed(input) {
    const url = typeof input === 'string' ? input : input?.url;
    return /(?:^|\/)assets\/data\/matchmaker\/current\.json(?:[?#]|$)/i.test(String(url || ''));
  }

  window.fetch = async function (...args) {
    const response = await nativeFetch(...args);
    if (response.ok && isMatchmakerFeed(args[0])) {
      response.clone().json().then(next => {
        if (!next?.events || !next?.fighters) return;
        data = next;
        window.MatlockMatchmakerWarRoomData = next;
        schedule();
      }).catch(() => {});
    }
    return response;
  };

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      enhance();
    });
  }

  function setText(selector, value) {
    const node = root?.querySelector(selector);
    if (node && node.textContent !== String(value)) node.textContent = String(value);
  }

  function setWidth(selector, value) {
    const node = root?.querySelector(selector);
    if (node && node.style.width !== value) node.style.width = value;
  }

  function storeBoard(eventId) {
    try {
      const saved = JSON.parse(localStorage.getItem('matlock-matchmaker-v1') || '{}');
      return saved?.boards?.[eventId] || { locks: [], overrides: {} };
    } catch {
      return { locks: [], overrides: {} };
    }
  }

  function currentEvent() {
    if (!data || !root) return null;
    const id = root.querySelector('[data-mm-event]')?.value;
    return data.events.find(item => item.id === id) || data.events[0] || null;
  }

  function fighterIndex() {
    return new Map((data?.fighters || []).map(fighter => [fighter.id, fighter]));
  }

  function selectedId(event) {
    const pressed = root.querySelector('.mm-fighter[aria-pressed="true"]')?.dataset.select;
    if (pressed) return pressed;
    const board = storeBoard(event?.id);
    if (board.selected) return board.selected;
    const name = clean(root.querySelector('[data-mm-selected] h3')?.textContent);
    if (!name) return '';
    return data.fighters.find(fighter => clean(fighter.name) === name)?.id || '';
  }

  function context(event) {
    const board = storeBoard(event.id);
    return {
      event,
      asOf: data.generatedAt,
      locks: Array.isArray(board.locks) ? board.locks : [],
      overrides: board.overrides && typeof board.overrides === 'object' ? board.overrides : {}
    };
  }

  function eventParticipantIds(event) {
    return new Set((event?.bouts || []).flatMap(bout => bout.fighters || []).map(fighter => fighter.id));
  }

  function formatAsOf(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return clean(value) || '—';
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  }

  function targetText(fighter, ctx) {
    const range = E.targetRange(fighter, ctx);
    const label = value => value <= 15 ? `#${value}` : 'UNRANKED';
    return `${label(range[0])}–${label(range[1])}`;
  }

  function streakText(fighter) {
    const streak = E.streak(fighter);
    if (!streak) return 'EVEN';
    return streak > 0 ? `W${streak}` : `L${Math.abs(streak)}`;
  }

  function updateCommandDeck(event, selected, ctx) {
    const ids = eventParticipantIds(event);
    const used = new Set();
    for (const pair of ctx.locks || []) {
      if (ids.has(pair.a)) used.add(pair.a);
      if (ids.has(pair.b)) used.add(pair.b);
    }
    const total = ids.size;
    const assigned = used.size;
    const open = Math.max(0, total - assigned);
    const percent = total ? Math.round(assigned / total * 100) : 0;

    setText('[data-mm-event-name]', event.title || 'Completed UFC event');
    setText('[data-mm-event-date]', event.date || '—');
    setText('[data-mm-stat-fighters]', total);
    setText('[data-mm-stat-open]', open);
    setText('[data-mm-stat-locked]', (ctx.locks || []).length);
    setText('[data-mm-stat-asof]', formatAsOf(data.generatedAt));
    setText('[data-mm-progress-copy]', `${assigned} OF ${total} EVENT FIGHTERS ASSIGNED`);
    setWidth('[data-mm-progress-bar]', `${percent}%`);

    const steps = [...root.querySelectorAll('[data-mm-step]')];
    const current = !selected ? 1 : open === 0 && total > 0 ? 3 : assigned > 0 ? 2 : 1;
    const complete = [true, Boolean(selected), assigned > 0, open === 0 && total > 0];
    steps.forEach((step, index) => {
      step.classList.toggle('is-complete', complete[index]);
      step.classList.toggle('is-current', index === current);
    });
  }

  function enhanceSelected(fighter, ctx) {
    const card = root.querySelector('.mm-selected-card');
    if (!card) return;
    const signature = `${fighter.id}:${E.rank(fighter, ctx)}:${E.streak(fighter)}:${E.division(fighter, ctx)}`;
    if (card.dataset.warroomIntel === signature) return;
    card.dataset.warroomIntel = signature;
    card.querySelector('.mm-selected-intel')?.remove();
    card.querySelector('.mm-file-stamp')?.remove();

    const tags = E.tags(fighter, ctx).slice(0, 3);
    const rank = E.rank(fighter, ctx);
    card.insertAdjacentHTML('beforeend', `
      <span class="mm-file-stamp" aria-hidden="true">ACTIVE FILE</span>
      <div class="mm-selected-intel">
        <div class="mm-intel-grid">
          <span><b>TIER</b>${esc(E.tier(fighter, ctx))}</span>
          <span><b>FORM</b>${esc(streakText(fighter))}</span>
          <span><b>RANK</b>${rank === 0 ? 'CHAMP' : rank == null ? 'UR' : `#${rank}`}</span>
          <span><b>TARGET</b>${esc(targetText(fighter, ctx))}</span>
        </div>
        ${tags.length ? `<div class="mm-tag-row">${tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div>` : ''}
        <p class="mm-file-note">Last listed fight: <strong>${esc(fighter.lastFight || 'UNKNOWN')}</strong></p>
      </div>`);
  }

  function enhanceCandidates(selected, ctx, index) {
    const cards = [...root.querySelectorAll('.mm-candidate')];
    const labels = ['PRIMARY TARGET', 'ALTERNATIVE', 'SWING FIGHT'];
    cards.forEach((card, position) => {
      const id = card.dataset.candidate;
      const opponent = index.get(id);
      if (!opponent) return;
      const result = E.evaluate(selected, opponent, ctx, false);
      if (!result.eligible) return;
      const signature = `${selected.id}:${id}:${result.score}:${result.rationale}`;
      if (card.dataset.warroomIntel === signature) return;
      card.dataset.warroomIntel = signature;
      card.querySelector('.mm-candidate-intel')?.remove();
      const tags = E.tags(opponent, ctx).slice(0, 2);
      card.insertAdjacentHTML('beforeend', `
        <span class="mm-candidate-intel">
          <span class="mm-candidate-head"><b>${labels[position] || 'TARGET'}</b><strong>${result.score}<small>/100</small></strong></span>
          <span class="mm-score-track" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, result.score))}%"></i></span>
          <span class="mm-candidate-rationale">${esc(result.rationale)}</span>
          ${tags.length ? `<span class="mm-tag-row">${tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</span>` : ''}
          <span class="mm-open-file">OPEN CASE FILE →</span>
        </span>`);
    });
  }

  function scoreBreakdown(result) {
    return Object.entries(E.WEIGHTS).map(([key, max]) => {
      const value = Number(result.parts?.[key] || 0);
      const width = max ? Math.round(value / max * 100) : 0;
      return `<div class="mm-score-line"><span>${esc(key)}</span><i><b style="width:${width}%"></b></i><strong>${Math.round(value)}/${max}</strong></div>`;
    }).join('');
  }

  function enhanceDetail(selected, ctx, index) {
    const dialog = root.querySelector('[data-mm-detail]');
    const body = root.querySelector('[data-mm-detail-body]');
    if (!dialog?.open || !body || !lastCandidateId) return;
    const opponent = index.get(lastCandidateId);
    if (!opponent) return;
    const result = E.evaluate(selected, opponent, ctx, lastManual);
    const signature = `${selected.id}:${opponent.id}:${result.eligible}:${result.score || 0}:${lastManual}`;
    if (body.dataset.warroomCase === signature) return;
    body.dataset.warroomCase = signature;
    body.querySelector('.mm-casefile')?.remove();
    if (!result.eligible) return;

    body.insertAdjacentHTML('beforeend', `
      <section class="mm-casefile" aria-label="Matchup case file">
        <header><div><span>BOOKING CASE / ${lastManual ? 'MANUAL TARGET' : 'ENGINE TARGET'}</span><h3>Why this fight works</h3></div><strong>${result.score}<small>/100</small></strong></header>
        <p class="mm-case-rationale">${esc(result.rationale)}</p>
        <div class="mm-case-columns">
          <div class="mm-score-sheet"><h4>Fit breakdown</h4>${scoreBreakdown(result)}</div>
          <div class="mm-evidence-sheet"><h4>Evidence</h4><ul>${(result.evidence || []).map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>
        </div>
        <footer><span>${result.rematch?.meetings?.length ? 'REMATCH FILE' : 'NO PRIOR MEETING FOUND'}</span><span>${result.ambitious ? 'UPWARD MOVE' : 'COMPETITIVE RANGE'}</span></footer>
      </section>`);
  }

  function enhanceBoard(event, ctx, index) {
    const dialog = root.querySelector('[data-mm-board]');
    if (!dialog?.open) return;
    const rows = [...dialog.querySelectorAll('.mm-board-row')];
    const saved = storeBoard(event.id);
    const locks = Array.isArray(saved.locks) ? saved.locks : [];
    rows.forEach(row => {
      const key = row.querySelector('[data-unlock]')?.dataset.unlock;
      if (!key) return;
      const pair = locks.find(lock => E.pairKey(lock.a, lock.b) === key);
      if (!pair) return;
      const signature = `${key}:${pair.score || ''}:${pair.rationale || ''}`;
      if (row.dataset.warroomIntel === signature) return;
      row.dataset.warroomIntel = signature;
      row.querySelector('.mm-board-intel')?.remove();
      const a = index.get(pair.a), b = index.get(pair.b);
      const score = pair.score ?? (a && b ? E.evaluate(a, b, { ...ctx, locks: [] }, Boolean(pair.manual)).score : null);
      row.insertAdjacentHTML('beforeend', `<div class="mm-board-intel"><span>LOCKED ORDER ${score != null ? `· FIT ${esc(score)}/100` : ''}</span><p>${esc(pair.rationale || 'Matchup locked to this board.')}</p></div>`);
    });
  }

  function enhance() {
    root = root || document.querySelector('[data-matchmaker]');
    data = data || window.MatlockMatchmakerWarRoomData || null;
    if (!root || !data) return;
    const event = currentEvent();
    if (!event) return;
    const index = fighterIndex();
    const id = selectedId(event);
    const selected = index.get(id);
    if (!selected) return;
    const ctx = context(event);

    updateCommandDeck(event, selected, ctx);
    enhanceSelected(selected, ctx);
    enhanceCandidates(selected, ctx, index);
    enhanceDetail(selected, ctx, index);
    enhanceBoard(event, ctx, index);
  }

  function bind() {
    root = document.querySelector('[data-matchmaker]');
    if (!root) return;

    root.addEventListener('click', event => {
      const candidate = event.target.closest('[data-candidate], [data-manual]');
      if (candidate) {
        lastCandidateId = candidate.dataset.candidate || candidate.dataset.manual || '';
        lastManual = Boolean(candidate.dataset.manual);
      }
      schedule();
    }, true);
    root.addEventListener('change', schedule, true);
    root.addEventListener('input', event => {
      if (event.target.matches('[data-mm-search], [data-mm-exclude]')) schedule();
    }, true);

    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'open', 'hidden'] });
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
