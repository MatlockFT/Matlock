from pathlib import Path

# ---------- write.html ----------
path = Path('write.html')
text = path.read_text()

old = '''        </div>\n\n        <label class="writer-body-label" for="writer-body">Article</label>'''
new = '''        </div>\n\n        <div class="writer-html-block-rail" data-html-block-rail hidden aria-label="Embedded HTML visuals"></div>\n\n        <label class="writer-body-label" for="writer-body">Article</label>'''
if old not in text:
    raise SystemExit('HTML rail insertion point not found')
text = text.replace(old, new, 1)

old = '''      </section>\n\n      <section class="writer-preview-pane" aria-label="Live article preview">'''
new = '''      </section>\n\n      <div class="writer-splitter" data-writer-splitter role="separator" aria-orientation="vertical" aria-label="Resize editor and preview" aria-valuemin="32" aria-valuemax="68" aria-valuenow="50" tabindex="0"><span aria-hidden="true"></span></div>\n\n      <section class="writer-preview-pane" aria-label="Live article preview">'''
if old not in text:
    raise SystemExit('splitter insertion point not found')
text = text.replace(old, new, 1)
path.write_text(text)

# ---------- writer.js ----------
path = Path('assets/writer.js')
text = path.read_text()

old = '''  const conflictDialog = app.querySelector('[data-conflict-dialog]');\n'''
new = '''  const conflictDialog = app.querySelector('[data-conflict-dialog]');\n  const metaDetails = app.querySelector('.writer-meta');\n  const htmlBlockRail = app.querySelector('[data-html-block-rail]');\n  const splitter = app.querySelector('[data-writer-splitter]');\n'''
if old not in text:
    raise SystemExit('DOM refs insertion point not found')
text = text.replace(old, new, 1)

old = '''  let editingHtmlBlockId = '';\n'''
new = '''  let editingHtmlBlockId = '';\n  let splitRatio = 50;\n'''
if old not in text:
    raise SystemExit('state insertion point not found')
text = text.replace(old, new, 1)

marker = '''  function inlineMarkdown(text) {'''
helpers = r'''  function renderHtmlBlockRail() {
    if (!htmlBlockRail) return;
    const blocks = [...htmlBlocks.values()];
    htmlBlockRail.hidden = blocks.length === 0;
    if (!blocks.length) { htmlBlockRail.innerHTML = ''; return; }
    htmlBlockRail.innerHTML = `<div class="writer-html-block-rail-head"><span>Embedded visuals</span><small>${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'}</small></div><div class="writer-html-block-list">${blocks.map(block => `<button type="button" class="writer-html-block-card" data-html-block-edit="${escapeHtml(block.id)}" title="Edit ${escapeHtml(block.label)}"><span class="writer-html-block-badge">HTML</span><strong>${escapeHtml(block.label)}</strong><span class="writer-html-block-action">Edit</span></button>`).join('')}</div>`;
  }

  function focusHtmlBlockToken(id) {
    const block = htmlBlocks.get(id);
    if (!block) return false;
    const token = htmlBlockToken(block);
    const index = bodyEditor.value.indexOf(token);
    if (index >= 0) {
      bodyEditor.focus({ preventScroll: true });
      bodyEditor.setSelectionRange(index, index + token.length);
    }
    return true;
  }

  function openHtmlBlockById(id) {
    if (!focusHtmlBlockToken(id)) return;
    openHtmlDialog(id);
  }

  function setArticleDetailsOpen(open) {
    if (metaDetails) metaDetails.open = Boolean(open);
  }

  function applySplitRatio(value, { persist = false } = {}) {
    const next = Math.max(32, Math.min(68, Number(value) || 50));
    splitRatio = next;
    workspace.style.setProperty('--writer-split', `${next}%`);
    if (splitter) splitter.setAttribute('aria-valuenow', String(Math.round(next)));
    if (persist) {
      try { localStorage.setItem('matlock-writer:split-ratio', String(next)); } catch {}
    }
  }

  function restoreSplitRatio() {
    try { applySplitRatio(Number(localStorage.getItem('matlock-writer:split-ratio') || 50)); }
    catch { applySplitRatio(50); }
  }

'''
if marker not in text:
    raise SystemExit('helper insertion point not found')
text = text.replace(marker, helpers + marker, 1)

old = '''  function openHtmlDialog() {\n    const dialog = app.querySelector('[data-html-dialog]');\n    const current = htmlBlockAtCursor();'''
new = '''  function openHtmlDialog(blockId = '') {\n    const dialog = app.querySelector('[data-html-dialog]');\n    const current = blockId && htmlBlocks.has(blockId) ? { block: htmlBlocks.get(blockId) } : htmlBlockAtCursor();'''
if old not in text:
    raise SystemExit('openHtmlDialog signature not found')
