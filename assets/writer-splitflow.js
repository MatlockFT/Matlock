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

  // Editor and preview intentionally scroll independently. The previous
  // percentage-based scroll coupling made split view fight the user's input,
  // especially now that both panes are viewport-contained.
  try { localStorage.removeItem('mma-writer-sync-scroll'); } catch {}

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
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(index, index);
    editor.scrollTop = editorMax * (line / totalLines);
    editor.dispatchEvent(new Event('select', { bubbles: true }));
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
