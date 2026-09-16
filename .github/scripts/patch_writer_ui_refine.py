from pathlib import Path

# ---------- write.html ----------
path = Path('write.html')
text = path.read_text()

old = '''    <div class="writer-top-actions">
      <span class="writer-save-state" data-save-state>Library</span>
      <button class="writer-button writer-button-subtle" type="button" data-show-library>Library</button>
      <button class="writer-button writer-button-subtle" type="button" data-new-article>New</button>
      <button class="writer-button writer-button-subtle" type="button" data-github-connect>Sign in with GitHub</button>
      <button class="writer-button" type="button" data-save-draft disabled>Save</button>
      <button class="writer-button" type="button" data-schedule disabled>Schedule</button>
      <button class="writer-button writer-button-primary" type="button" data-publish disabled>Publish</button>
    </div>'''
new = '''    <div class="writer-top-actions">
      <div class="writer-top-secondary">
        <button class="writer-button writer-button-subtle" type="button" data-show-library>Library</button>
        <button class="writer-button writer-button-subtle" type="button" data-new-article>New</button>
        <button class="writer-button writer-button-subtle" type="button" data-github-connect>Sign in with GitHub</button>
      </div>
      <div class="writer-publish-actions">
        <span class="writer-save-state" data-save-state data-state="neutral">Library</span>
        <button class="writer-button" type="button" data-save-draft disabled>Save</button>
        <button class="writer-button" type="button" data-schedule disabled>Schedule</button>
        <button class="writer-button writer-button-primary" type="button" data-publish disabled>Publish</button>
      </div>
    </div>'''
if old not in text:
    raise SystemExit('top actions block not found')
text = text.replace(old, new, 1)

old = '''  <div class="writer-statusbar" aria-live="polite">
    <span data-github-status>GitHub not connected</span>
    <span aria-hidden="true">•</span>
    <span data-document-status>Library</span>
    <span aria-hidden="true">•</span>
    <span data-word-count>0 words</span>
    <span aria-hidden="true">•</span>
    <span data-read-time>1 min read</span>
    <a href="#" data-live-link hidden target="_blank" rel="noopener noreferrer">Open live article ↗</a>
  </div>'''
new = '''  <div class="writer-statusbar" aria-live="polite">
    <div class="writer-status-primary">
      <span class="writer-connection-chip"><i aria-hidden="true"></i><span data-github-status>GitHub not connected</span></span>
      <span class="writer-document-chip" data-document-status data-state="library">Library</span>
    </div>
    <div class="writer-status-meta">
      <span class="writer-autosave-chip" data-local-status data-state="ready"><i aria-hidden="true"></i><span>Local autosave ready</span></span>
      <span class="writer-status-stat" data-word-count>0 words</span>
      <span class="writer-status-stat" data-read-time>1 min read</span>
      <a href="#" data-live-link hidden target="_blank" rel="noopener noreferrer">Open live ↗</a>
    </div>
  </div>'''
if old not in text:
    raise SystemExit('statusbar block not found')
text = text.replace(old, new, 1)

old = '''          <summary>Article details</summary>'''
new = '''          <summary><span>Article details</span><span class="writer-meta-summary" data-meta-summary>Title, publishing and media</span></summary>'''
if old not in text:
    raise SystemExit('article details summary not found')
text = text.replace(old, new, 1)

old = '''        <footer class="writer-editor-footer">
          <span data-local-status>Autosaves locally in this browser.</span>
          <div>'''
new = '''        <footer class="writer-editor-footer">
          <span class="writer-shortcut-hint">Local autosave is automatic · Ctrl/Cmd+S saves to GitHub</span>
          <div>'''
if old not in text:
    raise SystemExit('editor footer status not found')
text = text.replace(old, new, 1)
path.write_text(text)

# ---------- writer.js ----------
path = Path('assets/writer.js')
text = path.read_text()

old = '''  function setSaveState(message) {
    app.querySelector('[data-save-state]').textContent = message;
  }

  function setDocumentStatus(message) {
    app.querySelector('[data-document-status]').textContent = message;
  }'''
new = '''  function saveStateKind(message) {
    const value = String(message || '').toLowerCase();
    if (/failed|expired|error/.test(value)) return 'error';
    if (/unsaved/.test(value)) return 'dirty';
    if (/saving|publishing|scheduling|loading|restoring/.test(value)) return 'working';
    if (/saved|published|scheduled/.test(value)) return 'saved';
    return 'neutral';
  }

  function setSaveState(message) {
    const el = app.querySelector('[data-save-state]');
    el.textContent = message;
    el.dataset.state = saveStateKind(message);
  }

  function setDocumentStatus(message) {
    const el = app.querySelector('[data-document-status]');
    el.textContent = message;
    el.dataset.state = String(message || 'document').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';
  }

  function setLocalStatus(message, state = 'saved') {
    const el = app.querySelector('[data-local-status]');
    if (!el) return;
    const text = el.querySelector('span') || el;
    text.textContent = message;
    el.dataset.state = state;
  }'''
