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

function insertBlock(text, { preserveScroll = false } = {}) {
  const start = bodyEditor.selectionStart;
  const end = bodyEditor.selectionEnd;
  const editorScrollTop = bodyEditor.scrollTop;
  const editorScrollLeft = bodyEditor.scrollLeft;
  const before = bodyEditor.value.slice(0, start);
  const after = bodyEditor.value.slice(end);
  const prefix = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = !after ? '\n\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const inserted = `${prefix}${String(text).trim()}${suffix}`;
  bodyEditor.setRangeText(inserted, start, end, 'end');
  bodyEditor.focus({ preventScroll: preserveScroll });
  const cursor = start + inserted.length;
  bodyEditor.setSelectionRange(cursor, cursor);
  if (preserveScroll) {
    bodyEditor.scrollTop = editorScrollTop;
    bodyEditor.scrollLeft = editorScrollLeft;
    requestAnimationFrame(() => {
      bodyEditor.scrollTop = editorScrollTop;
      bodyEditor.scrollLeft = editorScrollLeft;
    });
  }
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

  function normalizeTalePortrait(fighter = {}) {
    const portrait = fighter?.portrait && typeof fighter.portrait === 'object' ? fighter.portrait : {};
    const clamp=(value,min,max,fallback)=>{
      const number=Number(value);
      return Math.max(min,Math.min(max,Number.isFinite(number)?number:fallback));
    };
    return {
      x:clamp(portrait.x ?? fighter.x,0,100,50),
      y:clamp(portrait.y ?? fighter.y,0,100,50),
      zoom:clamp(portrait.zoom ?? fighter.zoom,100,250,100)
    };
  }

  function normalizeTaleConfig(config = {}) {
    const normalized={...config,version:Math.max(6,Number(config.version)||0)};
    normalized.a={...(config.a||{}),portrait:normalizeTalePortrait(config.a||{})};
    normalized.b={...(config.b||{}),portrait:normalizeTalePortrait(config.b||{})};
    for(const fighter of [normalized.a,normalized.b]){
      delete fighter.x;
      delete fighter.y;
      delete fighter.zoom;
    }
    return normalized;
  }

  function updateTalePortraitConfig(blockId, side, crop) {
    if(!['a','b'].includes(side)) return null;
    const block=htmlBlocks.get(blockId);
    const meta=structuredMeta(block?.code);
    if(!block||meta?.type!=='tale') return null;
    const config=normalizeTaleConfig(meta.config);
    config[side].portrait=normalizeTalePortrait({portrait:crop});
    block.code=buildTaleVisual(config);
    htmlBlocks.set(blockId,block);
    scheduleAutosave();
    return {config,portrait:config[side].portrait};
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
          stats: fighter.stats || null,
          career: fighter.career || null,
          opponentStrength: fighter.opponentStrength || null,
          careerHistorySource: fighter.careerHistorySource || null
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

  const writerAutoCorrectKey = 'matlock-writer:autocorrect';
  const writerAutoCorrectIgnoreKey = 'matlock-writer:autocorrect-ignore';
  const writerAutoCorrectWords = new Map([
    ['teh','the'],['hte','the'],['thsi','this'],['taht','that'],['adn','and'],
    ['woudl','would'],['coudl','could'],['shoudl','should'],['waht','what'],['wiht','with'],['wtiht','with'],
    ['becuase','because'],['becasue','because'],['definately','definitely'],['definetly','definitely'],
    ['seperate','separate'],['recieve','receive'],['wierd','weird'],['alot','a lot'],
    ['dont',"don't"],['doesnt',"doesn't"],['didnt',"didn't"],['cant',"can't"],['wont',"won't"],
    ['isnt',"isn't"],['wasnt',"wasn't"],['werent',"weren't"],['couldnt',"couldn't"],
    ['wouldnt',"wouldn't"],['shouldnt',"shouldn't"],['youre',"you're"],['theyre',"they're"],
    ['ive',"I've"],['im',"I'm"],['weve',"we've"],['thats',"that's"],['theres',"there's"],
    ['figher','fighter'],['figthers','fighters'],['fighers','fighters'],['strikng','striking'],
    ['wrestlng','wrestling'],['submision','submission'],['submisson','submission'],
    ['takedwon','takedown'],['takedwons','takedowns'],['oppnent','opponent'],['opponet','opponent'],
    ['decison','decision'],['knockot','knockout'],['kncokout','knockout'],
    ['cleean','clean'],['repeittiveness','repetitiveness'],['grammer','grammar'],['speling','spelling']
  ]);
  const writerAutoCorrectMmaWords = (
    'mma ufc pfl bellator pride rizin one fc dwcs contender apex octagon cage cagefighting ' +
    'bjj jiu jitsu jiujitsu grappler grappling wrestler wrestling kickboxing kickboxer muay thai ' +
    'tko ko koed knockout knockouts submission submissions subbed tapout tapout ground pound ' +
    'groundandpound clinch clinching takedown takedowns sprawled sprawl southpaw orthodox switch ' +
    'counterstriker counterstriking pressurefighter pressurefighting feint feints feinting jab ' +
    'cross hook uppercut overhand calfkick legkick headkick bodykick teep oblique guillotine ' +
    'armbar kimura americana omoplata darce anaconda triangle heelhook kneebar leglock rear naked ' +
    'rnc scramble scrambles scrambling underhook overhook whizzer mat return cagewalk wallwalk ' +
    'fight iq fightiq cardio gas tank gassed weightcut weighin weighins catchweight shortnotice ' +
    'moneyline underdog favorite favoured splitdecision unanimousdecision majoritydecision no contest'
  ).split(/\s+/);

  let writerAutoCorrectEnabled = true;
  let writerAutoCorrectFighterTokens = [];
  let writerAutoCorrectGlobalTokens = new Map();
  let writerAutoCorrectFighterTimer = 0;
  let writerAutoCorrectFeedbackTimer = 0;
  let writerAutoCorrectDirectoryIndexed = false;
  let writerAutoCorrectSmart = null;
  let writerAutoCorrectSmartPromise = null;
  let writerAutoCorrectLastChange = null;
  let writerAutoCorrectSuppressOnce = false;

  function writerAutoCorrectNormalizedToken(value) {
    return normalizeFighterLookup(value).replace(/\s+/g, '');
  }

  function writerAutoCorrectCase(original, replacement) {
    if (!replacement) return '';
    if (original.length > 1 && original === original.toUpperCase()) return replacement.toUpperCase();
    if (/^[A-ZÀ-ÖØ-Þ]/u.test(original)) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    return replacement;
  }

  function writerAutoCorrectCleanName(value) {
    return String(value || '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_\x60]/g, '')
      .replace(/\s+#+\s*$/, '')
      .trim();
  }

  function writerAutoCorrectIgnoredWords() {
    try {
      const value = JSON.parse(localStorage.getItem(writerAutoCorrectIgnoreKey) || '[]');
      return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function writerAutoCorrectRememberIgnored(word) {
    const normalized = String(word || '').trim();
    if (!normalized) return;
    const current = writerAutoCorrectIgnoredWords();
    if (!current.some(item => item.toLowerCase() === normalized.toLowerCase())) {
      current.push(normalized);
      try { localStorage.setItem(writerAutoCorrectIgnoreKey, JSON.stringify(current.slice(-500))); } catch {}
    }
    writerAutoCorrectSmart?.addWord(normalized, { personal:true, preferCanonical:true });
  }

  async function loadWriterSmartAutoCorrect() {
    if (writerAutoCorrectSmart) return writerAutoCorrectSmart;
    if (writerAutoCorrectSmartPromise) return writerAutoCorrectSmartPromise;

    writerAutoCorrectSmartPromise = (async () => {
      const api = window.MatlockAutocorrectEngine;
      if (!api?.create) return null;
      const engine = api.create();
      await engine.init({
        dicUrl:'/assets/data/autocorrect/en-US.dic',
        affUrl:'/assets/data/autocorrect/en-US.aff'
      });
      engine.addWords(writerAutoCorrectMmaWords, { domain:true });
      engine.addWords(writerAutoCorrectIgnoredWords(), { personal:true });
      writerAutoCorrectSmart = engine;

      const status = app.querySelector('[data-autocorrect-status]');
      if (status && !status.textContent) status.textContent = 'Smart dictionary ready';
      window.clearTimeout(writerAutoCorrectFeedbackTimer);
      writerAutoCorrectFeedbackTimer = window.setTimeout(() => {
        if (status?.textContent === 'Smart dictionary ready') status.textContent = '';
      }, 1600);

      scheduleWriterAutoCorrectFighterRefresh(0);
      return engine;
    })().catch(error => {
      console.warn('Smart autocorrect dictionary failed to load.', error);
      writerAutoCorrectSmartPromise = null;
      return null;
    });

    return writerAutoCorrectSmartPromise;
  }

  function writerAutoCorrectActiveNames() {
    const names = new Set();
    const add = value => {
      const name = writerAutoCorrectCleanName(value);
      if (name && name.length >= 3) names.add(name);
    };

    String(bodyEditor.value || '').split(/\r?\n/).forEach(line => {
      const heading = line.match(/^\s*#{2,4}\s+(.+?)\s+(?:vs\.?|v\.?)\s+(.+?)\s*$/i);
      if (!heading) return;
      add(heading[1]);
      add(heading[2]);
    });

    htmlBlocks.forEach(block => {
      const meta = structuredMeta(block?.code);
      if (!meta) return;
      if (meta.type === 'tale') {
        add(meta.config?.a?.name);
        add(meta.config?.b?.name);
      } else if (meta.type === 'stats') {
        add(meta.config?.fighterA);
        add(meta.config?.fighterB);
      } else if (meta.type === 'pick') {
        add(meta.config?.fighter);
      }
    });

    return [...names];
  }

  function writerAutoCorrectBuildGlobalTokenIndex(directory) {
    if (writerAutoCorrectSmart) {
      (directory?.fighters || []).forEach(fighter => writerAutoCorrectSmart.addName(fighter.name));
    }
    if (writerAutoCorrectDirectoryIndexed) return;
    const seen = new Map();
    (directory?.fighters || []).forEach(fighter => {
      const tokens = String(fighter.name || '').match(/[\p{L}\p{M}'’.-]+/gu) || [];
      tokens.forEach(token => {
        const normalized = writerAutoCorrectNormalizedToken(token);
        if (normalized.length < 5) return;
        if (!seen.has(normalized)) {
          seen.set(normalized, token);
          return;
        }
        if (seen.get(normalized) !== token) seen.set(normalized, null);
      });
    });
    writerAutoCorrectGlobalTokens = seen;
    writerAutoCorrectDirectoryIndexed = true;
  }

  async function refreshWriterAutoCorrectFighters() {
    const requested = writerAutoCorrectActiveNames();
    let canonicalNames = requested;

    try {
      const directory = await loadWriterFighterDirectory();
      writerAutoCorrectBuildGlobalTokenIndex(directory);
      const exact = new Map(directory.fighters.map(fighter => [normalizeFighterLookup(fighter.name), fighter.name]));
      canonicalNames = requested.map(name => exact.get(normalizeFighterLookup(name)) || name);
    } catch {}

    const tokens = [];
    canonicalNames.forEach(name => {
      writerAutoCorrectSmart?.addName(name);
      const parts = String(name || '').match(/[\p{L}\p{M}'’.-]+/gu) || [];
      parts.forEach((token, index) => {
        const normalized = writerAutoCorrectNormalizedToken(token);
        if (normalized.length < 4) return;
        tokens.push({
          canonical: token,
          normalized,
          surname: index === parts.length - 1,
          fullName: name
        });
      });
    });

    const deduped = new Map();
    tokens.forEach(token => {
      const existing = deduped.get(token.normalized);
      if (!existing || (token.surname && !existing.surname)) deduped.set(token.normalized, token);
    });
    writerAutoCorrectFighterTokens = [...deduped.values()];

    const toggle = app.querySelector('[data-autocorrect-toggle]');
    if (toggle) {
      const count = canonicalNames.length;
      toggle.title = writerAutoCorrectSmart
        ? 'Smart dictionary on. Fighter-aware for ' + count + ' article name' + (count === 1 ? '' : 's') + '.'
        : 'Auto-correct common typos and recognize fighter names in this article.';
    }
  }

  function scheduleWriterAutoCorrectFighterRefresh(delay = 650) {
    window.clearTimeout(writerAutoCorrectFighterTimer);
    writerAutoCorrectFighterTimer = window.setTimeout(refreshWriterAutoCorrectFighters, delay);
  }

  function writerAutoCorrectDistance(a, b) {
    a = String(a || '');
    b = String(b || '');
    const rows = a.length + 1;
    const cols = b.length + 1;
    const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let i = 0; i < rows; i++) matrix[i][0] = i;
    for (let j = 0; j < cols; j++) matrix[0][j] = j;

    for (let i = 1; i < rows; i++) {
      for (let j = 1; j < cols; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
        if (
          i > 1 && j > 1 &&
          a[i - 1] === b[j - 2] &&
          a[i - 2] === b[j - 1]
        ) {
          matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
        }
      }
    }
    return matrix[a.length][b.length];
  }

  function writerAutoCorrectFighterReplacement(word) {
    const normalized = writerAutoCorrectNormalizedToken(word);
    if (!normalized || normalized.length < 4) return '';
    const startsUpper = /^[A-ZÀ-ÖØ-Þ]/u.test(word);

    const exactActive = writerAutoCorrectFighterTokens.filter(token => token.normalized === normalized);
    if (exactActive.length === 1) {
      const token = exactActive[0];
      const safeLowercase = token.surname && token.canonical.length >= 7;
      if (startsUpper || safeLowercase) return token.canonical === word ? '' : token.canonical;
    }

    if (startsUpper && normalized.length >= 5 && writerAutoCorrectGlobalTokens.has(normalized)) {
      const canonical = writerAutoCorrectGlobalTokens.get(normalized);
      if (canonical && canonical !== word) return canonical;
    }

    if (normalized.length < 5) return '';
    const maxDistance = normalized.length >= 8 ? 2 : 1;
    const candidates = writerAutoCorrectFighterTokens
      .filter(token => startsUpper || (token.surname && token.canonical.length >= 7))
      .map(token => ({ token, distance: writerAutoCorrectDistance(normalized, token.normalized) }))
      .filter(item => item.distance > 0 && item.distance <= maxDistance)
      .sort((a, b) => a.distance - b.distance || Number(b.token.surname) - Number(a.token.surname));

    if (!candidates.length) return '';
    if (candidates[1] && candidates[1].distance === candidates[0].distance && candidates[1].token.normalized !== candidates[0].token.normalized) return '';
    return candidates[0].token.canonical;
  }

  function writerAutoCorrectSafeContext(wordStart) {
    const before = bodyEditor.value.slice(0, wordStart);
    const fenceCount = (before.match(/\x60\x60\x60/g) || []).length;
    if (fenceCount % 2) return false;

    const lineStart = before.lastIndexOf('\n') + 1;
    const linePrefix = before.slice(lineStart);
    if (/^\s*\[HTML VISUAL ·/i.test(linePrefix)) return false;
    if (/(?:https?:\/\/|www\.|mailto:)\S*$/i.test(linePrefix)) return false;
    if (linePrefix.lastIndexOf('](') > linePrefix.lastIndexOf(')')) return false;
    if (linePrefix.lastIndexOf('<') > linePrefix.lastIndexOf('>')) return false;
    if ((linePrefix.match(/\x60/g) || []).length % 2) return false;
    return true;
  }

  function writerAutoCorrectSentenceStart(wordStart) {
    const before = bodyEditor.value.slice(0, wordStart);
    const trimmed = before.replace(/\s+$/, '');
    if (!trimmed) return true;
    return /(?:^|[.!?]\s*)$/u.test(trimmed) || /\n\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?$/u.test(before);
  }

  function writerAutoCorrectApplyChange(word, replacement, wordStart, wordEnd, cursor) {
    const value = bodyEditor.value;
    bodyEditor.value = value.slice(0, wordStart) + replacement + value.slice(wordEnd);
    const nextCursor = cursor + replacement.length - word.length;
    bodyEditor.setSelectionRange(nextCursor, nextCursor);

    writerAutoCorrectLastChange = {
      original:word,
      replacement,
      start:wordStart,
      at:Date.now()
    };
    writerAutoCorrectSmart?.learnCorrection(word, replacement);

    const feedback = app.querySelector('[data-autocorrect-status]');
    if (feedback) {
      feedback.textContent = 'Fixed ' + word + ' → ' + replacement + ' · click to undo';
      feedback.title = 'Click to undo this correction and remember the original word.';
      feedback.dataset.autocorrectUndo = 'true';
      window.clearTimeout(writerAutoCorrectFeedbackTimer);
      writerAutoCorrectFeedbackTimer = window.setTimeout(() => {
        feedback.textContent = '';
        feedback.title = '';
        delete feedback.dataset.autocorrectUndo;
      }, 4200);
    }
  }

  function applyWriterAutoCorrect(event) {
    if (writerAutoCorrectSuppressOnce) {
      writerAutoCorrectSuppressOnce = false;
      return false;
    }
    if (!writerAutoCorrectEnabled || event?.isComposing) return false;
    if (event && !['insertText','insertLineBreak','insertParagraph'].includes(event.inputType || '')) return false;
    if (bodyEditor.selectionStart !== bodyEditor.selectionEnd) return false;

    const cursor = bodyEditor.selectionStart;
    const before = bodyEditor.value.slice(0, cursor);
    const match = before.match(/([\p{L}\p{M}][\p{L}\p{M}'’.-]*)([\s.,!?;:)\]}]+)$/u);
    if (!match) return false;

    const word = match[1];
    const boundary = match[2];
    const wordEnd = cursor - boundary.length;
    const wordStart = wordEnd - word.length;
    if (!writerAutoCorrectSafeContext(wordStart)) return false;

    const ignored = writerAutoCorrectIgnoredWords();
    if (ignored.some(item => item.toLowerCase() === word.toLowerCase())) return false;

    const lower = word.toLowerCase();
    let replacement = writerAutoCorrectWords.get(lower) || '';
    if (replacement) replacement = writerAutoCorrectCase(word, replacement);

    if (!replacement) replacement = writerAutoCorrectFighterReplacement(word);

    if (!replacement && writerAutoCorrectSmart) {
      const sentenceStart = writerAutoCorrectSentenceStart(wordStart);
      const capitalized = /^[A-ZÀ-ÖØ-Þ]/u.test(word);
      const suggestion = writerAutoCorrectSmart.suggest(word, { sentenceStart, capitalized });
      if (suggestion?.replacement) {
        const allow = suggestion.confidence === 'high' ||
          (!capitalized && suggestion.confidence === 'medium') ||
          (sentenceStart && suggestion.confidence === 'medium');
        if (allow) replacement = suggestion.replacement;
      }
    }

    if (!replacement || replacement === word) return false;
    writerAutoCorrectApplyChange(word, replacement, wordStart, wordEnd, cursor);
    return true;
  }

  function undoWriterAutoCorrect() {
    const change = writerAutoCorrectLastChange;
    if (!change || Date.now() - change.at > 12000) return false;
    const current = bodyEditor.value.slice(change.start, change.start + change.replacement.length);
    if (current !== change.replacement) return false;

    const cursor = bodyEditor.selectionStart;
    bodyEditor.value =
      bodyEditor.value.slice(0, change.start) +
      change.original +
      bodyEditor.value.slice(change.start + change.replacement.length);

    const delta = change.original.length - change.replacement.length;
    const nextCursor = cursor > change.start ? Math.max(change.start + change.original.length, cursor + delta) : cursor;
    bodyEditor.setSelectionRange(nextCursor, nextCursor);
    writerAutoCorrectRememberIgnored(change.original);
    writerAutoCorrectSuppressOnce = true;
    bodyEditor.dispatchEvent(new Event('input', { bubbles:true }));

    const feedback = app.querySelector('[data-autocorrect-status]');
    if (feedback) {
      feedback.textContent = 'Restored ' + change.original + ' · learned as allowed';
      feedback.title = '';
      delete feedback.dataset.autocorrectUndo;
      window.clearTimeout(writerAutoCorrectFeedbackTimer);
      writerAutoCorrectFeedbackTimer = window.setTimeout(() => { feedback.textContent = ''; }, 2200);
    }
    writerAutoCorrectLastChange = null;
    return true;
  }

  function setWriterAutoCorrectEnabled(enabled, { persist = true } = {}) {
    writerAutoCorrectEnabled = Boolean(enabled);
    const toggle = app.querySelector('[data-autocorrect-toggle]');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(writerAutoCorrectEnabled));
      toggle.setAttribute('aria-label', 'Auto-correct is ' + (writerAutoCorrectEnabled ? 'on' : 'off'));
      toggle.textContent = writerAutoCorrectEnabled ? 'Auto-correct' : 'Auto-correct off';
    }
    bodyEditor.setAttribute('autocorrect', writerAutoCorrectEnabled ? 'on' : 'off');
    if (persist) {
      try { localStorage.setItem(writerAutoCorrectKey, writerAutoCorrectEnabled ? 'on' : 'off'); } catch {}
    }
  }

  function initializeWriterAutoCorrect() {
    let saved = '';
    try { saved = localStorage.getItem(writerAutoCorrectKey) || ''; } catch {}
    setWriterAutoCorrectEnabled(saved !== 'off', { persist:false });

    app.querySelector('[data-autocorrect-toggle]')?.addEventListener('click', () => {
      setWriterAutoCorrectEnabled(!writerAutoCorrectEnabled);
      if (writerAutoCorrectEnabled) {
        void loadWriterSmartAutoCorrect();
        scheduleWriterAutoCorrectFighterRefresh(0);
      }
    });

    app.querySelector('[data-autocorrect-status]')?.addEventListener('click', event => {
      if (event.currentTarget?.dataset.autocorrectUndo === 'true') undoWriterAutoCorrect();
    });

    bodyEditor.addEventListener('input', event => {
      applyWriterAutoCorrect(event);
      scheduleWriterAutoCorrectFighterRefresh();
    });

    if (writerAutoCorrectEnabled) void loadWriterSmartAutoCorrect();
    scheduleWriterAutoCorrectFighterRefresh(0);
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
    const counts = { W:0, L:0, D:0, NC:0 };
    for (const row of (rows || []).slice(0,5)) {
      const result = String(row?.result || '').toUpperCase();
      if (Object.hasOwn(counts,result)) counts[result]++;
    }
    const total = counts.W + counts.L + counts.D + counts.NC;
    if (!total) return '';
    const third = counts.D + counts.NC;
    return counts.W + '-' + counts.L + (third ? '-' + third : '');
  }

  function displayComparisonValue(value) {
    return value === null || value === undefined || value === '' ? 'N/A' : value;
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

  function applyCareerComparisonValues(container, side, career) {
    const source = career || {};
    setComparisonValue(container,'Total Finishes',side,displayComparisonValue(source.totalFinishes));
    setComparisonValue(container,'TKO / KO',side,displayComparisonValue(source.winsByKnockout));
    setComparisonValue(container,'Submission',side,displayComparisonValue(source.winsBySubmission));
    setComparisonValue(container,'Unanimous Decision',side,displayComparisonValue(source.unanimousDecisionWins));
    setComparisonValue(container,'Split Decision',side,displayComparisonValue(source.splitDecisionWins));
  }

  function fighterSourceMeta(input) {
    if (!input) return null;
    return {
      fighterId: input.dataset.fighterId || null,
      ufcStatsId: input.dataset.ufcStatsId || null,
      mode: input.dataset.sourceMode || null,
      fetchedAt: input.dataset.sourceFetchedAt || null,
      latestBoutDate: input.dataset.latestBoutDate || null,
      bookingDate: input.dataset.bookingDate || null,
      sourceUrl: input.dataset.sourceUrl || null
    };
  }

  async function fetchLiveWriterFighter(fighter) {
    if (!fighter?.name || !authBase) return null;
    const cacheKey = fighter.ufcStatsId || fighter.id || normalizeFighterLookup(fighter.name);
    const cached = writerFighterLiveCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < 5 * 60 * 1000) return cached.data;
    const query = new URLSearchParams({
      slug:fighter.id || '',
      name:fighter.name || ''
    });
    if (fighter.ufcStatsId) query.set('id',fighter.ufcStatsId);
    if (fighter.bio?.dob) query.set('dob',fighter.bio.dob);
    if (fighter.bio?.height) query.set('height',fighter.bio.height);
    if (fighter.bio?.weight) query.set('weight',fighter.bio.weight);
    const response = await fetch(authBase + '/api/writer/fighter?' + query.toString(), {
      method:'GET',
      mode:'cors',
      cache:'no-store',
      headers:{Accept:'application/json'}
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || !data.profile) throw new Error(data.error || 'Live fighter lookup failed.');
    writerFighterLiveCache.set(cacheKey,{savedAt:Date.now(),data});
    return data;
  }

  function parseOpponentRecord(value) {
    const match = String(value || '').match(/\b(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);
    if (!match) return null;
    return {
      wins:Number(match[1]),
      losses:Number(match[2]),
      draws:Number(match[3] || 0)
    };
  }

  function canAutoFillTaleOpponentStrength(recordInput,pctInput) {
    if (!recordInput || !pctInput) return false;
    const recordValue=recordInput.value.trim();
    const pctValue=pctInput.value.trim();
    if (!recordValue && !pctValue) return true;
    const autoRecord=recordInput.dataset.autoOpponentValue || '';
    const autoPct=pctInput.dataset.autoOpponentValue || '';
    return Boolean(autoRecord || autoPct) && recordValue === autoRecord && pctValue === autoPct;
  }

  async function populateTaleOpponentStrength(dialog,side,fighter,liveProfile=null) {
    if (!dialog || !fighter || !liveProfile?.historyComplete || !Array.isArray(liveProfile.history)) return;
    const recordInput=dialog.querySelector('[data-tale-opponents-record="' + side + '"]');
    const pctInput=dialog.querySelector('[data-tale-opponents-pct="' + side + '"]');
    if (!canAutoFillTaleOpponentStrength(recordInput,pctInput)) return;

    const opponents=liveProfile.history.map(row => String(row?.opponent || '').trim()).filter(Boolean);
    if (!opponents.length) return;

    const requestKey=normalizeFighterLookup(fighter.name) + '|' +
      opponents.map(normalizeFighterLookup).join('|');
    recordInput.dataset.opponentStrengthRequest=requestKey;
    pctInput.dataset.opponentStrengthRequest=requestKey;

    let directory;
    try {
      directory=await loadWriterFighterDirectory();
    } catch {
      return;
    }

    const uniqueNames=[...new Map(opponents.map(name => [normalizeFighterLookup(name),name])).values()];
    const recordByName=new Map();
    let cursor=0;
    const workers=Array.from({length:Math.min(4,uniqueNames.length)},async () => {
      while (cursor < uniqueNames.length) {
        const name=uniqueNames[cursor++];
        const wanted=normalizeFighterLookup(name);
        const cachedOpponent=directory.fighters.find(item => normalizeFighterLookup(item.name) === wanted);
        const cachedRecord=parseOpponentRecord(cachedOpponent?.record);
        if (cachedRecord) {
          recordByName.set(wanted,cachedRecord);
          continue;
        }
        try {
          const payload=await fetchLiveWriterFighter({name});
          recordByName.set(wanted,parseOpponentRecord(payload?.profile?.record));
        } catch {
          recordByName.set(wanted,null);
        }
      }
    });
    await Promise.all(workers);

    if (recordInput.dataset.opponentStrengthRequest !== requestKey ||
        pctInput.dataset.opponentStrengthRequest !== requestKey ||
        !canAutoFillTaleOpponentStrength(recordInput,pctInput)) return;

    const records=opponents.map(name => recordByName.get(normalizeFighterLookup(name)) || null);

    // Never publish a partial strength-of-schedule number as if it were complete.
    if (records.some(record => !record)) {
      if (recordInput.value === (recordInput.dataset.autoOpponentValue || '')) recordInput.value='';
      if (pctInput.value === (pctInput.dataset.autoOpponentValue || '')) pctInput.value='';
      delete recordInput.dataset.autoOpponentValue;
      delete pctInput.dataset.autoOpponentValue;
      return;
    }

    const wins=records.reduce((total,record) => total + record.wins,0);
    const losses=records.reduce((total,record) => total + record.losses,0);
    const denominator=wins + losses;
    if (!denominator) return;

    const combined=wins + '-' + losses;
    const winPct=Math.round((wins / denominator) * 100) + '%';
    recordInput.value=combined;
    pctInput.value=winPct;
    recordInput.dataset.autoOpponentValue=combined;
    pctInput.dataset.autoOpponentValue=winPct;
  }

  function applyCachedWriterFighter(dialog, type, side, fighter) {
    if (type === 'stats') {
      const input = dialog.querySelector('[data-stats-fighter="' + side + '"]');
      if (input) input.value = fighter.name;
      const rows = dialog.querySelector('[data-stats-row-list]');
      const values = [
        ['Significant Strikes / Minute',displayComparisonValue(fighter.stats?.slpm)],
        ['Sig. Strikes Absorbed / Minute',displayComparisonValue(fighter.stats?.sapm)],
        ['Striking Accuracy',displayComparisonValue(fighter.stats?.strAccuracy)],
        ['Striking Defense',displayComparisonValue(fighter.stats?.strDefense)],
        ['Takedowns / 15 Minutes',displayComparisonValue(fighter.stats?.tdAvg)],
        ['Takedown Accuracy',displayComparisonValue(fighter.stats?.tdAccuracy)],
        ['Takedown Defense',displayComparisonValue(fighter.stats?.tdDefense)],
        ['Submission Attempts / 15',displayComparisonValue(fighter.stats?.subAvg)]
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
    if (image && fighter.image) {
      const previousImage = image.value.trim();
      if (previousImage && previousImage !== fighter.image) {
        const xInput=dialog.querySelector('[data-tale-image-x="' + side + '"]');
        const yInput=dialog.querySelector('[data-tale-image-y="' + side + '"]');
        const zoomInput=dialog.querySelector('[data-tale-image-zoom="' + side + '"]');
        if (xInput) xInput.value='50';
        if (yInput) yInput.value='50';
        if (zoomInput) zoomInput.value='100';
      }
      image.value = fighter.image;
    }
    const recent = recentRowsFromFighter(fighter);
    renderRecentRows(dialog.querySelector('[data-tale-form-list="' + side + '"]'),recent);
    const last5 = dialog.querySelector('[data-tale-last5="' + side + '"]');
    if (last5 && recent.length) last5.value = lastFiveFromRows(recent);
    const rows = dialog.querySelector('[data-tale-row-list]');
    const ufcRecord = fighter.ufcRecord || recordFromHistory(fighter.history,new Set(['ufc']));
    setComparisonValue(rows,'Record',side,displayComparisonValue(fighter.record));
    setComparisonValue(rows,'Age',side,displayComparisonValue(ageFromDob(fighter.bio?.dob)));
    setComparisonValue(rows,'Height',side,displayComparisonValue(fighter.bio?.height));
    setComparisonValue(rows,'Arm Reach',side,displayComparisonValue(fighter.bio?.reach));
    setComparisonValue(rows,'UFC Record',side,displayComparisonValue(ufcRecord));
    setComparisonValue(rows,'Record Outside UFC',side,displayComparisonValue(fighter.recordOutsideUfc || subtractRecords(fighter.record,ufcRecord)));
    applyCareerComparisonValues(rows,side,fighter.career);
    const strength=fighter.opponentStrength;
    if (strength?.complete && strength.record && Number.isFinite(Number(strength.winPct))) {
      const recordInput=dialog.querySelector('[data-tale-opponents-record="' + side + '"]');
      const pctInput=dialog.querySelector('[data-tale-opponents-pct="' + side + '"]');
      if (canAutoFillTaleOpponentStrength(recordInput,pctInput)) {
        const pct=Number(strength.winPct) + '%';
        recordInput.value=strength.record;
        pctInput.value=pct;
        recordInput.dataset.autoOpponentValue=strength.record;
        pctInput.dataset.autoOpponentValue=pct;
      }
    }
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
    applyCareerComparisonValues(rows,side,{
      ...(fighter.career || {}),
      ...(profile.career || {})
    });

    const recent = recentRowsFromFighter(fighter,profile);
    if (recent.length) {
      renderRecentRows(dialog.querySelector('[data-tale-form-list="' + side + '"]'),recent);
      const last5 = dialog.querySelector('[data-tale-last5="' + side + '"]');
      if (last5) last5.value = lastFiveFromRows(recent);
    }
    populateTaleOpponentStrength(dialog,side,fighter,profile);
  }

  function cachedSourceStateForFighter(fighter) {
    const latest = fighter.latestBoutDate || fighter.stats?.sample?.latestBoutDate || fighter.history?.[0]?.date || null;
    const bookingDate = fighter?.booking?.date || null;
    const todayValue = today();
    if (!fighter.stats) {
      return {
        state:'verified',
        text:'No UFCStats sample yet · unavailable Stats fields marked N/A' +
          (fighter.careerSource?.source ? ' · career verified via ' + fighter.careerSource.source : '')
      };
    }
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
    const latest = payload?.profile?.latestBoutDate || fighter.latestBoutDate || fighter.stats?.sample?.latestBoutDate || null;
    const bookingDate = fighter?.booking?.date || null;
    const todayValue = today();
    const pendingKnownFight = bookingDate && bookingDate <= todayValue && (!latest || latest < bookingDate);
    if (pendingKnownFight) {
      return {
        state:'warning',
        text:'Update pending · known ' + formatLookupDate(bookingDate) + ' fight is not in the stat sample yet · using through ' + formatLookupDate(latest) + '.'
      };
    }
    if (!payload?.liveUfcStats) {
      const careerStatus = payload?.liveCareerFallback
        ? ' · career checked live via ' + (payload.careerSource || 'fallback')
        : (payload?.liveUfcProfile ? ' · UFC profile checked live' : '');
      if (!fighter.stats) {
        return {
          state:'verified',
          text:'No UFCStats sample yet · unavailable Stats fields marked N/A' + careerStatus
        };
      }
      return {
        state:'verified',
        text:'Verified UFCStats data loaded · live UFCStats probe unavailable' +
          careerStatus +
          ' · sample through ' + formatLookupDate(latest)
      };
    }
    return {
      state:'live',
      text:'LIVE UFCStats · latest bout ' + formatLookupDate(latest) + ' · checked ' +
        new Date(payload.fetchedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})
    };
  }

  async function selectWriterFighter(input, fighter, type, side) {
    const dialog = type === 'stats' ? app.querySelector('[data-stats-dialog]') : app.querySelector('[data-tale-dialog]');
    if (!input || !fighter || !dialog) return;
    input.dataset.fighterId = fighter.id;
    input.dataset.ufcStatsId = fighter.ufcStatsId || '';
    input.dataset.bookingDate = fighter.booking?.date || '';
    input.value = fighter.name;
    applyCachedWriterFighter(dialog,type,side,fighter);
    const cachedState = cachedSourceStateForFighter(fighter);
    input.dataset.sourceMode = 'verified-cache';
    input.dataset.sourceFetchedAt = fighter.statsBuiltAt || fighter.checkedAt || '';
    input.dataset.latestBoutDate = fighter.latestBoutDate || fighter.stats?.sample?.latestBoutDate || fighter.history?.[0]?.date || '';
    input.dataset.sourceUrl = fighter.sourceUrl || '';
    setLookupStatus(input,cachedState.state,cachedState.text + ' · checking live…');

    try {
      const payload = await fetchLiveWriterFighter(fighter);
      applyLiveWriterFighter(dialog,type,side,fighter,payload);
      input.dataset.sourceMode = payload.liveUfcStats
        ? 'live'
        : (payload.liveCareerFallback || payload.liveUfcProfile ? 'live-profile' : 'verified-cache');
      input.dataset.sourceFetchedAt = payload.liveUfcStats
        ? (payload.fetchedAt || '')
        : (fighter.statsBuiltAt || fighter.checkedAt || '');
      input.dataset.latestBoutDate = payload.profile?.latestBoutDate ||
        fighter.latestBoutDate || fighter.stats?.sample?.latestBoutDate || '';
      input.dataset.sourceUrl = payload.liveUfcStats
        ? (payload.sourceUrl || fighter.sourceUrl || '')
        : (fighter.sourceUrl || payload.sourceUrl || '');
      const sourceState = sourceStateForFighter(fighter,payload);
      setLookupStatus(input,sourceState.state,sourceState.text);
    } catch (error) {
      input.dataset.sourceMode = 'verified-cache';
      input.dataset.sourceFetchedAt = fighter.statsBuiltAt || fighter.checkedAt || '';
      input.dataset.latestBoutDate = fighter.latestBoutDate || fighter.stats?.sample?.latestBoutDate || fighter.history?.[0]?.date || '';
      const fallbackState = cachedSourceStateForFighter(fighter);
      setLookupStatus(input,fallbackState.state,'Verified stats loaded · live refresh unavailable · ' + fallbackState.text);
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
      delete input.dataset.bookingDate;
      if (type === 'tale') {
        const recordInput=dialog.querySelector('[data-tale-opponents-record="' + side + '"]');
        const pctInput=dialog.querySelector('[data-tale-opponents-pct="' + side + '"]');
        if (recordInput) {
          recordInput.value='';
          delete recordInput.dataset.autoOpponentValue;
          delete recordInput.dataset.opponentStrengthRequest;
        }
        if (pctInput) {
          pctInput.value='';
          delete pctInput.dataset.autoOpponentValue;
          delete pctInput.dataset.opponentStrengthRequest;
        }
      }
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
    const rows=normalizeComparisonRows(config.rows,statsDefaultRowLabels);
    const fighterA=String(config.fighterA||'Fighter A').trim()||'Fighter A';
    const fighterB=String(config.fighterB||'Fighter B').trim()||'Fighter B';
    const renderRows=(items)=>items.map((row,index)=>
      '<div class="fs-stat-row'+(index===0?' featured':'')+'"><strong>'+
      escapeHtml(row.a||'—')+'</strong><span>'+escapeHtml(row.label)+'</span><strong>'+
      escapeHtml(row.b||'—')+'</strong></div>'
    ).join('');
    const striking=rows.slice(0,4);
    const grappling=rows.slice(4,8);
    const inner=
      '<div class="fight-stats-sleek"><div class="fs-shell">'+
        '<div class="fs-header">'+
          '<div class="fs-fighter fs-fighter-left"><span class="fs-side-label">RED CORNER</span><strong>'+escapeHtml(fighterA)+'</strong></div>'+
          '<div class="fs-header-center"><strong>STATS</strong><i></i></div>'+
          '<div class="fs-fighter fs-fighter-right"><span class="fs-side-label">BLUE CORNER</span><strong>'+escapeHtml(fighterB)+'</strong></div>'+
        '</div>'+
        '<div class="fs-section">'+
          '<div class="fs-section-title"><span>Striking</span></div>'+
          renderRows(striking)+
        '</div>'+
        '<div class="fs-section fs-section-grappling">'+
          '<div class="fs-section-title"><span>Grappling</span></div>'+
          renderRows(grappling)+
        '</div>'+
      '</div></div>';
    return structuredSection('stats',config,inner);
  }

  function recentFormMarkup(value) {
    return normalizeRecentRows(value).map(row=>{
      const result=String(row.result||'').toUpperCase();
      const resultClass=result==='W'?'win':result==='L'?'loss':'draw';
      return '<div class="fc-form-row"><span class="fc-result '+resultClass+'">'+escapeHtml(result||'—')+
        '</span><div class="fc-form-copy"><strong>'+escapeHtml(row.opponent)+
        '</strong><small>'+escapeHtml(row.detail)+'</small></div></div>';
    }).join('');
  }

  function fighterPortraitMarkup(side, fighter) {
    const image=String(fighter.image||'').trim();
    const portrait=normalizeTalePortrait(fighter);
    return '<div class="fc-portrait ring-'+side+'" data-portrait-side="'+(side==='left'?'a':'b')+'">'+
      '<span class="fc-ring"></span><span class="fc-ring fc-ring-inner"></span>'+
      (image?'<img class="fc-portrait-source" data-portrait-source src="'+escapeHtml(image)+'" alt="'+escapeHtml(fighter.name||'')+
        '" data-portrait-x="'+portrait.x+'" data-portrait-y="'+portrait.y+'" data-portrait-zoom="'+portrait.zoom+'">':'')+
      '</div>';
  }

  function fighterTopMarkup(side, fighter) {
    const odds=String(fighter.odds||'').trim()||'—';
    const oddsClass=side==='left'?' fc-red-odds':' fc-blue-odds';
    const liveSide=side==='left'?'a':'b';
    return '<div class="fc-fighter fc-'+side+'">'+
      fighterPortraitMarkup(side,fighter)+
      '<div class="fc-meta"><span class="fc-division">'+escapeHtml(fighter.division||'')+
      '</span><h2>'+escapeHtml(fighter.name||'')+
      '</h2><div class="fc-meta-strip"><div class="fc-odds'+oddsClass+'" data-live-odds-side="'+liveSide+
      '" data-live-odds-fighter="'+escapeHtml(fighter.name||'')+'" data-live-odds-state="pending"><span>ML</span><strong data-live-odds-value>'+
      escapeHtml(odds)+'</strong></div><div class="fc-last5"><span class="fc-last5-record">'+
      escapeHtml(fighter.last5||'—')+'</span><span class="fc-last5-label">Last 5</span></div></div></div></div>';
  }

  function buildTaleVisual(config) {
    config=normalizeTaleConfig(config);
    const a=config.a||{}, b=config.b||{};
    const rows=normalizeComparisonRows(config.rows,taleDefaultRowLabels);
    const taleRows=rows.map((row,index)=>
      '<div class="fc-tale-row'+(index===0?' featured':'')+'"><strong>'+escapeHtml(row.a||'—')+
      '</strong><span>'+escapeHtml(row.label)+'</span><strong>'+escapeHtml(row.b||'—')+'</strong></div>'
    ).join('');
    const recentA=recentFormMarkup(a.recent), recentB=recentFormMarkup(b.recent);
    const recent=recentA||recentB
      ? '<div class="fc-form-section"><div class="fc-section-title fc-form-title"><span>Recent Form</span></div>'+
        '<div class="fc-form-wrap"><div class="fc-column"><div class="fc-mobile-column-label"><span>RECENT FORM</span><strong>'+
        escapeHtml(a.name||'Fighter A')+'</strong></div>'+recentA+
        '</div><div class="fc-column"><div class="fc-mobile-column-label"><span>RECENT FORM</span><strong>'+
        escapeHtml(b.name||'Fighter B')+'</strong></div>'+recentB+'</div></div></div>'
      : '';
    const opponents=(a.opponentsRecord||b.opponentsRecord||a.opponentsPct||b.opponentsPct)
      ? '<div class="fc-opponents"><div class="fc-opponent-stat"><strong>'+escapeHtml(a.opponentsRecord||'—')+
        '</strong><span>'+escapeHtml(a.opponentsPct||'')+'</span></div><div class="fc-opponent-label">OPPONENTS COMBINED RECORD</div>'+
        '<div class="fc-opponent-stat"><strong>'+escapeHtml(b.opponentsRecord||'—')+'</strong><span>'+
        escapeHtml(b.opponentsPct||'')+'</span></div></div>'
      : '';
    const eventDate=String(config.eventDate||a.source?.bookingDate||b.source?.bookingDate||'').trim();
    const inner=
      '<div class="fight-compare-sleek" data-live-odds-matchup data-live-odds-fighter-a="'+escapeHtml(a.name||'')+
      '" data-live-odds-fighter-b="'+escapeHtml(b.name||'')+'" data-live-odds-event-date="'+escapeHtml(eventDate)+'"><div class="fc-shell">'+
        '<div class="fc-top">'+fighterTopMarkup('left',a)+
          '<div class="fc-center-badge"><strong>MATCHUP</strong><i></i></div>'+
          fighterTopMarkup('right',b)+'</div>'+
        '<div class="fc-tale"><div class="fc-section-title"><span>Tale of the Tape</span></div>'+taleRows+'</div>'+
        recent+opponents+
      '</div></div>';
    return structuredSection('tale',config,inner);
  }

  function buildPickVisual(config) {
    const fighter = String(config.fighter || '').trim();
    const method = String(config.method || '').trim();
    const round = String(config.round || '').trim();
    const note = String(config.note || '').trim();
    const result =
      (method ? '<span class="article-pick-card__method">' + escapeHtml(method) + '</span>' : '') +
      (method && round ? '<span class="article-pick-card__dot" aria-hidden="true"></span>' : '') +
      (round ? '<span class="article-pick-card__round">' + escapeHtml(round) + '</span>' : '');
    const inner =
      '<aside class="article-pick-card article-pick-card--slim">' +
        '<div class="article-pick-card__rule"><span>Matlock\'s Pick</span></div>' +
        '<div class="article-pick-card__centerline">' +
          '<strong class="article-pick-card__fighter">' + escapeHtml(fighter) + '</strong>' +
          (result ? '<span class="article-pick-card__divider" aria-hidden="true"></span><span class="article-pick-card__result">' + result + '</span>' : '') +
        '</div>' +
        (note ? '<p class="article-pick-card__note">' + escapeHtml(note) + '</p>' : '') +
      '</aside>';
    return structuredSection('pick', config, inner);
  }

  function saveStructuredBlock(type, label, code) {
    const insertingNewBlock = !(editingStructuredBlockId && htmlBlocks.has(editingStructuredBlockId));
    if (!insertingNewBlock) {
      const block = htmlBlocks.get(editingStructuredBlockId);
      block.label = label;
      block.code = code;
      htmlBlocks.set(editingStructuredBlockId, block);
      replaceHtmlToken(editingStructuredBlockId, htmlBlockToken(block));
    } else {
      const id = htmlBlockId();
      const block = { id, label, code };
      htmlBlocks.set(id, block);
      insertBlock(htmlBlockToken(block), { preserveScroll: true });
    }
    editingStructuredBlockId = '';
    if (insertingNewBlock) setHtmlBlockPanel(false);
    renderHtmlBlockRail();
    scheduleAutosave();
    updatePreview();
  }

  function taleImagePreview(side, localUrl = '') {
    const dialog = app.querySelector('[data-tale-dialog]');
    if (!dialog) return;
    const path = dialog.querySelector('[data-tale-image-path="' + side + '"]')?.value.trim() || '';
    const drop = dialog.querySelector('[data-tale-image-drop="' + side + '"]');
    const image = dialog.querySelector('[data-tale-image-preview="' + side + '"]');
    const empty = dialog.querySelector('[data-tale-image-empty="' + side + '"]');
    if (!drop || !image || !empty) return;
    const x = Number(dialog.querySelector('[data-tale-image-x="' + side + '"]')?.value || 50);
    const y = Number(dialog.querySelector('[data-tale-image-y="' + side + '"]')?.value || 50);
    const zoom = Number(dialog.querySelector('[data-tale-image-zoom="' + side + '"]')?.value || 100);
    const src = localUrl || (path ? writerPreviewAssetUrl(path) : '');
    image.hidden = !src;
    empty.hidden = Boolean(src);
    image.dataset.portraitX = String(x);
    image.dataset.portraitY = String(y);
    image.dataset.portraitZoom = String(Math.max(100,zoom||100));
    if (src) {
      const nextSrc = new URL(src,location.href).href;
      if (image.src !== nextSrc) {
        drop.classList.remove('portrait-canvas-ready');
        image.src = src;
      }
      window.MatlockPortraitCrop?.render?.(image,{x,y,zoom:Math.max(100,zoom||100),frame:drop});
    } else {
      image.removeAttribute('src');
      drop.classList.remove('portrait-canvas-ready');
      drop.querySelector(':scope > canvas.matlock-portrait-canvas')?.remove();
    }
  }

  function resetStatsDialog(config = {}) {
    const dialog=app.querySelector('[data-stats-dialog]');
    dialog.querySelector('[data-stats-fighter="a"]').value=config.fighterA||'';
    dialog.querySelector('[data-stats-fighter="b"]').value=config.fighterB||'';
    ['a','b'].forEach(side => {
      const input=dialog.querySelector('[data-stats-fighter="'+side+'"]');
      const source=side==='a'?(config.sourceA||{}):(config.sourceB||{});
      for (const key of ['fighterId','ufcStatsId','sourceMode','sourceFetchedAt','latestBoutDate','bookingDate','sourceUrl']) delete input.dataset[key];
      if (source.fighterId) input.dataset.fighterId=source.fighterId;
      if (source.ufcStatsId) input.dataset.ufcStatsId=source.ufcStatsId;
      if (source.mode) input.dataset.sourceMode=source.mode;
      if (source.fetchedAt) input.dataset.sourceFetchedAt=source.fetchedAt;
      if (source.latestBoutDate) input.dataset.latestBoutDate=source.latestBoutDate;
      if (source.bookingDate) input.dataset.bookingDate=source.bookingDate;
      if (source.sourceUrl) input.dataset.sourceUrl=source.sourceUrl;
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
    const officialResult = dialog.querySelector('[data-pick-official-result]');
    const outcome = dialog.querySelector('[data-pick-outcome]');
    if (officialResult) officialResult.value = config.officialResult || '';
    if (outcome) outcome.value = config.outcome || '';
  }

  function cleanManagedMatchupHeading(value) {
    return String(value || '')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .replace(/[*_]/g, '')
      .replace(/\s+#+\s*$/, '')
      .trim();
  }

  function collectManagedPickRows() {
    const rows = [];
    let matchup = '';
    String(bodyEditor.value || '').split(/\r?\n/).forEach(line => {
      const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
      if (heading) matchup = cleanManagedMatchupHeading(heading[1]);

      const token = htmlTokenMatch(line);
      if (!token) return;
      const id = token[1];
      const block = htmlBlocks.get(id);
      const meta = structuredMeta(block?.code);
      if (!meta || meta.type !== 'pick') return;
      rows.push({
        id,
        matchup: matchup || String(meta.config?.matchup || '').trim() || 'Fight',
        config: meta.config || {}
      });
    });
    return rows;
  }

  function renderPicksManager() {
    const dialog = app.querySelector('[data-picks-manager-dialog]');
    const list = dialog?.querySelector('[data-picks-manager-list]');
    const summary = dialog?.querySelector('[data-picks-manager-summary]');
    if (!dialog || !list || !summary) return [];

    const rows = collectManagedPickRows();
    const graded = rows.filter(row => ['correct','incorrect'].includes(String(row.config?.outcome || '')));
    const correct = graded.filter(row => row.config.outcome === 'correct').length;
    summary.innerHTML = rows.length
      ? '<strong>' + rows.length + ' picks</strong><span>' + graded.length + ' graded · ' + correct + ' correct</span>'
      : '<strong>No picks found</strong><span>Add Matlock pick blocks to the article first.</span>';

    list.innerHTML = rows.map((row, index) => {
      const cfg = row.config || {};
      const pickDetail = [cfg.method, cfg.round].filter(Boolean).join(' · ');
      return '<section class="writer-picks-manager-row" data-picks-manager-row="' + escapeHtml(row.id) + '">' +
        '<div class="writer-picks-manager-row-head"><span>Fight ' + (index + 1) + '</span><strong>' + escapeHtml(row.matchup) + '</strong></div>' +
        '<div class="writer-picks-manager-pick"><small>Your pick</small><strong>' + escapeHtml(cfg.fighter || '—') + '</strong>' +
          (pickDetail ? '<span>' + escapeHtml(pickDetail) + '</span>' : '') + '</div>' +
        '<label class="writer-field writer-picks-manager-result"><span>Official result</span><input type="text" data-picks-manager-result value="' + escapeHtml(cfg.officialResult || '') + '" placeholder="Winner · Method R#"></label>' +
        '<label class="writer-field writer-picks-manager-status"><span>Status</span><select data-picks-manager-outcome>' +
          '<option value=""' + (!cfg.outcome ? ' selected' : '') + '>Pending</option>' +
          '<option value="correct"' + (cfg.outcome === 'correct' ? ' selected' : '') + '>Correct</option>' +
          '<option value="incorrect"' + (cfg.outcome === 'incorrect' ? ' selected' : '') + '>Incorrect</option>' +
          '<option value="void"' + (cfg.outcome === 'void' ? ' selected' : '') + '>No contest / void</option>' +
        '</select></label>' +
      '</section>';
    }).join('');

    return rows;
  }

  function openPicksManager() {
    const dialog = app.querySelector('[data-picks-manager-dialog]');
    if (!dialog) return;
    renderPicksManager();
    dialog.showModal();
  }

  function savePicksManager() {
    const dialog = app.querySelector('[data-picks-manager-dialog]');
    if (!dialog) return;
    const rows = collectManagedPickRows();
    let changed = 0;

    rows.forEach(row => {
      const editorRow = dialog.querySelector('[data-picks-manager-row="' + CSS.escape(row.id) + '"]');
      const block = htmlBlocks.get(row.id);
      if (!editorRow || !block) return;
      const meta = structuredMeta(block.code);
      if (!meta || meta.type !== 'pick') return;

      const config = {
        ...meta.config,
        officialResult: editorRow.querySelector('[data-picks-manager-result]')?.value.trim() || '',
        outcome: editorRow.querySelector('[data-picks-manager-outcome]')?.value || ''
      };
      block.code = buildPickVisual(config);
      block.label = 'Pick · ' + (config.fighter || 'Fighter');
      htmlBlocks.set(row.id, block);
      changed++;
    });

    renderHtmlBlockRail();
    bodyEditor.dispatchEvent(new Event('input', { bubbles:true }));
    dialog.close();
    showToast(changed ? 'Picks and results updated.' : 'No picks to update.');
  }

  function resetTaleDialog(config = {}) {
    const dialog=app.querySelector('[data-tale-dialog]');
    const a=config.a||{}, b=config.b||{};
    dialog.querySelector('[data-tale-a]').value=a.name||'';
    dialog.querySelector('[data-tale-b]').value=b.name||'';
    ['a','b'].forEach(side => {
      const input=dialog.querySelector(side==='a'?'[data-tale-a]':'[data-tale-b]');
      const fighter=side==='a'?a:b;
      const source=fighter.source||{};
      for (const key of ['fighterId','ufcStatsId','sourceMode','sourceFetchedAt','latestBoutDate','bookingDate','sourceUrl']) delete input.dataset[key];
      if (source.fighterId) input.dataset.fighterId=source.fighterId;
      if (source.ufcStatsId) input.dataset.ufcStatsId=source.ufcStatsId;
      if (source.mode) input.dataset.sourceMode=source.mode;
      if (source.fetchedAt) input.dataset.sourceFetchedAt=source.fetchedAt;
      if (source.latestBoutDate) input.dataset.latestBoutDate=source.latestBoutDate;
      if (source.bookingDate||config.eventDate) input.dataset.bookingDate=source.bookingDate||config.eventDate;
      if (source.sourceUrl) input.dataset.sourceUrl=source.sourceUrl;
      setLookupStatus(input,'','');
    });
    ['a','b'].forEach(side=>{
      const fighter=side==='a'?a:b;
      dialog.querySelector('[data-tale-division="'+side+'"]').value=fighter.division||'';
      dialog.querySelector('[data-tale-odds="'+side+'"]').value=fighter.odds||'';
      dialog.querySelector('[data-tale-last5="'+side+'"]').value=fighter.last5||'';
      const portrait=normalizeTalePortrait(fighter);
      dialog.querySelector('[data-tale-image-path="'+side+'"]').value=fighter.image||'';
      dialog.querySelector('[data-tale-image-x="'+side+'"]').value=portrait.x;
      dialog.querySelector('[data-tale-image-y="'+side+'"]').value=portrait.y;
      dialog.querySelector('[data-tale-image-zoom="'+side+'"]').value=portrait.zoom;
      const opponentsRecordInput=dialog.querySelector('[data-tale-opponents-record="'+side+'"]');
      const opponentsPctInput=dialog.querySelector('[data-tale-opponents-pct="'+side+'"]');
      opponentsRecordInput.value=fighter.opponentsRecord||'';
      opponentsPctInput.value=fighter.opponentsPct||'';
      delete opponentsRecordInput.dataset.autoOpponentValue;
      delete opponentsRecordInput.dataset.opponentStrengthRequest;
      delete opponentsPctInput.dataset.autoOpponentValue;
      delete opponentsPctInput.dataset.opponentStrengthRequest;
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
    if (type === 'picks-manager') {
      openPicksManager();
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

