(() => {
  const app = document.querySelector('[data-writer-app]');
  if (!app) return;

  const editor = app.querySelector('#writer-body');
  const workspace = app.querySelector('[data-workspace]');
  const splitter = app.querySelector('[data-writer-splitter]');
  const previewPane = app.querySelector('.writer-preview-pane');
  const previewFrame = app.querySelector('[data-preview-frame]');
  const previewContent = app.querySelector('[data-preview-content]');
  const modeActions = app.querySelector('.writer-modebar-actions');
  if (!editor || !workspace || !previewPane || !previewFrame || !previewContent || !modeActions) return;

  const VIEW_KEY = 'mma-writer-view-mode';
  const PREVIEW_SIZE_KEY = 'mma-writer-preview-size';
  const SYNC_KEY = 'mma-writer-sync-scroll';

  const safeGet = key => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const safeSet = (key, value) => {
    try { localStorage.setItem(key, value); } catch {}
  };

  app.classList.add('writer-splitflow');

  function restoreViewPreferences() {
    const storedView = safeGet(VIEW_KEY);
    if (['write', 'split', 'preview'].includes(storedView)) {
      const button = app.querySelector(`[data-view="${storedView}"]`);
      if (button && workspace.dataset.viewMode !== storedView) button.click();
    }

    const storedSize = safeGet(PREVIEW_SIZE_KEY);
    if (['desktop', 'mobile'].includes(storedSize)) {
      const button = app.querySelector(`[data-preview-size="${storedSize}"]`);
      if (button && previewFrame.dataset.previewSize !== storedSize) button.click();
    }
  }

  app.addEventListener('click', event => {
    const view = event.target.closest('[data-view]');
    if (view) safeSet(VIEW_KEY, view.dataset.view);

    const size = event.target.closest('[data-preview-size]');
    if (size) safeSet(PREVIEW_SIZE_KEY, size.dataset.previewSize);
  });

  const syncButton = document.createElement('button');
  syncButton.type = 'button';
  syncButton.className = 'writer-text-button writer-splitflow-sync';
  syncButton.dataset.writerSyncScroll = '';
  syncButton.textContent = 'Sync scroll';
  syncButton.title = 'Keep the editor and preview at roughly the same place';

  const widthSwitcher = modeActions.querySelector('[data-writer-ux-width-switcher]');
  if (widthSwitcher) widthSwitcher.insertAdjacentElement('afterend', syncButton);
  else modeActions.insertAdjacentElement('afterbegin', syncButton);

  let syncEnabled = safeGet(SYNC_KEY) !== '0';
  function updateSyncButton() {
    syncButton.setAttribute('aria-pressed', String(syncEnabled));
    syncButton.classList.toggle('is-active', syncEnabled);
    app.dataset.writerSyncScroll = syncEnabled ? 'on' : 'off';
  }
  updateSyncButton();

  syncButton.addEventListener('click', () => {
    syncEnabled = !syncEnabled;
    safeSet(SYNC_KEY, syncEnabled ? '1' : '0');
    updateSyncButton();
  });

  let syncing = false;
  let syncRaf = 0;

  function syncScroll(source, target) {
    if (!syncEnabled || syncing || workspace.dataset.viewMode !== 'split') return;
    cancelAnimationFrame(syncRaf);
    syncRaf = requestAnimationFrame(() => {
      const sourceMax = Math.max(0, source.scrollHeight - source.clientHeight);
      const targetMax = Math.max(0, target.scrollHeight - target.clientHeight);
      if (!sourceMax || !targetMax) return;
      const progress = Math.max(0, Math.min(1, source.scrollTop / sourceMax));
      syncing = true;
      target.scrollTop = progress * targetMax;
      requestAnimationFrame(() => { syncing = false; });
    });
  }

  editor.addEventListener('scroll', () => syncScroll(editor, previewPane), { passive: true });
  previewPane.addEventListener('scroll', () => syncScroll(previewPane, editor), { passive: true });

  function markdownHeadingMatches() {
    return Array.from(editor.value.matchAll(/^(#{2,3})[ \t]+(.+)$/gm));
  }

  previewContent.addEventListener('click', event => {
    const heading = event.target.closest('h2, h3');
    if (!heading || !previewContent.contains(heading)) return;

    const previewHeadings = Array.from(previewContent.querySelectorAll('h2, h3'));
    const headingIndex = previewHeadings.indexOf(heading);
    const sourceHeadings = markdownHeadingMatches();
    const source = sourceHeadings[headingIndex];
    if (!source || source.index == null) return;

    const index = source.index;
    const before = editor.value.slice(0, index);
    const totalLines = Math.max(1, editor.value.split('\n').length - 1);
    const line = Math.max(0, before.split('\n').length - 1);
    const editorMax = Math.max(0, editor.scrollHeight - editor.clientHeight);

    syncing = true;
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(index, index);
    editor.scrollTop = editorMax * (line / totalLines);
    editor.dispatchEvent(new Event('select', { bubbles: true }));
    requestAnimationFrame(() => { syncing = false; });
  });

  if (splitter) {
    splitter.addEventListener('pointerup', () => {
      safeSet('matlock-writer:split-ratio', splitter.getAttribute('aria-valuenow') || '50');
    });
    splitter.addEventListener('keyup', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        safeSet('matlock-writer:split-ratio', splitter.getAttribute('aria-valuenow') || '50');
      }
    });
  }

  restoreViewPreferences();
})();