if old not in text:
    raise SystemExit('save/document status functions not found')
text = text.replace(old, new, 1)

old = '''    app.querySelector('[data-description-count]').textContent = `${fields.description.value.length} / 160`;'''
new = '''    app.querySelector('[data-description-count]').textContent = `${fields.description.value.length} / 160`;
    const metaSummary = app.querySelector('[data-meta-summary]');
    if (metaSummary) {
      const summaryBits = [category, formatDate(date)];
      if (fields.filename.value.trim()) summaryBits.push(fields.filename.value.trim().replace(/^\\d{4}-\\d{2}-\\d{2}-/, '').replace(/\\.md$/i, ''));
      metaSummary.textContent = summaryBits.filter(Boolean).join(' · ');
    }'''
if old not in text:
    raise SystemExit('preview count insertion point not found')
text = text.replace(old, new, 1)

old = '''function persistLocalAutosave() {
  if (!dirty) return;
  try {
    localStorage.setItem(localKey(), JSON.stringify(getState()));
    app.querySelector('[data-local-status]').textContent = `Autosaved locally at ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}.`;
  } catch {}
}

function scheduleAutosave() {
  dirty = true;
  setSaveState('Unsaved changes');
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(persistLocalAutosave, 500);
}'''
new = '''function persistLocalAutosave() {
  if (!dirty) return;
  try {
    localStorage.setItem(localKey(), JSON.stringify(getState()));
    const stamp = new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
    setLocalStatus(`Saved locally · ${stamp}`, 'saved');
  } catch {
    setLocalStatus('Local autosave unavailable', 'error');
  }
}

function scheduleAutosave() {
  dirty = true;
  setSaveState('Unsaved changes');
  setLocalStatus('Saving locally…', 'working');
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(persistLocalAutosave, 500);
}'''
if old not in text:
    raise SystemExit('local autosave block not found')
text = text.replace(old, new, 1)

old = '''    app.querySelector('[data-local-status]').textContent = `GitHub saved at ${stamp}.`;'''
new = '''    setLocalStatus(`Saved to GitHub · ${stamp}`, 'github');'''
if old not in text:
    raise SystemExit('GitHub saved local status line not found')
text = text.replace(old, new, 1)

path.write_text(text)

