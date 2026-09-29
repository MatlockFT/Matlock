(() => {
  const app = document.querySelector('[data-writer-app]');
  if (!app) return;

  const authBase = String(app.dataset.authBase || '').replace(/\/$/, '');
  const editor = app.querySelector('#writer-body');
  const titleInput = app.querySelector('[data-field="title"]');
  const preview = app.querySelector('[data-preview-content]');
  const toggleButton = app.querySelector('[data-live-writer-toggle]');
  const panel = app.querySelector('[data-live-writer-panel]');
  const closeButton = app.querySelector('[data-live-writer-close]');
  const startButton = app.querySelector('[data-live-writer-start]');
  const endButton = app.querySelector('[data-live-writer-end]');
  const pushButton = app.querySelector('[data-live-writer-push]');
  const status = app.querySelector('[data-live-writer-status]');
  const syncState = app.querySelector('[data-live-writer-sync-state]');
  const publicLink = app.querySelector('[data-live-writer-public-link]');

  if (!authBase || !editor || !titleInput || !preview || !toggleButton || !panel || !startButton || !endButton) return;

  const SESSION_ID_KEY = 'matlock-writer:server-session';
  const PUBLIC_PATH = '/live-notes/';
  const LIVE_REPO_PATH = 'assets/uploads/runtime/live-writer.json';
  const LIVE_API_PATH = '/contents/' + LIVE_REPO_PATH;
  const MIN_AUTO_PUSH_MS = 12000;
  let active = false;
  let syncTimer = 0;
  let syncing = false;
  let queuedWhileSyncing = false;
  let lastSent = '';
  let lastPushAt = 0;
  let liveFileSha = '';
  let previewObserver = null;

  function sessionId() {
    try { return localStorage.getItem(SESSION_ID_KEY) || ''; } catch { return ''; }
  }

  function publicUrl() {
    return new URL(PUBLIC_PATH, location.origin).href;
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
    startButton.hidden = active;
    endButton.hidden = !active;
    if (pushButton) pushButton.disabled = !active;
    if (publicLink) {
      publicLink.href = publicUrl();
      publicLink.textContent = PUBLIC_PATH;
    }
    if (active) setPanelStatus('Live on your public site', 'live');
    else setPanelStatus('Not live', 'idle');
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

  async function writeLiveRecord(record, { retry = true } = {}) {
    const content = encodeBase64Utf8(JSON.stringify(record));
    const body = {
      message: record.active ? 'Update live writer [skip ci]' : 'End live writer [skip ci]',
      content,
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
        return writeLiveRecord(record, { retry: false });
      }
      throw error;
    }
  }

  function safePreviewHtml() {
    const clone = preview.cloneNode(true);
    clone.querySelectorAll('script, object, embed').forEach(node => node.remove());
    clone.querySelectorAll('*').forEach(node => {
      for (const attr of [...node.attributes]) {
        if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
        if ((attr.name === 'href' || attr.name === 'src') && /^\s*javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
      }
    });
    const empty = clone.querySelector('.writer-preview-empty');
    if (empty && !editor.value.trim()) empty.remove();
    return clone.innerHTML.trim();
  }

  function snapshot({ isActive = active, previous = null } = {}) {
    const now = new Date().toISOString();
    return {
      active: Boolean(isActive),
      title: titleInput.value.trim() || previous?.title || 'Live notes',
      html: safePreviewHtml() || previous?.html || '',
      text: editor.value || previous?.text || '',
      author: 'Matlock',
      startedAt: previous?.startedAt || now,
      updatedAt: now,
      endedAt: isActive ? null : now,
      version: Number(previous?.version || 0) + 1
    };
  }

  function signature(data) {
    return data.title + '\n' + data.html + '\n' + data.text;
  }

  async function pushNow({ force = false } = {}) {
    if (!active) return;
    if (syncing) {
      queuedWhileSyncing = true;
      return;
    }

    const previous = await readLiveRecord().catch(() => null);
    const data = snapshot({ isActive: true, previous });
    const nextSignature = signature(data);
    if (!force && nextSignature === lastSent) return;

    syncing = true;
    setSyncState('Updating…', 'working');
    try {
      await writeLiveRecord(data);
      lastSent = nextSignature;
      lastPushAt = Date.now();
      setSyncState('Public page updated just now', 'success');
    } catch (error) {
      setSyncState(error.message, 'error');
    } finally {
      syncing = false;
      if (queuedWhileSyncing) {
        queuedWhileSyncing = false;
        queueSync(250);
      }
    }
  }

  function queueSync(delay = 1200) {
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
    previewObserver = new MutationObserver(() => queueSync(700));
    previewObserver.observe(preview, { childList: true, subtree: true, characterData: true, attributes: true });
  }

  function detachLiveListeners() {
    window.clearTimeout(syncTimer);
    syncTimer = 0;
    editor.removeEventListener('input', onEditorInput);
    titleInput.removeEventListener('input', onTitleInput);
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

    setSyncState('Checking live status…', 'working');
    try {
      const live = await readLiveRecord();
      active = Boolean(live?.active);
      updateControls();
      if (active) {
        lastSent = signature(live);
        attachLiveListeners();
        setSyncState('Live session restored. Changes will sync automatically.', 'success');
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
    if (!sessionId()) {
      setSyncState('Sign in with GitHub first.', 'error');
      return;
    }

    startButton.disabled = true;
    setSyncState('Starting live session…', 'working');
    try {
      const previous = await readLiveRecord();
      active = true;
      const data = snapshot({ isActive: true, previous });
      await writeLiveRecord(data);
      lastSent = signature(data);
      lastPushAt = Date.now();
      attachLiveListeners();
      updateControls();
      setSyncState('Live. New edits sync automatically.', 'success');
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
    setSyncState('Ending live session…', 'working');
    try {
      const previous = await readLiveRecord();
      const data = snapshot({ isActive: false, previous });
      await writeLiveRecord(data);
      active = false;
      detachLiveListeners();
      updateControls();
      setSyncState('Live session ended. The last version remains visible as ended.', 'success');
    } catch (error) {
      setSyncState(error.message, 'error');
    } finally {
      endButton.disabled = false;
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

  if (publicLink) publicLink.href = publicUrl();
  updateControls();
})();