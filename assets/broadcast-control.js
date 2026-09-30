(() => {
  const app = document.querySelector('[data-mfc-control]');
  if (!app) return;

  const authBase = String(app.dataset.authBase || '').replace(/\/$/, '');
  const SESSION_ID_KEY = 'matlock-writer:server-session';
  const SESSION_LOGIN_KEY = 'matlock-writer:server-login';
  const STATE_API_PATH = '/contents/assets/uploads/broadcast.json';
  const WORKSPACE_KEY = 'matlock-broadcast-control:workspace';
  const CHUNK_BYTES = Math.floor(3.5 * 1024 * 1024);
  const STATUS_POLL_MS = 1400;
  const STATUS_TIMEOUT_MS = 20 * 60 * 1000;

  const authPanel = app.querySelector('[data-auth-panel]');
  const workspace = app.querySelector('[data-control-workspace]');
  const signInButton = app.querySelector('[data-sign-in]');
  const saveDraftButton = app.querySelector('[data-save-draft]');
  const takeLiveButton = app.querySelector('[data-take-live]');
  const reloadStateButton = app.querySelector('[data-reload-state]');
  const liveStatus = app.querySelector('[data-live-status]');
  const authStatus = app.querySelector('[data-auth-status]');
  const draftStatus = app.querySelector('[data-draft-status]');
  const loopTotal = app.querySelector('[data-loop-total]');
  const previewNow = app.querySelector('[data-preview-now]');
  const previewDuration = app.querySelector('[data-preview-duration]');
  const previewFrame = app.querySelector('[data-preview-frame]');
  const programFrame = app.querySelector('[data-program-frame]');
  const previewAudioButton = app.querySelector('[data-preview-audio]');
  const programAudioButton = app.querySelector('[data-program-audio]');
  const programAudioStatus = app.querySelector('[data-program-audio-status]');
  const workspaceTabs = Array.from(app.querySelectorAll('[data-workspace-tab]'));
  const workspacePanels = Array.from(app.querySelectorAll('[data-workspace-panel]'));
  const tickerPreview = app.querySelector('[data-ticker-preview]');
  const programTrack = app.querySelector('[data-program-track]');
  const programRuler = app.querySelector('[data-program-ruler]');
  const programFields = app.querySelector('[data-program-fields]');
  const programEditorTitle = app.querySelector('[data-program-editor-title]');
  const deleteProgramButton = app.querySelector('[data-delete-program]');
  const videoLibraryPanel = app.querySelector('[data-video-library-panel]');
  const videoLibraryList = app.querySelector('[data-video-library-list]');
  const videoLibrarySummary = app.querySelector('[data-video-library-summary]');
  const videoLibrarySearch = app.querySelector('[data-video-library-search]');
  const videoLibraryFilter = app.querySelector('[data-video-library-filter]');
  const videoLibrarySort = app.querySelector('[data-video-library-sort]');
  const videoLibraryRefreshButton = app.querySelector('[data-video-library-refresh]');
  const videoLibraryUploadInput = app.querySelector('[data-video-library-upload]');
  const videoPreviewDialog = app.querySelector('[data-video-preview-dialog]');
  const videoPreviewTitle = app.querySelector('[data-video-preview-title]');
  const videoPreviewPlayer = app.querySelector('[data-video-preview-player]');
  const videoPreviewMeta = app.querySelector('[data-video-preview-meta]');
  const musicTrack = app.querySelector('[data-music-track]');
  const musicFields = app.querySelector('[data-music-fields]');
  const musicEditorTitle = app.querySelector('[data-music-editor-title]');
  const deleteMusicButton = app.querySelector('[data-delete-music]');
  const tickerInput = app.querySelector('[data-ticker-input]');
  const musicUploadInput = app.querySelector('[data-music-upload]');
  const addMusicUrlButton = app.querySelector('[data-add-music-url]');
  const urlDialog = app.querySelector('[data-url-dialog]');
  const musicUrlInput = app.querySelector('[data-music-url]');
  const musicUrlTitleInput = app.querySelector('[data-music-url-title]');
  const confirmMusicUrlButton = app.querySelector('[data-confirm-music-url]');
  const uploadProgress = app.querySelector('[data-upload-progress]');
  const uploadLabel = app.querySelector('[data-upload-label]');
  const uploadPercent = app.querySelector('[data-upload-percent]');
  const uploadMeter = app.querySelector('[data-upload-meter]');
  const toast = app.querySelector('[data-toast]');

  let sessionId = '';
  let stateSha = '';
  let fullState = null;
  let working = null;
  let selectedProgramId = '';
  let selectedMusicId = '';
  let draggingProgramId = '';
  let draggingMusicId = '';
  let popup = null;
  let popupWatch = 0;
  let toastTimer = 0;
  let dirty = false;
  let busyAction = '';
  let videoLibraryAssets = [];
  let videoLibraryReadOnly = false;
  let videoLibraryLoading = false;
  let previewMonitorAudio = false;
  let programMonitorAudio = false;
  const videoDurationCache = new Map();

  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const positive = value => Math.max(0, Number(value) || 0);
  const uid = prefix => `${prefix}-${window.crypto?.randomUUID ? window.crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)}`;
  const fmt = seconds => {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  const formatBytes = bytes => {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${Math.round(value)} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = value / 1024;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    const digits = size >= 100 ? 0 : size >= 10 ? 1 : 2;
    return `${size.toFixed(digits)} ${units[unit]}`;
  };

  function youtubeVideoId(value) {
    try {
      const url = new URL(String(value || '').trim());
      const host = url.hostname.replace(/^www\./, '').toLowerCase();
      if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
      if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
        if (url.pathname === '/watch') return url.searchParams.get('v') || '';
        const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{6,})/);
        return match?.[1] || '';
      }
    } catch {}
    return '';
  }

  function localRead(key) {
    try { return localStorage.getItem(key) || ''; } catch { return ''; }
  }

  function localWrite(key, value) {
    try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch {}
  }

  function showToast(message, ms = 4200) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, ms);
  }

  function updateWorkspaceCounts() {
    const counts = {
      rundown: working?.program?.length || 0,
      media: videoLibraryAssets.length,
      audio: working?.music?.length || 0,
      graphics: working?.ticker?.length || 0
    };
    app.querySelectorAll('[data-workspace-count]').forEach(node => {
      node.textContent = String(counts[node.dataset.workspaceCount] || 0);
    });
  }

  function activateWorkspace(name, { focus = false } = {}) {
    const target = workspacePanels.some(panel => panel.dataset.workspacePanel === name) ? name : 'rundown';
    workspaceTabs.forEach(tab => {
      const active = tab.dataset.workspaceTab === target;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    workspacePanels.forEach(panel => {
      const active = panel.dataset.workspacePanel === target;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    localWrite(WORKSPACE_KEY, target);
    if (target === 'rundown') window.setTimeout(postPreview, 50);
  }

  function bindWorkspaceTabs() {
    workspaceTabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activateWorkspace(tab.dataset.workspaceTab));
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === 'ArrowLeft') next = (index - 1 + workspaceTabs.length) % workspaceTabs.length;
        if (event.key === 'ArrowRight') next = (index + 1) % workspaceTabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = workspaceTabs.length - 1;
        activateWorkspace(workspaceTabs[next].dataset.workspaceTab, { focus: true });
      });
    });
  }

  function renderTickerPreview() {
    if (!tickerPreview) return;
    const entries = Array.isArray(working?.ticker) ? working.ticker.filter(Boolean) : [];
    tickerPreview.textContent = entries.length ? entries.join('   •   ') : 'NO TICKER ITEMS';
  }

  function refreshProgramMonitor() {
    if (!programFrame?.src) return;
    try {
      const url = new URL(programFrame.src, location.href);
      url.searchParams.set('refresh', String(Date.now()));
      programFrame.src = url.href;
    } catch {}
  }

  function postMonitorSound(frame, enabled) {
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage({
      type: 'matlock-broadcast-monitor-sound',
      enabled: Boolean(enabled)
    }, location.origin);
  }

  function renderMonitorAudioButtons() {
    if (previewAudioButton) {
      previewAudioButton.setAttribute('aria-pressed', previewMonitorAudio ? 'true' : 'false');
      previewAudioButton.textContent = previewMonitorAudio ? 'Listening' : 'Listen';
    }
    if (programAudioButton) {
      programAudioButton.setAttribute('aria-pressed', programMonitorAudio ? 'true' : 'false');
      programAudioButton.textContent = programMonitorAudio ? 'Listening' : 'Listen';
    }
    if (programAudioStatus) {
      programAudioStatus.textContent = programMonitorAudio ? 'Program audio enabled' : 'Audio muted locally';
    }
  }

  function setMonitorAudio(target, enabled) {
    const next = Boolean(enabled);
    if (target === 'preview') {
      previewMonitorAudio = next;
      if (next) programMonitorAudio = false;
    } else {
      programMonitorAudio = next;
      if (next) previewMonitorAudio = false;
    }
    postMonitorSound(previewFrame, previewMonitorAudio);
    postMonitorSound(programFrame, programMonitorAudio);
    renderMonitorAudioButtons();
  }

  function syncActionButtons() {
    const busy = Boolean(busyAction);
    saveDraftButton.disabled = !sessionId || !working || !dirty || busy;
    takeLiveButton.disabled = !sessionId || !working || busy;
    if (reloadStateButton) reloadStateButton.disabled = !sessionId || busy;
  }

  function setDirty(value = true) {
    dirty = Boolean(value);
    if (draftStatus) {
      draftStatus.textContent = dirty ? 'Unsaved' : 'Saved';
      draftStatus.dataset.dirty = dirty ? 'true' : 'false';
    }
    syncActionButtons();
  }

  function setBusy(action = '') {
    busyAction = action;
    syncActionButtons();
  }

  function expireSession() {
    sessionId = '';
    localWrite(SESSION_ID_KEY, '');
    authPanel.hidden = false;
    workspace.hidden = true;
    liveStatus.textContent = 'Sign in required';
    if (authStatus) authStatus.textContent = 'Session expired';
    syncActionButtons();
  }

  function resetSignInUi() {
    window.clearInterval(popupWatch);
    popupWatch = 0;
    signInButton.disabled = false;
    signInButton.textContent = 'Sign in with GitHub';
  }

  function setUploadProgress(percent, label) {
    const value = clamp(percent, 0, 100);
    uploadProgress.hidden = false;
    uploadMeter.value = value;
    uploadPercent.textContent = `${Math.round(value)}%`;
    uploadLabel.textContent = label;
  }

  function clearUploadProgress() {
    uploadProgress.hidden = true;
    uploadMeter.value = 0;
    uploadPercent.textContent = '0%';
  }

  function authOrigin() {
    try { return new URL(authBase).origin; } catch { return ''; }
  }

  async function verifySession(id) {
    if (!id || !authBase) return null;
    try {
      const response = await fetch(`${authBase}/api/writer/session`, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'X-Writer-Session': id }
      });
      const data = await response.json().catch(() => ({}));
      return response.ok && data.ok ? data : null;
    } catch {
      return null;
    }
  }

  function beginSignIn() {
    if (!authBase) {
      showToast('Writer auth bridge is unavailable.');
      return;
    }
    if (popup && !popup.closed) {
      popup.focus();
      showToast('GitHub sign-in is already open.');
      return;
    }
    const url = `${authBase}/auth/github/start?origin=${encodeURIComponent(location.origin)}`;
    signInButton.disabled = true;
    signInButton.textContent = 'Waiting for GitHub…';
    popup = window.open(url, 'matlock-broadcast-github-auth', 'popup=yes,width=720,height=820,resizable=yes,scrollbars=yes');
    if (!popup) {
      resetSignInUi();
      showToast('Allow popups for this page and try again.');
      return;
    }
    popupWatch = window.setInterval(() => {
      if (!popup || popup.closed) {
        popup = null;
        resetSignInUi();
      }
    }, 500);
  }

  window.addEventListener('message', async event => {
    if (event.origin !== authOrigin()) return;
    const message = event.data;
    if (!message || message.type !== 'matlock-writer-github-auth') return;
    if (popup && !popup.closed) popup.close();
    popup = null;
    resetSignInUi();

    if (!message.ok || !message.sessionId) {
      showToast(message.error || 'GitHub sign-in did not complete.', 7000);
      return;
    }

    localWrite(SESSION_ID_KEY, message.sessionId);
    localWrite(SESSION_LOGIN_KEY, message.login || 'GitHub user');
    sessionId = message.sessionId;
    await startWorkspace({ preserveWorking: Boolean(working && dirty) });
  });

  signInButton.addEventListener('click', beginSignIn);

  async function githubRequest(apiPath, options = {}) {
    if (!sessionId) throw new Error('Sign in with GitHub first.');
    const response = await fetch(`${authBase}/api/writer/github?path=${encodeURIComponent(apiPath)}`, {
      ...options,
      mode: 'cors',
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-Writer-Session': sessionId,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) expireSession();
      const error = new Error(data.message || data.error || `${response.status} ${response.statusText}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function decodeBase64Utf8(value) {
    const binary = atob(String(value || '').replace(/\s+/g, ''));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
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

  function normalizedChannel(value) {
    const channel = value && typeof value === 'object' ? clone(value) : {};
    channel.program = Array.isArray(channel.program) ? channel.program : [];
    channel.music = Array.isArray(channel.music) ? channel.music : [];
    channel.ticker = Array.isArray(channel.ticker) ? channel.ticker : [];
    channel.audio = {
      master: 1,
      music: .72,
      video: 1,
      videoMusic: 'duck',
      duckLevel: .18,
      duckAttack: .4,
      duckRelease: 1.5,
      crossfade: 2.5,
      ...(channel.audio || {})
    };
    return channel;
  }

  async function loadState() {
    const remote = await githubRequest(`${STATE_API_PATH}?ref=main`);
    stateSha = remote.sha || '';
    const parsed = JSON.parse(decodeBase64Utf8(remote.content || 'e30='));
    fullState = parsed && typeof parsed === 'object' ? parsed : { version: 1 };
    working = normalizedChannel(fullState.draft || fullState.live);
    if (!working.startedAt) working.startedAt = new Date().toISOString();
    selectedProgramId = working.program[0]?.id || '';
    selectedMusicId = working.music[0]?.id || '';
    renderAll();
    void loadVideoLibrary({ quiet: true });
  }

  function totalProgramDuration() {
    return (working?.program || []).reduce((sum, item) => sum + positive(item.duration), 0);
  }

  function totalMusicDuration() {
    return (working?.music || []).reduce((sum, item) => sum + positive(item.duration), 0);
  }

  function markDirty() {
    if (!working) return;
    working.updatedAt = new Date().toISOString();
    setDirty(true);
    renderSummary();
    postPreview();
  }

  function postPreview() {
    if (!previewFrame?.contentWindow || !working) return;
    const channel = clone(working);
    channel.startedAt = new Date().toISOString();
    previewFrame.contentWindow.postMessage({
      type: 'matlock-broadcast-preview',
      channel
    }, location.origin);
  }

  function renderSummary() {
    const total = totalProgramDuration();
    loopTotal.textContent = `Loop ${fmt(total)}`;
    previewDuration.textContent = fmt(total);
    previewNow.textContent = `${working?.program?.length || 0} item${working?.program?.length === 1 ? '' : 's'} · ${working?.music?.length || 0} audio cue${working?.music?.length === 1 ? '' : 's'}`;

    const liveStamp = fullState?.live?.updatedAt || fullState?.live?.startedAt || '';
    liveStatus.textContent = liveStamp
      ? new Date(liveStamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : 'Standby';
    updateWorkspaceCounts();
  }

  function displayVideoName(name) {
    return String(name || 'Uploaded video')
      .replace(/^broadcast-video-/i, '')
      .replace(/-\d{17}(?=\.(?:mp4|m4v|webm)$)/i, '')
      .replace(/\.(?:mp4|m4v|webm)$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'Uploaded video';
  }

  function normalizedLibraryAsset(asset, release = {}) {
    return {
      id: Number(asset?.id) || 0,
      name: String(asset?.name || ''),
      url: String(asset?.url || asset?.browser_download_url || ''),
      size: Number(asset?.size) || 0,
      contentType: String(asset?.contentType || asset?.content_type || ''),
      createdAt: asset?.createdAt || asset?.created_at || null,
      updatedAt: asset?.updatedAt || asset?.updated_at || null,
      downloadCount: Number(asset?.downloadCount ?? asset?.download_count) || 0,
      releaseId: Number(asset?.releaseId || release?.id) || null,
      releaseTag: String(asset?.releaseTag || release?.tag_name || '')
    };
  }

  function isBroadcastVideoAsset(asset) {
    const name = String(asset?.name || '').toLowerCase();
    const type = String(asset?.contentType || asset?.content_type || '').toLowerCase();
    return name.startsWith('broadcast-video-')
      && (type.startsWith('video/') || /\.(?:mp4|m4v|webm)$/i.test(name));
  }

  function programUsesVideo(program, url) {
    const target = String(url || '');
    return Boolean(target) && Array.isArray(program) && program.some(item =>
      String(item?.type || '').toLowerCase() === 'video'
      && String(item?.mediaUrl || '') === target
    );
  }

  function videoUsage(asset) {
    const url = String(asset?.url || '');
    const draft = programUsesVideo(working?.program, url);
    const savedDraft = programUsesVideo(fullState?.draft?.program, url);
    const live = programUsesVideo(fullState?.live?.program, url);
    return {
      draft,
      savedDraft: savedDraft && !draft,
      live,
      blocked: draft || savedDraft || live
    };
  }

  function knownVideoDuration(url) {
    const target = String(url || '');
    const cached = Number(videoDurationCache.get(target));
    if (Number.isFinite(cached) && cached > 0) return cached;
    const channels = [working, fullState?.draft, fullState?.live];
    for (const channel of channels) {
      const item = (channel?.program || []).find(row =>
        String(row?.type || '').toLowerCase() === 'video'
        && String(row?.mediaUrl || '') === target
      );
      const duration = Number(item?.duration);
      if (Number.isFinite(duration) && duration > 0) return duration;
    }
    return 0;
  }

  function badge(text, state) {
    const node = document.createElement('span');
    node.className = 'mfc-video-badge';
    node.dataset.state = state;
    node.textContent = text;
    return node;
  }

  function openVideoPreview(asset) {
    if (!videoPreviewDialog || !videoPreviewPlayer) return;
    videoPreviewTitle.textContent = displayVideoName(asset.name);
    const usage = videoUsage(asset);
    const states = [
      usage.live ? 'LIVE' : '',
      usage.draft ? 'DRAFT' : '',
      usage.savedDraft ? 'SAVED DRAFT' : '',
      !usage.blocked ? 'UNUSED' : ''
    ].filter(Boolean).join(' · ');
    const uploaded = asset.createdAt ? new Date(asset.createdAt).toLocaleString() : 'Unknown upload date';
    const knownDuration = knownVideoDuration(asset.url);
    videoPreviewMeta.textContent = `${formatBytes(asset.size)}${knownDuration ? ` · ${fmt(knownDuration)}` : ''} · ${uploaded}${states ? ` · ${states}` : ''}`;
    videoPreviewPlayer.onloadedmetadata = () => {
      const duration = Number(videoPreviewPlayer.duration);
      if (!Number.isFinite(duration) || duration <= 0) return;
      videoDurationCache.set(asset.url, duration);
      videoPreviewMeta.textContent = `${formatBytes(asset.size)} · ${fmt(duration)} · ${uploaded}${states ? ` · ${states}` : ''}`;
      renderVideoLibrary();
    };
    videoPreviewPlayer.src = asset.url;
    videoPreviewDialog.showModal();
  }

  async function queueBroadcastVideoDelete(asset) {
    const path = '/contents/assets/uploads/runtime/broadcast-media-delete.json';
    let sha = '';
    try {
      const current = await githubRequest(`${path}?ref=main`);
      sha = current.sha || '';
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    const request = {
      assetId: Number(asset.id),
      name: String(asset.name || ''),
      url: String(asset.url || ''),
      requestedAt: new Date().toISOString()
    };
    await githubRequest(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Delete Broadcast Control video asset',
        content: encodeBase64Utf8(JSON.stringify(request, null, 2) + '\n'),
        branch: 'main',
        ...(sha ? { sha } : {})
      })
    });
  }

  function removeVideoReferences(url) {
    const target = String(url || '');
    if (!target) return { draft: false, live: false };
    let draft = false;
    let live = false;
    if (working?.program) {
      const before = working.program.length;
      working.program = working.program.filter(item => String(item?.mediaUrl || '') !== target);
      draft = working.program.length !== before;
    }
    if (fullState?.draft?.program) {
      fullState.draft.program = fullState.draft.program.filter(item => String(item?.mediaUrl || '') !== target);
    }
    if (fullState?.live?.program) {
      const before = fullState.live.program.length;
      fullState.live.program = fullState.live.program.filter(item => String(item?.mediaUrl || '') !== target);
      live = fullState.live.program.length !== before;
      if (live) {
        const now = new Date().toISOString();
        fullState.live.startedAt = now;
        fullState.live.updatedAt = now;
        fullState.live.revision = `live-${Date.now()}`;
      }
    }
    return { draft, live };
  }

  async function waitForVideoDeletion(assetId, timeoutMs = 90000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await new Promise(resolve => window.setTimeout(resolve, 2500));
      try {
        const assets = await fetchPublicVideoLibrary();
        if (!assets.some(asset => asset.id === assetId)) return true;
      } catch {}
    }
    return false;
  }

  function renderVideoLibrary() {
    if (!videoLibraryList || !videoLibrarySummary) return;
    const query = String(videoLibrarySearch?.value || '').trim().toLowerCase();
    const filter = String(videoLibraryFilter?.value || 'all');
    const sort = String(videoLibrarySort?.value || 'newest');
    const visible = videoLibraryAssets
      .filter(asset => {
        if (query && !displayVideoName(asset.name).toLowerCase().includes(query) && !String(asset.name || '').toLowerCase().includes(query)) return false;
        const usage = videoUsage(asset);
        if (filter === 'active') return usage.blocked;
        if (filter === 'live') return usage.live;
        if (filter === 'unused') return !usage.blocked;
        return true;
      })
      .slice()
      .sort((a, b) => {
        if (sort === 'oldest') return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
        if (sort === 'largest') return (Number(b.size) || 0) - (Number(a.size) || 0);
        if (sort === 'smallest') return (Number(a.size) || 0) - (Number(b.size) || 0);
        if (sort === 'name') return displayVideoName(a.name).localeCompare(displayVideoName(b.name));
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
    const totalBytes = videoLibraryAssets.reduce((sum, asset) => sum + (Number(asset.size) || 0), 0);
    const mode = videoLibraryReadOnly ? ' · public index fallback' : '';
    videoLibrarySummary.textContent = videoLibraryLoading
      ? 'Loading video library…'
      : `${visible.length === videoLibraryAssets.length ? videoLibraryAssets.length : `${visible.length} of ${videoLibraryAssets.length}`} video${videoLibraryAssets.length === 1 ? '' : 's'} · ${formatBytes(totalBytes)}${mode}`;
    updateWorkspaceCounts();
  
    videoLibraryList.replaceChildren();
    if (videoLibraryLoading && !videoLibraryAssets.length) {
      const empty = document.createElement('p');
      empty.className = 'mfc-empty';
      empty.textContent = 'Loading uploaded videos…';
      videoLibraryList.append(empty);
      return;
    }
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'mfc-empty';
      empty.textContent = (query || filter !== 'all') ? 'No uploaded videos match the current search or filter.' : 'No Broadcast Control videos have been uploaded yet.';
      videoLibraryList.append(empty);
      return;
    }
  
    for (const asset of visible) {
      const usage = videoUsage(asset);
      const row = document.createElement('article');
      row.className = `mfc-video-asset${usage.live ? ' is-live' : ''}`;
  
      const main = document.createElement('div');
      main.className = 'mfc-video-asset-main';
      const title = document.createElement('strong');
      title.className = 'mfc-video-asset-title';
      title.textContent = displayVideoName(asset.name);
      title.title = asset.name;
  
      const meta = document.createElement('div');
      meta.className = 'mfc-video-asset-meta';
      const uploaded = asset.createdAt ? new Date(asset.createdAt).toLocaleDateString() : 'Unknown date';
      const duration = knownVideoDuration(asset.url);
      const parts = [
        formatBytes(asset.size),
        duration ? fmt(duration) : '',
        uploaded,
        `${asset.downloadCount || 0} download${asset.downloadCount === 1 ? '' : 's'}`
      ].filter(Boolean);
      parts.forEach((part, index) => {
        if (index) meta.append(document.createTextNode('•'));
        meta.append(document.createTextNode(part));
      });
  
      const badges = document.createElement('div');
      badges.className = 'mfc-video-asset-badges';
      if (usage.live) badges.append(badge('Live', 'live'));
      if (usage.draft) badges.append(badge('Draft', 'draft'));
      if (usage.savedDraft) badges.append(badge('Saved draft', 'saved'));
      if (!usage.blocked) badges.append(badge('Unused', 'unused'));
  
      main.append(title, meta, badges);
  
      const actions = document.createElement('div');
      actions.className = 'mfc-video-asset-actions';
  
      const previewButton = smallButton('Preview', () => openVideoPreview(asset), 'mfc-button-ghost');
      const addButton = smallButton('Add to Program', async () => {
        if (!working) return;
        const original = addButton.textContent;
        addButton.disabled = true;
        addButton.textContent = 'Adding…';
        let duration = knownVideoDuration(asset.url);
        if (!duration) {
          try {
            duration = await probeUrlDuration(asset.url, 'video');
            videoDurationCache.set(asset.url, duration);
          } catch {
            duration = 30;
            showToast('Video added with a 30-second fallback duration. Use Read duration in the selected video block if needed.', 7500);
          }
        }
        const item = {
          id: uid('program'),
          type: 'video',
          header: 'MMA VIDEO',
          eyebrow: 'VIDEO',
          title: displayVideoName(asset.name),
          mediaUrl: asset.url,
          duration,
          videoAudio: true
        };
        working.program.push(item);
        selectedProgramId = item.id;
        renderProgram();
        renderProgramEditor();
        markDirty();
        renderVideoLibrary();
        requestAnimationFrame(() => { programTrack.scrollLeft = programTrack.scrollWidth; });
        addButton.textContent = original;
        showToast('Video added to the draft program.');
      });
  
      const copyButton = smallButton('Copy URL', async () => {
        try {
          await navigator.clipboard.writeText(asset.url);
          showToast('Video URL copied.');
        } catch {
          showToast(asset.url, 9000);
        }
      }, 'mfc-button-ghost');
  
      const releaseButton = smallButton('GitHub Release', () => {
        if (!asset.releaseTag) return;
        window.open(`https://github.com/MatlockFT/Matlock/releases/tag/${encodeURIComponent(asset.releaseTag)}`, '_blank', 'noopener,noreferrer');
      }, 'mfc-button-ghost');

      const deleteButton = smallButton('Delete', async () => {
        const currentUsage = videoUsage(asset);
        const warning = currentUsage.blocked
          ? `"${displayVideoName(asset.name)}" is currently referenced by ${[
              currentUsage.live ? 'the live Program' : '',
              currentUsage.draft || currentUsage.savedDraft ? 'the draft' : ''
            ].filter(Boolean).join(' and ')}. Delete it anyway? It will be removed from those rundowns first.`
          : `Permanently delete "${displayVideoName(asset.name)}"? This cannot be undone.`;
        if (!window.confirm(warning)) return;

        deleteButton.disabled = true;
        deleteButton.textContent = 'Deleting…';
        try {
          if (currentUsage.blocked) {
            const removed = removeVideoReferences(asset.url);
            const now = new Date().toISOString();
            working.updatedAt = now;
            working.revision = `draft-${Date.now()}`;
            fullState = {
              ...(fullState || {}),
              version: 1,
              updatedAt: now,
              draft: clone(working)
            };
            await writeState(fullState, 'Remove deleted video from broadcast programming [skip ci]');
            setDirty(false);
            renderProgram();
            renderSummary();
            if (removed.live) refreshProgramMonitor();
          }

          await queueBroadcastVideoDelete(asset);
          showToast('Delete queued. GitHub is removing the uploaded video…', 9000);
          const removed = await waitForVideoDeletion(asset.id);
          if (removed) {
            videoLibraryAssets = videoLibraryAssets.filter(row => row.id !== asset.id);
            renderVideoLibrary();
            showToast('Uploaded video deleted permanently.');
          } else {
            showToast('Delete was queued, but GitHub is still processing it. Refresh Media in a moment.', 9000);
            deleteButton.disabled = false;
            deleteButton.textContent = 'Delete';
          }
        } catch (error) {
          showToast(`Could not delete video: ${error.message}`, 9000);
          deleteButton.disabled = false;
          deleteButton.textContent = 'Delete';
        }
      }, 'mfc-button-ghost mfc-danger');
      deleteButton.disabled = !asset.id;
      if (usage.blocked) deleteButton.title = 'Deleting will first remove this video from draft/live programming.';
      else deleteButton.title = 'Permanently delete this uploaded video.';
  
      actions.append(previewButton, addButton, copyButton, releaseButton, deleteButton);
      row.append(main, actions);
      videoLibraryList.append(row);
    }
  }

  async function fetchPublicVideoLibrary() {
    const assets = [];
    for (let page = 1; page <= 3; page += 1) {
      const response = await fetch(`https://api.github.com/repos/MatlockFT/Matlock/releases?per_page=100&page=${page}`, {
        headers: { Accept: 'application/vnd.github+json' },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`GitHub video library returned ${response.status}.`);
      const releases = await response.json();
      if (!Array.isArray(releases) || !releases.length) break;
      for (const release of releases) {
        if (!String(release?.tag_name || '').startsWith('writer-media-')) continue;
        for (const raw of release.assets || []) {
          const asset = normalizedLibraryAsset(raw, release);
          if (isBroadcastVideoAsset(asset)) assets.push(asset);
        }
      }
      if (releases.length < 100) break;
    }
    return assets.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  async function loadVideoLibrary({ quiet = false } = {}) {
    if (!videoLibraryList || videoLibraryLoading || !sessionId) return;
    videoLibraryLoading = true;
    if (videoLibraryRefreshButton) videoLibraryRefreshButton.disabled = true;
    renderVideoLibrary();
    try {
      try {
        const data = await mediaBridge('/api/writer/media-library');
        videoLibraryAssets = Array.isArray(data.assets)
          ? data.assets.map(asset => normalizedLibraryAsset(asset)).filter(isBroadcastVideoAsset)
          : [];
        videoLibraryReadOnly = false;
      } catch (error) {
        if (error.status === 401 || !sessionId) throw error;
        videoLibraryAssets = await fetchPublicVideoLibrary();
        videoLibraryReadOnly = true;
        if (!quiet) showToast('Video library loaded from GitHub’s public index. Delete still works through the cleanup queue.', 7000);
      }
    } catch (error) {
      if (!quiet) showToast(`Could not load video library: ${error.message}`, 8000);
    } finally {
      videoLibraryLoading = false;
      if (videoLibraryRefreshButton) videoLibraryRefreshButton.disabled = false;
      renderVideoLibrary();
    }
  }



  function currentLiveProgramId() {
    const live = fullState?.live;
    const items = Array.isArray(live?.program) ? live.program.filter(item => positive(item.duration) > 0) : [];
    if (!items.length) return '';
    const stamp = Date.parse(live.startedAt || live.updatedAt || '');
    if (!Number.isFinite(stamp)) return String(items[0]?.id || '');
    const total = items.reduce((sum, item) => sum + positive(item.duration), 0);
    if (total <= 0) return '';
    const elapsed = Math.max(0, (Date.now() - stamp) / 1000);
    const position = ((elapsed % total) + total) % total;
    let cursor = 0;
    for (const item of items) {
      cursor += positive(item.duration);
      if (position < cursor) return String(item.id || '');
    }
    return String(items[0]?.id || '');
  }

  function updateOnAirRundown() {
    if (!programTrack) return;
    const liveId = currentLiveProgramId();
    programTrack.querySelectorAll('[data-program-id]').forEach(block => {
      block.classList.toggle('is-on-air', Boolean(liveId) && block.dataset.programId === liveId);
    });
  }
  function blockWidth(duration, min = 118, scale = 4.4, max = 460) {
    return Math.max(min, Math.min(max, positive(duration) * scale));
  }

  function setRuler() {
    const total = totalProgramDuration();
    if (!total) {
      programRuler.textContent = '00:00';
      return;
    }
    const marks = [0, .25, .5, .75, 1].map(fraction => fmt(total * fraction));
    programRuler.innerHTML = marks.map((mark, index) => `<span style="margin-left:${index ? 'auto' : '0'}">${mark}</span>`).join('');
  }

  function renderProgram() {
    programTrack.replaceChildren();
    setRuler();

    if (!working.program.length) {
      const empty = document.createElement('p');
      empty.className = 'mfc-empty';
      empty.textContent = 'No program items. Add a headline, result, event, image or video.';
      programTrack.append(empty);
      renderProgramEditor();
      return;
    }

    working.program.forEach((item, index) => {
      if (!item.id) item.id = uid('program');
      const block = document.createElement('div');
      block.className = 'mfc-timeline-block';
      if (item.id === selectedProgramId) block.classList.add('is-selected');
      block.dataset.programId = item.id;
      block.dataset.type = item.type || 'headline';
      block.draggable = true;
      block.tabIndex = 0;
      block.style.setProperty('--block-width', `${blockWidth(item.duration)}px`);

      const kind = document.createElement('span');
      kind.className = 'mfc-timeline-kind';
      kind.textContent = `${String(index + 1).padStart(2, '0')} · ${String(item.type || 'headline').toUpperCase()}`;

      const blockTitle = document.createElement('strong');
      blockTitle.className = 'mfc-timeline-title';
      blockTitle.textContent = item.title || `${item.type || 'Program'} ${index + 1}`;

      const duration = document.createElement('div');
      duration.className = 'mfc-timeline-duration';
      if (item.type === 'video') {
        duration.textContent = `${fmt(item.duration)} AUTO`;
      } else {
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.max = '3600';
        input.step = '1';
        input.value = String(Math.max(1, Math.round(positive(item.duration) || 20)));
        input.setAttribute('aria-label', `Duration for ${blockTitle.textContent}`);
        input.addEventListener('click', event => event.stopPropagation());
        input.addEventListener('pointerdown', event => event.stopPropagation());
        input.addEventListener('change', event => {
          item.duration = clamp(event.target.value, 1, 3600);
          renderProgram();
          markDirty();
        });
        duration.append(input, document.createTextNode(' sec'));
      }

      block.append(kind, blockTitle, duration);
      block.addEventListener('click', () => {
        selectedProgramId = item.id;
        renderProgram();
        renderProgramEditor();
      });
      block.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectedProgramId = item.id;
          renderProgram();
          renderProgramEditor();
        }
      });
      block.addEventListener('dragstart', event => {
        draggingProgramId = item.id;
        block.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.id);
      });
      block.addEventListener('dragend', () => {
        draggingProgramId = '';
        block.classList.remove('is-dragging');
      });
      block.addEventListener('dragover', event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      });
      block.addEventListener('drop', event => {
        event.preventDefault();
        if (!draggingProgramId || draggingProgramId === item.id) return;
        const from = working.program.findIndex(row => row.id === draggingProgramId);
        const to = working.program.findIndex(row => row.id === item.id);
        if (from < 0 || to < 0) return;
        const [moved] = working.program.splice(from, 1);
        working.program.splice(to, 0, moved);
        renderProgram();
        markDirty();
      });

      programTrack.append(block);
    });

    renderProgramEditor();
    updateOnAirRundown();
  }

  function field(label, key, options = {}) {
    const wrap = document.createElement('label');
    wrap.className = `mfc-field${options.wide ? ' mfc-field-wide' : ''}`;
    const labelNode = document.createElement('span');
    labelNode.textContent = label;
    let input;

    if (options.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = options.rows || 4;
    } else if (options.type === 'select') {
      input = document.createElement('select');
      for (const option of options.options || []) {
        const node = document.createElement('option');
        node.value = option.value;
        node.textContent = option.label;
        input.append(node);
      }
    } else {
      input = document.createElement('input');
      input.type = options.type || 'text';
      if (options.min != null) input.min = String(options.min);
      if (options.max != null) input.max = String(options.max);
      if (options.step != null) input.step = String(options.step);
      if (options.readOnly) input.readOnly = true;
      if (options.placeholder) input.placeholder = options.placeholder;
    }

    input.value = options.value ?? '';
    input.addEventListener(options.live === false ? 'change' : 'input', () => {
      options.onChange?.(input.value, input);
    });

    wrap.append(labelNode, input);
    return { wrap, input };
  }

  function buttonRow(...buttons) {
    const row = document.createElement('div');
    row.className = 'mfc-inline-actions mfc-field-wide';
    row.append(...buttons);
    return row;
  }

  function smallButton(label, handler, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `mfc-button mfc-button-small ${className}`.trim();
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  function currentProgram() {
    return working?.program?.find(item => item.id === selectedProgramId) || null;
  }

  function renderProgramEditor() {
    programFields.replaceChildren();
    const item = currentProgram();
    programEditorTitle.textContent = item?.title || 'Choose a block above';
    deleteProgramButton.hidden = !item;
    if (!item) {
      const empty = document.createElement('p');
      empty.className = 'mfc-empty';
      empty.textContent = 'Select a program block to edit it.';
      programFields.append(empty);
      return;
    }

    const form = document.createElement('div');
    form.className = 'mfc-editor-form';

    const titleField = field('Title', 'title', {
      value: item.title || '',
      wide: true,
      onChange: value => {
        item.title = value;
        programEditorTitle.textContent = value || 'Untitled';
        const node = programTrack.querySelector(`[data-program-id="${item.id}"] .mfc-timeline-title`);
        if (node) node.textContent = value || String(item.type || 'Program').toUpperCase();
        markDirty();
      }
    });

    const eyebrowField = field('Eyebrow', 'eyebrow', {
      value: item.eyebrow || '',
      onChange: value => { item.eyebrow = value; markDirty(); }
    });

    const headerField = field('Header band', 'header', {
      value: item.header || '',
      onChange: value => { item.header = value; markDirty(); }
    });

    form.append(titleField.wrap, eyebrowField.wrap, headerField.wrap);

    if (!['image', 'video'].includes(item.type)) {
      const bodyField = field('Body', 'body', {
        type: 'textarea',
        value: item.body || '',
        wide: true,
        onChange: value => { item.body = value; markDirty(); }
      });
      const durationField = field('Duration (seconds)', 'duration', {
        type: 'number',
        value: Math.max(1, Math.round(positive(item.duration) || 20)),
        min: 1,
        max: 3600,
        step: 1,
        live: false,
        onChange: value => {
          item.duration = clamp(value, 1, 3600);
          renderProgram();
          markDirty();
        }
      });
      form.append(bodyField.wrap, durationField.wrap);
    }

    if (item.type === 'image' || item.type === 'video') {
      const mediaField = field(item.type === 'video' ? 'Video URL' : 'Image URL', 'mediaUrl', {
        type: 'url',
        value: item.mediaUrl || '',
        placeholder: 'https://…',
        wide: true,
        live: false,
        onChange: async value => {
          item.mediaUrl = value.trim();
          if (item.type === 'video' && item.mediaUrl) {
            try {
              item.duration = await probeUrlDuration(item.mediaUrl, 'video');
              showToast(`Video duration detected: ${fmt(item.duration)}`);
            } catch {
              showToast('Could not read video duration from that URL. Upload the file or try another direct media URL.', 7000);
            }
          }
          renderProgram();
          renderProgramEditor();
          markDirty();
          if (item.type === 'video') renderVideoLibrary();
        }
      });
      form.append(mediaField.wrap);

      if (item.type === 'video') {
        const durationField = field('Video duration', 'duration', {
          value: fmt(item.duration),
          readOnly: true
        });
        form.append(durationField.wrap);

        const upload = document.createElement('input');
        upload.type = 'file';
        upload.accept = 'video/mp4,video/webm,video/x-m4v,.mp4,.webm,.m4v';
        upload.hidden = true;
        let videoUploadBusy = false;
        const uploadButton = smallButton('Upload video', () => {
          if (!videoUploadBusy) upload.click();
        });
        const redetectButton = smallButton('Read duration', async () => {
          if (!item.mediaUrl) return showToast('Add a direct video URL first.');
          if (videoUploadBusy) return;
          redetectButton.disabled = true;
          try {
            item.duration = await probeUrlDuration(item.mediaUrl, 'video');
            renderProgram();
            renderProgramEditor();
            markDirty();
            showToast(`Video duration detected: ${fmt(item.duration)}`);
          } catch {
            showToast('Could not read the duration from that URL.', 6500);
          } finally {
            redetectButton.disabled = false;
          }
        });
        upload.addEventListener('change', async () => {
          const file = upload.files?.[0];
          if (!file || videoUploadBusy) return;
          videoUploadBusy = true;
          uploadButton.disabled = true;
          redetectButton.disabled = true;
          const uploadLabel = uploadButton.textContent;
          uploadButton.textContent = 'Uploading…';
          try {
            const duration = await probeFileDuration(file);
            const url = await uploadMediaFile(file, 'video');
            videoDurationCache.set(url, duration);
            item.mediaUrl = url;
            item.duration = duration;
            void loadVideoLibrary({ quiet: true });
            showToast('Video uploaded and added to the program.');
            renderProgram();
            renderProgramEditor();
            markDirty();
            renderVideoLibrary();
          } catch (error) {
            showToast(`Video upload failed: ${error.message}`, 9000);
          } finally {
            videoUploadBusy = false;
            uploadButton.disabled = false;
            redetectButton.disabled = false;
            uploadButton.textContent = uploadLabel;
            upload.value = '';
            clearUploadProgress();
          }
        });
        const controls = buttonRow(uploadButton, redetectButton, upload);
        form.append(controls);

        const audioField = field('Video audio', 'videoAudio', {
          type: 'select',
          value: item.videoAudio === false ? 'off' : 'on',
          options: [
            { value: 'on', label: 'Use video audio' },
            { value: 'off', label: 'Mute video audio' }
          ],
          onChange: value => { item.videoAudio = value !== 'off'; markDirty(); }
        });

        const behaviorField = field('Music during this video', 'musicBehavior', {
          type: 'select',
          value: item.musicBehavior || '',
          options: [
            { value: '', label: 'Use global setting' },
            { value: 'duck', label: 'Duck music' },
            { value: 'keep', label: 'Keep music playing' },
            { value: 'mute', label: 'Mute music' }
          ],
          onChange: value => {
            if (value) item.musicBehavior = value;
            else delete item.musicBehavior;
            markDirty();
          }
        });

        const duckField = field('Override duck level %', 'duckLevel', {
          type: 'number',
          value: item.duckLevel == null ? '' : Math.round(Number(item.duckLevel) * 100),
          min: 0,
          max: 100,
          step: 1,
          placeholder: 'Global',
          onChange: value => {
            if (value === '') delete item.duckLevel;
            else item.duckLevel = clamp(Number(value) / 100, 0, 1);
            markDirty();
          }
        });
        form.append(audioField.wrap, behaviorField.wrap, duckField.wrap);
      }
    }

    const programIndex = working.program.findIndex(row => row.id === item.id);
    const moveLeft = smallButton('← Move left', () => moveProgram(item.id, -1), 'mfc-button-ghost');
    const moveRight = smallButton('Move right →', () => moveProgram(item.id, 1), 'mfc-button-ghost');
    moveLeft.disabled = programIndex <= 0;
    moveRight.disabled = programIndex < 0 || programIndex >= working.program.length - 1;
    form.append(buttonRow(moveLeft, moveRight));
    programFields.append(form);
  }

  function moveProgram(id, delta) {
    const index = working.program.findIndex(item => item.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= working.program.length) return;
    const [item] = working.program.splice(index, 1);
    working.program.splice(target, 0, item);
    renderProgram();
    markDirty();
  }

  deleteProgramButton.addEventListener('click', () => {
    const item = currentProgram();
    if (!item) return;
    const index = working.program.findIndex(row => row.id === item.id);
    if (index < 0) return;
    working.program.splice(index, 1);
    selectedProgramId = working.program[Math.min(index, working.program.length - 1)]?.id || '';
    renderProgram();
    markDirty();
    renderVideoLibrary();
  });

  app.querySelectorAll('[data-add-program]').forEach(button => {
    button.addEventListener('click', () => {
      const type = button.dataset.addProgram;
      const defaults = {
        headline: { header: 'YOUR FIGHT FORECAST', eyebrow: 'LATEST', title: 'NEW HEADLINE', body: 'ADD THE STORY HERE.', duration: 20 },
        results: { header: 'FIGHT RESULTS', eyebrow: 'RESULTS', title: 'FIGHT RESULT', body: 'WINNER • METHOD • ROUND', duration: 18 },
        event: { header: 'UPCOMING FIGHTS', eyebrow: 'NEXT EVENT', title: 'UPCOMING EVENT', body: 'DATE • VENUE • MAIN EVENT', duration: 18 },
        image: { header: 'MMA NEWS', eyebrow: 'PHOTO', title: 'IMAGE', mediaUrl: '', duration: 20 },
        video: { header: 'MMA VIDEO', eyebrow: 'VIDEO', title: 'VIDEO', mediaUrl: '', duration: 30, videoAudio: true },
        breaking: { header: 'BREAKING NEWS', eyebrow: 'BREAKING', title: 'BREAKING NEWS', body: 'ADD THE UPDATE HERE.', duration: 20 }
      };
      const item = { id: uid('program'), type, ...(defaults[type] || defaults.headline) };
      working.program.push(item);
      selectedProgramId = item.id;
      renderProgram();
      markDirty();
      renderVideoLibrary();
      requestAnimationFrame(() => { programTrack.scrollLeft = programTrack.scrollWidth; });
    });
  });

  function currentMusic() {
    return working?.music?.find(item => item.id === selectedMusicId) || null;
  }

  function renderMusic() {
    musicTrack.replaceChildren();

    if (!working.music.length) {
      const empty = document.createElement('p');
      empty.className = 'mfc-empty';
      empty.textContent = 'No music yet. Upload as many tracks as you want or add direct audio URLs.';
      musicTrack.append(empty);
      renderMusicEditor();
      return;
    }

    working.music.forEach((track, index) => {
      if (!track.id) track.id = uid('music');
      const block = document.createElement('div');
      block.className = 'mfc-timeline-block';
      block.dataset.music = 'true';
      block.dataset.musicId = track.id;
      block.draggable = true;
      block.tabIndex = 0;
      block.style.setProperty('--block-width', `${blockWidth(track.duration, 122, 1.25, 360)}px`);
      if (track.id === selectedMusicId) block.classList.add('is-selected');

      const kind = document.createElement('span');
      kind.className = 'mfc-timeline-kind';
      kind.textContent = `TRACK ${index + 1}`;
      const titleNode = document.createElement('strong');
      titleNode.className = 'mfc-timeline-title';
      titleNode.textContent = track.title || 'Untitled track';
      const duration = document.createElement('div');
      duration.className = 'mfc-timeline-duration';
      duration.textContent = fmt(track.duration);

      block.append(kind, titleNode, duration);
      block.addEventListener('click', () => {
        selectedMusicId = track.id;
        renderMusic();
        renderMusicEditor();
      });
      block.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectedMusicId = track.id;
          renderMusic();
          renderMusicEditor();
        }
      });
      block.addEventListener('dragstart', event => {
        draggingMusicId = track.id;
        block.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', track.id);
      });
      block.addEventListener('dragend', () => {
        draggingMusicId = '';
        block.classList.remove('is-dragging');
      });
      block.addEventListener('dragover', event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      });
      block.addEventListener('drop', event => {
        event.preventDefault();
        if (!draggingMusicId || draggingMusicId === track.id) return;
        const from = working.music.findIndex(row => row.id === draggingMusicId);
        const to = working.music.findIndex(row => row.id === track.id);
        if (from < 0 || to < 0) return;
        const [moved] = working.music.splice(from, 1);
        working.music.splice(to, 0, moved);
        renderMusic();
        markDirty();
      });
      musicTrack.append(block);
    });

    renderMusicEditor();
  }

  function renderMusicEditor() {
    musicFields.replaceChildren();
    const track = currentMusic();
    musicEditorTitle.textContent = track?.title || 'Choose a song above';
    deleteMusicButton.hidden = !track;
    if (!track) {
      const empty = document.createElement('p');
      empty.className = 'mfc-empty';
      empty.textContent = 'Add or select a song to edit gain, fades and duration.';
      musicFields.append(empty);
      return;
    }

    const form = document.createElement('div');
    form.className = 'mfc-editor-form';

    const titleField = field('Track title', 'title', {
      value: track.title || '',
      wide: true,
      onChange: value => {
        track.title = value;
        musicEditorTitle.textContent = value || 'Untitled track';
        const node = musicTrack.querySelector(`[data-music-id="${track.id}"] .mfc-timeline-title`);
        if (node) node.textContent = value || 'Untitled track';
        markDirty();
      }
    });
    const urlField = field('Audio URL', 'url', {
      type: 'url',
      value: track.url || '',
      wide: true,
      live: false,
      onChange: async value => {
        track.url = value.trim();
        const youtubeId = youtubeVideoId(track.url);
        if (youtubeId) {
          track.sourceType = 'youtube';
          track.youtubeId = youtubeId;
          if (!positive(track.duration)) track.duration = 180;
          showToast('YouTube source recognized. Set the track duration to match the video length.');
        } else {
          delete track.sourceType;
          delete track.youtubeId;
          try {
            if (track.url) track.duration = await probeUrlDuration(track.url);
          } catch {
            showToast('Could not read duration from that host. Set the duration manually.', 6500);
          }
        }
        renderMusic();
        renderMusicEditor();
        markDirty();
      }
    });
    const durationField = field('Duration (seconds)', 'duration', {
      type: 'number',
      value: Math.max(1, Number(track.duration) || 180),
      min: 1,
      max: 86400,
      step: .1,
      live: false,
      onChange: value => {
        track.duration = clamp(value, 1, 86400);
        renderMusic();
        markDirty();
      }
    });
    const gainField = field('Gain (dB)', 'gainDb', {
      type: 'number',
      value: Number(track.gainDb || 0),
      min: -30,
      max: 12,
      step: .5,
      onChange: value => { track.gainDb = clamp(value, -30, 12); markDirty(); }
    });
    const fadeInField = field('Fade in (sec)', 'fadeIn', {
      type: 'number',
      value: Number(track.fadeIn ?? 1.5),
      min: 0,
      max: 30,
      step: .1,
      onChange: value => { track.fadeIn = clamp(value, 0, 30); markDirty(); }
    });
    const fadeOutField = field('Fade out (sec)', 'fadeOut', {
      type: 'number',
      value: Number(track.fadeOut ?? 2),
      min: 0,
      max: 30,
      step: .1,
      onChange: value => { track.fadeOut = clamp(value, 0, 30); markDirty(); }
    });
    const detectButton = smallButton('Read duration from file', async () => {
      if (!track.url) return showToast('Add an audio URL first.');
      if (youtubeVideoId(track.url)) return showToast('YouTube does not expose duration as a direct audio file here. Set the duration field manually.');
      try {
        track.duration = await probeUrlDuration(track.url, 'audio');
        renderMusic();
        renderMusicEditor();
        markDirty();
        showToast(`Duration detected: ${fmt(track.duration)}`);
      } catch {
        showToast('Could not read duration from that URL.', 6500);
      }
    }, 'mfc-button-ghost');
    const musicIndex = working.music.findIndex(row => row.id === track.id);
    const moveLeft = smallButton('← Move left', () => moveMusic(track.id, -1), 'mfc-button-ghost');
    const moveRight = smallButton('Move right →', () => moveMusic(track.id, 1), 'mfc-button-ghost');
    moveLeft.disabled = musicIndex <= 0;
    moveRight.disabled = musicIndex < 0 || musicIndex >= working.music.length - 1;

    form.append(titleField.wrap, urlField.wrap, durationField.wrap, gainField.wrap, fadeInField.wrap, fadeOutField.wrap, buttonRow(detectButton, moveLeft, moveRight));
    musicFields.append(form);
  }

  function moveMusic(id, delta) {
    const index = working.music.findIndex(item => item.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= working.music.length) return;
    const [item] = working.music.splice(index, 1);
    working.music.splice(target, 0, item);
    renderMusic();
    markDirty();
  }

  deleteMusicButton.addEventListener('click', () => {
    const item = currentMusic();
    if (!item) return;
    const index = working.music.findIndex(row => row.id === item.id);
    if (index < 0) return;
    working.music.splice(index, 1);
    selectedMusicId = working.music[Math.min(index, working.music.length - 1)]?.id || '';
    renderMusic();
    markDirty();
  });

  function renderAudioSettings() {
    app.querySelectorAll('[data-audio-setting]').forEach(input => {
      const key = input.dataset.audioSetting;
      if (!(key in working.audio)) return;
      input.value = String(working.audio[key]);
      if (input.type === 'range') {
        const output = app.querySelector(`[data-audio-output="${key}"]`);
        if (output) output.textContent = `${Math.round(Number(input.value) * 100)}%`;
      }
    });
    app.querySelectorAll('[data-audio-percent]').forEach(input => {
      const key = input.dataset.audioPercent;
      input.value = String(Math.round(Number(working.audio[key] ?? 0) * 100));
    });
  }

  app.querySelectorAll('[data-audio-setting]').forEach(input => {
    input.addEventListener('input', () => {
      if (!working) return;
      const key = input.dataset.audioSetting;
      working.audio[key] = input.type === 'range' || input.type === 'number' ? Number(input.value) : input.value;
      if (input.type === 'range') {
        const output = app.querySelector(`[data-audio-output="${key}"]`);
        if (output) output.textContent = `${Math.round(Number(input.value) * 100)}%`;
      }
      markDirty();
    });
  });

  app.querySelectorAll('[data-audio-percent]').forEach(input => {
    input.addEventListener('input', () => {
      if (!working) return;
      working.audio[input.dataset.audioPercent] = clamp(Number(input.value) / 100, 0, 1);
      markDirty();
    });
  });

  tickerInput.addEventListener('input', () => {
    if (!working) return;
    working.ticker = tickerInput.value.split('\n').map(value => value.trim()).filter(Boolean);
    renderTickerPreview();
    markDirty();
  });

  function renderAll() {
    renderSummary();
    renderProgram();
    renderMusic();
    renderAudioSettings();
    tickerInput.value = (working.ticker || []).join('\n');
    renderTickerPreview();
    setDirty(false);
    renderVideoLibrary();
    postPreview();
  }

  async function writeState(nextState, message) {
    const body = {
      message,
      content: encodeBase64Utf8(JSON.stringify(nextState, null, 2) + '\n'),
      branch: 'main',
      ...(stateSha ? { sha: stateSha } : {})
    };
    const response = await githubRequest(STATE_API_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    stateSha = response.content?.sha || response.sha || stateSha;
    return response;
  }

  async function saveDraft() {
    if (!working || !dirty || busyAction) return;
    const originalLabel = saveDraftButton.textContent;
    setBusy('save');
    saveDraftButton.textContent = 'Saving…';
    try {
      const now = new Date().toISOString();
      working.updatedAt = now;
      working.revision = `draft-${Date.now()}`;
      fullState = {
        ...(fullState || {}),
        version: 1,
        updatedAt: now,
        draft: clone(working)
      };
      await writeState(fullState, 'Update broadcast draft [skip ci]');
      setDirty(false);
      showToast('Broadcast draft saved.');
      renderSummary();
      renderVideoLibrary();
    } catch (error) {
      if (error.status === 409) showToast('Broadcast state changed remotely. Use Reload State, then try again.', 8500);
      else showToast(`Could not save draft: ${error.message}`, 8500);
    } finally {
      saveDraftButton.textContent = originalLabel;
      setBusy('');
    }
  }

  function validateWorkingForLive() {
    if (!working) return false;
    const program = Array.isArray(working.program) ? working.program : [];
    const missingMedia = program.filter(item =>
      ['image', 'video'].includes(String(item?.type || '').toLowerCase())
      && !String(item?.mediaUrl || '').trim()
    );
    if (missingMedia.length) {
      showToast(`Cannot Take Live: ${missingMedia.length} media block${missingMedia.length === 1 ? ' is' : 's are'} missing a file or URL.`, 8500);
      return false;
    }
    const invalidVideo = program.find(item =>
      String(item?.type || '').toLowerCase() === 'video'
      && positive(item?.duration) <= 0
    );
    if (invalidVideo) {
      showToast('Cannot Take Live: a video block has no valid duration.', 8500);
      return false;
    }
    if (!program.length) {
      return window.confirm('The rundown is empty. Take an empty standby program live?');
    }
    return true;
  }

  async function takeLive() {
    if (!working || busyAction || !validateWorkingForLive()) return;
    const originalLabel = takeLiveButton.textContent;
    setBusy('live');
    takeLiveButton.textContent = 'Taking Live…';
    try {
      const now = new Date().toISOString();
      working.updatedAt = now;
      working.revision = `draft-${Date.now()}`;
      const live = clone(working);
      live.startedAt = now;
      live.updatedAt = now;
      live.revision = `live-${Date.now()}`;
      fullState = {
        ...(fullState || {}),
        version: 1,
        updatedAt: now,
        draft: clone(working),
        live
      };
      await writeState(fullState, 'Take broadcast programming live [skip ci]');
      setDirty(false);
      showToast('Preview is now live on Program. Existing viewers will sync automatically.');
      renderSummary();
      renderVideoLibrary();
      refreshProgramMonitor();
    } catch (error) {
      if (error.status === 409) showToast('Broadcast state changed remotely. Use Reload State, then try again.', 8500);
      else showToast(`Could not take broadcast live: ${error.message}`, 8500);
    } finally {
      takeLiveButton.textContent = originalLabel;
      setBusy('');
    }
  }

  async function reloadState() {
    if (!sessionId || busyAction) return;
    if (dirty && !window.confirm('Discard unsaved Broadcast Control changes and reload the saved draft?')) return;
    const originalLabel = reloadStateButton.textContent;
    setBusy('reload');
    reloadStateButton.textContent = 'Reloading…';
    liveStatus.textContent = 'Reloading broadcast…';
    try {
      await loadState();
      authPanel.hidden = true;
      workspace.hidden = false;
      showToast('Broadcast state reloaded.');
    } catch (error) {
      if (error.status === 401) expireSession();
      else {
        liveStatus.textContent = 'Broadcast load failed';
        showToast(`Could not reload broadcast state: ${error.message}`, 9000);
      }
    } finally {
      reloadStateButton.textContent = originalLabel;
      setBusy('');
    }
  }

  saveDraftButton.addEventListener('click', saveDraft);
  takeLiveButton.addEventListener('click', takeLive);
  reloadStateButton?.addEventListener('click', reloadState);

  function probeMedia(element) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const clean = () => {
        element.removeEventListener('loadedmetadata', loaded);
        element.removeEventListener('error', failed);
      };
      const loaded = () => {
        if (settled) return;
        settled = true;
        clean();
        const duration = Number(element.duration);
        if (!Number.isFinite(duration) || duration <= 0) reject(new Error('Media duration unavailable.'));
        else resolve(duration);
      };
      const failed = () => {
        if (settled) return;
        settled = true;
        clean();
        reject(new Error('Could not load media metadata.'));
      };
      element.addEventListener('loadedmetadata', loaded, { once: true });
      element.addEventListener('error', failed, { once: true });
      window.setTimeout(failed, 12000);
      element.load();
    });
  }

  async function probeUrlDuration(url, kind = 'auto') {
    const tag = kind === 'video' || kind === 'audio'
      ? kind
      : /\.(?:mp4|m4v|webm)(?:[?#].*)?$/i.test(url) ? 'video' : 'audio';
    const element = document.createElement(tag);
    element.preload = 'metadata';
    element.src = url;
    const duration = await probeMedia(element);
    element.removeAttribute('src');
    element.load();
    return duration;
  }

  async function probeFileDuration(file) {
    const url = URL.createObjectURL(file);
    const tag = file.type.startsWith('video/') ? 'video' : 'audio';
    const element = document.createElement(tag);
    element.preload = 'metadata';
    element.src = url;
    try {
      return await probeMedia(element);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function safeExtension(file) {
    const fromName = String(file.name || '').match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() || '';
    return fromName || ({
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/aac': 'aac',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/ogg': 'ogg',
      'audio/opus': 'opus',
      'audio/flac': 'flac',
      'audio/x-flac': 'flac',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/x-m4v': 'm4v'
    }[file.type] || 'bin');
  }

  function mediaAssetName(file, kind) {
    const ext = safeExtension(file);
    const stem = String(file.name || kind)
      .replace(/\.[^.]+$/, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72) || kind;
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
    return `broadcast-${kind}-${stem}-${stamp}.${ext}`;
  }

  async function mediaBridge(path, options = {}) {
    if (!sessionId) throw new Error('Sign in with GitHub first.');
    const response = await fetch(`${authBase}${path}`, {
      ...options,
      mode: 'cors',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'X-Writer-Session': sessionId,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) expireSession();
      const error = new Error(data.error || data.message || `${response.status} ${response.statusText}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function uploadMediaFile(file, kind) {
    if (!file?.size) throw new Error('Choose a media file.');
    if (file.size >= 2 * 1024 * 1024 * 1024) throw new Error('GitHub Release assets must be smaller than 2 GiB.');
    const uploadId = uid('upload').replace(/-/g, '');
    const assetName = mediaAssetName(file, kind);
    const chunkCount = Math.ceil(file.size / CHUNK_BYTES);
    let uploaded = 0;

    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * CHUNK_BYTES;
      const end = Math.min(file.size, start + CHUNK_BYTES);
      const chunk = file.slice(start, end);
      await mediaBridge('/api/writer/media-chunk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Upload-Id': uploadId,
          'X-Chunk-Index': String(index),
          'X-Chunk-Count': String(chunkCount),
          'X-File-Size': String(file.size),
          'X-File-Type': file.type || 'application/octet-stream',
          'X-Asset-Name': assetName
        },
        body: chunk
      });
      uploaded += chunk.size;
      setUploadProgress(5 + (uploaded / file.size) * 72, `Uploading ${file.name}…`);
    }

    setUploadProgress(80, `Publishing ${file.name} to GitHub Releases…`);
    await mediaBridge('/api/writer/media-finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId,
        assetName,
        chunkCount,
        fileSize: file.size,
        fileType: file.type || 'application/octet-stream'
      })
    });

    const started = Date.now();
    while (Date.now() - started < STATUS_TIMEOUT_MS) {
      const status = await mediaBridge(`/api/writer/media-status?uploadId=${encodeURIComponent(uploadId)}`);
      if (status.state === 'complete' && status.url) {
        setUploadProgress(100, `${file.name} uploaded.`);
        return status.url;
      }
      if (status.state === 'error') throw new Error(status.error || 'GitHub Release upload failed.');
      if (status.state === 'publishing') setUploadProgress(94, `Publishing ${file.name}…`);
      else if (status.state === 'preparing') setUploadProgress(87, `Preparing ${file.name}…`);
      await new Promise(resolve => window.setTimeout(resolve, STATUS_POLL_MS));
    }
    throw new Error('Media upload timed out.');
  }

  async function uploadVideoFiles(fileList) {
    const files = Array.from(fileList || []).filter(file =>
      String(file.type || '').startsWith('video/')
      || /\.(?:mp4|m4v|webm)$/i.test(String(file.name || ''))
    );
    if (!files.length) return showToast('Drop or choose MP4, WebM or M4V video files.', 6500);
    if (videoLibraryUploadInput.disabled) return showToast('Wait for the current video upload to finish.');

    videoLibraryUploadInput.disabled = true;
    if (videoLibraryRefreshButton) videoLibraryRefreshButton.disabled = true;
    try {
      let completed = 0;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setUploadProgress(1, `Reading ${file.name}… (${index + 1}/${files.length})`);
        const duration = await probeFileDuration(file);
        const url = await uploadMediaFile(file, 'video');
        videoDurationCache.set(url, duration);
        completed += 1;
      }
      await loadVideoLibrary({ quiet: true });
      showToast(`${completed} video${completed === 1 ? '' : 's'} uploaded to the Media pool.`);
    } catch (error) {
      showToast(`Video upload failed: ${error.message}`, 9000);
      void loadVideoLibrary({ quiet: true });
    } finally {
      videoLibraryUploadInput.value = '';
      videoLibraryUploadInput.disabled = false;
      if (videoLibraryRefreshButton) videoLibraryRefreshButton.disabled = false;
      videoLibraryPanel?.classList.remove('is-drop-target');
      window.setTimeout(clearUploadProgress, 900);
    }
  }

  function bindVideoLibraryHandlers() {
    videoLibrarySearch?.addEventListener('input', renderVideoLibrary);
    videoLibraryFilter?.addEventListener('change', renderVideoLibrary);
    videoLibrarySort?.addEventListener('change', renderVideoLibrary);
  
    videoLibraryRefreshButton?.addEventListener('click', () => {
      void loadVideoLibrary();
    });
  
    videoPreviewDialog?.addEventListener('close', () => {
      if (!videoPreviewPlayer) return;
      videoPreviewPlayer.pause();
      videoPreviewPlayer.onloadedmetadata = null;
      videoPreviewPlayer.removeAttribute('src');
      videoPreviewPlayer.load();
    });
  
    videoLibraryUploadInput?.addEventListener('change', () => {
      void uploadVideoFiles(videoLibraryUploadInput.files);
    });

    if (videoLibraryPanel) {
      const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
      videoLibraryPanel.addEventListener('dragenter', event => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        videoLibraryPanel.classList.add('is-drop-target');
      });
      videoLibraryPanel.addEventListener('dragover', event => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        videoLibraryPanel.classList.add('is-drop-target');
      });
      videoLibraryPanel.addEventListener('dragleave', event => {
        if (event.relatedTarget && videoLibraryPanel.contains(event.relatedTarget)) return;
        videoLibraryPanel.classList.remove('is-drop-target');
      });
      videoLibraryPanel.addEventListener('drop', event => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        videoLibraryPanel.classList.remove('is-drop-target');
        void uploadVideoFiles(event.dataTransfer.files);
      });
    }
  }

  bindVideoLibraryHandlers();

  musicUploadInput.addEventListener('change', async () => {
    const files = Array.from(musicUploadInput.files || []);
    if (!files.length || musicUploadInput.disabled) return;
    musicUploadInput.disabled = true;
    addMusicUrlButton.disabled = true;
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setUploadProgress(1, `Reading ${file.name}… (${index + 1}/${files.length})`);
        const duration = await probeFileDuration(file);
        const url = await uploadMediaFile(file, 'audio');
        const track = {
          id: uid('music'),
          title: String(file.name || 'Track').replace(/\.[^.]+$/, ''),
          url,
          duration,
          gainDb: 0,
          fadeIn: 1.5,
          fadeOut: 2
        };
        working.music.push(track);
        selectedMusicId = track.id;
        renderMusic();
        markDirty();
      }
      showToast(`${files.length} song${files.length === 1 ? '' : 's'} added to the music bed.`);
    } catch (error) {
      showToast(`Music upload failed: ${error.message}`, 9000);
    } finally {
      musicUploadInput.value = '';
      musicUploadInput.disabled = false;
      addMusicUrlButton.disabled = false;
      window.setTimeout(clearUploadProgress, 900);
    }
  });

  addMusicUrlButton.addEventListener('click', () => {
    if (musicUploadInput.disabled) return showToast('Wait for the current media upload to finish.');
    musicUrlInput.value = '';
    musicUrlTitleInput.value = '';
    urlDialog.showModal();
  });

  confirmMusicUrlButton.addEventListener('click', async () => {
    const url = musicUrlInput.value.trim();
    if (!url) return showToast('Enter an audio URL or YouTube link.');
    if (!musicUrlInput.checkValidity()) {
      musicUrlInput.reportValidity();
      return;
    }
    const originalLabel = confirmMusicUrlButton.textContent;
    confirmMusicUrlButton.disabled = true;
    confirmMusicUrlButton.textContent = 'Checking…';
    let duration = 180;
    const youtubeId = youtubeVideoId(url);
    try {
      if (!youtubeId) {
        try {
          duration = await probeUrlDuration(url, 'audio');
        } catch {
          showToast('Track added, but the host did not expose its duration. Set the duration manually.', 6500);
        }
      }
      const track = {
        id: uid('music'),
        title: musicUrlTitleInput.value.trim() || (youtubeId ? 'YouTube audio' : 'Remote track'),
        url,
        duration,
        ...(youtubeId ? { sourceType: 'youtube', youtubeId } : {}),
        gainDb: 0,
        fadeIn: 1.5,
        fadeOut: 2
      };
      working.music.push(track);
      selectedMusicId = track.id;
      urlDialog.close();
      renderMusic();
      markDirty();
      if (youtubeId) showToast('YouTube audio added. Set its duration to match the source before going live.', 7000);
    } finally {
      confirmMusicUrlButton.disabled = false;
      confirmMusicUrlButton.textContent = originalLabel;
    }
  });

  for (const input of [musicUrlInput, musicUrlTitleInput]) {
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (!confirmMusicUrlButton.disabled) confirmMusicUrlButton.click();
    });
  }

  previewFrame?.addEventListener('load', () => {
    window.setTimeout(() => {
      postPreview();
      postMonitorSound(previewFrame, previewMonitorAudio);
    }, 150);
  });

  programFrame?.addEventListener('load', () => {
    window.setTimeout(() => postMonitorSound(programFrame, programMonitorAudio), 150);
  });

  previewAudioButton?.addEventListener('click', () => {
    setMonitorAudio('preview', !previewMonitorAudio);
  });

  programAudioButton?.addEventListener('click', () => {
    setMonitorAudio('program', !programMonitorAudio);
  });

  renderMonitorAudioButtons();

  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    if (!saveDraftButton.disabled) void saveDraft();
  });

  async function startWorkspace({ preserveWorking = false } = {}) {
    const valid = await verifySession(sessionId);
    if (!valid) {
      sessionId = '';
      localWrite(SESSION_ID_KEY, '');
      authPanel.hidden = false;
      workspace.hidden = true;
      liveStatus.textContent = 'Sign in required';
      if (authStatus) authStatus.textContent = 'Signed out';
      return;
    }

    const login = valid.login || localRead(SESSION_LOGIN_KEY) || 'GitHub';
    authPanel.hidden = true;
    workspace.hidden = false;
    if (authStatus) authStatus.textContent = login;
    syncActionButtons();
    if (preserveWorking && working) {
      renderSummary();
      setDirty(true);
      void loadVideoLibrary({ quiet: true });
      showToast('Signed back in. Unsaved changes were preserved.');
      return;
    }

    liveStatus.textContent = 'Loading broadcast…';
    try {
      await loadState();
    } catch (error) {
      workspace.hidden = true;
      if (error.status === 401) {
        authPanel.hidden = false;
        liveStatus.textContent = 'Sign in required';
        if (authStatus) authStatus.textContent = 'Session expired';
      } else {
        authPanel.hidden = true;
        liveStatus.textContent = 'Broadcast load failed';
      }
      showToast(`Could not load broadcast state: ${error.message}`, 9000);
    }
  }

  window.addEventListener('beforeunload', event => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  bindWorkspaceTabs();
  activateWorkspace(localRead(WORKSPACE_KEY) || 'rundown');
  window.setInterval(updateOnAirRundown, 1000);

  sessionId = localRead(SESSION_ID_KEY);
  if (sessionId) startWorkspace();
  else {
    authPanel.hidden = false;
    workspace.hidden = true;
    liveStatus.textContent = 'Sign in required';
    if (authStatus) authStatus.textContent = 'Signed out';
  }
})();
