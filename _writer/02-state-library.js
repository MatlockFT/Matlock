  function getState() {
    return {
      title: fields.title.value,
      description: fields.description.value,
      date: fields.date.value,
      category: fields.category.value,
      tags: fields.tags.value,
      imagePath: fields.imagePath.value,
      imageAlt: fields.imageAlt.value,
      imagePosition: fields.imagePosition.value,
      filename: fields.filename.value,
      publishAt: fields.publishAt.value,
      showToc: fields.showToc.checked,
      spoilerWarning: fields.spoilerWarning.checked,
      pinned: fields.pinned.checked,
      body: bodyEditor.value,
      htmlBlocks: [...htmlBlocks.values()].map(block => ({ ...block })),
      currentPath,
      currentSha,
      originalFrontmatter,
      currentPublished,
      savedAt: Date.now()
    };
  }

  function applyState(state, { remote = false } = {}) {
    fields.title.value = state.title || '';
    fields.description.value = state.description || '';
    fields.date.value = (state.date || today()).slice(0,10);
    fields.category.value = state.category || 'Breakdown';
    fields.tags.value = state.tags || '';
    fields.imagePath.value = state.imagePath || '';
    fields.imageAlt.value = state.imageAlt || '';
    fields.imagePosition.value = state.imagePosition || 'center center';
    fields.filename.value = state.filename || '';
    fields.publishAt.value = state.publishAt || '';
    fields.showToc.checked = Boolean(state.showToc);
    fields.spoilerWarning.checked = Boolean(state.spoilerWarning);
    fields.pinned.checked = Boolean(state.pinned);
    bodyEditor.value = prepareEditorBody(state.body || '', state.htmlBlocks || []);
    renderHtmlBlockRail();
    if (remote) {
      currentPath = state.currentPath || '';
      currentSha = state.currentSha || '';
      originalFrontmatter = state.originalFrontmatter || '';
      currentPublished = Boolean(state.currentPublished);
      filenameTouched = Boolean(currentPath);
      fields.filename.disabled = Boolean(currentPath);
      dirty = false;
      updateSaveButtonLabel();
      updateUrlPath();
    }
    updatePreview();
    updateDocumentStatus();
  }

  function stateFromFile(text, path, sha) {
    const parsed = parseFrontmatter(text);
    const m = parsed.meta;
    const image = (m.image && typeof m.image === 'object') ? m.image : { path: typeof m.image === 'string' ? m.image : '' };
    return {
      title: m.title || '',
      description: m.description || '',
      date: String(m.date || '').slice(0,10) || today(),
      category: m.category || (Array.isArray(m.categories) ? m.categories[0] : '') || 'Breakdown',
      tags: Array.isArray(m.tags) ? m.tags.join(', ') : (m.tags || ''),
      imagePath: image.path || '',
      imageAlt: image.alt || '',
      imagePosition: image.position || 'center center',
      filename: path.split('/').pop(),
      publishAt: isoToLocalInput(m.publish_at || ''),
      showToc: Boolean(m.show_toc),
      spoilerWarning: Boolean(m.spoiler_warning),
      pinned: Boolean(m.pinned),
      body: parsed.body.replace(/^\n+/, ''),
      currentPath: path,
      currentSha: sha,
      originalFrontmatter: parsed.frontmatter,
      currentPublished: m.published !== false
    };
  }

  function encodeBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  function decodeBase64(value) {
    const binary = atob(String(value || '').replace(/\n/g,''));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function isServerSession() {
  return githubCredential.startsWith('session:');
}

function setPublishingControls(enabled) {
  const active = Boolean(enabled) && !saveInFlight && !imageUploadInFlight && !videoUploadInFlight;
  saveDraftButton.disabled = !active;
  publishButton.disabled = !active;
  scheduleButton.disabled = !active;
  uploadButton.disabled = !active || !selectedImageFile;
}

function expireGithubConnection(message = 'GitHub session expired. Sign in again to save or publish.') {
  githubCredential = '';
  githubLogin = '';
  setPublishingControls(false);
  app.querySelector('[data-github-status]').textContent = 'GitHub session expired';
  const topConnect = app.querySelector('[data-github-connect]');
  if (topConnect) {
    topConnect.textContent = 'GitHub';
    topConnect.dataset.connected = 'false';
    topConnect.title = 'Connect GitHub';
  }
  window.dispatchEvent(new CustomEvent('matlock-writer:auth-expired'));
  showToast(message, 6000);
}

async function githubFetch(path, options = {}, requireAuth = false) {
  const method = options.method || 'GET';
  if (requireAuth && !githubCredential) throw new Error('Sign in with GitHub first.');

  let response;
  try {
    if (githubCredential && isServerSession()) {
      if (!authBase) throw new Error('Writer auth bridge is unavailable.');
      const id = githubCredential.slice('session:'.length);
      const headers = { Accept: 'application/json', 'X-Writer-Session': id, ...(options.headers || {}) };
      response = await fetch(`${authBase}/api/writer/github?path=${encodeURIComponent(path)}`, { ...options, method, headers, mode: 'cors' });
    } else {
      const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(options.headers || {}) };
      if (githubCredential) headers.Authorization = `Bearer ${githubCredential}`;
      response = await fetch(`https://api.github.com/repos/${repo}${path}`, { ...options, method, headers });
    }
  } catch (error) {
    if (error?.message === 'Writer auth bridge is unavailable.') throw error;
    throw new Error(navigator.onLine === false
      ? 'You appear to be offline. Your local autosave is safe.'
      : 'Could not reach GitHub. Your local autosave is safe; try again in a moment.');
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = await response.json();
      if (data.message || data.error) message = data.message || data.error;
    } catch {}
    if (response.status === 401 && githubCredential) expireGithubConnection();
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

  async function connectGitHub() {
  const credential = tokenInput.value.trim();
  if (!credential) { showToast('Sign in with GitHub or enter a fine-grained token.'); return; }
  const button = app.querySelector('[data-github-authorize]');
  button.disabled = true;
  button.textContent = 'Connecting…';
  try {
    githubCredential = credential;
    const info = await githubFetch('', {}, true);
    githubLogin = info.owner?.login || 'GitHub';
    tokenInput.value = '';
    if (connectDialog.open) connectDialog.close();
    app.querySelector('[data-github-status]').textContent = `Connected to ${repo} as ${githubLogin}`;
    const topConnect = app.querySelector('[data-github-connect]');
    if (topConnect) {
      topConnect.textContent = 'GitHub';
      topConnect.dataset.connected = 'true';
      topConnect.title = `GitHub connected as ${githubLogin}`;
    }
    setPublishingControls(true);
    window.dispatchEvent(new CustomEvent('matlock-writer:auth', { detail: { login: githubLogin } }));
    showToast('GitHub connected.');
    if (selectedImageFile && !imageUploadInFlight) uploadFeaturedImage();
  } catch (error) {
    githubCredential = '';
    setPublishingControls(false);
    showToast(`Could not connect: ${error.message}`, 5000);
  } finally {
    button.disabled = false;
    button.textContent = 'Connect with token';
  }
}

  function showLibrary() {
    if (dirty && !window.confirm('Leave the editor with unsaved changes? Your local autosave will remain available.')) return;
    libraryView.hidden = false;
    editorView.hidden = true;
    setSaveState('Library');
    setDocumentStatus('Library');
    history.replaceState(null, '', '/write/');
    renderLibrary();
  }

  function showEditor() {
    libraryView.hidden = true;
    editorView.hidden = false;
  }

  function localKey() { return `matlock-writer:${currentPath || 'new'}`; }

function persistLocalAutosave() {
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
}

  function maybeRestoreLocal(key, remoteState = null) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (remoteState && saved.currentSha !== remoteState.currentSha) return false;
      const hasWork = (saved.title || saved.body || '').trim();
      if (!hasWork) return false;
      if (remoteState && !window.confirm('A local autosave exists for this article. Restore it?')) return false;
      applyState(saved, { remote: Boolean(remoteState) });
      dirty = true;
      showEditor();
      setSaveState('Restored local changes');
      showToast('Restored your local autosave.');
      return true;
    } catch { return false; }
  }

  function resetNewArticle({ template = '' } = {}) {
    if (dirty && !window.confirm('Start a new article and leave the current unsaved changes?')) return;
    clearLocalFeaturedPreview();
    currentPath = '';
    currentSha = '';
    originalFrontmatter = '';
    currentPublished = false;
    filenameTouched = false;
    fields.filename.disabled = false;
    const initial = { date: today(), category: 'Breakdown', imagePosition: 'center center' };
    if (template && templateBodies[template]) {
      initial.category = templateBodies[template].category;
      initial.body = templateBodies[template].body;
    }
    applyState(initial, { remote: true });
    setArticleDetailsOpen(true);
    showEditor();
    history.replaceState(null, '', '/write/');
    if (!template) maybeRestoreLocal('matlock-writer:new');
    setSaveState(template ? 'New article from template' : 'New article');
  }

  function articleStatus(meta) {
    if (meta.published !== false) return 'published';
    const when = meta.publish_at ? Date.parse(meta.publish_at) : NaN;
    return !Number.isNaN(when) && when > Date.now() ? 'scheduled' : 'draft';
  }

  function loadLibraryCache() {
    try { return JSON.parse(localStorage.getItem('matlock-writer:library-cache') || '{}'); } catch { return {}; }
  }

  function saveLibraryCache(cache) {
    try { localStorage.setItem('matlock-writer:library-cache', JSON.stringify(cache)); } catch {}
  }

  async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let index = 0;
    async function run() {
      while (index < items.length) {
        const i = index++;
        results[i] = await worker(items[i], i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
  }

  async function loadLibrary({ hydrate = Boolean(githubCredential) } = {}) {
    libraryList.innerHTML = '<div class="writer-library-empty">Loading article library…</div>';
    try {
      const files = await githubFetch('/contents/_posts?ref=main');
      const markdownFiles = files.filter(item => item.type === 'file' && /\.md$/i.test(item.name)).sort((a,b) => b.name.localeCompare(a.name));
      const cache = loadLibraryCache();
      libraryEntries = markdownFiles.map(item => {
        const cached = cache[item.path];
        if (cached?.sha === item.sha) return { ...cached, path: item.path, name: item.name, sha: item.sha };
        return {
          path: item.path,
          name: item.name,
          sha: item.sha,
          title: item.name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/i,'').replace(/-/g,' '),
          date: item.name.slice(0,10),
          category: '', tags: [], imagePath: '', status: 'unknown', publishAt: '', editedAt: ''
        };
      });
      renderLibrary();
      if (hydrate) await hydrateLibrary();
    } catch (error) {
      libraryList.innerHTML = `<div class="writer-library-empty">Could not load articles: ${escapeHtml(error.message)}</div>`;
    }
  }

  async function hydrateLibrary() {
    if (!libraryEntries.length || !githubCredential) return;
    const cache = loadLibraryCache();
    const needs = libraryEntries.filter(entry => !cache[entry.path] || cache[entry.path].sha !== entry.sha || cache[entry.path].status === 'unknown');
    if (!needs.length) { renderLibrary(); hydrateEditedTimes(); return; }

    await mapLimit(needs, 6, async entry => {
      try {
        const data = await githubFetch(`/contents/${encodeURIComponent(entry.path).replace(/%2F/g,'/')}?ref=main`);
        const parsed = parseFrontmatter(decodeBase64(data.content));
        const m = parsed.meta;
        const image = (m.image && typeof m.image === 'object') ? m.image : { path: typeof m.image === 'string' ? m.image : '' };
        const summary = {
          path: entry.path,
          name: entry.name,
          sha: data.sha || entry.sha,
          title: m.title || entry.title,
          description: m.description || '',
          date: String(m.date || entry.date).slice(0,10),
          category: m.category || '',
          tags: Array.isArray(m.tags) ? m.tags : (m.tags ? [m.tags] : []),
          imagePath: image.path || '',
          status: articleStatus(m),
          publishAt: m.publish_at || '',
          editedAt: cache[entry.path]?.editedAt || ''
        };
        cache[entry.path] = summary;
        const idx = libraryEntries.findIndex(item => item.path === entry.path);
        if (idx >= 0) libraryEntries[idx] = summary;
      } catch {}
    });
    saveLibraryCache(cache);
    renderLibrary();
    hydrateEditedTimes();
  }

  async function hydrateEditedTimes() {
    if (!githubCredential) return;
    const cache = loadLibraryCache();
    const visible = filteredLibraryEntries().slice(0, 24).filter(entry => !entry.editedAt);
    await mapLimit(visible, 4, async entry => {
      try {
        const commits = await githubFetch(`/commits?path=${encodeURIComponent(entry.path)}&per_page=1`);
        const editedAt = commits?.[0]?.commit?.committer?.date || commits?.[0]?.commit?.author?.date || '';
        if (!editedAt) return;
        entry.editedAt = editedAt;
        if (cache[entry.path]) cache[entry.path].editedAt = editedAt;
      } catch {}
    });
    saveLibraryCache(cache);
    renderLibrary();
  }

  function filteredLibraryEntries() {
    const query = (librarySearch.value || '').trim().toLowerCase();
    return libraryEntries.filter(entry => {
      if (libraryFilter !== 'all' && entry.status !== libraryFilter) return false;
      if (!query) return true;
      return [entry.title, entry.name, entry.category, ...(entry.tags || [])].join(' ').toLowerCase().includes(query);
    });
  }

  function libraryLiveUrl(entry) {
    if (entry.status !== 'published') return '';
    const match = entry.name.replace(/\.md$/i,'').match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
    return match ? `/${match[1]}/${match[2]}/${match[3]}/${match[4]}.html` : '';
  }

  function renderLibrary() {
    const counts = {
      total: libraryEntries.length,
      draft: libraryEntries.filter(x => x.status === 'draft').length,
      scheduled: libraryEntries.filter(x => x.status === 'scheduled').length,
      published: libraryEntries.filter(x => x.status === 'published').length
    };
    libraryStats.innerHTML = `<span><strong>${counts.total}</strong> total</span><span><strong>${counts.draft}</strong> drafts</span><span><strong>${counts.scheduled}</strong> scheduled</span><span><strong>${counts.published}</strong> published</span>`;

    const entries = filteredLibraryEntries();
    if (!entries.length) {
      libraryList.innerHTML = '<div class="writer-library-empty">No matching articles.</div>';
      return;
    }

    libraryList.innerHTML = entries.map(entry => {
      const image = normalizeImagePath(entry.imagePath);
      const status = entry.status || 'unknown';
      const statusText = status === 'scheduled' ? `Scheduled ${formatDateTime(entry.publishAt)}` : status === 'published' ? 'Published' : status === 'draft' ? 'Draft' : 'Loading';
      const edited = entry.editedAt ? `Edited ${formatDateTime(entry.editedAt)}` : entry.date ? `Dated ${formatDate(entry.date)}` : '';
      const live = libraryLiveUrl(entry);
      return `<article class="writer-library-card" data-library-path="${escapeHtml(entry.path)}">
        <div class="writer-library-thumb">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : '<span>MATLOCK</span>'}</div>
        <div class="writer-library-card-body">
          <div class="writer-library-card-meta"><span class="writer-status-badge is-${status}">${escapeHtml(statusText)}</span>${entry.category ? `<span>${escapeHtml(entry.category)}</span>` : ''}</div>
          <h3>${escapeHtml(entry.title || entry.name)}</h3>
          <p>${escapeHtml(entry.description || edited || entry.name)}</p>
          <div class="writer-library-card-foot"><span>${escapeHtml(edited)}</span><div class="writer-library-actions"><button type="button" data-library-edit>Edit</button><button type="button" data-library-duplicate>Duplicate</button>${live ? `<a href="${escapeHtml(live)}" target="_blank" rel="noopener noreferrer">View live</a>` : ''}</div></div>
        </div>
      </article>`;
    }).join('');
  }

  async function loadArticle(path, { force = false } = {}) {
    if (!force && dirty && !window.confirm('Open another article and leave the current unsaved changes?')) return;
    clearLocalFeaturedPreview();
    setSaveState('Loading…');
    try {
      const data = await githubFetch(`/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}?ref=main`);
      const state = stateFromFile(decodeBase64(data.content), path, data.sha);
      applyState(state, { remote: true });
      const restored = maybeRestoreLocal(`matlock-writer:${path}`, state);
      if (!restored) dirty = false;
      showEditor();
      if ((state.body || '').trim() || state.title) setArticleDetailsOpen(false);
      setSaveState(currentPublished ? 'Published article' : fields.publishAt.value ? 'Scheduled article' : 'Draft article');
      showToast('Article loaded.');
    } catch (error) {
      setSaveState('Load failed');
      showToast(`Could not load article: ${error.message}`, 5000);
    }
  }

  async function duplicateArticle(path) {
    if (dirty && !window.confirm('Duplicate another article and leave the current unsaved changes?')) return;
    clearLocalFeaturedPreview();
    try {
      const data = await githubFetch(`/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}?ref=main`);
      const state = stateFromFile(decodeBase64(data.content), path, data.sha);
      state.title = `${state.title} — Copy`;
      state.filename = `${today()}-${slugify(state.title.replace(/— Copy$/, '').trim())}-copy.md`;
      state.publishAt = '';
      state.currentPath = '';
      state.currentSha = '';
      state.currentPublished = false;
      applyState(state, { remote: true });
      currentPath = '';
      currentSha = '';
      currentPublished = false;
      fields.filename.disabled = false;
      filenameTouched = true;
      setArticleDetailsOpen(true);
      showEditor();
      dirty = true;
      setSaveState('Duplicated • unsaved');
      showToast('Article duplicated into a new draft.');
    } catch (error) {
      showToast(`Could not duplicate article: ${error.message}`, 5000);
    }
  }