text = text.replace(old, new, 1)

old = '''    bodyEditor.value = prepareEditorBody(state.body || '', state.htmlBlocks || []);\n    if (remote) {'''
new = '''    bodyEditor.value = prepareEditorBody(state.body || '', state.htmlBlocks || []);\n    renderHtmlBlockRail();\n    if (remote) {'''
if old not in text:
    raise SystemExit('applyState body insertion point not found')
text = text.replace(old, new, 1)

old = '''      if (!restored) dirty = false;\n      showEditor();\n      setSaveState(currentPublished ? 'Published article' : fields.publishAt.value ? 'Scheduled article' : 'Draft article');'''
new = '''      if (!restored) dirty = false;\n      showEditor();\n      if ((state.body || '').trim() || state.title) setArticleDetailsOpen(false);\n      setSaveState(currentPublished ? 'Published article' : fields.publishAt.value ? 'Scheduled article' : 'Draft article');'''
if old not in text:
    raise SystemExit('loadArticle collapse insertion point not found')
text = text.replace(old, new, 1)

old = '''      fields.filename.disabled = false;\n      filenameTouched = true;\n      showEditor();'''
new = '''      fields.filename.disabled = false;\n      filenameTouched = true;\n      setArticleDetailsOpen(true);\n      showEditor();'''
if old not in text:
    raise SystemExit('duplicate meta-open insertion point not found')
text = text.replace(old, new, 1)

old = '''    applyState(initial, { remote: true });\n    showEditor();'''
new = '''    applyState(initial, { remote: true });\n    setArticleDetailsOpen(true);\n    showEditor();'''
if old not in text:
    raise SystemExit('new article meta-open insertion point not found')
text = text.replace(old, new, 1)

# Keep HTML rail in sync after inserts/edits/removals.
text = text.replace("      showToast('HTML visual updated.');", "      renderHtmlBlockRail();\n      showToast('HTML visual updated.');", 1)
text = text.replace("      showToast('HTML visual inserted as a compact block.');", "      renderHtmlBlockRail();\n      showToast('HTML visual inserted as a compact block.');", 1)
text = text.replace("    htmlBlocks.delete(editingHtmlBlockId);", "    htmlBlocks.delete(editingHtmlBlockId);\n    renderHtmlBlockRail();", 1)
text = text.replace("    htmlBlocks.set(id, block);\n    insertBlock(htmlBlockToken(block));\n    showToast('HTML visual collapsed into one Writer block. Double-click it to edit.');", "    htmlBlocks.set(id, block);\n    insertBlock(htmlBlockToken(block));\n    renderHtmlBlockRail();\n    showToast('HTML visual collapsed into one Writer block. Use Embedded visuals to edit it.');", 1)

# Add rail click + splitter interactions before body keydown handler.
marker = '''  bodyEditor.addEventListener('keydown', event => {'''
handlers = r'''  if (htmlBlockRail) htmlBlockRail.addEventListener('click', event => {
    const button = event.target.closest('[data-html-block-edit]');
    if (!button) return;
    openHtmlBlockById(button.dataset.htmlBlockEdit);
  });

  if (splitter) {
    splitter.addEventListener('pointerdown', event => {
      if (workspace.dataset.viewMode !== 'split' || window.innerWidth <= 1100) return;
      event.preventDefault();
      splitter.setPointerCapture?.(event.pointerId);
      document.body.classList.add('writer-is-resizing');
      const rect = workspace.getBoundingClientRect();
      const move = moveEvent => {
        const percent = ((moveEvent.clientX - rect.left) / rect.width) * 100;
        applySplitRatio(percent);
      };
      const finish = () => {
        splitter.removeEventListener('pointermove', move);
        splitter.removeEventListener('pointerup', finish);
        splitter.removeEventListener('pointercancel', finish);
        document.body.classList.remove('writer-is-resizing');
        applySplitRatio(splitRatio, { persist: true });
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', finish);
      splitter.addEventListener('pointercancel', finish);
    });
    splitter.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') applySplitRatio(50, { persist: true });
      else applySplitRatio(splitRatio + (event.key === 'ArrowRight' ? 2 : -2), { persist: true });
    });
  }

'''
if marker not in text:
    raise SystemExit('interaction insertion point not found')
text = text.replace(marker, handlers + marker, 1)

# Restore ratio during startup just before initial preview update.
old = '''  fields.imagePosition.value = 'center center';\n  updatePreview();'''
new = '''  fields.imagePosition.value = 'center center';\n  restoreSplitRatio();\n  updatePreview();'''
if old not in text:
    raise SystemExit('split restore insertion point not found')
text = text.replace(old, new, 1)

