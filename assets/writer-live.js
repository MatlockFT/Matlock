(() => {
  const app = document.querySelector('[data-writer-app]');
  if (!app) return;

  const authBase = String(app.dataset.authBase || '').replace(/\/$/, '');
  const editor = app.querySelector('#writer-body');
  const titleInput = app.querySelector('[data-field="title"]');
  const descriptionInput = app.querySelector('[data-field="description"]');
  const filenameInput = app.querySelector('[data-field="filename"]');
  const preview = app.querySelector('[data-preview-content]');
  const publishedLink = app.querySelector('[data-live-link]');
  const toggleButton = app.querySelector('[data-live-writer-toggle]');
  const panel = app.querySelector('[data-live-writer-panel]');
  const closeButton = app.querySelector('[data-live-writer-close]');
  const startButton = app.querySelector('[data-live-writer-start]');
  const endButton = app.querySelector('[data-live-writer-end]');
  const pushButton = app.querySelector('[data-live-writer-push]');
  const status = app.querySelector('[data-live-writer-status]');
  const syncState = app.querySelector('[data-live-writer-sync-state]');
  const publicLink = app.querySelector('[data-live-writer-public-link]');

  if (!authBase || !editor || !titleInput || !filenameInput || !preview || !toggleButton || !panel || !startButton || !endButton) return;

  const SESSION_ID_KEY = 'matlock-writer:server-session';
  const LIVE_REPO_PATH = 'assets/uploads/runtime/live-writer.json';
  const LIVE_API_PATH = '/contents/' + LIVE_REPO_PATH;
  const MIN_AUTO_PUSH_MS = 5000;
  let liveFileSha = '';
  let active = false;
  let syncTimer = 0;
  let syncing = false;
  let queuedWhileSyncing = false;
  let lastSent = '';
  let lastPushAt = 0;
  let previewObserver = null;

  function sessionId() {
    try { return localStorage.getItem(SESSION_ID_KEY) || ''; } catch { return ''; }
  }

  function targetFromFilename() {
    const filename = filenameInput.value.trim();
    const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/i);
    if (!match) return null;
    return {
      sourcePath: '_posts/' + filename,
      publicPath: '/' + match[1] + '/' + match[2] + '/' + match[3] + '/' + match[4] + '.html'
    };
  }

  function currentTarget() {
    const target = targetFromFilename();
    if (!target) return null;
    let published = false;
    if (publishedLink && !publishedLink.hidden) {
      try {
        const url = new URL(publishedLink.href, location.origin);
        if (url.pathname === target.publicPath) published = true;
      } catch {}
    }
    return { ...target, published };
  }

  function publicUrl(target = currentTarget()) {
    return target ? new URL(target.publicPath, location.origin).href : '';
  }

  function sameTarget(live, target = currentTarget()) {
    if (!live || !target) return false;
    return live.sourcePath === target.sourcePath || live.publicPath === target.publicPath;
  }

  function setPanelStatus(message, state = 'idle') {
    if (status) {
      status.textContent = message;
      status.dataset.state = state;
    }
    toggleButton.dataset.state = active ? 'live' : state;
    toggleButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    toggleButton.textContent = active ? 'LIVE ●' : 'Live';
  }

  function setSyncState(message, state = 'idle') {
    if (!syncState) return;
    syncState.textContent = message;
    syncState.dataset.state = state;
  }

  function updateControls() {
    const target = currentTarget();
    startButton.hidden = active;
    endButton.hidden = !active;
    if (pushButton) pushButton.disabled = !active;

    if (publicLink) {
      const url = publicUrl(target);
      publicLink.href = url || '#';
      publicLink.textContent = target?.publicPath || 'Open a published article first';
      publicLink.toggleAttribute('aria-disabled', !url);
    }

    if (active) setPanelStatus('Live on this article', 'live');
    else setPanelStatus('Not live', 'idle');
  }

  async function githubRequest(method, apiPath, body) {
    const id = sessionId();
    if (!id) throw new Error('Sign in with GitHub first. Live Writer uses your secure Writer session.');

    const response = await fetch(authBase + '/api/writer/github?path=' + encodeURIComponent(apiPath), {
      method,
      mode: 'cors',
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-Writer-Session': id,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    const data = await response.json().catch(() => ({}));
    if (response.status === 401) window.dispatchEvent(new CustomEvent('matlock-writer:auth-expired'));
    if (!response.ok) {
      const error = new Error(data.message || 'Live Writer request failed.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function encodeBase64Utf8(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function readLiveRecord() {
    try {
      const data = await githubRequest('GET', LIVE_API_PATH + '?ref=main');
      liveFileSha = data.sha || '';
      const encoded = String(data.content || '').replace(/\s+/g, '');
      if (!encoded) return null;
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      if (error.status === 404) {
        liveFileSha = '';
        return null;
      }
      throw error;
    }
  }

  async function writeLiveRecord(record, { retry = true, message = '' } = {}) {
    const body = {
      message: message || (record.active ? 'Update live article [skip ci]' : record.hold ? 'End live article [skip ci]' : 'Clear live article [skip ci]'),
      content: encodeBase64Utf8(JSON.stringify(record)),
      branch: 'main',
      ...(liveFileSha ? { sha: liveFileSha } : {})
    };

    try {
      const data = await githubRequest('PUT', LIVE_API_PATH, body);
      liveFileSha = data?.content?.sha || liveFileSha;
      return record;
    } catch (error) {
      if (retry && (error.status === 409 || error.status === 422)) {
        await readLiveRecord();
        return writeLiveRecord(record, { retry: false, message });
      }
      throw error;
    }
  }

  function unwrap(node) {
    const parent = node.parentNode;
    if (!parent) return;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    node.remove();
  }

  function safePreviewHtml() {
    const clone = preview.cloneNode(true);

    clone.querySelectorAll('script, object, embed, .writer-preview-block-tools, .writer-tale-crop-controls, .writer-media-toolbar, .writer-media-resize-handle, .article-inline-video-controls, .article-inline-video-fallback, canvas.matlock-portrait-canvas').forEach(node => node.remove());

    clone.querySelectorAll('.writer-preview-html-shell, .writer-preview-table-shell').forEach(unwrap);

    clone.querySelectorAll('.writer-embed').forEach(node => {
      node.classList.remove('writer-embed');
      node.classList.add('article-embed', 'article-video-embed');
      node.removeAttribute('data-writer-embed-src');
    });

    clone.querySelectorAll('.writer-x-embed').forEach(node => {
      node.classList.remove('writer-x-embed');
      node.classList.add('article-embed', 'article-x-embed');
      node.removeAttribute('data-writer-x-url');
    });

    clone.querySelectorAll('img[data-writer-source]').forEach(img => {
      const source = img.getAttribute('data-writer-source');
      if (source) img.setAttribute('src', source);
      img.removeAttribute('data-writer-source');
      img.removeAttribute('data-writer-retry-attempt');
    });

    clone.querySelectorAll('video').forEach(video => {
      video.controls = false;
      video.removeAttribute('controls');
      video.removeAttribute('tabindex');
    });

    clone.querySelectorAll('*').forEach(node => {
      node.removeAttribute('contenteditable');
      node.removeAttribute('spellcheck');
      node.removeAttribute('data-writer-video-ui');
      node.removeAttribute('data-writer-media-tools');
      node.removeAttribute('data-writer-table-index');
      node.removeAttribute('data-editable-portrait');
      node.removeAttribute('data-tale-portrait-editing');
      for (const attr of [...node.attributes]) {
        if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
        if ((attr.name === 'href' || attr.name === 'src') && /^\s*javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
      }
    });

    const empty = clone.querySelector('.writer-preview-empty');
    if (empty && !editor.value.trim()) empty.remove();
    return clone.innerHTML.trim();
  }

  function snapshot({ isActive = active, hold = false, previous = null, publishedAt = null } = {}) {
    const target = currentTarget();
    if (!target) throw new Error('This article needs a valid YYYY-MM-DD-slug.md filename first.');
    return {
      active: Boolean(isActive),
      hold: Boolean(hold),
      sourcePath: target.sourcePath,
      publicPath: target.publicPath,
      title: titleInput.value.trim() || previous?.title || 'Live article',
      description: descriptionInput?.value.trim() || previous?.description || '',
      html: safePreviewHtml() || previous?.html || '',
      text: editor.value || previous?.text || '',
      publishedAt
    };
  }

  function signature(data) {
    return [data.sourcePath, data.publicPath, data.title, data.description, data.html, data.text].join('\n');
  }

  async function pushNow({ force = false } = {}) {
    if (!active) return;
    if (syncing) {
      queuedWhileSyncing = true;
      return;
    }

    const data = snapshot({ isActive: true, hold: false });
    const nextSignature = signature(data);
    if (!force && nextSignature === lastSent) return;

    syncing = true;
    setSyncState('Updating article…', 'working');
    try {
      const live = await writeLiveRecord(data);
      lastSent = signature(live || data);
      lastPushAt = Date.now();
      setSyncState('Readers have the latest version.', 'success');
    } catch (error) {
      setSyncState(error.message, 'error');
    } finally {
      syncing = false;
      if (queuedWhileSyncing) {
        queuedWhileSyncing = false;
        queueSync(200);
      }
    }
  }

  function queueSync(delay = 650) {
    if (!active) return;
    window.clearTimeout(syncTimer);
    const waitForRateLimit = Math.max(0, MIN_AUTO_PUSH_MS - (Date.now() - lastPushAt));
    syncTimer = window.setTimeout(() => pushNow(), Math.max(delay, waitForRateLimit));
  }

  const onEditorInput = () => queueSync();
  const onTitleInput = () => queueSync();

  function attachLiveListeners() {
    if (previewObserver) return;
    editor.addEventListener('input', onEditorInput);
    titleInput.addEventListener('input', onTitleInput);
    descriptionInput?.addEventListener('input', onTitleInput);
    previewObserver = new MutationObserver(() => queueSync(450));
    previewObserver.observe(preview, { childList: true, subtree: true, characterData: true, attributes: true });
  }

  function detachLiveListeners() {
    window.clearTimeout(syncTimer);
    syncTimer = 0;
    editor.removeEventListener('input', onEditorInput);
    titleInput.removeEventListener('input', onTitleInput);
    descriptionInput?.removeEventListener('input', onTitleInput);
    previewObserver?.disconnect();
    previewObserver = null;
  }

  async function loadState() {
    const id = sessionId();
    if (!id) {
      active = false;
      updateControls();
      setSyncState('Connect GitHub to use Live Writer.', 'idle');
      return;
    }

    const target = currentTarget();
    if (!target) {
      active = false;
      updateControls();
      setSyncState('Open an article with a valid filename first.', 'idle');
      return;
    }

    setSyncState('Checking this article…', 'working');
    try {
      const live = await readLiveRecord();
      active = Boolean(live?.active && sameTarget(live, target));
      updateControls();
      if (active) {
        lastSent = signature(live);
        attachLiveListeners();
        setSyncState('Live session restored. Changes sync automatically.', 'success');
      } else if (live?.active && !sameTarget(live, target)) {
        setSyncState('A different article is currently live: ' + (live.publicPath || live.title || 'another article') + '.', 'idle');
      } else if (live?.hold && sameTarget(live, target)) {
        setSyncState('Live coverage ended. The last live version is still on this article until you publish.', 'success');
      } else {
        setSyncState('Ready.', 'idle');
      }
    } catch (error) {
      active = false;
      updateControls();
      setSyncState(error.message, 'error');
    }
  }

  async function startLive() {
    const target = currentTarget();
    if (!sessionId()) {
      setSyncState('Sign in with GitHub first.', 'error');
      return;
    }
    if (!target?.published) {
      setSyncState('Publish this article once before going live so readers have a public page to open.', 'error');
      return;
    }

    startButton.disabled = true;
    setSyncState('Starting live updates on ' + target.publicPath + '…', 'working');
    try {
      active = true;
      const live = await writeLiveRecord(snapshot({ isActive: true, hold: false }), { message: 'Start live article [skip ci]' });
      lastSent = signature(live);
      lastPushAt = Date.now();
      attachLiveListeners();
      updateControls();
      setSyncState('Live. Readers on this article will receive updates automatically.', 'success');
    } catch (error) {
      active = false;
      updateControls();
      setSyncState(error.message, 'error');
    } finally {
      startButton.disabled = false;
    }
  }

  async function endLive() {
    endButton.disabled = true;
    setSyncState('Ending live updates…', 'working');
    try {
      await writeLiveRecord(snapshot({ isActive: false, hold: true }), { message: 'End live article [skip ci]' });
      active = false;
      detachLiveListeners();
      updateControls();
      setSyncState('Live updates ended. The last live version stays on the article until you publish the final version.', 'success');
    } catch (error) {
      setSyncState(error.message, 'error');
    } finally {
      endButton.disabled = false;
    }
  }

  async function clearAfterPublish() {
    const target = currentTarget();
    if (!target) return;
    try {
      const previous = await readLiveRecord();
      if (!sameTarget(previous, target)) return;
      await writeLiveRecord(snapshot({
        isActive: false,
        hold: false,
        previous,
        publishedAt: new Date().toISOString()
      }), { message: 'Clear live article after publish [skip ci]' });
      active = false;
      detachLiveListeners();
      updateControls();
      setSyncState('Final article published. Live override cleared.', 'success');
    } catch (error) {
      setSyncState('Published, but the live override could not be cleared: ' + error.message, 'error');
    }
  }

  toggleButton.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggleButton.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
    if (!panel.hidden) loadState();
  });
  closeButton?.addEventListener('click', () => {
    panel.hidden = true;
    toggleButton.setAttribute('aria-expanded', 'false');
  });
  startButton.addEventListener('click', startLive);
  endButton.addEventListener('click', endLive);
  pushButton?.addEventListener('click', () => pushNow({ force: true }));

  window.addEventListener('storage', event => {
    if (event.key === SESSION_ID_KEY && !panel.hidden) loadState();
  });
  window.addEventListener('matlock-writer:published', clearAfterPublish);

  filenameInput.addEventListener('input', updateControls);
  if (publicLink) publicLink.addEventListener('click', event => {
    if (!publicUrl()) event.preventDefault();
  });

  updateControls();
})();
