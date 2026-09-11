(async function () {
  'use strict';
  const root = document.querySelector('[data-matchmaker]'); if (!root) return;
  const E = window.MatlockMatchmaker, $ = s => root.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const safeUrl = s => { try { const u = new URL(s, location.origin); return ['http:', 'https:'].includes(u.protocol) ? esc(u.href) : ''; } catch { return ''; } };
  const STORAGE = 'matlock-matchmaker-v1', clone = x => JSON.parse(JSON.stringify(x));
  let fighterIndex = new Map(), restoredRemoved = 0;
  let data, event, selected, locks = [], overrides = {}, undo = [], detailId, store = { boards: {}, archives: [] }, storageOK = true, filter = 'all';
  const status = message => { $('[data-mm-status]').textContent = message; };
  try { const saved = localStorage.getItem(STORAGE); if (saved) { const parsed = JSON.parse(saved); if (parsed.boards && Array.isArray(parsed.archives)) store = parsed; } } catch { storageOK = false; }
  function save() {
    store.boards[event.id] = { version: 1, eventId: event.id, locks, overrides, selected, dataAsOf: data.generatedAt };
    try { localStorage.setItem(STORAGE, JSON.stringify(store)); } catch { storageOK = false; status('Browser storage is unavailable or full. Export or share your board before leaving.'); }
  }
  const ctx = () => ({ event, asOf: data.generatedAt, locks, overrides });
  const fighter = id => fighterIndex.get(id);
  const rankText = f => { const r = E.rank(f, ctx()); return r === 0 ? 'Champion' : r === null ? 'Unranked' : `#${r}`; };
  const participants = () => event.bouts.flatMap(b => b.fighters).filter(f => fighter(f.id)?.active);
  const visible = () => participants().filter(f => filter === 'all' || filter === 'open' && !locks.some(p => p.a === f.id || p.b === f.id) || filter === 'available' && !E.availability(fighter(f.id), ctx()) || filter === 'booked' && !!fighter(f.id).booking || f.result === filter);
  const placeholder = large => `<span class="${large ? 'mm-portrait' : 'mm-avatar'} mm-photo-placeholder" aria-hidden="true"><svg viewBox="0 0 160 180"><ellipse cx="80" cy="57" rx="28" ry="35"/><path d="M22 180v-42q0-29 34-38l24 14 24-14q34 9 34 38v42z"/></svg></span>`;
  const avatar = (f, large = false) => { const photo = event?.bouts.flatMap(b => b.fighters).find(entry => entry.id === f.id)?.image || f.image; return photo ? `<img class="${large ? 'mm-portrait' : 'mm-avatar'}" src="${safeUrl(photo)}" alt="" width="${large ? 240 : 48}" height="${large ? 180 : 58}" loading="lazy" decoding="async" data-mm-image>` : placeholder(large); };
  function bindImages() { root.querySelectorAll('[data-mm-image]').forEach(img => { img.onload = () => requestAnimationFrame(drawStrings); img.onerror = () => { img.outerHTML = placeholder(img.classList.contains('mm-portrait')); requestAnimationFrame(drawStrings); }; }); }
  function transaction(fn) { undo.push(clone({ locks, overrides })); if (undo.length > 30) undo.shift(); fn(); save(); render(); }
  function cleanOverrides(value) {
    const result = {}, divisions = new Set(data.fighters.map(f => f.division).filter(Boolean));
    for (const [id, o] of Object.entries(value || {})) if (fighter(id) && o && typeof o === 'object') result[id] = { allowRematch: o.allowRematch === true, unavailable: typeof o.unavailable === 'string' ? o.unavailable.slice(0, 120) : '', ...(divisions.has(o.division) ? { division: o.division } : {}) };
    return result;
  }
  function setEvent(id) {
    event = data.events.find(e => e.id === id) || data.events[0];
    const saved = store.boards[event.id]; restoredRemoved = 0; locks = []; overrides = {}; undo = [];
    if (saved) try { E.validateBoard(saved, data); overrides = cleanOverrides(saved.overrides); locks = saved.locks.filter(p => fighter(p.a)?.active && fighter(p.b)?.active && !fighter(p.a).booking && !fighter(p.b).booking); restoredRemoved = saved.locks.length - locks.length; } catch { status('Could not restore this board.'); }
    selected = participants().some(f => f.id === saved?.selected) ? saved.selected : participants().find(f => !E.availability(fighter(f.id), ctx()))?.id || participants()[0]?.id;
    $('[data-mm-event]').value = event.id;
    const sourceLink = $('[data-mm-event-source]'); if (sourceLink) sourceLink.href = event.source;
    const url = new URL(location.href); url.searchParams.set('event', event.id); history.replaceState(null, '', url); render();
  }
  function render() {
    const f = fighter(selected); if (!f) return;
    const list = visible();
    $('[data-mm-fighter-count]').textContent = `${list.length} / ${participants().length}`;
    $('[data-mm-fighters]').innerHTML = list.length ? list.map(entry => {
      const item = fighter(entry.id), paired = locks.find(p => p.a === entry.id || p.b === entry.id);
      return `<button class="mm-fighter" data-select="${esc(item.id)}" aria-pressed="${item.id === selected}">${avatar(item)}<span><strong>${esc(item.name)}</strong><span class="mm-meta">${esc(item.record || '—')} · ${esc(rankText(item))}</span><span class="mm-result ${esc(entry.result)}">${entry.result === 'W' ? 'WIN' : entry.result === 'L' ? 'LOSS' : esc(entry.result)}${item.booking ? ' · BOOKED' : paired ? ' · LOCKED' : ''}</span></span></button>`;
    }).join('') : '<p class="mm-empty">No fighters in this view.</p>';
    $('[data-mm-division]').textContent = E.division(f, ctx());
    $('[data-mm-selected]').innerHTML = `<div class="mm-card mm-selected-card" data-mm-anchor>${avatar(f, true)}<h3>${esc(f.name)}</h3><p class="mm-record">${esc(f.record || '—')} <span>· ${esc(rankText(f))}</span></p></div>`;
    const paired = locks.find(p => p.a === f.id || p.b === f.id), unavailable = E.availability(f, ctx());
    if (paired) { const opponent = fighter(paired.a === f.id ? paired.b : paired.a); $('[data-mm-candidates]').innerHTML = `<div class="mm-card mm-locked-card">${avatar(opponent)}<h3>${esc(opponent.name)}</h3><p class="mm-record">${esc(opponent.record || '—')} · ${esc(rankText(opponent))}</p><button data-unlock="${esc(E.pairKey(paired.a, paired.b))}">Unlock match</button></div>`; }
    else if (unavailable) $('[data-mm-candidates]').innerHTML = `<div class="mm-empty">${esc(unavailable)}</div>`;
    else {
      const recs = E.recommendations(f, data.fighters, ctx());
      $('[data-mm-candidates]').innerHTML = recs.length ? recs.map(r => `<button class="mm-card mm-candidate" data-candidate="${esc(r.fighter.id)}" aria-label="Choose ${esc(r.fighter.name)}">${avatar(r.fighter)}<div><h3>${esc(r.fighter.name)}</h3><span class="mm-meta">${esc(r.fighter.record || '—')} · ${esc(rankText(r.fighter))}</span></div></button>`).join('') : '<p class="mm-empty">No available opponents.</p>';
    }
    $('[data-mm-count]').textContent = locks.length;
    $('[data-mm-undo]').disabled = !undo.length;
    const o = overrides[f.id] || {};
    $('[data-mm-rematch]').checked = o.allowRematch || false; $('[data-mm-exclude]').value = o.unavailable || '';
    $('[data-mm-division-override]').value = o.division || f.division || '';
    $('[data-mm-overrides]').innerHTML = Object.entries(overrides).filter(([, o]) => o.unavailable || o.allowRematch || o.division).map(([id, o]) => `<p class="mm-small">${esc(fighter(id).name)}: ${esc([o.unavailable, o.allowRematch ? 'rematches allowed' : '', o.division].filter(Boolean).join(' · '))} <button data-clear-override="${esc(id)}">Clear</button></p>`).join('');
    $('[data-mm-search]').value = ''; $('[data-mm-search-results]').innerHTML = '';
    root.querySelectorAll('.mm-card').forEach(card => { if (!card.querySelector('.mm-pin')) card.insertAdjacentHTML('afterbegin', '<span class="mm-pin" aria-hidden="true"></span>'); });
    bindImages(); requestAnimationFrame(drawStrings);
  }
  function drawStrings() {
    const wrapper = $('[data-mm-connections]'), svg = $('[data-mm-strings]'), anchor = $('[data-mm-anchor]');
    const bounds = wrapper.getBoundingClientRect(), from = anchor?.querySelector('.mm-pin')?.getBoundingClientRect(); if (!from) return;
    const x = from.left + from.width / 2 - bounds.left, y = from.top + from.height / 2 - bounds.top;
    svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    svg.innerHTML = [...root.querySelectorAll('.mm-candidate, .mm-locked-card')].map(el => { const r = el.querySelector('.mm-pin').getBoundingClientRect(), x2 = r.left + r.width / 2 - bounds.left, y2 = r.top + r.height / 2 - bounds.top; const sag = Math.min(36, Math.abs(x2 - x) * .08); return `<path class="mm-string-shadow" d="M${x},${y} Q${(x+x2)/2},${(y+y2)/2+sag+3} ${x2},${y2}"/><path class="mm-strings-path" d="M${x},${y} Q${(x+x2)/2},${(y+y2)/2+sag} ${x2},${y2}"/>`; }).join('');
  }
  function showDetail(id, manual = false) {
    const a = fighter(selected), b = fighter(id); if (!b) return;
    detailId = { id, manual }; const r = E.evaluate(a, b, ctx(), manual);
    $('[data-mm-detail-body]').innerHTML = `<h2>Lock matchup</h2><div class="mm-matchup-pair">${[a,b].map(f => `<div>${avatar(f,true)}<h3>${esc(f.name)}</h3><p>${esc(f.record || '—')} · ${esc(rankText(f))}</p></div>`).join('<span class="mm-vs">vs</span>')}</div>${r.eligible ? '<button class="mm-lock" data-mm-lock>Lock match</button>' : `<p class="mm-empty">${esc(r.reason)}</p>`}`;
    bindImages();
    $('[data-mm-detail]').showModal();
  }
  function search() {
    const query = E.normalize($('[data-mm-search]').value); if (!query) { $('[data-mm-search-results]').innerHTML = ''; return; }
    const a = fighter(selected);
    const matches = data.fighters.filter(f => f.active && f.id !== a.id && E.normalize(f.name).includes(query) && E.normalize(E.division(f, ctx())) === E.normalize(E.division(a, ctx()))).slice(0, 20);
    $('[data-mm-search-results]').innerHTML = matches.length ? matches.map(f => { const r = E.evaluate(a, f, ctx(), true); return `<button class="mm-search-row" draggable="${r.eligible}" data-manual="${esc(f.id)}" ${f.booking ? 'disabled' : ''}><span>${esc(f.name)}<span class="mm-meta">${esc(f.record || '—')} · ${esc(rankText(f))}</span></span><span>${f.booking ? 'Booked' : r.eligible ? 'Select' : 'Unavailable'}</span></button>`; }).join('') : '<p>No fighters found.</p>';
  }
  function bookingStatus(pair, createdAt) {
    const matching = data.bookings.filter(b => b.pairKey === E.pairKey(pair.a, pair.b));
    const booking = matching.find(b => Date.parse(b.firstSeen) > Date.parse(createdAt)) || matching[0];
    if (!booking) return null;
    const later = Date.parse(booking.firstSeen) > Date.parse(createdAt);
    return { later, text: later ? `✓ Official booking observed after this prediction: ${booking.event}` : `Official booking was already in the collected data: ${booking.event}` };
  }
  function boardData() { return { version: 1, eventId: event.id, eventTitle: event.title, createdAt: new Date().toISOString(), dataAsOf: data.generatedAt, locks: clone(locks), overrides: clone(overrides) }; }
  function renderBoard() {
    $('[data-mm-board-body]').innerHTML = `<p>${esc(event.title)} · ${esc(event.date)} · ${locks.length} matches</p>${locks.length ? locks.map(p => `<div class="mm-board-row"><div>${[fighter(p.a),fighter(p.b)].map(f => `<strong>${esc(f.name)}</strong><small>${esc(f.record || '—')} · ${esc(rankText(f))}</small>`).join('<span class="mm-board-vs">vs</span>')}</div><button data-unlock="${esc(E.pairKey(p.a, p.b))}">Unlock</button></div>`).join('') : '<p class="mm-empty">No matches locked yet.</p>'}`;
    $('[data-mm-freeze]').disabled = !locks.length; $('[data-mm-download]').disabled = !locks.length;
    const archives = store.archives.filter(b => b.eventId === event.id);
    $('[data-mm-archives]').innerHTML = archives.length ? `<h3>Frozen predictions on this device</h3>${archives.slice().reverse().map(b => { const hits = b.locks.filter(p => bookingStatus(p, b.createdAt)?.later).length; return `<details class="mm-archive"><summary>${esc(new Date(b.createdAt).toLocaleString())} · ${hits}/${b.locks.length} later observed bookings</summary><p class="mm-small">Frozen using data from ${esc(b.dataAsOf)}. Observation dates reflect when our collector first saw a booking.</p>${b.locks.map(p => `<p>${esc(fighter(p.a)?.name || p.a)} vs ${esc(fighter(p.b)?.name || p.b)}<br><small class="mm-frozen">${esc(bookingStatus(p, b.createdAt)?.text || 'No matching official booking observed.')}</small></p>`).join('')}</details>`; }).join('')}` : '';
  }
  function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
  function drawDownload() {
    const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350; const c = canvas.getContext('2d');
    c.fillStyle = '#111113'; c.fillRect(0, 0, 1080, 1350); c.fillStyle = '#ff4a54'; c.fillRect(48, 48, 80, 7);
    c.font = 'bold 22px Arial'; c.fillText('MMA MATLOCK / MATCHMAKER', 48, 102); c.fillStyle = '#fff'; c.font = 'bold 58px Arial'; c.fillText('THE NEXT FIGHT', 48, 180);
    c.fillStyle = '#bbb'; c.font = '25px Arial'; c.fillText(`${event.title} · ${event.date}`, 48, 227, 980);
    const rowH = Math.min(115, 950 / Math.max(locks.length, 1));
    locks.forEach((p, i) => { const y = 280 + i * rowH; c.strokeStyle = '#39393e'; c.beginPath(); c.moveTo(48, y + rowH - 10); c.lineTo(1032, y + rowH - 10); c.stroke(); c.font = `bold ${Math.min(30, rowH * .42)}px Arial`; c.fillStyle = '#f5f5f5'; c.fillText(fighter(p.a).name, 48, y + rowH * .45, 410); c.fillText(fighter(p.b).name, 608, y + rowH * .45, 425); c.fillStyle = '#ff4a54'; c.fillText('VS', 510, y + rowH * .45); });
    c.fillStyle = '#999'; c.font = '20px Arial'; c.fillText('FAN MATCHMAKING · NOT AN OFFICIAL UFC CARD', 48, 1280); c.fillText('mmamatlock.com/matchmaker', 48, 1310);
    canvas.toBlob(blob => { if (blob) download(blob, `matlock-${event.id}-matchmaking.png`); else $('[data-mm-board-status]').textContent = 'Image export failed. Try exporting the board JSON.'; }, 'image/png');
  }
  root.addEventListener('click', async e => {
    const button = e.target.closest('button'); if (!button) return;
    try {
      if (button.dataset.select) { selected = button.dataset.select; save(); render(); }
      else if (button.dataset.candidate) showDetail(button.dataset.candidate);
      else if (button.dataset.manual) showDetail(button.dataset.manual, true);
      else if (button.hasAttribute('data-mm-close')) button.closest('dialog').close();
      else if (button.hasAttribute('data-mm-lock')) { const p = E.lock(fighter(selected), fighter(detailId.id), ctx(), detailId.manual); transaction(() => locks.push(p)); $('[data-mm-detail]').close(); status(`Locked ${fighter(p.a).name} vs ${fighter(p.b).name}. Both fighters are reserved.`); }
      else if (button.dataset.unlock) { transaction(() => { locks = locks.filter(p => E.pairKey(p.a, p.b) !== button.dataset.unlock); }); if ($('[data-mm-board]').open) renderBoard(); }
      else if (button.hasAttribute('data-mm-next')) { const available = participants().filter(f => !E.availability(fighter(f.id), ctx())); const next = available[(available.findIndex(f => f.id === selected) + 1) % available.length]; if (next) { selected = next.id; save(); render(); } else status('No available fighters left.'); }
      else if (button.hasAttribute('data-mm-refresh')) { button.disabled = true; try { save(); const response = await fetch(root.dataset.liveFeed, { cache: 'no-store', signal: AbortSignal.timeout(10000) }); if (!response.ok) throw new Error('Could not refresh availability.'); const fresh = await response.json(); if (fresh.schemaVersion !== 1 || !fresh.fighters?.length || !fresh.events?.length) throw new Error('Invalid refresh data.'); data = fresh; fighterIndex = new Map(data.fighters.map(f => [f.id, f])); setEvent(event.id); save(); status(restoredRemoved ? `${restoredRemoved} unavailable matches removed. Undo history cleared.` : 'Availability refreshed.'); } finally { button.disabled = false; } }
      else if (button.hasAttribute('data-mm-undo')) { const prior = undo.pop(); if (prior) { locks = prior.locks; overrides = prior.overrides; save(); render(); status('Last board change undone.'); } }
      else if (button.hasAttribute('data-mm-auto')) { button.disabled = true; status('Finding unique matchups…'); await new Promise(resolve => setTimeout(resolve, 20)); const result = E.autoMatch(data.fighters, ctx(), visible().map(f => f.id)); if (result.pairs.length) transaction(() => locks.push(...result.pairs)); status(`Added ${result.pairs.length} matches.`); button.disabled = false; }
      else if (button.hasAttribute('data-mm-apply')) { if (locks.some(p => p.a === selected || p.b === selected)) throw new Error('Unlock this fighter’s match before changing their overrides.'); transaction(() => { overrides[selected] = { division: $('[data-mm-division-override]').value, allowRematch: $('[data-mm-rematch]').checked, unavailable: $('[data-mm-exclude]').value.trim() }; }); status('Board overrides applied.'); }
      else if (button.dataset.clearOverride) { const id = button.dataset.clearOverride; if (locks.some(p => p.a === id || p.b === id)) throw new Error('Unlock this fighter before clearing the override.'); transaction(() => { delete overrides[id]; }); }
      else if (button.hasAttribute('data-mm-completed')) { renderBoard(); $('[data-mm-board]').showModal(); }
      else if (button.hasAttribute('data-mm-freeze')) { const frozen = boardData(); store.archives.push(frozen); save(); renderBoard(); $('[data-mm-board-status]').textContent = 'Prediction frozen on this device. Later edits affect only your working board.'; }
      else if (button.hasAttribute('data-mm-share')) { const b = boardData(); b.locks = b.locks.map(({ a, b, manual }) => ({ a, b, manual })); const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(b)))); const url = new URL(location.href); url.hash = 'board=' + encodeURIComponent(encoded); if (url.href.length > 24000) throw new Error('This board is too large for a reliable share URL. Export JSON instead.'); try { await navigator.clipboard.writeText(url.href); $('[data-mm-board-status]').textContent = 'Share URL copied. Anyone with the link can open a copy of this board.'; } catch { const area = document.createElement('textarea'); area.value = url.href; area.setAttribute('aria-label', 'Copy this board link'); $('[data-mm-board-status]').replaceChildren(area); area.select(); } }
      else if (button.hasAttribute('data-mm-download')) drawDownload();
      else if (button.hasAttribute('data-mm-json')) download(new Blob([JSON.stringify(boardData(), null, 2)], { type: 'application/json' }), `${event.id}-matchmaking.json`);
    } catch (error) { if (button.hasAttribute('data-mm-auto')) button.disabled = false; if ($('[data-mm-board]').open) $('[data-mm-board-status]').textContent = error.message; else status(error.message); }
  });
  $('[data-mm-event]').addEventListener('change', e => { save(); setEvent(e.target.value); });
  $('[data-mm-filter]').addEventListener('change', e => { filter = e.target.value; render(); });
  $('[data-mm-search]').addEventListener('input', search);
  root.addEventListener('dragstart', e => { const el = e.target.closest('[data-manual]'); if (el) e.dataTransfer.setData('text/plain', el.dataset.manual); });
  $('[data-mm-selected]').addEventListener('dragover', e => e.preventDefault());
  $('[data-mm-selected]').addEventListener('drop', e => { e.preventDefault(); showDetail(e.dataTransfer.getData('text/plain'), true); });
  try {
    async function loadData(url) { const response = await fetch(url, { signal: AbortSignal.timeout(10000) }); if (!response.ok) throw new Error('Could not load Matchmaker data. Please try again shortly.'); const payload = await response.json(); if (payload.schemaVersion !== 1 || !payload.events?.length || !payload.fighters?.length) throw new Error('Invalid Matchmaker data.'); return payload; }
    try { data = await loadData(root.dataset.liveFeed); } catch { data = await loadData(root.dataset.feed); }
    if (data.schemaVersion !== 1 || !data.events?.length || !data.fighters?.length) throw new Error('The Matchmaker data is unavailable.');
    fighterIndex = new Map(data.fighters.map(f => [f.id, f]));
    $('[data-mm-event]').innerHTML = data.events.map(e => `<option value="${esc(e.id)}">${esc(e.title)} · ${esc(e.date)}</option>`).join('');
    $('[data-mm-division-override]').innerHTML = [...new Set(data.fighters.map(f => f.division).filter(Boolean))].sort().map(d => `<option>${esc(d)}</option>`).join('');
    let eventId = new URL(location.href).searchParams.get('event'), sharedMessage = '';
    if (location.hash.startsWith('#board=')) {
      try { if (location.hash.length > 30000) throw new Error('Shared board is too large.'); const binary = atob(decodeURIComponent(location.hash.slice(7))); const shared = E.validateBoard(JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)))), data); store.boards[shared.eventId] = { ...shared, overrides: cleanOverrides(shared.overrides) }; eventId = shared.eventId; sharedMessage = ' Shared board loaded as a working copy.'; history.replaceState(null, '', location.pathname + location.search); }
      catch (e) { sharedMessage = ` Shared board rejected: ${e.message}`; }
    }
    setEvent(eventId); $('[data-mm-app]').hidden = false;
    const age = Math.floor((Date.now() - Date.parse(data.generatedAt)) / 86400000);
    status(`${age > 2 ? 'Data is ' + age + ' days old; bookings may have changed.' : ''}${restoredRemoved ? restoredRemoved + ' unavailable matches removed. ' : ''}${sharedMessage}${!storageOK ? ' Device saving unavailable.' : ''}`);
    $('[data-mm-sources]').innerHTML = `Sources: <a href="${safeUrl(data.sources.rankings.url)}">UFC rankings</a> · <a href="${safeUrl(data.sources.roster.url)}">Verified site roster</a> · <a href="${safeUrl(event.source)}" data-mm-event-source>Official event results</a> · <a href="https://www.ufc.com/events">Upcoming UFC cards</a><br>Rankings collected ${esc(data.sources.rankings.checkedAt.slice(0, 10))}; roster checked ${esc(data.sources.roster.checkedAt.slice(0, 10))}. Profile history is partial evidence. Boards save on this device; no account required.`;
    new ResizeObserver(drawStrings).observe($('[data-mm-connections]'));
  } catch (error) { status(error.message || 'The Matchmaker could not load. Please try again shortly.'); }
})();
