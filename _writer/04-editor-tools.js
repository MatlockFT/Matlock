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

  const taleDefaultRows = [
    'Record |  | ',
    'Age |  | ',
    'Height |  | ',
    'Arm Reach |  | ',
    'UFC Record |  | ',
    'Record Outside UFC |  | ',
    'Total Finishes |  | ',
    'TKO / KO |  | ',
    'Submission |  | ',
    'Unanimous Decision |  | ',
    'Split Decision |  | '
  ].join('\n');

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

  function structuredSection(type, config, inner) {
    return '<section class="article-html-visual" data-writer-block="' + type + '" data-writer-config="' +
      encodedStructuredConfig(config) + '">\n' + inner + '\n</section>';
  }

  function buildStatsVisual(config) {
    const body = pipeRows(config.rows, 3).map(row =>
      '<tr><td>' + escapeHtml(row[0]) + '</td><td>' + escapeHtml(row[1]) +
      '</td><td>' + escapeHtml(row[2]) + '</td></tr>'
    ).join('');
    return structuredSection('stats', config,
      '<div class="matlock-stats-card"><table><thead><tr><th>STAT</th><th>COUNT / LEADER</th><th>FIGHTER(S)</th></tr></thead><tbody>' +
      body + '</tbody></table></div>'
    );
  }

  function recentFormMarkup(text) {
    return pipeRows(text, 3).map(row => {
      const result = String(row[0] || '').toUpperCase();
      const resultClass = result === 'W' ? 'win' : result === 'L' ? 'loss' : 'draw';
      return '<div class="mfc-form-row"><span class="mfc-result ' + resultClass + '">' +
        escapeHtml(result || '—') + '</span><div><strong>' + escapeHtml(row[1]) +
        '</strong><small>' + escapeHtml(row[2]) + '</small></div></div>';
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
    const a = config.a || {};
    const b = config.b || {};
    const taleRows = pipeRows(config.rows, 3).map((row, index) =>
      '<div class="mfc-tale-row' + (index === 0 ? ' featured' : '') + '"><strong>' +
      escapeHtml(row[1]) + '</strong><span>' + escapeHtml(row[0]) +
      '</span><strong>' + escapeHtml(row[2]) + '</strong></div>'
    ).join('');
    const recentA = recentFormMarkup(a.recent);
    const recentB = recentFormMarkup(b.recent);
    const recent = recentA || recentB
      ? '<div class="mfc-form-wrap"><div class="mfc-column"><div class="mfc-mobile-column-label"><span>RECENT FORM</span><strong>' +
        escapeHtml(a.name || 'Fighter A') + '</strong></div>' + recentA +
        '</div><div class="mfc-column"><div class="mfc-mobile-column-label"><span>RECENT FORM</span><strong>' +
        escapeHtml(b.name || 'Fighter B') + '</strong></div>' + recentB + '</div></div>'
      : '';
    const opponents = (a.opponentsRecord || b.opponentsRecord || a.opponentsPct || b.opponentsPct)
      ? '<div class="mfc-opponents"><div><strong>' + escapeHtml(a.opponentsRecord || '—') +
        '</strong><span>' + escapeHtml(a.opponentsPct || '') + '</span></div><p>OPPONENTS COMBINED RECORD</p><div><strong>' +
        escapeHtml(b.opponentsRecord || '—') + '</strong><span>' + escapeHtml(b.opponentsPct || '') + '</span></div></div>'
      : '';
    const inner = '<div class="matlock-fight-card"><div class="mfc-top">' +
      fighterTopMarkup('left', a) +
      '<div class="mfc-center"><strong>MATCHUP</strong><i></i></div>' +
      fighterTopMarkup('right', b) +
      '</div>' + recent + opponents +
      '<div class="mfc-tale"><div class="mfc-section-title">TALE OF THE TAPE</div>' +
      taleRows + '</div></div>';
    return structuredSection('tale', config, inner);
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
    app.querySelector('[data-stats-dialog] [data-stats-rows]').value = config.rows || '';
  }

  function resetPickDialog(config = {}) {
    const dialog = app.querySelector('[data-pick-dialog]');
    dialog.querySelector('[data-pick-fighter]').value = config.fighter || '';
    dialog.querySelector('[data-pick-method]').value = config.method || '';
    dialog.querySelector('[data-pick-round]').value = config.round || '';
    dialog.querySelector('[data-pick-note]').value = config.note || '';
  }

  function resetTaleDialog(config = {}) {
    const dialog = app.querySelector('[data-tale-dialog]');
    const a = config.a || {};
    const b = config.b || {};
    dialog.querySelector('[data-tale-a]').value = a.name || '';
    dialog.querySelector('[data-tale-b]').value = b.name || '';
    ['a','b'].forEach(side => {
      const fighter = side === 'a' ? a : b;
      dialog.querySelector('[data-tale-division="' + side + '"]').value = fighter.division || '';
      dialog.querySelector('[data-tale-odds="' + side + '"]').value = fighter.odds || '';
      dialog.querySelector('[data-tale-last5="' + side + '"]').value = fighter.last5 || '';
      dialog.querySelector('[data-tale-image-path="' + side + '"]').value = fighter.image || '';
      dialog.querySelector('[data-tale-image-x="' + side + '"]').value = fighter.x ?? 50;
      dialog.querySelector('[data-tale-image-y="' + side + '"]').value = fighter.y ?? 50;
      dialog.querySelector('[data-tale-image-zoom="' + side + '"]').value = fighter.zoom ?? 100;
      dialog.querySelector('[data-tale-recent="' + side + '"]').value = fighter.recent || '';
      dialog.querySelector('[data-tale-opponents-record="' + side + '"]').value = fighter.opponentsRecord || '';
      dialog.querySelector('[data-tale-opponents-pct="' + side + '"]').value = fighter.opponentsPct || '';
      taleImagePreview(side);
    });
    dialog.querySelector('[data-tale-rows]').value = config.rows || taleDefaultRows;
  }

  function openStructuredBlockById(id) {
    const block = htmlBlocks.get(id);
    const meta = structuredMeta(block?.code);
    if (!meta) return false;
    editingStructuredBlockId = id;
    if (meta.type === 'stats') {
      resetStatsDialog(meta.config);
      app.querySelector('[data-stats-dialog]').showModal();
      return true;
    }
    if (meta.type === 'tale') {
      resetTaleDialog(meta.config);
      app.querySelector('[data-tale-dialog]').showModal();
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
      app.querySelector('[data-stats-dialog]').showModal();
      return;
    }
    if (type === 'tale') {
      editingStructuredBlockId = '';
      resetTaleDialog();
      app.querySelector('[data-tale-dialog]').showModal();
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

