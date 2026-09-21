(() => {
  const app = document.querySelector('[data-writer-app]');
  if (!app) return;

  const editor = app.querySelector('#writer-body');
  const toolbar = app.querySelector('.writer-toolbar');
  const primaryGroup = toolbar?.querySelector('.writer-toolbar-group');
  const richGroup = toolbar?.querySelector('.writer-toolbar-rich');
  const modeActions = app.querySelector('.writer-modebar-actions');
  const dropzone = app.querySelector('[data-editor-dropzone]');
  const outlinePanel = app.querySelector('[data-wordtools-outline]');
  const outlineButton = app.querySelector('[data-wordtool="outline"]');
  if (!editor || !toolbar || !primaryGroup || !richGroup || !modeActions || !dropzone) return;

  const WIDTH_KEY = 'mma-writer-reading-width';
  const OUTLINE_KEY = 'mma-writer-outline-open';

  const commands = [
    { key: 'image', label: 'Image', detail: 'Upload or insert an image', selector: '[data-tool="image"]', aliases: 'photo picture media' },
    { key: 'youtube', label: 'YouTube', detail: 'Embed a YouTube video', selector: '[data-tool="youtube"]', aliases: 'video yt' },
    { key: 'tweet', label: 'Tweet / X', detail: 'Embed an X or Twitter post', selector: '[data-tool="x"]', aliases: 'x twitter post status embed' },
    { key: 'table', label: 'Table', detail: 'Build a Markdown table', selector: '[data-tool="table"]', aliases: 'rows columns stats' },
    { key: 'tale', label: 'Tale of Tape', detail: 'Insert the existing tale-of-the-tape block', selector: '[data-tool="tale"]', aliases: 'tale tape fighter' },
    { key: 'pick', label: 'Pick', detail: 'Insert the existing fight-pick block', selector: '[data-tool="prediction"]', aliases: 'prediction fight' },
    { key: 'html', label: 'HTML visual', detail: 'Insert or edit a self-contained visual', selector: '[data-tool="html"]', aliases: 'visual embed code' },
    { key: 'source', label: 'Source', detail: 'Insert a source or citation', selector: '[data-tool="citation"]', aliases: 'citation reference' },
    { key: 'link', label: 'Link', detail: 'Insert a link', selector: '[data-tool="link"]', aliases: 'url' },
    { key: 'template', label: 'Template', detail: 'Insert an article template', selector: '[data-tool="template"]', aliases: 'article structure' }
  ];

  function dispatchBeforeInput(inputType = 'insertText') {
    try {
      editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType }));
    } catch (_) {
      editor.dispatchEvent(new Event('beforeinput', { bubbles: true, cancelable: true }));
    }
  }

  function dispatchInput(inputType = 'insertText') {
    try {
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
    } catch (_) {
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function currentLine() {
    const value = editor.value;
    const caret = editor.selectionStart;
    const start = value.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
    const next = value.indexOf('\n', caret);
    const end = next === -1 ? value.length : next;
    return {
      start,
      end,
      caret,
      text: value.slice(start, end),
      before: value.slice(start, caret),
      after: value.slice(caret, end),
      relative: caret - start
    };
  }

  function setPressed(element, active) {
    if (!element) return;
    element.classList.toggle('is-active', Boolean(active));
    element.setAttribute('aria-pressed', String(Boolean(active)));
  }

  function caretInside(line, relative, regex) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(line))) {
      if (relative >= match.index && relative <= match.index + match[0].length) return true;
      if (!match[0].length) regex.lastIndex += 1;
    }
    return false;
  }

  function updateActiveFormatting() {
    const line = currentLine();
    setPressed(primaryGroup.querySelector('[data-insert="h2"]'), /^[ \t]{0,3}##[ \t]+/.test(line.text) && !/^[ \t]{0,3}###[ \t]+/.test(line.text));
    setPressed(primaryGroup.querySelector('[data-wordtool="h3"]'), /^[ \t]{0,3}###[ \t]+/.test(line.text));
    setPressed(primaryGroup.querySelector('[data-wordtool="bullets"]'), /^[ \t]*[-*+][ \t]+/.test(line.text));
    setPressed(primaryGroup.querySelector('[data-wordtool="numbers"]'), /^[ \t]*\d+[.)][ \t]+/.test(line.text));
    setPressed(primaryGroup.querySelector('[data-insert="quote"]'), /^[ \t]*>[ \t]?/.test(line.text));
    setPressed(primaryGroup.querySelector('[data-insert="bold"]'), caretInside(line.text, line.relative, /\*\*[^*\n]+\*\*|__[^_\n]+__/g));
    setPressed(primaryGroup.querySelector('[data-insert="italic"]'), caretInside(line.text, line.relative, /(?<!\*)\*(?!\*)[^*\n]+(?<!\*)\*(?!\*)|(?<!_)_(?!_)[^_\n]+(?<!_)_(?!_)/g));
    setPressed(primaryGroup.querySelector('[data-wordtool="strike"]'), caretInside(line.text, line.relative, /~~[^~\n]+~~/g));
    setPressed(primaryGroup.querySelector('[data-tool="link"]'), caretInside(line.text, line.relative, /\[[^\]\n]+\]\([^)]+\)/g));
  }

  function buildMoreMenu() {
    const actions = ['indent', 'outdent', 'clear', 'move-up', 'move-down', 'find']
      .map(action => primaryGroup.querySelector(`[data-wordtool="${action}"]`))
      .filter(Boolean);
    if (!actions.length) return;

    const more = document.createElement('details');
    more.className = 'writer-ux-more';
    more.dataset.writerUxMore = '';
    more.innerHTML = '<summary title="More editing tools">More</summary><div class="writer-ux-more-panel" role="group" aria-label="More editing tools"></div>';
    const panel = more.querySelector('.writer-ux-more-panel');
    actions.forEach(button => panel.appendChild(button));
    primaryGroup.appendChild(more);

    document.addEventListener('pointerdown', event => {
      if (!more.open || more.contains(event.target)) return;
      more.open = false;
    });
  }

  function addWidthControl() {
    if (modeActions.querySelector('[data-writer-ux-width-switcher]')) return;
    const shell = document.createElement('div');
    shell.className = 'writer-segmented writer-ux-width-switcher';
    shell.dataset.writerUxWidthSwitcher = '';
    shell.setAttribute('aria-label', 'Writing width');
    shell.innerHTML = `
      <button type="button" data-writer-ux-width="normal" aria-pressed="false" title="Comfortable reading width">Normal</button>
      <button type="button" data-writer-ux-width="wide" aria-pressed="false" title="Wider editor">Wide</button>
      <button type="button" data-writer-ux-width="full" aria-pressed="false" title="Use all available editor width">Full</button>
    `;
    modeActions.insertAdjacentElement('afterbegin', shell);

    const stored = localStorage.getItem(WIDTH_KEY);
    setWidth(['normal', 'wide', 'full'].includes(stored) ? stored : 'normal');

    shell.addEventListener('click', event => {
      const button = event.target.closest('[data-writer-ux-width]');
      if (button) setWidth(button.dataset.writerUxWidth);
    });
  }

  function setWidth(mode) {
    app.dataset.writerUxWidth = mode;
    localStorage.setItem(WIDTH_KEY, mode);
    app.querySelectorAll('[data-writer-ux-width]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.writerUxWidth === mode));
    });
  }

  function restoreOutlinePreference() {
    if (!outlinePanel || !outlineButton) return;
    outlinePanel.classList.add('writer-ux-outline-rail');
    if (localStorage.getItem(OUTLINE_KEY) === '1' && outlinePanel.hidden) {
      requestAnimationFrame(() => outlineButton.click());
    }

    app.addEventListener('click', event => {
      if (!event.target.closest('[data-wordtool="outline"], [data-wordtool="outline-close"]')) return;
      window.setTimeout(() => {
        localStorage.setItem(OUTLINE_KEY, outlinePanel.hidden ? '0' : '1');
      }, 0);
    });
  }

  function continueMarkdownBlock(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
    if (editor.selectionStart !== editor.selectionEnd) return false;

    const line = currentLine();
    const bullet = line.before.match(/^([ \t]*)([-*+])([ \t]+)(.*)$/);
    const numbered = line.before.match(/^([ \t]*)(\d+)([.)])([ \t]+)(.*)$/);
    const quote = line.before.match(/^([ \t]*)((?:>[ \t]*)+)(.*)$/);
    if (!bullet && !numbered && !quote) return false;

    event.preventDefault();
    event.stopPropagation();
    dispatchBeforeInput('insertParagraph');

    let prefix = '';
    let bodyBefore = '';
    let prefixLength = 0;

    if (bullet) {
      prefix = `${bullet[1]}${bullet[2]} `;
      bodyBefore = bullet[4];
      prefixLength = bullet[1].length + bullet[2].length + bullet[3].length;
    } else if (numbered) {
      prefix = `${numbered[1]}${Number(numbered[2]) + 1}${numbered[3]} `;
      bodyBefore = numbered[5];
      prefixLength = numbered[1].length + numbered[2].length + numbered[3].length + numbered[4].length;
    } else {
      const quotePrefix = quote[2].replace(/[ \t]*$/, '');
      prefix = `${quote[1]}${quotePrefix} `;
      bodyBefore = quote[3];
      prefixLength = quote[1].length + quote[2].length;
    }

    const fullBody = `${bodyBefore}${line.after}`.trim();
    if (!fullBody) {
      editor.setRangeText('', line.start, line.start + prefixLength, 'end');
    } else {
      editor.setRangeText(`\n${prefix}`, line.caret, line.caret, 'end');
    }

    dispatchInput('insertParagraph');
    updateActiveFormatting();
    return true;
  }

  const slashMenu = document.createElement('div');
  slashMenu.className = 'writer-ux-slash-menu';
  slashMenu.dataset.writerUxSlashMenu = '';
  slashMenu.hidden = true;
  slashMenu.setAttribute('role', 'listbox');
  slashMenu.setAttribute('aria-label', 'Insert block');
  dropzone.appendChild(slashMenu);

  let slashState = null;

  function slashMatch() {
    if (editor.selectionStart !== editor.selectionEnd) return null;
    const line = currentLine();
    const match = line.before.match(/^([ \t]*)\/([a-z0-9 -]*)$/i);
    if (!match) return null;
    const slashStart = line.start + match[1].length;
    return { line, slashStart, query: match[2].trim().toLowerCase() };
  }

  function commandResults(query) {
    if (!query) return commands;
    return commands.filter(command => `${command.key} ${command.label} ${command.aliases}`.toLowerCase().includes(query));
  }

  function positionSlashMenu(line) {
    const style = getComputedStyle(editor);
    const lineHeight = Number.parseFloat(style.lineHeight) || 24;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const row = editor.value.slice(0, line.start).split('\n').length - 1;
    const caretY = paddingTop + row * lineHeight - editor.scrollTop;
    const menuHeight = 286;
    const below = caretY + lineHeight + 8;
    const top = below + menuHeight < editor.clientHeight ? below : Math.max(8, caretY - menuHeight - 6);
    slashMenu.style.top = `${top}px`;
    slashMenu.style.left = '12px';
  }

  function renderSlashMenu(forceIndex = null) {
    const match = slashMatch();
    if (!match) {
      hideSlashMenu();
      return;
    }
    const items = commandResults(match.query);
    if (!items.length) {
      hideSlashMenu();
      return;
    }

    const previousIndex = forceIndex ?? slashState?.index ?? 0;
    const index = Math.max(0, Math.min(previousIndex, items.length - 1));
    slashState = { ...match, items, index };
    slashMenu.hidden = false;
    slashMenu.innerHTML = `
      <div class="writer-ux-slash-head"><strong>Insert</strong><span>${items.length} ${items.length === 1 ? 'command' : 'commands'}</span></div>
      <div class="writer-ux-slash-list">
        ${items.map((item, itemIndex) => `
          <button type="button" role="option" aria-selected="${itemIndex === index}" data-writer-ux-command="${item.key}" class="${itemIndex === index ? 'is-active' : ''}">
            <span><strong>${item.label}</strong><small>/${item.key}</small></span>
            <em>${item.detail}</em>
          </button>
        `).join('')}
      </div>
      <div class="writer-ux-slash-foot">↑↓ navigate · Enter insert · Esc close</div>
    `;
    positionSlashMenu(match.line);
  }

  function hideSlashMenu() {
    slashState = null;
    slashMenu.hidden = true;
    slashMenu.innerHTML = '';
  }

  function runSlashCommand(command) {
    if (!slashState) return;
    const target = commands.find(item => item.key === command);
    if (!target) return;
    const { slashStart } = slashState;
    const caret = editor.selectionStart;
    dispatchBeforeInput('deleteContentBackward');
    editor.setRangeText('', slashStart, caret, 'end');
    dispatchInput('deleteContentBackward');
    hideSlashMenu();
    editor.focus({ preventScroll: true });
    requestAnimationFrame(() => document.querySelector(target.selector)?.click());
  }

  slashMenu.addEventListener('pointerdown', event => event.preventDefault());
  slashMenu.addEventListener('click', event => {
    const button = event.target.closest('[data-writer-ux-command]');
    if (button) runSlashCommand(button.dataset.writerUxCommand);
  });

  editor.addEventListener('keydown', event => {
    if (slashState && !slashMenu.hidden) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = (slashState.index + delta + slashState.items.length) % slashState.items.length;
        renderSlashMenu(next);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        runSlashCommand(slashState.items[slashState.index].key);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideSlashMenu();
        return;
      }
    }
    continueMarkdownBlock(event);
  });

  editor.addEventListener('input', () => {
    updateActiveFormatting();
    renderSlashMenu();
  });

  ['select', 'keyup', 'mouseup', 'scroll'].forEach(type => editor.addEventListener(type, () => {
    updateActiveFormatting();
    if (!slashMenu.hidden) renderSlashMenu();
  }));

  app.addEventListener('click', event => {
    if (event.target.closest('.writer-toolbar button, .writer-ux-more button')) {
      window.setTimeout(updateActiveFormatting, 0);
    }
  });

  buildMoreMenu();
  addWidthControl();
  restoreOutlinePreference();
  toolbar.classList.add('writer-ux-toolbar');
  richGroup.setAttribute('aria-label', 'Insert blocks');
  updateActiveFormatting();
})();
