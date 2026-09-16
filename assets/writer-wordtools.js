(() => {
  const app = document.querySelector('[data-writer-app]');
  if (!app) return;

  const editor = app.querySelector('#writer-body');
  const toolbar = app.querySelector('.writer-toolbar');
  const primaryGroup = toolbar?.querySelector('.writer-toolbar-group');
  const modeActions = app.querySelector('.writer-modebar-actions');
  const editorPane = app.querySelector('.writer-editor-pane');
  const editorView = app.querySelector('[data-editor-view]');
  if (!editor || !toolbar || !primaryGroup || !modeActions || !editorPane) return;

  const MAX_HISTORY = 120;
  const undoStack = [];
  const redoStack = [];
  let applyingHistory = false;
  let lastTypingCheckpoint = 0;
  let lastInputType = '';
  let outlineTimer = 0;

  function snapshot() {
    return {
      value: editor.value,
      start: editor.selectionStart,
      end: editor.selectionEnd,
      scrollTop: editor.scrollTop
    };
  }

  function sameSnapshot(a, b) {
    return Boolean(a && b && a.value === b.value && a.start === b.start && a.end === b.end);
  }

  function pushUndo(state = snapshot()) {
    const previous = undoStack[undoStack.length - 1];
    if (previous && sameSnapshot(previous, state)) return;
    undoStack.push(state);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    updateHistoryButtons();
  }

  function applySnapshot(state) {
    if (!state) return;
    applyingHistory = true;
    editor.value = state.value;
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(state.start, state.end);
    editor.scrollTop = state.scrollTop || 0;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    applyingHistory = false;
    scheduleOutline();
    updateSelectionStat();
  }

  function undo() {
    if (!undoStack.length) return;
    const current = snapshot();
    const target = undoStack.pop();
    if (!sameSnapshot(current, target)) redoStack.push(current);
    applySnapshot(target);
    updateHistoryButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    const current = snapshot();
    const target = redoStack.pop();
    undoStack.push(current);
    applySnapshot(target);
    updateHistoryButtons();
  }

  function dispatchEdit() {
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    scheduleOutline();
    updateSelectionStat();
  }

  function lineBounds(start = editor.selectionStart, end = editor.selectionEnd) {
    const value = editor.value;
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const next = value.indexOf('\n', end);
    const lineEnd = next === -1 ? value.length : next;
    return { lineStart, lineEnd };
  }

  function replaceLines(transform) {
    pushUndo();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const { lineStart, lineEnd } = lineBounds(start, end);
    const source = editor.value.slice(lineStart, lineEnd);
    const next = transform(source.split('\n')).join('\n');
    editor.setRangeText(next, lineStart, lineEnd, 'select');
    editor.focus();
    dispatchEdit();
  }

  function toggleHeading(level) {
    replaceLines(lines => lines.map(line => {
      const stripped = line.replace(/^\s{0,3}#{1,6}\s+/, '');
      const prefix = '#'.repeat(level) + ' ';
      if (new RegExp(`^\\s{0,3}#{${level}}\\s+`).test(line)) return stripped;
      return prefix + stripped;
    }));
  }

  function toggleBullets() {
    replaceLines(lines => {
      const meaningful = lines.filter(line => line.trim());
      const allBulleted = meaningful.length > 0 && meaningful.every(line => /^\s*[-*+]\s+/.test(line));
      return lines.map(line => {
        if (!line.trim()) return line;
        if (allBulleted) return line.replace(/^(\s*)[-*+]\s+/, '$1');
        const indent = line.match(/^\s*/)?.[0] || '';
        return `${indent}- ${line.trimStart().replace(/^(?:[-*+]|\d+[.)])\s+/, '')}`;
      });
    });
  }

  function toggleNumbered() {
    replaceLines(lines => {
      const meaningful = lines.filter(line => line.trim());
      const allNumbered = meaningful.length > 0 && meaningful.every(line => /^\s*\d+[.)]\s+/.test(line));
      let n = 1;
      return lines.map(line => {
        if (!line.trim()) return line;
        if (allNumbered) return line.replace(/^(\s*)\d+[.)]\s+/, '$1');
        const indent = line.match(/^\s*/)?.[0] || '';
        const content = line.trimStart().replace(/^(?:\d+[.)]|[-*+])\s+/, '');
        return `${indent}${n++}. ${content}`;
      });
    });
  }

  function toggleWrap(marker, placeholder) {
    pushUndo();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end);
    const before = editor.value.slice(Math.max(0, start - marker.length), start);
    const after = editor.value.slice(end, end + marker.length);
    if (selected && before === marker && after === marker) {
      editor.setRangeText(selected, start - marker.length, end + marker.length, 'select');
      editor.setSelectionRange(start - marker.length, end - marker.length);
    } else {
      const content = selected || placeholder;
      editor.setRangeText(`${marker}${content}${marker}`, start, end, 'end');
      const contentStart = start + marker.length;
      editor.setSelectionRange(contentStart, contentStart + content.length);
    }
    editor.focus();
    dispatchEdit();
  }

  function countWords(text) {
    const words = String(text || '').trim().match(/\b[\w’'-]+\b/g);
    return words ? words.length : 0;
  }

  function cleanHeadingText(text) {
    return String(text || '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_~`]/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+#+\s*$/, '')
      .trim();
  }

  function parseOutline() {
    const headings = [];
    let offset = 0;
    let fenced = false;
    for (const line of editor.value.split('\n')) {
      if (/^\s*```/.test(line)) fenced = !fenced;
      if (!fenced) {
        const match = line.match(/^\s*(#{2,3})\s+(.+)$/);
        if (match) headings.push({ level: match[1].length, text: cleanHeadingText(match[2]), offset });
      }
      offset += line.length + 1;
    }
    return headings;
  }

  function scrollEditorToOffset(offset) {
    const line = editor.value.slice(0, offset).split('\n').length - 1;
    const style = getComputedStyle(editor);
    const lineHeight = Number.parseFloat(style.lineHeight) || 24;
    editor.scrollTop = Math.max(0, line * lineHeight - editor.clientHeight * 0.28);
  }

  function scheduleOutline() {
    window.clearTimeout(outlineTimer);
    outlineTimer = window.setTimeout(renderOutline, 80);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderOutline() {
    if (!outlineList) return;
    const headings = parseOutline();
    outlineCount.textContent = `${headings.length} ${headings.length === 1 ? 'section' : 'sections'}`;
    if (!headings.length) {
      outlineList.innerHTML = '<p class="writer-wordtools-outline-empty">Add H2 or H3 headings to build the outline.</p>';
      return;
    }
    outlineList.innerHTML = headings.map((item, index) => (
      `<button type="button" class="writer-wordtools-outline-item level-${item.level}" data-wordtools-outline-offset="${item.offset}"><span>${item.level === 2 ? 'H2' : 'H3'}</span><strong>${escapeHtml(item.text || `Section ${index + 1}`)}</strong></button>`
    )).join('');
  }

  function safeLink(url) {
    const value = String(url || '').trim();
    if (/^(https?:\/\/|\/|#|mailto:)/i.test(value)) return value;
    return '';
  }

  function cleanPastedText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\u00a0\u2007\u202f]/g, ' ')
      .replace(/[\u200b\ufeff]/g, '')
      .replace(/\t/g, '  ')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n');
  }

  function tableToMarkdown(table) {
    const rows = [...table.querySelectorAll('tr')].map(row => [...row.querySelectorAll('th,td')].map(cell => cleanPastedText(cell.textContent).replace(/\|/g, '\\|').trim()));
    if (!rows.length) return '';
    const width = Math.max(...rows.map(row => row.length));
    rows.forEach(row => { while (row.length < width) row.push(''); });
    return [
      `| ${rows[0].join(' | ')} |`,
      `| ${Array(width).fill('---').join(' | ')} |`,
      ...rows.slice(1).map(row => `| ${row.join(' | ')} |`)
    ].join('\n');
  }

  function htmlToMarkdown(html) {
    const doc = new DOMParser().parseFromString(`<div data-wordtools-root>${html}</div>`, 'text/html');
    const root = doc.querySelector('[data-wordtools-root]');
    if (!root) return '';

    const renderChildren = node => [...node.childNodes].map(renderNode).join('');
    const renderListItem = (node, prefix) => {
      const clone = node.cloneNode(true);
      clone.querySelectorAll(':scope > ul, :scope > ol').forEach(list => list.remove());
      const body = cleanPastedText(renderChildren(clone)).replace(/\n+/g, ' ').trim();
      const nested = [...node.children]
        .filter(child => ['UL','OL'].includes(child.tagName))
        .map(child => renderNode(child).split('\n').filter(Boolean).map(line => `  ${line}`).join('\n'))
        .filter(Boolean)
        .join('\n');
      return `${prefix}${body}${nested ? `\n${nested}` : ''}`;
    };

    function renderNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName.toLowerCase();
      const children = () => renderChildren(node);
      if (['script','style','meta','link','svg'].includes(tag)) return '';
      if (tag === 'br') return '\n';
      if (tag === 'span') {
        let value = children();
        const style = String(node.getAttribute('style') || '').toLowerCase();
        if (/font-weight\s*:\s*(?:bold|[6-9]00)/.test(style)) value = `**${value.trim()}**`;
        if (/font-style\s*:\s*italic/.test(style)) value = `*${value.trim()}*`;
        if (/text-decoration[^;]*line-through/.test(style)) value = `~~${value.trim()}~~`;
        return value;
      }
      if (['strong','b'].includes(tag)) return `**${children().trim()}**`;
      if (['em','i'].includes(tag)) return `*${children().trim()}*`;
      if (['s','strike','del'].includes(tag)) return `~~${children().trim()}~~`;
      if (tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') return `\`${children().trim()}\``;
      if (tag === 'pre') return `\n\n\`\`\`\n${cleanPastedText(node.textContent).trim()}\n\`\`\`\n\n`;
      if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag.slice(1)))} ${cleanPastedText(node.textContent).trim()}\n\n`;
      if (tag === 'a') {
        const label = cleanPastedText(children()).trim() || cleanPastedText(node.textContent).trim();
        const href = safeLink(node.getAttribute('href'));
        return href ? `[${label}](${href})` : label;
      }
      if (tag === 'img') {
        const src = safeLink(node.getAttribute('src'));
        if (!src) return '';
        return `![${cleanPastedText(node.getAttribute('alt') || '')}](${src})`;
      }
      if (tag === 'blockquote') return `\n\n${cleanPastedText(children()).trim().split('\n').map(line => `> ${line}`).join('\n')}\n\n`;
      if (tag === 'ul') return `\n${[...node.children].filter(child => child.tagName === 'LI').map(child => renderListItem(child, '- ')).join('\n')}\n`;
      if (tag === 'ol') return `\n${[...node.children].filter(child => child.tagName === 'LI').map((child, index) => renderListItem(child, `${index + 1}. `)).join('\n')}\n`;
      if (tag === 'table') return `\n\n${tableToMarkdown(node)}\n\n`;
      if (tag === 'hr') return '\n\n---\n\n';
      if (['p','div','section','article','header','footer','aside'].includes(tag)) return `\n\n${children().trim()}\n\n`;
      return children();
    }

    return cleanPastedText(renderChildren(root)).trim();
  }

  function insertPastedText(text) {
    if (!text) return;
    pushUndo();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText(text, start, end, 'end');
    editor.focus();
    dispatchEdit();
  }

  function isMatch(value, query, matchCase) {
    return matchCase ? value === query : value.toLowerCase() === query.toLowerCase();
  }

  function regexForFind(query, { matchCase = false, wholeWord = false } = {}) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(wholeWord ? `\\b${escaped}\\b` : escaped, matchCase ? 'g' : 'gi');
  }

  function getFindOptions() {
    return {
      matchCase: findDialog.querySelector('[data-wordtools-match-case]').checked,
      wholeWord: findDialog.querySelector('[data-wordtools-whole-word]').checked
    };
  }

  function updateFindStatus(message) {
    findStatus.textContent = message || '';
  }

  function findNext({ fromStart = false } = {}) {
    const query = findInput.value;
    if (!query) { updateFindStatus('Type something to find.'); return null; }
    const regex = regexForFind(query, getFindOptions());
    regex.lastIndex = fromStart ? 0 : editor.selectionEnd;
    let match = regex.exec(editor.value);
    let wrapped = false;
    if (!match && !fromStart) {
      regex.lastIndex = 0;
      match = regex.exec(editor.value);
      wrapped = Boolean(match);
    }
    if (!match) { updateFindStatus('No matches.'); return null; }
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(match.index, match.index + match[0].length);
    scrollEditorToOffset(match.index);
    updateFindStatus(wrapped ? 'Wrapped to the first match.' : 'Match selected.');
    updateSelectionStat();
    return match;
  }

  function replaceCurrent() {
    const query = findInput.value;
    if (!query) { updateFindStatus('Type something to find.'); return; }
    const options = getFindOptions();
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    const wholeWordOk = !options.wholeWord || (/^\w/.test(selected) && /\w$/.test(selected));
    if (!isMatch(selected, query, options.matchCase) || !wholeWordOk) {
      if (!findNext()) return;
    }
    pushUndo();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText(replaceInput.value, start, end, 'end');
    dispatchEdit();
    updateFindStatus('Replaced 1 match.');
    findNext();
  }

  function replaceAll() {
    const query = findInput.value;
    if (!query) { updateFindStatus('Type something to find.'); return; }
    const regex = regexForFind(query, getFindOptions());
    const matches = [...editor.value.matchAll(regex)];
    if (!matches.length) { updateFindStatus('No matches.'); return; }
    pushUndo();
    editor.value = editor.value.replace(regex, () => replaceInput.value);
    editor.focus();
    dispatchEdit();
    updateFindStatus(`Replaced ${matches.length} ${matches.length === 1 ? 'match' : 'matches'}.`);
  }

  function openFindDialog(replace = false) {
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
    if (selected && !selected.includes('\n') && selected.length <= 120) findInput.value = selected;
    if (!findDialog.open) findDialog.showModal();
    requestAnimationFrame(() => (replace ? replaceInput : findInput).focus());
  }

  function toggleFocusMode() {
    const active = app.classList.toggle('writer-wordtools-focus');
    focusButton.setAttribute('aria-pressed', String(active));
    focusButton.textContent = active ? 'Exit focus' : 'Focus';
    if (active) editor.focus();
  }

  function toggleFullscreen() {
    const active = document.body.classList.toggle('writer-wordtools-fullscreen');
    app.classList.toggle('writer-wordtools-fullscreen-app', active);
    fullscreenButton.setAttribute('aria-pressed', String(active));
    fullscreenButton.textContent = active ? 'Exit full screen' : 'Full screen';
    if (active) editor.focus();
  }

  function toggleOutline() {
    const open = outlinePanel.hidden;
    outlinePanel.hidden = !open;
    outlineButton.setAttribute('aria-pressed', String(open));
    if (open) renderOutline();
  }

  function updateSelectionStat() {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = end > start ? editor.value.slice(start, end) : '';
    selectionStat.hidden = !selected;
    if (!selected) return;
    const words = countWords(selected);
    selectionStat.textContent = `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'} · ${selected.length.toLocaleString()} chars selected`;
  }

  function updateHistoryButtons() {
    undoButton.disabled = undoStack.length === 0;
    redoButton.disabled = redoStack.length === 0;
  }

  primaryGroup.querySelector('[data-insert="h2"]')?.insertAdjacentHTML('beforebegin', `
    <button type="button" data-wordtool="undo" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo">Undo</button>
    <button type="button" data-wordtool="redo" title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo">Redo</button>
  `);
  primaryGroup.querySelector('[data-insert="h2"]')?.insertAdjacentHTML('afterend', '<button type="button" data-wordtool="h3" title="Heading 3">H3</button>');
  primaryGroup.querySelector('[data-insert="italic"]')?.insertAdjacentHTML('afterend', '<button type="button" data-wordtool="strike" title="Strikethrough"><s>S</s></button>');
  primaryGroup.querySelector('[data-insert="quote"]')?.insertAdjacentHTML('beforebegin', `
    <button type="button" data-wordtool="bullets" title="Bulleted list">• List</button>
    <button type="button" data-wordtool="numbers" title="Numbered list">1. List</button>
  `);
  primaryGroup.insertAdjacentHTML('beforeend', '<button type="button" data-wordtool="find" title="Find and replace (Ctrl/Cmd+F)">Find</button>');

  modeActions.insertAdjacentHTML('afterbegin', `
    <button class="writer-text-button" type="button" data-wordtool="outline" aria-pressed="false">Outline</button>
    <button class="writer-text-button" type="button" data-wordtool="focus" aria-pressed="false">Focus</button>
    <button class="writer-text-button" type="button" data-wordtool="fullscreen" aria-pressed="false">Full screen</button>
  `);

  toolbar.insertAdjacentHTML('afterend', `
    <aside class="writer-wordtools-outline" data-wordtools-outline hidden>
      <header><div><strong>Document outline</strong><span data-wordtools-outline-count>0 sections</span></div><button type="button" class="writer-text-button" data-wordtool="outline-close">Close</button></header>
      <nav data-wordtools-outline-list aria-label="Article outline"></nav>
    </aside>
  `);

  const footer = app.querySelector('.writer-editor-footer');
  footer?.insertAdjacentHTML('afterbegin', '<span class="writer-wordtools-selection-stat" data-wordtools-selection-stat hidden></span>');

  app.insertAdjacentHTML('beforeend', `
    <dialog class="writer-dialog writer-wordtools-find-dialog" data-wordtools-find-dialog>
      <form method="dialog">
        <header><div><p class="eyebrow">Edit</p><h2>Find &amp; replace</h2></div><button class="writer-dialog-close" value="cancel" aria-label="Close">×</button></header>
        <div class="writer-dialog-body">
          <div class="writer-wordtools-find-grid">
            <label class="writer-field"><span>Find</span><input type="text" data-wordtools-find autocomplete="off" spellcheck="false"></label>
            <label class="writer-field"><span>Replace with</span><input type="text" data-wordtools-replace autocomplete="off" spellcheck="false"></label>
          </div>
          <div class="writer-wordtools-find-options">
            <label><input type="checkbox" data-wordtools-match-case> Match case</label>
            <label><input type="checkbox" data-wordtools-whole-word> Whole word</label>
          </div>
          <p class="writer-wordtools-find-status" data-wordtools-find-status aria-live="polite"></p>
        </div>
        <footer class="writer-dialog-actions">
          <button class="writer-button writer-button-subtle" type="button" data-wordtools-find-next>Find next</button>
          <button class="writer-button writer-button-subtle" type="button" data-wordtools-replace-one>Replace</button>
          <button class="writer-button writer-button-primary" type="button" data-wordtools-replace-all>Replace all</button>
          <button class="writer-button writer-button-subtle" value="cancel">Close</button>
        </footer>
      </form>
    </dialog>
  `);

  const undoButton = app.querySelector('[data-wordtool="undo"]');
  const redoButton = app.querySelector('[data-wordtool="redo"]');
  const outlineButton = app.querySelector('[data-wordtool="outline"]');
  const focusButton = app.querySelector('[data-wordtool="focus"]');
  const fullscreenButton = app.querySelector('[data-wordtool="fullscreen"]');
  const outlinePanel = app.querySelector('[data-wordtools-outline]');
  const outlineList = app.querySelector('[data-wordtools-outline-list]');
  const outlineCount = app.querySelector('[data-wordtools-outline-count]');
  const selectionStat = app.querySelector('[data-wordtools-selection-stat]');
  const findDialog = app.querySelector('[data-wordtools-find-dialog]');
  const findInput = app.querySelector('[data-wordtools-find]');
  const replaceInput = app.querySelector('[data-wordtools-replace]');
  const findStatus = app.querySelector('[data-wordtools-find-status]');

  updateHistoryButtons();
  renderOutline();

  app.addEventListener('click', event => {
    const button = event.target.closest('[data-wordtool]');
    if (!button) return;
    const action = button.dataset.wordtool;
    if (action === 'undo') undo();
    else if (action === 'redo') redo();
    else if (action === 'h3') toggleHeading(3);
    else if (action === 'strike') toggleWrap('~~', 'strikethrough text');
    else if (action === 'bullets') toggleBullets();
    else if (action === 'numbers') toggleNumbered();
    else if (action === 'find') openFindDialog(false);
    else if (action === 'outline') toggleOutline();
    else if (action === 'outline-close') toggleOutline();
    else if (action === 'focus') toggleFocusMode();
    else if (action === 'fullscreen') toggleFullscreen();
  });

  outlineList.addEventListener('click', event => {
    const button = event.target.closest('[data-wordtools-outline-offset]');
    if (!button) return;
    const offset = Number(button.dataset.wordtoolsOutlineOffset) || 0;
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(offset, offset);
    scrollEditorToOffset(offset);
    updateSelectionStat();
  });

  app.querySelector('[data-wordtools-find-next]').addEventListener('click', () => findNext());
  app.querySelector('[data-wordtools-replace-one]').addEventListener('click', replaceCurrent);
  app.querySelector('[data-wordtools-replace-all]').addEventListener('click', replaceAll);
  findInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); findNext(); } });
  replaceInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); replaceCurrent(); } });

  editor.addEventListener('beforeinput', event => {
    if (applyingHistory || event.inputType === 'historyUndo' || event.inputType === 'historyRedo') return;
    const now = Date.now();
    const typing = ['insertText','deleteContentBackward','deleteContentForward'].includes(event.inputType);
    const shouldCheckpoint = !typing || event.inputType !== lastInputType || now - lastTypingCheckpoint > 900;
    if (shouldCheckpoint) pushUndo(snapshot());
    if (typing) lastTypingCheckpoint = now;
    lastInputType = event.inputType;
  });

  editor.addEventListener('input', () => {
    if (applyingHistory) return;
    scheduleOutline();
    updateSelectionStat();
  });

  ['select','keyup','mouseup'].forEach(type => editor.addEventListener(type, updateSelectionStat));

  app.addEventListener('pointerdown', event => {
    if (!event.target.closest('button')) return;
    if (event.target.closest('[data-wordtool]')) return;
    if (event.target.closest('[data-insert],[data-link-insert],[data-youtube-insert],[data-image-insert],[data-html-insert],[data-html-delete],[data-table-insert],[data-tale-insert],[data-pick-insert],[data-template]')) {
      pushUndo(snapshot());
      window.setTimeout(() => scheduleOutline(), 0);
    }
  }, true);

  editor.addEventListener('paste', event => {
    const plain = event.clipboardData?.getData('text/plain') || '';
    const html = event.clipboardData?.getData('text/html') || '';
    if (!plain && !html) return;
    if (/^\s*<section\b[\s\S]*<\/section>\s*$/i.test(plain.trim())) return;
    const converted = html && /<(?:p|div|h[1-6]|strong|b|em|i|ul|ol|table|a|blockquote|s|strike|del)\b/i.test(html)
      ? htmlToMarkdown(html)
      : cleanPastedText(plain);
    if (!converted) return;
    event.preventDefault();
    insertPastedText(converted);
  });

  window.addEventListener('keydown', event => {
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const editing = !editorView?.hidden && (document.activeElement === editor || app.contains(document.activeElement));
    if (modifier && editing && key === 'f') {
      event.preventDefault();
      openFindDialog(false);
      return;
    }
    if (modifier && editing && key === 'h') {
      event.preventDefault();
      openFindDialog(true);
      return;
    }
    if (modifier && document.activeElement === editor && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (modifier && document.activeElement === editor && key === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (event.key === 'Escape') {
      if (findDialog.open) return;
      if (document.body.classList.contains('writer-wordtools-fullscreen')) toggleFullscreen();
      else if (app.classList.contains('writer-wordtools-focus')) toggleFocusMode();
    }
  });
})();
