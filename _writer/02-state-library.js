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
      newsFeature: Boolean(fields.newsFeature?.checked),
      newsFeatureUntil: fields.newsFeatureUntil?.value || '',
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
    if (fields.newsFeature) fields.newsFeature.checked = Boolean(state.newsFeature);
    if (fields.newsFeatureUntil) fields.newsFeatureUntil.value = state.newsFeatureUntil || '';
    fields.showToc.checked = Boolean(state.showToc);
    fields.spoilerWarning.checked = Boolean(state.spoilerWarning);
    fields.pinned.checked = Boolean(state.pinned);
    bodyEditor.value = prepareEditorBody(state.body || '', state.htmlBlocks || []);
    renderHtmlBlockRail();
    scheduleWriterAutoCorrectFighterRefresh(0);
    if (remote) {
      currentPath = state.currentPath || '';
      currentSha = state.currentSha || '';
      originalFrontmatter = state.originalFrontmatter || '';
      currentPublished = Boolean(state.currentPublished);
      filenameTouched = Boolean(currentPath);
      fields.filename.disabled = Boolean(currentPath);
      dirty = false;
      updateSaveButtonLabel();
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
      newsFeature: Boolean(m.news_feature),
      newsFeatureUntil: isoToLocalInput(m.news_feature_until || ''),
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

function setPublishingControls() {
  const editing = Boolean(editorView && !editorView.hidden);
  const active = editing && !saveInFlight && !imageUploadInFlight && !videoUploadInFlight;
  saveDraftButton.disabled = !active;
  publishButton.disabled = !active;
  scheduleButton.disabled = !active;
  uploadButton.disabled = !active || !selectedImageFile || !githubCredential;
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

  function writerUrl(mode, path = '') {
    const url = new URL('/write/', location.origin);
    if (mode === 'new') url.searchParams.set('new', '1');
    if (mode === 'article' && path) url.searchParams.set('path', path);
    if (mode === 'media') url.searchParams.set('media', '1');
    return url.pathname + url.search;
  }

  function setWriterRoute(mode, { path = '', replace = false } = {}) {
    const target = writerUrl(mode, path);
    const current = location.pathname + location.search;
    if (target === current) return;
    history[replace ? 'replaceState' : 'pushState'](null, '', target);
  }

  function setWriterScreen(screen) {
    app.dataset.writerScreen = screen;
    const editing = screen === 'editor';
    libraryView.hidden = screen !== 'library';
    editorView.hidden = !editing;
    if (mediaLibraryView) mediaLibraryView.hidden = screen !== 'media';
    setPublishingControls(Boolean(githubCredential));
  }

  function showLibrary({ updateRoute = true, replaceRoute = false } = {}) {
    if (dirty) {
      persistLocalAutosave();
      dirty = false;
    }
    setWriterScreen('library');
    setSaveState('Library');
    setDocumentStatus('Library');
    setLocalStatus('Local autosave ready', 'ready');
    if (updateRoute) setWriterRoute('library', { replace: replaceRoute });
    renderLibrary();
    return true;
  }

  function showEditor({ route = '', path = '', updateRoute = true, replaceRoute = false } = {}) {
    setWriterScreen('editor');
    if (updateRoute) {
      const mode = route || (path || currentPath ? 'article' : 'new');
      setWriterRoute(mode, { path: path || currentPath, replace: replaceRoute });
    }
  }

  function localKey() { return `matlock-writer:${currentPath || 'new'}`; }

  function readLocalNewDraft() {
    try {
      const saved = JSON.parse(localStorage.getItem('matlock-writer:new') || 'null');
      if (!saved) return null;
      const hasWork = ((saved.title || '') + (saved.body || '')).trim();
      return hasWork ? saved : null;
    } catch {
      return null;
    }
  }

  function resumeLocalNewDraft({ updateRoute = true, replaceRoute = false } = {}) {
    const saved = readLocalNewDraft();
    if (!saved) return false;
    clearLocalFeaturedPreview();
    currentPath = '';
    currentSha = '';
    originalFrontmatter = '';
    currentPublished = false;
    fields.filename.disabled = false;
    applyState({ ...saved, currentPath: '', currentSha: '', currentPublished: false }, { remote: true });
    filenameTouched = Boolean(saved.filename);
    dirty = true;
    setArticleDetailsOpen(false);
    showEditor({ route: 'new', updateRoute, replaceRoute });
    setSaveState('Local draft • unsaved to GitHub');
    setLocalStatus(saved.savedAt ? `Saved locally · ${new Date(saved.savedAt).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' })}` : 'Saved locally', 'saved');
    return true;
  }

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

      const repaired = repairSavedHtmlVisualState(saved, remoteState);
      applyState(repaired.state, { remote: Boolean(remoteState) });
      dirty = true;
      showEditor();
      setSaveState(repaired.recovered ? 'Local changes restored · visuals repaired' : 'Local changes restored');

      if (repaired.unresolved) {
        showToast(
          `Restored local changes. ${repaired.recovered ? repaired.recovered + ' visual' + (repaired.recovered === 1 ? '' : 's') + ' repaired. ' : ''}` +
          `${repaired.unresolved} local visual${repaired.unresolved === 1 ? '' : 's'} still need recovery.`,
          8000
        );
      } else if (repaired.recovered) {
        showToast(`Restored your local changes and repaired ${repaired.recovered} visual${repaired.recovered === 1 ? '' : 's'} from the GitHub copy.`, 6500);
      } else {
        showToast('Restored your unsaved local changes.');
      }
      return true;
    } catch { return false; }
  }

  function resetNewArticle({ template = '', updateRoute = true, replaceRoute = false, allowExistingLocal = false } = {}) {
    if (dirty) {
      if (!window.confirm('Start a new article and leave the current unsaved changes?')) return false;
      persistLocalAutosave();
      dirty = false;
    }
    const existingLocal = readLocalNewDraft();
    if (existingLocal && !allowExistingLocal) {
      showToast('A browser-only draft already exists. Resume or discard it from the Library before starting another.', 6000);
      showLibrary({ updateRoute: true });
      return false;
    }
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
    showEditor({ route: 'new', updateRoute, replaceRoute });
    setSaveState(template ? 'New article from template' : 'New article');
    setLocalStatus('Local autosave ready', 'ready');
    return true;
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
          category: '', tags: [], imagePath: '', status: 'unknown', publishAt: '', editedAt: '', mediaRefs: []
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
    const needs = libraryEntries.filter(entry => !cache[entry.path] || cache[entry.path].sha !== entry.sha || cache[entry.path].status === 'unknown' || !Array.isArray(cache[entry.path].mediaRefs));
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
          editedAt: cache[entry.path]?.editedAt || '',
          mediaRefs: collectArticleMediaRefs({ imagePath: image.path || '', body: parsed.body || '' })
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

  function localAutosaveForEntry(entry) {
    if (!entry?.path) return null;
    try {
      const raw = localStorage.getItem(`matlock-writer:${entry.path}`);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || saved.currentPath !== entry.path) return null;
      // Only merge local metadata into the normal card when it was based on the
      // exact GitHub revision represented by this Library entry. A SHA mismatch
      // is a real remote/local conflict and must not silently masquerade as fresh.
      if (entry.sha && saved.currentSha !== entry.sha) return null;
      const hasWork = [
        saved.title,
        saved.body,
        saved.description,
        saved.imagePath
      ].some(value => String(value || '').trim());
      return hasWork ? saved : null;
    } catch {
      return null;
    }
  }

  function libraryDisplayEntry(entry) {
    const local = localAutosaveForEntry(entry);
    if (!local) return { ...entry, hasLocalChanges: false };

    const localTags = Array.isArray(local.tags)
      ? local.tags
      : String(local.tags || '').split(',').map(value => value.trim()).filter(Boolean);

    return {
      ...entry,
      title: Object.prototype.hasOwnProperty.call(local, 'title') ? local.title : entry.title,
      description: Object.prototype.hasOwnProperty.call(local, 'description') ? local.description : entry.description,
      date: Object.prototype.hasOwnProperty.call(local, 'date') ? local.date : entry.date,
      category: Object.prototype.hasOwnProperty.call(local, 'category') ? local.category : entry.category,
      tags: Object.prototype.hasOwnProperty.call(local, 'tags') ? localTags : entry.tags,
      imagePath: Object.prototype.hasOwnProperty.call(local, 'imagePath') ? local.imagePath : entry.imagePath,
      publishAt: Object.prototype.hasOwnProperty.call(local, 'publishAt') ? local.publishAt : entry.publishAt,
      mediaRefs: collectArticleMediaRefs({
        imagePath: Object.prototype.hasOwnProperty.call(local, 'imagePath') ? local.imagePath : entry.imagePath,
        body: Object.prototype.hasOwnProperty.call(local, 'body') ? local.body : ''
      }),
      hasLocalChanges: true,
      localSavedAt: local.savedAt || 0
    };
  }

  function filteredLibraryEntries() {
    const query = (librarySearch.value || '').trim().toLowerCase();
    return libraryEntries.filter(entry => {
      const display = libraryDisplayEntry(entry);
      if (libraryFilter !== 'all' && display.status !== libraryFilter) return false;
      if (!query) return true;
      return [display.title, display.name, display.category, ...(display.tags || [])].join(' ').toLowerCase().includes(query);
    });
  }

  function libraryLiveUrl(entry) {
    if (entry.status !== 'published') return '';
    const match = entry.name.replace(/\.md$/i,'').match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
    return match ? `/${match[1]}/${match[2]}/${match[3]}/${match[4]}.html` : '';
  }

  function markArticleUnpublished(text) {
    const normalized = String(text || '').replace(/\r\n?/g, '\n');
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) throw new Error('Article frontmatter is missing.');

    let frontmatter = match[1];
    if (/^published:/m.test(frontmatter)) {
      frontmatter = frontmatter.replace(/^published:.*$/m, 'published: false');
    } else {
      frontmatter = `${frontmatter.trimEnd()}\npublished: false`;
    }
    frontmatter = frontmatter.replace(/^publish_at:.*(?:\n|$)/m, '').trimEnd();

    return `---\n${frontmatter}\n---\n${normalized.slice(match[0].length)}`;
  }

  function updateLibraryCacheEntry(path, patch) {
    const cache = loadLibraryCache();
    if (cache[path]) {
      cache[path] = { ...cache[path], ...patch };
      saveLibraryCache(cache);
    }
  }

  function removeLibraryCacheEntry(path) {
    const cache = loadLibraryCache();
    if (cache[path]) {
      delete cache[path];
      saveLibraryCache(cache);
    }
  }

  async function unpublishLibraryArticle(path) {
    const entry = libraryEntries.find(item => item.path === path);
    if (!entry || entry.status !== 'published') return;
    if (!githubCredential) { connectDialog.showModal(); return; }

    const title = entry.title || entry.name;
    if (!window.confirm(`Unpublish “${title}”?\n\nIt will be removed from the public site after the next deployment, but the article will stay in Writer as a draft.`)) return;

    const apiPath = `/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}`;
    try {
      const data = await githubFetch(`${apiPath}?ref=main`);
      const unpublishedText = markArticleUnpublished(decodeBase64(data.content));
      const result = await githubFetch(apiPath, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Unpublish ${entry.name}`,
          content: encodeBase64(unpublishedText),
          sha: data.sha,
          branch: 'main'
        })
      }, true);

      entry.sha = result.content?.sha || data.sha;
      entry.status = 'draft';
      entry.publishAt = '';
      updateLibraryCacheEntry(path, { sha: entry.sha, status: 'draft', publishAt: '' });

      if (currentPath === path) {
        currentSha = entry.sha;
        currentPublished = false;
        fields.publishAt.value = '';
        originalFrontmatter = parseFrontmatter(unpublishedText).frontmatter;
        updateSaveButtonLabel();
        updateLiveLink();
        updateDocumentStatus();
      }

      renderLibrary();
      showToast('Article unpublished. The public site is redeploying now.', 5000);
      loadLibrary({ hydrate: true });
    } catch (error) {
      showToast(`Could not unpublish: ${error.message}`, 6000);
    }
  }

  async function deleteLibraryArticle(path) {
    const entry = libraryEntries.find(item => item.path === path);
    if (!entry) return;
    if (!githubCredential) { connectDialog.showModal(); return; }

    const title = entry.title || entry.name;
    const liveWarning = entry.status === 'published'
      ? '\n\nThis article is currently public. Its page will disappear after the next deployment.'
      : '';
    if (!window.confirm(`Delete “${title}”?\n\nThis removes the article source file from Writer and GitHub. Git history can still recover it, but there is no undo button in Writer.${liveWarning}`)) return;

    const apiPath = `/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}`;
    try {
      const data = await githubFetch(`${apiPath}?ref=main`);
      await githubFetch(apiPath, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Delete ${entry.name}`,
          sha: data.sha,
          branch: 'main'
        })
      }, true);

      removeLibraryCacheEntry(path);
      libraryEntries = libraryEntries.filter(item => item.path !== path);
      try { localStorage.removeItem(`matlock-writer:${path}`); } catch {}

      if (currentPath === path) {
        resetNewArticle();
        showLibrary();
      }

      renderLibrary();
      showToast('Article deleted from GitHub. The public site is redeploying now.', 5000);
      loadLibrary({ hydrate: true });
    } catch (error) {
      showToast(`Could not delete: ${error.message}`, 6000);
    }
  }

  function renderLibrary() {
    const localDraft = readLocalNewDraft();
    const counts = {
      total: libraryEntries.length + (localDraft ? 1 : 0),
      draft: libraryEntries.filter(x => x.status === 'draft').length + (localDraft ? 1 : 0),
      scheduled: libraryEntries.filter(x => x.status === 'scheduled').length,
      published: libraryEntries.filter(x => x.status === 'published').length
    };
    libraryStats.innerHTML = `<span><strong>${counts.total}</strong> total</span><span><strong>${counts.draft}</strong> drafts</span><span><strong>${counts.scheduled}</strong> scheduled</span><span><strong>${counts.published}</strong> published</span>`;

    const entries = filteredLibraryEntries();
    const query = (librarySearch.value || '').trim().toLowerCase();
    const localDraftMatches =
      Boolean(localDraft) &&
      (libraryFilter === 'all' || libraryFilter === 'draft') &&
      (!query || [localDraft.title, localDraft.filename, localDraft.category].filter(Boolean).join(' ').toLowerCase().includes(query));

    const localDraftCard = localDraftMatches ? (() => {
      const title = String(localDraft.title || '').trim() || 'Untitled local draft';
      const savedAt = localDraft.savedAt ? new Date(localDraft.savedAt) : null;
      const edited = savedAt && !Number.isNaN(savedAt.getTime()) ? `Saved locally ${savedAt.toLocaleString([], { dateStyle:'medium', timeStyle:'short' })}` : 'Saved locally in this browser';
      return `<article class="writer-library-card writer-library-card-local" data-library-local-draft>
        <div class="writer-library-thumb"><span>LOCAL</span></div>
        <div class="writer-library-card-body">
          <div class="writer-library-card-meta"><span class="writer-status-badge is-draft">Local draft</span><span>Not yet saved to GitHub</span></div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(edited)}</p>
          <div class="writer-library-card-foot"><span>${escapeHtml(localDraft.filename || 'Browser recovery draft')}</span><div class="writer-library-actions"><button type="button" data-library-resume-local>Resume</button><button type="button" data-library-discard-local>Discard</button></div></div>
        </div>
      </article>`;
    })() : '';

    if (!entries.length && !localDraftCard) {
      libraryList.innerHTML = '<div class="writer-library-empty">No matching articles.</div>';
      return;
    }

    const remoteCards = entries.map(remoteEntry => {
      const entry = libraryDisplayEntry(remoteEntry);
      const image = normalizeImagePath(entry.imagePath);
      const status = entry.status || 'unknown';
      const statusText = status === 'scheduled' ? `Scheduled ${formatDateTime(entry.publishAt)}` : status === 'published' ? 'Published' : status === 'draft' ? 'Draft' : 'Loading';
      const remoteEdited = entry.editedAt ? `Edited ${formatDateTime(entry.editedAt)}` : entry.date ? `Dated ${formatDate(entry.date)}` : '';
      const localEdited = entry.hasLocalChanges && entry.localSavedAt
        ? `Local changes ${new Date(entry.localSavedAt).toLocaleString([], { dateStyle:'medium', timeStyle:'short' })}`
        : entry.hasLocalChanges ? 'Local changes not yet saved to GitHub' : '';
      const edited = localEdited || remoteEdited;
      const live = libraryLiveUrl(remoteEntry);
      return `<article class="writer-library-card${entry.hasLocalChanges ? ' writer-library-card-has-local' : ''}" data-library-path="${escapeHtml(entry.path)}">
        <div class="writer-library-thumb">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : '<span>MATLOCK</span>'}</div>
        <div class="writer-library-card-body">
          <div class="writer-library-card-meta"><span class="writer-status-badge is-${status}">${escapeHtml(statusText)}</span>${entry.hasLocalChanges ? '<span class="writer-library-local-changes">Local changes</span>' : ''}${entry.category ? `<span>${escapeHtml(entry.category)}</span>` : ''}</div>
          <h3>${escapeHtml(entry.title || entry.name)}</h3>
          <p>${escapeHtml(entry.description || edited || entry.name)}</p>
          <div class="writer-library-card-foot"><span>${escapeHtml(edited)}</span><div class="writer-library-actions"><button type="button" data-library-edit>${entry.hasLocalChanges ? 'Resume' : 'Edit'}</button><button type="button" data-library-duplicate>Duplicate</button>${status === 'published' ? '<button type="button" data-library-unpublish>Unpublish</button>' : ''}<button type="button" data-library-delete>Delete</button>${live ? `<a href="${escapeHtml(live)}" target="_blank" rel="noopener noreferrer">View live</a>` : ''}</div></div>
        </div>
      </article>`;
    }).join('');

    libraryList.innerHTML = localDraftCard + remoteCards;
  }

  async function loadArticle(path, { force = false } = {}) {
    if (!force && dirty) {
      if (!window.confirm('Open another article and leave the current unsaved changes?')) return;
      persistLocalAutosave();
      dirty = false;
    }
    clearLocalFeaturedPreview();
    setSaveState('Loading…');
    try {
      const data = await githubFetch(`/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}?ref=main`);
      const state = stateFromFile(decodeBase64(data.content), path, data.sha);
      applyState(state, { remote: true });
      const restored = maybeRestoreLocal(`matlock-writer:${path}`, state);
      if (!restored) dirty = false;
      showEditor({ route: 'article', path });
      if ((state.body || '').trim() || state.title) setArticleDetailsOpen(false);
      if (!restored) {
        setSaveState(currentPublished ? 'Published article' : fields.publishAt.value ? 'Scheduled article' : 'Draft article');
      }
      showToast(restored ? 'Article loaded with local changes.' : 'Article loaded.');
    } catch (error) {
      setSaveState('Load failed');
      showToast(`Could not load article: ${error.message}`, 5000);
    }
  }

  async function duplicateArticle(path) {
    if (dirty) {
      if (!window.confirm('Duplicate another article and leave the current unsaved changes?')) return;
      persistLocalAutosave();
      dirty = false;
    }
    if (readLocalNewDraft()) {
      showToast('A browser-only draft already exists. Resume or discard it before duplicating another article.', 6000);
      return;
    }
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
      showEditor({ route: 'new' });
      dirty = true;
      persistLocalAutosave();
      setSaveState('Duplicated • local draft');
      setLocalStatus('Saved locally', 'saved');
      showToast('Article duplicated into a local draft.');
    } catch (error) {
      showToast(`Could not duplicate article: ${error.message}`, 5000);
    }
  }

