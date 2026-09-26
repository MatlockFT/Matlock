  function insertAtCursor(before, after = '', placeholder = '') {
  const start = bodyEditor.selectionStart;
  const end = bodyEditor.selectionEnd;
  const hasSelection = end > start;
  const selected = bodyEditor.value.slice(start, end) || placeholder;
  const inserted = `${before}${selected}${after}`;
  bodyEditor.setRangeText(inserted, start, end, 'end');
  bodyEditor.focus();
  if (!hasSelection && placeholder) {
    bodyEditor.setSelectionRange(start + before.length, start + before.length + placeholder.length);
  } else {
    const cursor = start + inserted.length;
    bodyEditor.setSelectionRange(cursor, cursor);
  }
  scheduleAutosave();
  updatePreview();
}

function insertQuoteBlock() {
  const start = bodyEditor.selectionStart;
  const end = bodyEditor.selectionEnd;
  if (end <= start) return insertAtCursor('> ', '', 'Quote');

  const selected = bodyEditor.value.slice(start, end).replace(/\r\n?/g, '\n');
  const lines = selected.split('\n');
  const meaningful = lines.filter(line => line.trim());
  const alreadyQuoted = meaningful.length > 0 && meaningful.every(line => /^\s*>\s?/.test(line));
  const transformed = lines.map(line => {
    if (alreadyQuoted) return line.replace(/^(\s*)>\s?/, '$1');
    if (!line.trim()) return '>';
    return `> ${line}`;
  }).join('\n');

  bodyEditor.setRangeText(transformed, start, end, 'select');
  bodyEditor.focus();
  scheduleAutosave();
  updatePreview();
}