# ---------- writer.css ----------
path = Path('assets/writer.css')
text = path.read_text()
marker = '/* Writer refinement pass 2026-09-16 */'
if marker not in text:
    text += r'''

/* Writer refinement pass 2026-09-16 */
.writer-app{
  --writer-surface:#0c0c0d;
  --writer-surface-raised:#111113;
  --writer-glow:rgba(255,255,255,.055);
  width:min(1660px,calc(100% - 2rem));
}
.writer-topbar{
  padding:.68rem .72rem .68rem .85rem;
  border-radius:15px;
  background:linear-gradient(180deg,rgba(23,23,25,.97),rgba(11,11,12,.98));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.045),0 10px 28px rgba(0,0,0,.18);
}
.writer-topbar h1{font-size:1.13rem;letter-spacing:-.025em}
.writer-top-actions{display:flex;align-items:center;gap:.55rem;flex-wrap:nowrap}
.writer-top-secondary,.writer-publish-actions{display:flex;align-items:center;gap:.34rem}
.writer-top-secondary{padding-right:.55rem;border-right:1px solid rgba(255,255,255,.08)}
.writer-publish-actions{padding-left:.04rem}
.writer-top-actions .writer-button{min-height:34px;padding:.52rem .7rem;border-radius:8px}
.writer-top-actions .writer-button-primary{padding-inline:.9rem}

.writer-button,.writer-toolbar button,.writer-segmented button,.writer-file-button,.writer-library-actions button,.writer-library-actions a{
  letter-spacing:.008em;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.045),0 1px 2px rgba(0,0,0,.3);
}
.writer-button:hover,.writer-toolbar button:hover,.writer-file-button:hover,.writer-library-actions button:hover,.writer-library-actions a:hover{
  box-shadow:inset 0 1px 0 rgba(255,255,255,.065),0 5px 14px rgba(0,0,0,.22);
}
.writer-button-primary{border-color:#fff;background:linear-gradient(180deg,#fff 0%,#eaeae7 72%,#dededb 100%)}

.writer-save-state{gap:.45rem;padding:0 .7rem 0 .58rem;background:#09090a;border-color:rgba(255,255,255,.12);transition:border-color .15s ease,color .15s ease,background .15s ease}
.writer-save-state::before{content:"";width:6px;height:6px;border-radius:50%;background:#6e6e70;box-shadow:0 0 0 3px rgba(255,255,255,.025)}
.writer-save-state[data-state="dirty"]{color:#e2c883;border-color:rgba(201,163,70,.27);background:rgba(122,88,21,.10)}
.writer-save-state[data-state="dirty"]::before{background:#d1a84a}
.writer-save-state[data-state="working"]{color:#c7d9ee;border-color:rgba(112,151,197,.25);background:rgba(49,77,109,.12)}
.writer-save-state[data-state="working"]::before{background:#83a9d2;animation:writer-pulse 1s ease-in-out infinite}
.writer-save-state[data-state="saved"]{color:#b9dbc6;border-color:rgba(87,158,111,.23);background:rgba(46,102,64,.10)}
.writer-save-state[data-state="saved"]::before{background:#6eb787}
.writer-save-state[data-state="error"]{color:#efb1b1;border-color:rgba(184,76,76,.32);background:rgba(115,40,40,.12)}
.writer-save-state[data-state="error"]::before{background:#d86e6e}
@keyframes writer-pulse{50%{opacity:.35;transform:scale(.82)}}

.writer-statusbar{justify-content:space-between;gap:.65rem;padding:.42rem .55rem;background:rgba(8,8,9,.72);border-color:rgba(255,255,255,.065)}
.writer-status-primary,.writer-status-meta{display:flex;align-items:center;gap:.4rem;min-width:0}
.writer-status-meta{justify-content:flex-end;margin-left:auto}
.writer-connection-chip,.writer-document-chip,.writer-autosave-chip,.writer-status-stat{display:inline-flex;align-items:center;gap:.38rem;min-height:25px;padding:0 .52rem;border-radius:999px;white-space:nowrap}
.writer-connection-chip,.writer-status-stat{color:#777;background:transparent}
.writer-connection-chip i,.writer-autosave-chip i{width:5px;height:5px;border-radius:50%;background:#666;flex:0 0 auto}
.writer-document-chip{border:1px solid rgba(255,255,255,.08);background:#101011;color:#aaa;font-weight:760}
.writer-autosave-chip{border:1px solid rgba(255,255,255,.08);background:#0f1010;color:#949696;font-weight:730;transition:.15s ease}
.writer-autosave-chip[data-state="working"]{color:#c7d9ee;border-color:rgba(112,151,197,.2);background:rgba(49,77,109,.10)}
.writer-autosave-chip[data-state="working"] i{background:#83a9d2;animation:writer-pulse 1s ease-in-out infinite}
.writer-autosave-chip[data-state="saved"]{color:#aecdba;border-color:rgba(87,158,111,.20);background:rgba(46,102,64,.08)}
.writer-autosave-chip[data-state="saved"] i{background:#6eb787}
.writer-autosave-chip[data-state="github"]{color:#d5d5d2;border-color:rgba(255,255,255,.13);background:#151516}
.writer-autosave-chip[data-state="github"] i{background:#ededeb}
.writer-autosave-chip[data-state="error"]{color:#e4aaaa;border-color:rgba(184,76,76,.25);background:rgba(115,40,40,.10)}
.writer-autosave-chip[data-state="error"] i{background:#d86e6e}
.writer-statusbar>a{margin-left:.12rem;padding:.28rem .52rem;border-radius:999px;background:#151516;border:1px solid rgba(255,255,255,.08)}

.writer-modebar{min-height:40px;padding:.28rem .34rem;border-radius:10px;background:rgba(10,10,11,.88);box-shadow:inset 0 1px 0 rgba(255,255,255,.018)}
.writer-modebar .writer-segmented{background:#080809}
.writer-modebar .writer-segmented button{padding:.46rem .68rem;font-size:.7rem}

.writer-meta{border-radius:14px;background:linear-gradient(180deg,#101012,#0b0b0c);box-shadow:inset 0 1px 0 rgba(255,255,255,.025),0 8px 24px rgba(0,0,0,.08)}
.writer-meta summary{min-height:40px;padding:.62rem .76rem}
.writer-meta summary>span:first-of-type{font-weight:830;color:#d6d6d3}
.writer-meta-summary{margin-left:auto;max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#676769;font-size:.66rem;font-weight:650;letter-spacing:.01em}
.writer-meta[open] .writer-meta-summary{opacity:.72}
.writer-meta-grid{gap:.52rem .58rem;padding:.66rem .7rem .62rem}
.writer-field>span{color:#747476}
.writer-field input,.writer-field textarea,.writer-field select,.writer-tale-head input,.writer-tale-grid input{border-radius:9px;background:#09090a;border-color:rgba(255,255,255,.09)}

.writer-toolbar{gap:.42rem;padding:.42rem;margin-bottom:.48rem;border:1px solid rgba(255,255,255,.075);border-radius:12px;background:linear-gradient(180deg,#0f0f10,#0a0a0b);box-shadow:inset 0 1px 0 rgba(255,255,255,.02)}
.writer-toolbar-group{display:flex;align-items:center;gap:3px;padding:3px;border-radius:9px;background:#080809;border:1px solid rgba(255,255,255,.05)}
.writer-toolbar button{min-height:29px;padding:.4rem .52rem;border:0;border-radius:6px;background:transparent;box-shadow:none;color:#a2a2a3;font-size:.69rem}
.writer-toolbar button:hover{transform:none;background:#181819;color:#f1f1ef;box-shadow:none}
.writer-toolbar button[data-tool="html"]{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#c9c9c6}
.writer-toolbar button[data-tool="html"]::before{content:"</> ";font-size:.62rem;color:#737375}

.writer-editor-dropzone{position:relative;border-radius:14px;background:linear-gradient(180deg,#0b0b0c,#09090a);box-shadow:0 14px 36px rgba(0,0,0,.11)}
.writer-body-editor{min-height:68vh;padding:1.15rem 1.22rem 5rem;border-radius:14px;font:500 .94rem/1.72 ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;letter-spacing:-.012em;background:transparent;border-color:rgba(255,255,255,.09);caret-color:#f4f4f2;tab-size:2}
.writer-body-editor:focus{background:#0b0b0c;border-color:rgba(255,255,255,.20);box-shadow:0 0 0 3px rgba(255,255,255,.035),0 18px 48px rgba(0,0,0,.12)}
.writer-editor-footer{padding:.48rem .18rem .2rem;color:#676769;font-size:.68rem}
.writer-shortcut-hint{display:inline-flex;align-items:center;min-height:24px}

.writer-preview-frame{border-radius:16px;border-color:rgba(255,255,255,.10);background:#0d0d0e;box-shadow:0 20px 55px rgba(0,0,0,.16),inset 0 1px 0 rgba(255,255,255,.025)}
.writer-preview-article{border-radius:14px;overflow:hidden}
.writer-preview-pane{position:relative}

.writer-dialog{border-color:rgba(255,255,255,.14);border-radius:16px;background:#0d0d0f;box-shadow:0 28px 90px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.035)}
.writer-dialog::backdrop{background:rgba(0,0,0,.68);backdrop-filter:blur(5px)}
.writer-dialog header{background:linear-gradient(180deg,#151517,#101011);border-bottom-color:rgba(255,255,255,.08)}
.writer-html-code{min-height:44vh!important;border-radius:10px!important;padding:.9rem!important;line-height:1.55!important;background:#080809!important}

.writer-library-card{border-radius:15px;background:linear-gradient(145deg,#111113,#0b0b0c);box-shadow:0 9px 28px rgba(0,0,0,.12)}
.writer-library-card:hover{border-color:rgba(255,255,255,.21);box-shadow:0 16px 42px rgba(0,0,0,.19)}
.writer-library-card-body h3{letter-spacing:-.025em}

@media (min-width:1200px){
  .writer-workspace[data-view-mode="split"]{grid-template-columns:minmax(0,1.04fr) minmax(0,.96fr);gap:1rem}
}
@media (max-width:1050px){
  .writer-topbar{align-items:flex-start}
  .writer-top-actions{flex-wrap:wrap;justify-content:flex-end}
  .writer-top-secondary{border-right:0;padding-right:0}
  .writer-publish-actions{width:100%;justify-content:flex-end}
  .writer-statusbar{align-items:flex-start}
  .writer-status-primary,.writer-status-meta{flex-wrap:wrap}
}
@media (max-width:760px){
  .writer-app{width:min(100% - 1rem,1660px);margin-top:.5rem}
  .writer-topbar{padding:.62rem;gap:.65rem}
  .writer-top-actions{width:100%}
  .writer-top-secondary,.writer-publish-actions{width:100%;justify-content:flex-start;overflow-x:auto;scrollbar-width:none}
  .writer-top-secondary::-webkit-scrollbar,.writer-publish-actions::-webkit-scrollbar{display:none}
  .writer-statusbar{gap:.35rem}
  .writer-status-primary,.writer-status-meta{width:100%;justify-content:flex-start;overflow-x:auto;scrollbar-width:none}
  .writer-status-primary::-webkit-scrollbar,.writer-status-meta::-webkit-scrollbar{display:none}
  .writer-status-stat{display:none}
  .writer-meta-summary{max-width:58%}
  .writer-toolbar{overflow-x:auto;flex-wrap:nowrap;scrollbar-width:none}
  .writer-toolbar::-webkit-scrollbar{display:none}
  .writer-toolbar-group{flex:0 0 auto}
  .writer-body-editor{min-height:62vh;padding:1rem .9rem 4rem;font-size:.9rem}
}
'''
path.write_text(text)
