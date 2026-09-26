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
  let active = false;
  let syncTimer = 0;
  let syncing = false;
  let queuedWhileSyncing = false;
  let lastSent = '';
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

  async function request(method, body) {
    const id = sessionId();
    if (!id) throw new Error('Sign in with GitHub first. Live Writer uses your secure Writer session.');

    const response = await fetch(authBase + '/api/writer/live', {
      method,
      mode: 'cors',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'X-Writer-Session': id,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    const data = await response.json().catch(() => ({}));
    if (response.status === 401) window.dispatchEvent(new CustomEvent('matlock-writer:auth-expired'));
    if (!response.ok) throw new Error(data.error || 'Live Writer request failed.');
    return data.live || null;
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

  function snapshot() {
    return {
      title: titleInput.value.trim() || 'Live notes',
      html: safePreviewHtml(),
      text: editor.value
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

    const data = snapshot();
    const nextSignature = signature(data);
    if (!force && nextSignature === lastSent) return;

    syncing = true;
    setSyncState('Updating…', 'working');
    try {
      await request('PUT', data);
      lastSent = nextSignature;
      setSyncState('Public page updated just now', 'success');
    } catch (error) {
      setSyncState(error.message, 'error');
    } finally {
      syncing = false;
      if (queuedWhileSyncing) {
        queuedWhileSyncing = false;
        queueSync(80);
      }
    }
  }

  function queueSync(delay = 450) {
    if (!active) return;
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => pushNow(), delay);
  }

  const onEditorInput = () => queueSync();
  const onTitleInput = () => queueSync();

  function attachLiveListeners() {
    if (previewObserver) return;
    editor.addEventListener('input', onEditorInput);
    titleInput.addEventListener('input', onTitleInput);
    previewObserver = new MutationObserver(() => queueSync(260));
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
      const live = await request('GET');
      active = Boolean(live?.active);
      updateControls();
      if (active) {
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
      active = true;
      const data = snapshot();
      await request('PUT', data);
      lastSent = signature(data);
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
      await request('DELETE');
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