function insertBlock(text) {
  const start = bodyEditor.selectionStart;
  const end = bodyEditor.selectionEnd;
  const before = bodyEditor.value.slice(0, start);
  const after = bodyEditor.value.slice(end);
  const prefix = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = !after ? '\n\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const inserted = `${prefix}${String(text).trim()}${suffix}`;
  bodyEditor.setRangeText(inserted, start, end, 'end');
  bodyEditor.focus();
  const cursor = start + inserted.length;
  bodyEditor.setSelectionRange(cursor, cursor);
  scheduleAutosave();
  updatePreview();
}

  function youtubeId(value) {
    try {
      const u = new URL(value);
      if (u.hostname === 'youtu.be') return u.pathname.split('/').filter(Boolean)[0] || '';
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const match = u.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/);
      return match ? match[1] : '';
    } catch { return /^[A-Za-z0-9_-]{6,}$/.test(value) ? value : ''; }
  }

  function xStatusUrl(value) {
    try {
      const u = new URL(value);
      const host = u.hostname.toLowerCase();
      const allowedHosts = ['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com'];
      if (!allowedHosts.includes(host)) return '';
      const match = u.pathname.match(/^\/(.+?)\/status\/(\d+)/i);
      if (!match) return '';
      return `https://x.com/${match[1]}/status/${match[2]}`;
    } catch {
      return '';
    }
  }

  function loadPreviewXWidgets(container) {
    const render = () => {
      if (window.twttr?.widgets) window.twttr.widgets.load(container);
    };
    if (window.twttr?.widgets) {
      render();
      return;
    }
    let script = document.querySelector('script[src="https://platform.x.com/widgets.js"]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://platform.x.com/widgets.js';
      script.async = true;
      script.charset = 'utf-8';
      document.body.appendChild(script);
    }
    script.addEventListener('load', render, { once: true });
  }

  function hydratePreviewXEmbeds() {
    if (!previewContent) return;
    let found = false;
    [...previewContent.querySelectorAll('a')].forEach(link => {
      if (link.textContent.trim().toUpperCase() !== 'EMBED X') return;
      const cleanUrl = xStatusUrl(link.href);
      if (!cleanUrl) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'writer-x-embed';
      wrapper.dataset.writerXUrl = cleanUrl;

      const blockquote = document.createElement('blockquote');
      blockquote.className = 'twitter-tweet';
      blockquote.dataset.dnt = 'true';
      blockquote.dataset.theme = 'dark';

      const xLink = document.createElement('a');
      xLink.href = cleanUrl;
      xLink.textContent = 'View post on X';
      blockquote.appendChild(xLink);
      wrapper.appendChild(blockquote);

      const paragraph = link.closest('p');
      if (paragraph && paragraph.textContent.trim().toUpperCase() === 'EMBED X') paragraph.replaceWith(wrapper);
      else link.replaceWith(wrapper);
      found = true;
    });
    if (found) loadPreviewXWidgets(previewContent);
  }

  function handleSimpleInsert(type) {
    if (type === 'h2') return insertAtCursor('## ', '', 'Section heading');
    if (type === 'bold') return insertAtCursor('**', '**', 'bold text');
    if (type === 'italic') return insertAtCursor('*', '*', 'italic text');
    if (type === 'quote') return insertQuoteBlock();
    if (type === 'divider') return insertBlock('---');
  }

  let editingStructuredBlockId = '';

  const taleDefaultRowLabels = [
    'Record','Age','Height','Arm Reach','UFC Record','Record Outside UFC',
    'Total Finishes','TKO / KO','Submission','Unanimous Decision','Split Decision'
  ];

  const statsDefaultRowLabels = [
    'Significant Strikes / Minute',
    'Sig. Strikes Absorbed / Minute',
    'Striking Accuracy',
    'Striking Defense',
    'Takedowns / 15 Minutes',
    'Takedown Accuracy',
    'Takedown Defense',
    'Submission Attempts / 15'
  ];

  const taleDefaultRows = taleDefaultRowLabels.map(label => label + ' |  | ').join('\n');

  function structuredMeta(code) {
    const source = String(code || '');
    const type = source.match(/data-writer-block="(stats|tale|pick)"/)?.[1] || '';
    const raw = source.match(/data-writer-config="([^"]+)"/)?.[1] || '';
    if (!type || !raw) return null;
    try { return { type, config: JSON.parse(decodeURIComponent(raw)) }; }
    catch { return null; }
  }

  function encodedStructuredConfig(config) {
    return encodeURIComponent(JSON.stringify(config || {}));
  }

  function pipeRows(text, width = 3) {
    return String(text || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const cells = line.split('|').map(cell => cell.trim());
      while (cells.length < width) cells.push('');
      return cells.slice(0, width);
    });
  }

  function normalizeComparisonRows(value, fallbackLabels = []) {
    if (Array.isArray(value)) {
      const rows = value.map(row => {
        if (Array.isArray(row)) return { label: row[0] || '', a: row[1] || '', b: row[2] || '' };
        return {
          label: String(row?.label ?? row?.stat ?? ''),
          a: String(row?.a ?? row?.left ?? row?.value ?? ''),
          b: String(row?.b ?? row?.right ?? row?.fighter ?? '')
        };
      }).filter(row => row.label || row.a || row.b);
      if (rows.length) return rows;
    }
    const legacy = pipeRows(value, 3).map(row => ({ label: row[0], a: row[1], b: row[2] }));
    if (legacy.length) return legacy;
    return fallbackLabels.map(label => ({ label, a: '', b: '' }));
  }

  function normalizeRecentRows(value) {
    if (Array.isArray(value)) {
      return value.map(row => ({
        result: String(row?.result || '').toUpperCase(),
        opponent: String(row?.opponent || ''),
        detail: String(row?.detail || '')
      })).filter(row => row.result || row.opponent || row.detail);
    }
    return pipeRows(value, 3).map(row => ({ result:String(row[0]||'').toUpperCase(), opponent:row[1]||'', detail:row[2]||'' }));
  }

  function comparisonRowElement(row = {}) {
    const item=document.createElement('div');
    item.className='writer-comparison-row';
    item.innerHTML='<input type="text" data-structured-label aria-label="Row label">'+
      '<input type="text" data-structured-a aria-label="Fighter A value">'+
      '<input type="text" data-structured-b aria-label="Fighter B value">'+
      '<div class="writer-row-actions">'+
      '<button type="button" data-structured-action="up" title="Move row up" aria-label="Move row up">↑</button>'+
      '<button type="button" data-structured-action="down" title="Move row down" aria-label="Move row down">↓</button>'+
      '<button type="button" data-structured-action="remove" title="Remove row" aria-label="Remove row">×</button></div>';
    item.querySelector('[data-structured-label]').value=row.label||'';
    item.querySelector('[data-structured-a]').value=row.a||'';
    item.querySelector('[data-structured-b]').value=row.b||'';
    return item;
  }

  function renderComparisonRows(container, value, fallbackLabels = []) {
    if (!container) return;
    const rows=normalizeComparisonRows(value,fallbackLabels);
    container.replaceChildren(...rows.map(comparisonRowElement));
  }

  function appendComparisonRow(container, row = {}) {
    if (!container) return;
    const item=comparisonRowElement(row);
    container.append(item);
    item.querySelector('[data-structured-label]')?.focus();
  }

  function collectComparisonRows(container) {
    if (!container) return [];
    return [...container.querySelectorAll('.writer-comparison-row')].map(item=>({
      label:item.querySelector('[data-structured-label]')?.value.trim()||'',
      a:item.querySelector('[data-structured-a]')?.value.trim()||'',
      b:item.querySelector('[data-structured-b]')?.value.trim()||''
    })).filter(row=>row.label||row.a||row.b);
  }

  function recentRowElement(row = {}) {
    const item=document.createElement('div');
    item.className='writer-recent-row';
    item.innerHTML='<select data-recent-result aria-label="Result"><option value="">—</option><option value="W">W</option><option value="L">L</option><option value="D">D</option><option value="NC">NC</option></select>'+
      '<input type="text" data-recent-opponent placeholder="Opponent" aria-label="Opponent">'+
      '<input type="text" data-recent-detail placeholder="DEC · JUN 14, 2025 · R3 5:00" aria-label="Fight detail">'+
      '<div class="writer-row-actions">'+
      '<button type="button" data-structured-action="up" title="Move fight up" aria-label="Move fight up">↑</button>'+
      '<button type="button" data-structured-action="down" title="Move fight down" aria-label="Move fight down">↓</button>'+
      '<button type="button" data-structured-action="remove" title="Remove fight" aria-label="Remove fight">×</button></div>';
    item.querySelector('[data-recent-result]').value=row.result||'';
    item.querySelector('[data-recent-opponent]').value=row.opponent||'';
    item.querySelector('[data-recent-detail]').value=row.detail||'';
    return item;
  }

  function renderRecentRows(container, value) {
    if(!container) return;
    container.replaceChildren(...normalizeRecentRows(value).map(recentRowElement));
  }

  function appendRecentRow(container, row = {}) {
    if(!container) return;
    const item=recentRowElement(row);
    container.append(item);
    item.querySelector('[data-recent-result]')?.focus();
  }

  function collectRecentRows(container) {
    if(!container) return [];
    return [...container.querySelectorAll('.writer-recent-row')].map(item=>({
      result:item.querySelector('[data-recent-result]')?.value||'',
      opponent:item.querySelector('[data-recent-opponent]')?.value.trim()||'',
      detail:item.querySelector('[data-recent-detail]')?.value.trim()||''
    })).filter(row=>row.result||row.opponent||row.detail);
  }

  function applyStructuredRowAction(button) {
    const action=button?.dataset?.structuredAction;
    const row=button?.closest('.writer-comparison-row, .writer-recent-row');
    if(!action||!row) return;
    if(action==='remove'){row.remove();return;}
    if(action==='up'&&row.previousElementSibling){row.parentElement.insertBefore(row,row.previousElementSibling);return;}
    if(action==='down'&&row.nextElementSibling){row.parentElement.insertBefore(row.nextElementSibling,row);}
  }

  function refreshStatsNameHeaders(dialog) {
    if(!dialog) return;
    ['a','b'].forEach(side=>{
      const value=dialog.querySelector('[data-stats-fighter="'+side+'"]')?.value.trim();
      const header=dialog.querySelector('[data-stats-name-header="'+side+'"]');
      if(header) header.textContent=value||(side==='a'?'Fighter A':'Fighter B');
    });
  }

  function refreshTaleNameHeaders(dialog) {
    if(!dialog) return;
    ['a','b'].forEach(side=>{
      const input=dialog.querySelector(side==='a'?'[data-tale-a]':'[data-tale-b]');
      const header=dialog.querySelector('[data-tale-name-header="'+side+'"]');
      if(header) header.textContent=input?.value.trim()||(side==='a'?'Fighter A':'Fighter B');
    });
  }

  function nearestMatchupNames() {
    const before=bodyEditor.value.slice(0,bodyEditor.selectionStart);
    const headings=[...before.matchAll(/^##\s+(.+)$/gm)];
    const title=headings.at(-1)?.[1]?.trim()||'';
    const match=title.match(/^(.+?)\s+(?:vs\.?|versus)\s+(.+)$/i);
    if(!match) return null;
    return { a:match[1].trim(), b:match[2].trim() };
  }

  function applyNearestMatchup(dialog,type) {
    const matchup=nearestMatchupNames();
    if(!matchup||!dialog) return;
    if(type==='stats'){
      const a=dialog.querySelector('[data-stats-fighter="a"]');
      const b=dialog.querySelector('[data-stats-fighter="b"]');
      if(a&&!a.value) a.value=matchup.a;
      if(b&&!b.value) b.value=matchup.b;
      refreshStatsNameHeaders(dialog);
      return;
    }
    if(type==='tale'){
      const a=dialog.querySelector('[data-tale-a]');
      const b=dialog.querySelector('[data-tale-b]');
      if(a&&!a.value) a.value=matchup.a;
      if(b&&!b.value) b.value=matchup.b;
      refreshTaleNameHeaders(dialog);
    }
  }

  let writerFighterDirectoryPromise = null;
  const writerFighterLiveCache = new Map();

  function normalizeFighterLookup(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  async function loadWriterFighterDirectory() {
    if (writerFighterDirectoryPromise) return writerFighterDirectoryPromise;

    const fetchJson = async url => {
      const response = await fetch(url, { cache:'no-store' });
      if (!response.ok) throw new Error('Could not load ' + url);
      return response.json();
    };

    writerFighterDirectoryPromise = (async () => {
      let data;
      let compact = true;
      try {
        data = await fetchJson('/assets/data/writer-fighters.json?writer-fighters=' + Date.now());
      } catch {
        compact = false;
        data = await fetchJson('/assets/data/matchmaker/current.json?writer-fighters=1');
      }

      return {
        generatedAt: data.generatedAt || '',
        builtAt: data.builtAt || data.generatedAt || '',
        mirrorThrough: data.mirrorThrough || '',
        fighters: (Array.isArray(data.fighters) ? data.fighters : []).map(fighter => ({
          id: fighter.id || '',
          name: fighter.name || '',
          division: fighter.division || '',
          record: fighter.record || '',
          ufcRecord: fighter.ufcRecord || '',
          recordOutsideUfc: fighter.recordOutsideUfc || '',
          rank: fighter.rank ?? null,
          image: fighter.image || '',
          checkedAt: fighter.checkedAt || data.generatedAt || '',
          statsBuiltAt: compact ? (data.builtAt || data.generatedAt || '') : '',
          history: compact
            ? (Array.isArray(fighter.recent) ? fighter.recent : [])
            : (Array.isArray(fighter.verifiedMeetings) && fighter.verifiedMeetings.length
              ? fighter.verifiedMeetings
              : (Array.isArray(fighter.history) ? fighter.history : [])),
          booking: fighter.booking || null,
          ufcStatsId: fighter.ufcStatsId || fighter.meetingCoverage?.ufcStatsId || '',
          sourceUrl: fighter.sourceUrl || fighter.meetingCoverage?.sourceUrl || '',
          mirrorThrough: fighter.mirrorThrough || fighter.meetingCoverage?.mirrorThrough || data.mirrorThrough || null,
          latestBoutDate: fighter.latestBoutDate || null,
          bio: fighter.bio || null,
          stats: fighter.stats || null
        })).filter(fighter => fighter.id && fighter.name)
      };
    })().catch(error => {
      writerFighterDirectoryPromise = null;
      throw error;
    });

    return writerFighterDirectoryPromise;
  }

  function writerFighterMatches(directory, query, limit = 8) {
    const needle = normalizeFighterLookup(query);
    if (!needle || needle.length < 2) return [];
    return directory.fighters.map(fighter => {
      const name = normalizeFighterLookup(fighter.name);
      let score = 9;
      if (name === needle) score = 0;
      else if (name.startsWith(needle)) score = 1;
      else if (name.split(' ').some(part => part.startsWith(needle))) score = 2;
      else if (name.includes(needle)) score = 3;
      else return null;
      return { fighter, score };
    }).filter(Boolean).sort((a,b) => a.score - b.score || a.fighter.name.localeCompare(b.fighter.name))
      .slice(0,limit).map(entry => entry.fighter);
  }

  function lookupStatusElement(input) {
    const host = input?.closest('.writer-field');
    if (!host) return null;
    let status = host.querySelector('.writer-fighter-source-status');
    if (!status) {
      status = document.createElement('small');
      status.className = 'writer-fighter-source-status';
      status.setAttribute('aria-live','polite');
      host.append(status);
    }
    return status;
  }

  function setLookupStatus(input, state, message) {
    const status = lookupStatusElement(input);
    if (!status) return;
    status.dataset.state = state || '';
    status.textContent = message || '';
  }

  function lookupMenuElement(input) {
    const host = input?.closest('.writer-field');
    if (!host) return null;
    host.classList.add('writer-fighter-lookup-field');
    let menu = host.querySelector('.writer-fighter-suggestions');
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'writer-fighter-suggestions';
      menu.setAttribute('role','listbox');
      menu.hidden = true;
      host.append(menu);
    }
    return menu;
  }

  function formatLookupDate(value) {
    if (!value) return 'unknown';
    const date = new Date(value + (String(value).length === 10 ? 'T12:00:00' : ''));
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  }

  function ageFromDob(value) {
    if (!value) return '';
    const dob = new Date(value);
    if (Number.isNaN(dob.getTime())) return '';
    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const beforeBirthday = now.getMonth() < dob.getMonth() ||
      now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate();
    if (beforeBirthday) age--;
    return age >= 0 && age < 100 ? String(age) : '';
  }

  function compactFightDetail(fight) {
    return [fight.method || '', fight.date ? formatLookupDate(fight.date) : ''].filter(Boolean).join(' · ');
  }

  function recentRowsFromFighter(fighter, liveProfile = null) {
    const live = Array.isArray(liveProfile?.recent) ? liveProfile.recent : [];
    const history = live.length ? live : (fighter.history || []);
    return history.slice(0,5).map(fight => ({
      result: fight.result || '',
      opponent: fight.opponent || fight.opponentName || '',
      detail: compactFightDetail(fight)
    })).filter(row => row.result || row.opponent);
  }

  function recordFromHistory(history, classes = null) {
    const counts = { W:0,L:0,D:0 };
    for (const fight of history || []) {
      if (classes && !classes.has(fight.competitionClass || 'ufc')) continue;
      if (Object.hasOwn(counts,fight.result)) counts[fight.result]++;
    }
    return (counts.W + counts.L + counts.D) ? counts.W + '-' + counts.L + '-' + counts.D : '';
  }

  function subtractRecords(overall, ufc) {
    const parse = value => String(value || '').match(/^(\d+)-(\d+)-(\d+)/)?.slice(1,4).map(Number);
    const total = parse(overall), inside = parse(ufc);
    if (!total || !inside) return '';
    const result = total.map((value,index) => Math.max(0,value - inside[index]));
    return result.join('-');
  }

  function lastFiveFromRows(rows) {
    return (rows || []).slice(0,5).map(row => row.result || '').filter(Boolean).join('');
  }

  function setComparisonValue(container, label, side, value) {
    if (!container || value === null || value === undefined || value === '') return;
    const wanted = normalizeFighterLookup(label);
    const row = [...container.querySelectorAll('.writer-comparison-row')].find(item =>
      normalizeFighterLookup(item.querySelector('[data-structured-label]')?.value) === wanted
    );
    if (!row) return;
    const input = row.querySelector(side === 'a' ? '[data-structured-a]' : '[data-structured-b]');
    if (input) input.value = String(value);
  }

  function fighterSourceMeta(input) {
    if (!input) return null;
    return {
      fighterId: input.dataset.fighterId || null,
      ufcStatsId: input.dataset.ufcStatsId || null,
      mode: input.dataset.sourceMode || null,
      fetchedAt: input.dataset.sourceFetchedAt || null,
      latestBoutDate: input.dataset.latestBoutDate || null,
      sourceUrl: input.dataset.sourceUrl || null
    };
  }

  async function fetchLiveWriterFighter(fighter) {
    if (!fighter?.ufcStatsId || !authBase) return null;
    const cached = writerFighterLiveCache.get(fighter.ufcStatsId);
    if (cached && Date.now() - cached.savedAt < 5 * 60 * 1000) return cached.data;
    const response = await fetch(authBase + '/api/writer/fighter?id=' + encodeURIComponent(fighter.ufcStatsId), {
      method:'GET',
      mode:'cors',
      cache:'no-store',
      headers:{Accept:'application/json'}
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.profile) throw new Error(data.error || 'Live UFCStats lookup failed.');
    writerFighterLiveCache.set(fighter.ufcStatsId,{savedAt:Date.now(),data});
    return data;
  }

  function applyCachedWriterFighter(dialog, type, side, fighter) {
    if (type === 'stats') {
      const input = dialog.querySelector('[data-stats-fighter="' + side + '"]');
      if (input) input.value = fighter.name;
      const rows = dialog.querySelector('[data-stats-row-list]');
      const values = [
        ['Significant Strikes / Minute',fighter.stats?.slpm],
        ['Sig. Strikes Absorbed / Minute',fighter.stats?.sapm],
        ['Striking Accuracy',fighter.stats?.strAccuracy],
        ['Striking Defense',fighter.stats?.strDefense],
        ['Takedowns / 15 Minutes',fighter.stats?.tdAvg],
        ['Takedown Accuracy',fighter.stats?.tdAccuracy],
        ['Takedown Defense',fighter.stats?.tdDefense],
        ['Submission Attempts / 15',fighter.stats?.subAvg]
      ];
      for (const [label,value] of values) setComparisonValue(rows,label,side,value);
      refreshStatsNameHeaders(dialog);
      return;
    }

    const nameInput = dialog.querySelector(side === 'a' ? '[data-tale-a]' : '[data-tale-b]');
    if (nameInput) nameInput.value = fighter.name;
    const division = dialog.querySelector('[data-tale-division="' + side + '"]');
    if (division && fighter.division) division.value = fighter.division;
    const image = dialog.querySelector('[data-tale-image-path="' + side + '"]');
    if (image && fighter.image) image.value = fighter.image;
    const recent = recentRowsFromFighter(fighter);
    renderRecentRows(dialog.querySelector('[data-tale-form-list="' + side + '"]'),recent);
    const last5 = dialog.querySelector('[data-tale-last5="' + side + '"]');
    if (last5 && recent.length) last5.value = lastFiveFromRows(recent);
    const rows = dialog.querySelector('[data-tale-row-list]');
    const ufcRecord = fighter.ufcRecord || recordFromHistory(fighter.history,new Set(['ufc']));
    setComparisonValue(rows,'Record',side,fighter.record);
    setComparisonValue(rows,'Age',side,ageFromDob(fighter.bio?.dob));
    setComparisonValue(rows,'Height',side,fighter.bio?.height);
    setComparisonValue(rows,'Arm Reach',side,fighter.bio?.reach);
    setComparisonValue(rows,'UFC Record',side,ufcRecord);
    setComparisonValue(rows,'Record Outside UFC',side,fighter.recordOutsideUfc || subtractRecords(fighter.record,ufcRecord));
    refreshTaleNameHeaders(dialog);
    taleImagePreview(side);
  }

  function applyLiveWriterFighter(dialog, type, side, fighter, payload) {
    const profile = payload?.profile || {};
    if (type === 'stats') {
      const rows = dialog.querySelector('[data-stats-row-list]');
      const values = [
        ['Significant Strikes / Minute',profile.stats?.slpm],
        ['Sig. Strikes Absorbed / Minute',profile.stats?.sapm],
        ['Striking Accuracy',profile.stats?.strAccuracy],
        ['Striking Defense',profile.stats?.strDefense],
        ['Takedowns / 15 Minutes',profile.stats?.tdAvg],
        ['Takedown Accuracy',profile.stats?.tdAccuracy],
        ['Takedown Defense',profile.stats?.tdDefense],
        ['Submission Attempts / 15',profile.stats?.subAvg]
      ];
      for (const [label,value] of values) setComparisonValue(rows,label,side,value);
      return;
    }

    const rows = dialog.querySelector('[data-tale-row-list]');
    const overall = profile.record || fighter.record || '';
    const ufcRecord = profile.ufcRecord || recordFromHistory(fighter.history,new Set(['ufc']));
    setComparisonValue(rows,'Record',side,overall);
    setComparisonValue(rows,'Age',side,ageFromDob(profile.dob));
    setComparisonValue(rows,'Height',side,profile.height);
    setComparisonValue(rows,'Arm Reach',side,profile.reach);
    setComparisonValue(rows,'UFC Record',side,ufcRecord);
    setComparisonValue(rows,'Record Outside UFC',side,subtractRecords(overall,ufcRecord));

    const recent = recentRowsFromFighter(fighter,profile);
    if (recent.length) {
      renderRecentRows(dialog.querySelector('[data-tale-form-list="' + side + '"]'),recent);
      const last5 = dialog.querySelector('[data-tale-last5="' + side + '"]');
      if (last5) last5.value = lastFiveFromRows(recent);
    }
  }

  function cachedSourceStateForFighter(fighter) {
    const latest = fighter.latestBoutDate || fighter.stats?.sample?.latestBoutDate || fighter.history?.[0]?.date || null;
    const bookingDate = fighter?.booking?.date || null;
    const todayValue = today();
    const pendingKnownFight = bookingDate && bookingDate <= todayValue && (!latest || latest < bookingDate);
    if (pendingKnownFight) {
      return {
        state:'warning',
        text:'Verified UFCStats mirror has not posted the known ' + formatLookupDate(bookingDate) +
          ' fight yet. Stats currently run through ' + formatLookupDate(latest || fighter.mirrorThrough) + '.'
      };
    }
    const refreshed = fighter.statsBuiltAt || fighter.checkedAt;
    return {
      state:'verified',
      text:'VERIFIED UFCStats mirror · stats through ' + formatLookupDate(latest || fighter.mirrorThrough) +
        (refreshed ? ' · refreshed ' + new Date(refreshed).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}) : '')
    };
  }

  function sourceStateForFighter(fighter, payload) {
    const latest = payload?.profile?.latestBoutDate || null;
    const bookingDate = fighter?.booking?.date || null;
    const todayValue = today();
    const pendingKnownFight = bookingDate && bookingDate <= todayValue && (!latest || latest < bookingDate);
    if (pendingKnownFight) {
      return {
        state:'warning',
        text:'UFCStats live, but the known ' + formatLookupDate(bookingDate) + ' fight is not posted yet. Latest source bout: ' + formatLookupDate(latest) + '.'
      };
    }
    return {
      state:'live',
      text:'LIVE UFCStats · latest bout ' + formatLookupDate(latest) + ' · fetched ' +
        new Date(payload.fetchedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})
    };
  }

  async function selectWriterFighter(input, fighter, type, side) {
    const dialog = type === 'stats' ? app.querySelector('[data-stats-dialog]') : app.querySelector('[data-tale-dialog]');
    if (!input || !fighter || !dialog) return;
    input.dataset.fighterId = fighter.id;
    input.dataset.ufcStatsId = fighter.ufcStatsId || '';
    input.value = fighter.name;
    applyCachedWriterFighter(dialog,type,side,fighter);
    const cachedState = cachedSourceStateForFighter(fighter);
    input.dataset.sourceMode = 'verified-cache';
    input.dataset.sourceFetchedAt = fighter.statsBuiltAt || fighter.checkedAt || '';
    input.dataset.latestBoutDate = fighter.latestBoutDate || fighter.stats?.sample?.latestBoutDate || fighter.history?.[0]?.date || '';
    input.dataset.sourceUrl = fighter.sourceUrl || '';
    setLookupStatus(input,cachedState.state,cachedState.text + (fighter.ufcStatsId ? ' · checking live…' : ''));

    if (!fighter.ufcStatsId) return;

    try {
      const payload = await fetchLiveWriterFighter(fighter);
      applyLiveWriterFighter(dialog,type,side,fighter,payload);
      input.dataset.sourceMode = 'live';
      input.dataset.sourceFetchedAt = payload.fetchedAt || '';
      input.dataset.latestBoutDate = payload.profile?.latestBoutDate || '';
      input.dataset.sourceUrl = payload.sourceUrl || '';
      const sourceState = sourceStateForFighter(fighter,payload);
      setLookupStatus(input,sourceState.state,sourceState.text);
    } catch (error) {
      input.dataset.sourceMode = 'verified-cache';
      input.dataset.sourceFetchedAt = fighter.statsBuiltAt || fighter.checkedAt || '';
      input.dataset.latestBoutDate = fighter.latestBoutDate || fighter.stats?.sample?.latestBoutDate || fighter.history?.[0]?.date || '';
      const fallbackState = cachedSourceStateForFighter(fighter);
      setLookupStatus(input,fallbackState.state,'LIVE UFCStats unavailable · ' + fallbackState.text);
    }
  }

  function installWriterFighterLookup(input, type, side) {
    if (!input || input.dataset.lookupReady === 'true') return;
    input.dataset.lookupReady = 'true';
    input.autocomplete = 'off';
    const menu = lookupMenuElement(input);
    let matches = [];

    const render = async () => {
      const query = input.value.trim();
      if (query.length < 2) { menu.hidden = true; menu.replaceChildren(); return; }
      try {
        const directory = await loadWriterFighterDirectory();
        matches = writerFighterMatches(directory,query);
        menu.replaceChildren(...matches.map((fighter,index) => {
          const option = document.createElement('div');
          option.className = 'writer-fighter-suggestion';
          option.setAttribute('role','option');
          option.dataset.index = String(index);
          option.innerHTML = '<strong>' + escapeHtml(fighter.name) + '</strong><span>' +
            escapeHtml([fighter.division,fighter.rank ? '#' + fighter.rank : '',fighter.record].filter(Boolean).join(' · ')) +
            '</span>';
          return option;
        }));
        menu.hidden = !matches.length;
      } catch {
        menu.hidden = true;
        setLookupStatus(input,'warning','Fighter directory could not be loaded. Manual entry still works.');
      }
    };

    input.addEventListener('input',() => {
      delete input.dataset.fighterId;
      delete input.dataset.ufcStatsId;
      delete input.dataset.sourceMode;
      setLookupStatus(input,'','');
      render();
    });
    input.addEventListener('focus',render);
    input.addEventListener('keydown',event => {
      if (event.key === 'Escape') menu.hidden = true;
      if (event.key === 'Enter' && !menu.hidden && matches[0]) {
        event.preventDefault();
        menu.hidden = true;
        selectWriterFighter(input,matches[0],type,side);
      }
    });
    menu.addEventListener('pointerdown',event => {
      const option = event.target.closest('.writer-fighter-suggestion');
      if (!option) return;
      event.preventDefault();
      const fighter = matches[Number(option.dataset.index)];
      if (!fighter) return;
      menu.hidden = true;
      selectWriterFighter(input,fighter,type,side);
    });
    input.addEventListener('blur',() => window.setTimeout(() => { menu.hidden = true; },120));
    input.addEventListener('change',async () => {
      if (input.dataset.fighterId) return;
      try {
        const directory = await loadWriterFighterDirectory();
        const exact = directory.fighters.find(fighter => normalizeFighterLookup(fighter.name) === normalizeFighterLookup(input.value));
        if (exact) selectWriterFighter(input,exact,type,side);
      } catch {}
    });
  }

  async function resolveNearestMatchupLookups(dialog,type) {
    if (!dialog) return;
    try {
      const directory = await loadWriterFighterDirectory();
      for (const side of ['a','b']) {
        const input = type === 'stats'
          ? dialog.querySelector('[data-stats-fighter="' + side + '"]')
          : dialog.querySelector(side === 'a' ? '[data-tale-a]' : '[data-tale-b]');
        if (!input?.value || input.dataset.fighterId) continue;
        const normalized = normalizeFighterLookup(input.value);
        const fighter = directory.fighters.find(item => normalizeFighterLookup(item.name) === normalized);
        if (fighter) selectWriterFighter(input,fighter,type,side);
      }
    } catch {}
  }

  function structuredSection(type, config, inner) {
    return '<section class="article-html-visual" data-writer-block="' + type + '" data-writer-config="' +
      encodedStructuredConfig(config) + '">\n' + inner + '\n</section>';
  }

  function buildStatsVisual(config) {
    const rows=normalizeComparisonRows(config.rows,[]);
    const fighterA=String(config.fighterA||'Fighter A').trim()||'Fighter A';
    const fighterB=String(config.fighterB||'Fighter B').trim()||'Fighter B';
    const body=rows.map(row=>'<tr><td>'+escapeHtml(row.a||'—')+'</td><td>'+escapeHtml(row.label)+'</td><td>'+escapeHtml(row.b||'—')+'</td></tr>').join('');
    return structuredSection('stats',config,
      '<div class="matlock-stats-card matlock-stats-compare"><table><thead><tr><th>'+escapeHtml(fighterA)+'</th><th>STAT</th><th>'+escapeHtml(fighterB)+'</th></tr></thead><tbody>'+body+'</tbody></table></div>'
    );
  }

  function recentFormMarkup(value) {
    return normalizeRecentRows(value).map(row=>{
      const result=String(row.result||'').toUpperCase();
      const resultClass=result==='W'?'win':result==='L'?'loss':'draw';
      return '<div class="mfc-form-row"><span class="mfc-result '+resultClass+'">'+escapeHtml(result||'—')+'</span><div><strong>'+escapeHtml(row.opponent)+'</strong><small>'+escapeHtml(row.detail)+'</small></div></div>';
    }).join('');
  }

  function fighterPortraitMarkup(side, fighter) {
    const image = String(fighter.image || '').trim();
    const style = '--portrait-x:' + Number(fighter.x || 50) + '%;--portrait-y:' +
      Number(fighter.y || 50) + '%;--portrait-zoom:' + (Number(fighter.zoom || 100) / 100) + ';';
    return '<div class="mfc-portrait mfc-' + side + '" style="' + style + '">' +
      (image ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(fighter.name || '') + '">' : '') +
      '</div>';
  }

  function fighterTopMarkup(side, fighter) {
    return '<div class="mfc-fighter mfc-' + side + '-fighter">' +
      fighterPortraitMarkup(side, fighter) +
      '<div class="mfc-meta"><span class="mfc-division">' + escapeHtml(fighter.division || '') +
      '</span><strong class="mfc-name">' + escapeHtml(fighter.name || '') +
      '</strong><div class="mfc-meta-strip"><span class="mfc-odds">ML <b>' +
      escapeHtml(fighter.odds || '—') + '</b></span><span class="mfc-last5"><b>' +
      escapeHtml(fighter.last5 || '—') + '</b> LAST 5</span></div></div></div>';
  }

  function buildTaleVisual(config) {
    const a=config.a||{}, b=config.b||{};
    const rows=normalizeComparisonRows(config.rows,taleDefaultRowLabels);
    const taleRows=rows.map((row,index)=>'<div class="mfc-tale-row'+(index===0?' featured':'')+'"><strong>'+escapeHtml(row.a)+'</strong><span>'+escapeHtml(row.label)+'</span><strong>'+escapeHtml(row.b)+'</strong></div>').join('');
    const recentA=recentFormMarkup(a.recent), recentB=recentFormMarkup(b.recent);
    const recent=recentA||recentB
      ? '<div class="mfc-form-wrap"><div class="mfc-column"><div class="mfc-mobile-column-label"><span>RECENT FORM</span><strong>'+escapeHtml(a.name||'Fighter A')+'</strong></div>'+recentA+'</div><div class="mfc-column"><div class="mfc-mobile-column-label"><span>RECENT FORM</span><strong>'+escapeHtml(b.name||'Fighter B')+'</strong></div>'+recentB+'</div></div>'
      : '';
    const opponents=(a.opponentsRecord||b.opponentsRecord||a.opponentsPct||b.opponentsPct)
      ? '<div class="mfc-opponents"><div><strong>'+escapeHtml(a.opponentsRecord||'—')+'</strong><span>'+escapeHtml(a.opponentsPct||'')+'</span></div><p>OPPONENTS COMBINED RECORD</p><div><strong>'+escapeHtml(b.opponentsRecord||'—')+'</strong><span>'+escapeHtml(b.opponentsPct||'')+'</span></div></div>'
      : '';
    const inner='<div class="matlock-fight-card"><div class="mfc-top">'+fighterTopMarkup('left',a)+'<div class="mfc-center"><strong>MATCHUP</strong><i></i></div>'+fighterTopMarkup('right',b)+'</div><div class="mfc-tale"><div class="mfc-section-title">TALE OF THE TAPE</div>'+taleRows+'</div>'+recent+opponents+'</div>';
    return structuredSection('tale',config,inner);
  }

  function buildPickVisual(config) {
    const fighter = String(config.fighter || '').trim();
    const method = String(config.method || '').trim();
    const round = String(config.round || '').trim();
    const result = [method, round].filter(Boolean).join(' · ');
    const note = String(config.note || '').trim();
    const inner = '<aside class="article-pick-card"><span class="article-pick-card__label">MATLOCK PICK</span>' +
      '<div class="article-pick-card__main"><strong>' + escapeHtml(fighter) + '</strong>' +
      (result ? '<span>' + escapeHtml(result) + '</span>' : '') + '</div>' +
      (note ? '<p>' + escapeHtml(note) + '</p>' : '') + '</aside>';
    return structuredSection('pick', config, inner);
  }

  function saveStructuredBlock(type, label, code) {
    if (editingStructuredBlockId && htmlBlocks.has(editingStructuredBlockId)) {
      const block = htmlBlocks.get(editingStructuredBlockId);
      block.label = label;
      block.code = code;
      htmlBlocks.set(editingStructuredBlockId, block);
      replaceHtmlToken(editingStructuredBlockId, htmlBlockToken(block));
    } else {
      const id = htmlBlockId();
      const block = { id, label, code };
      htmlBlocks.set(id, block);
      insertBlock(htmlBlockToken(block));
    }
    editingStructuredBlockId = '';
    renderHtmlBlockRail();
    setHtmlBlockPanel(true);
    scheduleAutosave();
    updatePreview();
  }

  function taleImagePreview(side, localUrl = '') {
    const dialog = app.querySelector('[data-tale-dialog]');
    if (!dialog) return;
    const path = dialog.querySelector('[data-tale-image-path="' + side + '"]')?.value.trim() || '';
    const image = dialog.querySelector('[data-tale-image-preview="' + side + '"]');
    const empty = dialog.querySelector('[data-tale-image-empty="' + side + '"]');
    if (!image || !empty) return;
    const x = Number(dialog.querySelector('[data-tale-image-x="' + side + '"]')?.value || 50);
    const y = Number(dialog.querySelector('[data-tale-image-y="' + side + '"]')?.value || 50);
    const zoom = Number(dialog.querySelector('[data-tale-image-zoom="' + side + '"]')?.value || 100) / 100;
    const src = localUrl || (path ? writerPreviewAssetUrl(path) : '');
    image.hidden = !src;
    empty.hidden = Boolean(src);
    if (src) image.src = src;
    image.style.objectPosition = x + '% ' + y + '%';
    image.style.transform = 'scale(' + zoom + ')';
  }

  function resetStatsDialog(config = {}) {
    const dialog=app.querySelector('[data-stats-dialog]');
    dialog.querySelector('[data-stats-fighter="a"]').value=config.fighterA||'';
    dialog.querySelector('[data-stats-fighter="b"]').value=config.fighterB||'';
    ['a','b'].forEach(side => {
      const input=dialog.querySelector('[data-stats-fighter="'+side+'"]');
      for (const key of ['fighterId','ufcStatsId','sourceMode','sourceFetchedAt','latestBoutDate','sourceUrl']) delete input.dataset[key];
      setLookupStatus(input,'','');
    });
    renderComparisonRows(dialog.querySelector('[data-stats-row-list]'),config.rows,statsDefaultRowLabels);
    refreshStatsNameHeaders(dialog);
  }

  function resetPickDialog(config = {}) {
    const dialog = app.querySelector('[data-pick-dialog]');
    dialog.querySelector('[data-pick-fighter]').value = config.fighter || '';
    dialog.querySelector('[data-pick-method]').value = config.method || '';
    dialog.querySelector('[data-pick-round]').value = config.round || '';
    dialog.querySelector('[data-pick-note]').value = config.note || '';
  }

  function resetTaleDialog(config = {}) {
    const dialog=app.querySelector('[data-tale-dialog]');
    const a=config.a||{}, b=config.b||{};
    dialog.querySelector('[data-tale-a]').value=a.name||'';
    dialog.querySelector('[data-tale-b]').value=b.name||'';
    ['a','b'].forEach(side => {
      const input=dialog.querySelector(side==='a'?'[data-tale-a]':'[data-tale-b]');
      for (const key of ['fighterId','ufcStatsId','sourceMode','sourceFetchedAt','latestBoutDate','sourceUrl']) delete input.dataset[key];
      setLookupStatus(input,'','');
    });
    ['a','b'].forEach(side=>{
      const fighter=side==='a'?a:b;
      dialog.querySelector('[data-tale-division="'+side+'"]').value=fighter.division||'';
      dialog.querySelector('[data-tale-odds="'+side+'"]').value=fighter.odds||'';
      dialog.querySelector('[data-tale-last5="'+side+'"]').value=fighter.last5||'';
      dialog.querySelector('[data-tale-image-path="'+side+'"]').value=fighter.image||'';
      dialog.querySelector('[data-tale-image-x="'+side+'"]').value=fighter.x??50;
      dialog.querySelector('[data-tale-image-y="'+side+'"]').value=fighter.y??50;
      dialog.querySelector('[data-tale-image-zoom="'+side+'"]').value=fighter.zoom??100;
      dialog.querySelector('[data-tale-opponents-record="'+side+'"]').value=fighter.opponentsRecord||'';
      dialog.querySelector('[data-tale-opponents-pct="'+side+'"]').value=fighter.opponentsPct||'';
      renderRecentRows(dialog.querySelector('[data-tale-form-list="'+side+'"]'),fighter.recent);
      taleImagePreview(side);
    });
    renderComparisonRows(dialog.querySelector('[data-tale-row-list]'),config.rows,taleDefaultRowLabels);
    refreshTaleNameHeaders(dialog);
  }

  function openStructuredBlockById(id) {
    const block = htmlBlocks.get(id);
    const meta = structuredMeta(block?.code);
    if (!meta) return false;
    editingStructuredBlockId = id;
    if (meta.type === 'stats') {
      resetStatsDialog(meta.config);
      const dialog = app.querySelector('[data-stats-dialog]');
      dialog.showModal();
      resolveNearestMatchupLookups(dialog,'stats');
      return true;
    }
    if (meta.type === 'tale') {
      resetTaleDialog(meta.config);
      const dialog = app.querySelector('[data-tale-dialog]');
      dialog.showModal();
      resolveNearestMatchupLookups(dialog,'tale');
      return true;
    }
    if (meta.type === 'pick') {
      resetPickDialog(meta.config);
      app.querySelector('[data-pick-dialog]').showModal();
      return true;
    }
    return false;
  }

  function openTool(type) {
    if (type === 'link' || type === 'citation') {
      linkMode = type;
      const dialog = app.querySelector('[data-link-dialog]');
      dialog.querySelector('[data-link-dialog-title]').textContent = type === 'citation' ? 'Add source' : 'Add link';
      dialog.querySelector('[data-link-label]').value = bodyEditor.value.slice(bodyEditor.selectionStart, bodyEditor.selectionEnd) || (type === 'citation' ? 'Source' : '');
      dialog.querySelector('[data-link-url]').value = '';
      dialog.showModal();
      dialog.querySelector('[data-link-url]').focus();
      return;
    }
    if (type === 'html') {
      openHtmlDialog();
      return;
    }
    if (type === 'stats') {
      editingStructuredBlockId = '';
      resetStatsDialog();
      const dialog = app.querySelector('[data-stats-dialog]');
      applyNearestMatchup(dialog, 'stats');
      dialog.showModal();
      resolveNearestMatchupLookups(dialog,'stats');
      return;
    }
    if (type === 'tale') {
      editingStructuredBlockId = '';
      resetTaleDialog();
      const dialog = app.querySelector('[data-tale-dialog]');
      applyNearestMatchup(dialog, 'tale');
      dialog.showModal();
      resolveNearestMatchupLookups(dialog,'tale');
      return;
    }
    if (type === 'prediction') {
      editingStructuredBlockId = '';
      resetPickDialog();
      app.querySelector('[data-pick-dialog]').showModal();
      return;
    }
    const map = {
      image: '[data-image-dialog]', video: '[data-video-dialog]', youtube: '[data-youtube-dialog]', x: '[data-x-dialog]'
    };
    const dialog = app.querySelector(map[type]);
    if (dialog) {
      if (type === 'image') syncInlineImagePlacementControls(dialog);
      dialog.showModal();
    }
  }

  function syncInlineImagePlacementControls(dialog = app.querySelector('[data-image-dialog]')) {
    if (!dialog) return;
    const flow = dialog.querySelector('[data-inline-image-flow]');
    const align = dialog.querySelector('[data-inline-image-align]');
    const width = dialog.querySelector('[data-inline-image-width]');
    if (!flow || !align || !width) return;

    const wrap = flow.value === 'wrap';
    const center = align.querySelector('option[value="center"]');
    const full = width.querySelector('option[value="full"]');
    if (center) center.disabled = wrap;
    if (full) full.disabled = wrap;
    if (wrap && align.value === 'center') align.value = 'left';
    if (wrap && width.value === 'full') width.value = 'medium';
  }