path.write_text(text)

# ---------- writer.css ----------
path = Path('assets/writer.css')
text = path.read_text()
marker = '/* Writer ergonomics pass 2026-09-16 */'
if marker not in text:
    text += r'''

/* Writer ergonomics pass 2026-09-16 */
@media(min-width:1101px){
  .writer-topbar{position:sticky;top:8px;z-index:42;backdrop-filter:blur(16px)}
  .writer-statusbar{position:sticky;top:62px;z-index:41;backdrop-filter:blur(16px)}
  .writer-toolbar{position:sticky;top:104px;z-index:28;backdrop-filter:blur(14px);box-shadow:0 10px 28px rgba(0,0,0,.28),inset 0 1px 0 rgba(255,255,255,.035)}
  .writer-workspace[data-view-mode="split"]{
    grid-template-columns:minmax(0,var(--writer-split,50%)) 10px minmax(0,1fr);
    gap:.4rem;
  }
  .writer-workspace[data-view-mode="split"] .writer-preview-pane{
    position:sticky;
    top:104px;
    max-height:calc(100vh - 116px);
    overflow:auto;
  }
}
.writer-splitter{display:none}
@media(min-width:1101px){
  .writer-workspace[data-view-mode="split"] .writer-splitter{
    display:flex;
    align-self:stretch;
    justify-content:center;
    min-height:70vh;
    cursor:col-resize;
    touch-action:none;
    border-radius:999px;
    outline:0;
  }
  .writer-splitter span{width:2px;margin:5rem 0;border-radius:99px;background:rgba(255,255,255,.09);transition:background .14s ease,width .14s ease,box-shadow .14s ease}
  .writer-splitter:hover span,.writer-splitter:focus-visible span{width:3px;background:rgba(255,255,255,.28);box-shadow:0 0 0 4px rgba(255,255,255,.035)}
  body.writer-is-resizing{cursor:col-resize!important;user-select:none!important}
  body.writer-is-resizing *{cursor:col-resize!important}
}
.writer-html-block-rail{display:grid;gap:.38rem;padding:.52rem .58rem;margin:0;border:1px solid var(--writer-line);border-bottom:0;background:#0d0d0e}
.writer-html-block-rail[hidden]{display:none!important}
.writer-html-block-rail-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem;color:#777;font-size:.62rem;text-transform:uppercase;letter-spacing:.075em;font-weight:820}
.writer-html-block-rail-head small{font:650 .62rem/1 inherit;text-transform:none;letter-spacing:0;color:#555}
.writer-html-block-list{display:flex;gap:.35rem;overflow-x:auto;padding-bottom:1px;scrollbar-width:thin}
.writer-html-block-card{display:flex;align-items:center;gap:.45rem;min-width:0;max-width:340px;padding:.45rem .55rem;border:1px solid rgba(255,255,255,.10);border-radius:8px;background:linear-gradient(180deg,#151516,#101011);color:#d8d8d5;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.025);transition:border-color .14s ease,background .14s ease,transform .14s ease}
.writer-html-block-card:hover{border-color:rgba(255,255,255,.23);background:linear-gradient(180deg,#1b1b1c,#131314);transform:translateY(-1px)}
.writer-html-block-card:focus-visible{outline:2px solid #ddd;outline-offset:2px}
.writer-html-block-card strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.7rem;font-weight:760}
.writer-html-block-badge{flex:0 0 auto;padding:.2rem .31rem;border-radius:5px;background:#e9e9e6;color:#090909;font-size:.53rem;font-weight:900;letter-spacing:.06em}
.writer-html-block-action{margin-left:auto;color:#6f6f70;font-size:.62rem;font-weight:720}
.writer-body-editor{
  min-height:72vh;
  line-height:1.72;
  font-size:.94rem;
  letter-spacing:-.006em;
  caret-color:#fff;
  tab-size:2;
  scroll-padding-top:8rem;
}
.writer-body-editor::selection{background:rgba(255,255,255,.19);color:#fff}
.writer-editor-dropzone:has(+ .writer-editor-footer) .writer-body-editor{overscroll-behavior:contain}
.writer-shortcut-hint{color:#626264}
@media(max-width:1100px){
  .writer-splitter{display:none!important}
  .writer-workspace[data-view-mode="split"]{grid-template-columns:1fr}
  .writer-workspace[data-view-mode="split"] .writer-preview-pane{position:static;max-height:none}
  .writer-topbar,.writer-statusbar,.writer-toolbar{position:static}
}
@media(max-width:700px){
  .writer-html-block-rail{padding:.45rem}
  .writer-html-block-card{max-width:280px}
  .writer-body-editor{font-size:.9rem;line-height:1.68}
}
'''
path.write_text(text)
