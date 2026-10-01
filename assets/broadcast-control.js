(() => {
  const app = document.querySelector('[data-mfc-control]');
  if (!app) return;

  const authBase = String(app.dataset.authBase || '').replace(/\/$/, '');
  const SESSION_ID_KEY = 'matlock-writer:server-session';
  const SESSION_LOGIN_KEY = 'matlock-writer:server-login';
  const STATE_API_PATH = '/contents/assets/uploads/broadcast.json';
  const WORKSPACE_KEY = 'matlock-broadcast-control:workspace';
  const RECOVERY_PREFIX = 'matlock-broadcast-control:recovery:';
  const LIBRARY_PAGE_SIZE = 40;
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
  const tickerSpeedInput = app.querySelector('[data-ticker-speed]');
  const tickerSpeedOutput = app.querySelector('[data-ticker-speed-output]');
  const musicUploadInput = app.querySelector('[data-music-upload]');
  const addMusicUrlButton = app.querySelector('[data-add-music-url]');
  const urlDialog = app.querySelector('[data-url-dialog]');
  const musicUrlInput = app.querySelector('[data-music-url]');
  const musicUrlTitleInput = app.querySelector('[data-music-url-title]');
  const musicUrlDurationInput = app.querySelector('[data-music-url-duration]');
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
  let previewStartedAt = new Date().toISOString();
  let editVersion = 0;
  let history = [];
  let historyIndex = 0;
  let historyInput = null;
  let historyTime = 0;
  let recoveryKey = '';
  let pendingRecovery = null;
  let recoveryTimer = 0;
  let libraryPage = 0;
  let stopLibraryAdd = false;
  let uploadRunning = false;
  let stopUploads = false;
  let previewMonitorAudio = false;
  let programMonitorAudio = false;
  const videoDurationCache = new Map();
  const mediaRequests = new WeakMap();
  const textLayouts = new Map();

  function renderTextFitHint() {
    const hint = programFields.querySelector('[data-text-fit-hint]');
    const item = currentProgram();
    if (!hint || !item) return;
    const layout = textLayouts.get(item.id);
    const suggest = programFields.querySelector('[data-text-fit-duration]');
    if (!layout || layout.signature !== JSON.stringify([item.type, item.title || '', item.eyebrow || '', item.header || '', item.body || ''])) {
      hint.textContent = String(item.body || '').length + ' body characters. Preview this item to check its layout.';
      if (suggest) suggest.hidden = true;
      return;
    }
    hint.textContent = layout.characters + ' body characters · ' + layout.pages + ' page' + (layout.pages === 1 ? '' : 's')
      + ' in this Preview · ' + (positive(item.duration) / layout.pages).toFixed(1) + ' seconds per page.'
      + (positive(item.duration) < layout.suggestedDuration ? ' Suggested reading time: ' + layout.suggestedDuration + ' seconds.' : '')
      + (layout.smallHeading ? ' Shorten the title for larger text.' : '');
    if (suggest) suggest.hidden = positive(item.duration) >= layout.suggestedDuration;
  }

  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== previewFrame?.contentWindow || event.data?.type !== 'matlock-broadcast-layout') return;
    textLayouts.set(event.data.itemId, event.data); renderTextFitHint();
  });

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

  const fmtInput = seconds => {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  function parseDurationInput(value) {
    const text = String(value ?? '').trim();
    if (!text) return NaN;
    const clock = text.match(/^(\d+):([0-5]?\d)$/);
    if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
    return NaN;
  }
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
      if (node.dataset.workspaceCount in counts) node.textContent = String(counts[node.dataset.workspaceCount] || 0);
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
      if (active) {
        const nav = tab.parentElement;
        const bounds = tab.getBoundingClientRect(), parentBounds = nav.getBoundingClientRect();
        if (bounds.left < parentBounds.left || bounds.right > parentBounds.right) nav.scrollLeft += bounds.left - parentBounds.left;
      }
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
    const speed = clamp(Number(working?.tickerSpeed) || 1, .4, 2.5);
    if (tickerSpeedInput) tickerSpeedInput.value = String(Math.round(speed * 100));
    if (tickerSpeedOutput) tickerSpeedOutput.textContent = Math.round(speed * 100) + '%';
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
    try {
      if (typeof frame.contentWindow.matlockBroadcastSetSound === 'function') { frame.contentWindow.matlockBroadcastSetSound(Boolean(enabled)); return; }
    } catch {}
    frame.contentWindow.postMessage({
      type: 'matlock-broadcast-monitor-sound',
      enabled: Boolean(enabled)
    }, location.origin);
  }

  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.data?.type !== 'matlock-broadcast-playback-status') return;
    if (![previewFrame?.contentWindow, programFrame?.contentWindow].includes(event.source)) return;
    const fromPreview = event.source === previewFrame?.contentWindow;
    if (fromPreview) previewMonitorAudio = Boolean(event.data.soundEnabled);
    else programMonitorAudio = Boolean(event.data.soundEnabled);
    if (previewMonitorAudio && programMonitorAudio) {
      if (fromPreview) { programMonitorAudio = false; postMonitorSound(programFrame, false); }
      else { previewMonitorAudio = false; postMonitorSound(previewFrame, false); }
    }
    renderMonitorAudioButtons();
    if (event.data.blocked) {
      if (event.source === previewFrame?.contentWindow) previewMonitorAudio = false;
      else programMonitorAudio = false;
      renderMonitorAudioButtons();
      showToast('Your browser blocked audio. Click Sound On inside the player once.', 8000);
    }
  });

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
    if (next) {
      app.querySelectorAll('audio, video').forEach(media => media.pause());
    }
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
    const busy = Boolean(busyAction) || uploadRunning;
    saveDraftButton.disabled = !sessionId || !working || !dirty || busy;
    takeLiveButton.disabled = !sessionId || !working || busy;
    if (reloadStateButton) reloadStateButton.disabled = !sessionId || busy;
    app.querySelector('[data-undo]').disabled = !sessionId || busy || historyIndex <= 0;
    app.querySelector('[data-redo]').disabled = !sessionId || busy || historyIndex >= history.length - 1;
    app.querySelector('[data-restore-recovery]').disabled = busy;
    app.querySelector('[data-discard-recovery]').disabled = busy;
  }

  function setDirty(value = true) {
    dirty = Boolean(value);
    if (draftStatus) {
      draftStatus.textContent = dirty ? 'Unsaved' : 'Saved';
      draftStatus.dataset.dirty = dirty ? 'true' : 'false';
    }
    syncActionButtons();
    scheduleRecovery();
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
        signal: AbortSignal.timeout(20000),
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
      signal: options.signal || AbortSignal.timeout(45000),
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
    channel.tickerSpeed = clamp(Number(channel.tickerSpeed) || 1, .4, 2.5);
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

  async function loadState({ offerRecovery = true } = {}) {
    const remote = await githubRequest(`${STATE_API_PATH}?ref=main`);
    stateSha = remote.sha || '';
    const parsed = JSON.parse(decodeBase64Utf8(remote.content || 'e30='));
    fullState = parsed && typeof parsed === 'object' ? parsed : { version: 1 };
    working = normalizedChannel(fullState.draft || fullState.live);
    if (!working.startedAt) working.startedAt = new Date().toISOString();
    selectedProgramId = working.program[0]?.id || '';
    selectedMusicId = working.music[0]?.id || '';
    history = [draftSnapshot()]; historyIndex = 0; historyInput = null;
    pendingRecovery = offerRecovery ? readRecovery() : null;
    if (!offerRecovery) localWrite(recoveryKey, '');
    renderAll();
    setDirty(false);
    renderRecovery();
    let repaired = false;
    for (const item of [...working.program, ...working.music]) {
      const key = item.mediaUrl ? 'mediaUrl' : 'url';
      if (!String(item[key] || '').startsWith('https://api.github.com/')) continue;
      const original = item[key];
      const current = () => [...working.program, ...working.music].includes(item) && item[key] === original;
      try {
        const url = await resolveMediaUrl(original);
        const duration = await probeUrlDuration(url, item.type === 'video' ? 'video' : 'audio');
        if (!current()) continue;
        item[key] = url; item.duration = duration; repaired = true;
      } catch (error) { if (current()) { item.duration = 0; repaired = true; showToast(error.message, 8500); } }
    }
    if (repaired) { renderAll(); markDirty(); showToast('Repaired old media links in the draft. Review and save before taking live.', 8500); }
    void loadVideoLibrary({ quiet: true });
  }


  function draftSnapshot(channel = working) {
    if (!channel) return '';
    const { revision, updatedAt, startedAt, ...content } = normalizedChannel(channel);
    return JSON.stringify(content);
  }

  function savedSnapshot() { return draftSnapshot(fullState?.draft || fullState?.live); }

  function recordHistory() {
    const snapshot = draftSnapshot();
    if (history[historyIndex] === snapshot) return;
    const active = document.activeElement;
    const input = active?.matches('input, textarea') ? active : null;
    const group = input && input === historyInput && Date.now() - historyTime < 750 && historyIndex > 0 && historyIndex === history.length - 1;
    history = history.slice(0, historyIndex + 1);
    if (group) history[historyIndex] = snapshot;
    else { history.push(snapshot); if (history.length > 60) history.shift(); historyIndex = history.length - 1; }
    historyInput = input; historyTime = Date.now();
  }

  function navigateHistory(delta) {
    if (!sessionId || busyAction || uploadRunning || !working) return;
    const next = historyIndex + delta;
    if (next < 0 || next >= history.length) return;
    historyIndex = next; historyInput = null;
    working = normalizedChannel(JSON.parse(history[next]));
    selectedProgramId = working.program.some(row => row.id === selectedProgramId) ? selectedProgramId : working.program[0]?.id || '';
    selectedMusicId = working.music.some(row => row.id === selectedMusicId) ? selectedMusicId : working.music[0]?.id || '';
    editVersion += 1;
    renderAll(); setDirty(draftSnapshot() !== savedSnapshot());
  }

  function readRecovery() {
    if (!recoveryKey) return null;
    try {
      const backup = JSON.parse(localRead(recoveryKey) || 'null');
      if (!backup || backup.version !== 1 || !Array.isArray(backup.channel?.program) || !Array.isArray(backup.channel?.music)) return null;
      if (draftSnapshot(backup.channel) === savedSnapshot()) { localWrite(recoveryKey, ''); return null; }
      return backup;
    } catch { return null; }
  }

  function renderRecovery() {
    const panel = app.querySelector('[data-recovery-panel]');
    panel.hidden = !pendingRecovery;
    if (pendingRecovery) {
      const date = new Date(pendingRecovery.savedAt).toLocaleString();
      app.querySelector('[data-recovery-detail]').textContent = 'Unsaved work from ' + date + '. ' + (pendingRecovery.baseSha !== stateSha ? 'The saved draft has changed since this backup. Restoring replaces only your local preview; review it before saving.' : 'Restore it to Preview or discard the backup.');
    }
  }

  function persistRecovery() {
    window.clearTimeout(recoveryTimer);
    const status = app.querySelector('[data-recovery-status]');
    if (!working || !recoveryKey) return;
    if (pendingRecovery) { status.textContent = 'Choose Restore or Discard above to enable local recovery.'; return; }
    try {
      if (!dirty) { localStorage.removeItem(recoveryKey); status.textContent = 'Draft saved to your account.'; return; }
      localStorage.setItem(recoveryKey, JSON.stringify({ version: 1, baseSha: stateSha, savedAt: new Date().toISOString(), channel: working }));
      status.textContent = 'Unsaved draft backed up in this browser. Save Draft to store it in your account.';
    } catch { status.textContent = 'Local recovery unavailable. Save Draft to keep your changes.'; }
  }

  function scheduleRecovery() {
    window.clearTimeout(recoveryTimer);
    recoveryTimer = window.setTimeout(persistRecovery, 250);
  }

  app.querySelector('[data-undo]').addEventListener('click', () => navigateHistory(-1));
  app.querySelector('[data-redo]').addEventListener('click', () => navigateHistory(1));
  app.querySelector('[data-restore-recovery]').addEventListener('click', () => {
    if (!pendingRecovery || busyAction || uploadRunning) return;
    if (dirty && !window.confirm('Replace current unsaved Preview edits with the recovered draft?')) return;
    working = normalizedChannel(pendingRecovery.channel); pendingRecovery = null;
    selectedProgramId = working.program[0]?.id || ''; selectedMusicId = working.music[0]?.id || '';
    renderRecovery(); renderAll(); markDirty();
    showToast('Recovered into Preview. Review it, then Save Draft. Program is unchanged.');
  });
  app.querySelector('[data-discard-recovery]').addEventListener('click', () => {
    if (busyAction || uploadRunning) return;
    pendingRecovery = null; localWrite(recoveryKey, ''); renderRecovery(); persistRecovery();
  });
  window.addEventListener('pagehide', persistRecovery);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persistRecovery(); });

  function validNewsVideo(item) {
    return /^[A-Za-z0-9_-]{11}$/.test(item.youtubeId || '')
      && item.mediaUrl === 'https://www.youtube.com/watch?v=' + item.youtubeId
      && Number(item.sourceDuration) > 180 && Number(item.sourceDuration) <= 86400
      && Number(item.duration) > 0 && Number(item.duration) <= Number(item.sourceDuration);
  }

  // The news browser receives only draft membership and a narrowly scoped add action.
  window.matlockBroadcastNews = {
    snapshot: () => ({ program: (working?.program || []).map(item => ({ sourceUrl: item.sourceUrl, mediaUrl: item.mediaUrl })), ticker: [...(working?.ticker || [])] }),
    add: (news, target) => {
      if (!working || busyAction || uploadRunning) { showToast('Wait for the current action to finish.'); return false; }
      let url;
      try { url = new URL(news.url); if (!['https:', 'http:'].includes(url.protocol)) return false; } catch { return false; }
      const title = String(news.title || '').trim().slice(0, 240);
      const source = String(news.source || 'MMA news').slice(0, 80);
      if (!title) return false;
      if (target === 'ticker' && news.kind === 'article') {
        const text = title + ' — ' + source;
        if (working.ticker.includes(text)) return false;
        working.ticker.push(text); tickerInput.value = working.ticker.join('\n'); renderTickerPreview();
      } else {
        if (working.program.some(item => item.sourceUrl === url.href || item.mediaUrl === url.href)) return false;
        const item = { id: uid('news'), type: 'headline', title, body: String(news.excerpt || '').slice(0, 220),
          eyebrow: source, header: 'MMA NEWS', duration: 20, source, sourceUrl: url.href };
        if (news.kind === 'video') {
          Object.assign(item, { type: 'youtube', mediaUrl: url.href, youtubeId: news.id,
            duration: Number(news.duration), sourceDuration: Number(news.duration), videoAudio: true, musicBehavior: 'duck' });
          if (!validNewsVideo(item) || /#shorts\b/i.test(title)) { showToast('Choose a video over three minutes from News Pool.'); return false; }
        } else if (news.kind !== 'article') return false;
        working.program.push(item); selectedProgramId = item.id; renderProgram();
      }
      markDirty(); showToast('Added to Preview. Review in Rundown, then Save Draft.'); return true;
    }
  };

  function readinessIssues() {
    const issues = [];
    for (const [kind, items] of [['program', working?.program || []], ['music', working?.music || []]]) {
      items.forEach((item, index) => {
        const reasons = [];
        if (!Number.isFinite(Number(item.duration)) || Number(item.duration) <= 0) reasons.push('set duration in min:sec');
        const needsMedia = kind === 'music' || ['video', 'image', 'youtube'].includes(item.type);
        const url = kind === 'music' ? item.url : item.mediaUrl;
        if (needsMedia && !url) reasons.push('add a file or URL');
        else if (kind === 'program' && item.type === 'youtube') {
          if (!validNewsVideo(item)) reasons.push('choose a non-Short video from News Pool');
        } else if (kind === 'music' && youtubeVideoId(url)) {
          if (!String(item.youtubeId || youtubeVideoId(url))) reasons.push('use a valid YouTube video link');
        } else if (url && !isDirectUrl(url)) reasons.push('replace the page/API link with a direct file');
        if (reasons.length) issues.push({ kind, id: item.id, title: item.title || (kind === 'music' ? 'Track ' : 'Block ') + (index + 1), reasons });
      });
    }
    return issues;
  }

  function renderReadiness() {
    return readinessIssues();
  }

  function totalProgramDuration() {
    return (working?.program || []).reduce((sum, item) => sum + positive(item.duration), 0);
  }

  function totalMusicDuration() {
    return (working?.music || []).reduce((sum, item) => sum + positive(item.duration), 0);
  }

  function markDirty() {
    if (!working) return;
    editVersion += 1;
    recordHistory();
    working.updatedAt = new Date().toISOString();
    setDirty(draftSnapshot() !== savedSnapshot());
    renderSummary();
    postPreview();
  }

  function postPreview() {
    if (!previewFrame?.contentWindow || !working) return;
    const channel = clone(working);
    channel.startedAt = previewStartedAt;
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
    renderReadiness();
    app.dispatchEvent(new Event('matlock-broadcast-draft-change'));
  }

  function displayVideoName(name) {
    return String(name || 'Uploaded video')
      .replace(/^broadcast-(?:video|audio)-/i, '')
      .replace(/-\d{17}(?=\.(?:mp4|m4v|webm|mp3|m4a|aac|wav|ogg|opus|flac)$)/i, '')
      .replace(/\.(?:mp4|m4v|webm|mp3|m4a|aac|wav|ogg|opus|flac)$/i, '')
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
      releaseTag: String(asset?.releaseTag || release?.tag_name || ''),
      duration: positive(asset?.duration)
    };
  }

  function assetKind(asset) {
    return /^broadcast-audio-/i.test(asset?.name || '') ? 'audio' : 'video';
  }

  function isBroadcastVideoAsset(asset) {
    return /^broadcast-(?:video|audio)-.*\.(?:mp4|m4v|webm|mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(asset?.name || '');
  }

  function programUsesVideo(program, url) {
    const target = String(url || '');
    return Boolean(target) && Array.isArray(program) && program.some(item =>
      String(item?.mediaUrl || item?.url || '') === target
    );
  }

  function videoUsage(asset) {
    const url = String(asset?.url || '');
    const draft = programUsesVideo([...(working?.program || []), ...(working?.music || [])], url);
    const savedDraft = programUsesVideo([...(fullState?.draft?.program || []), ...(fullState?.draft?.music || [])], url);
    const live = programUsesVideo([...(fullState?.live?.program || []), ...(fullState?.live?.music || [])], url);
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
      const item = [...(channel?.mediaLibrary || []), ...(channel?.program || []), ...(channel?.music || [])].find(row =>
        String(row?.mediaUrl || row?.url || '') === target
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
    setMonitorAudio('preview', false);
    setMonitorAudio('program', false);
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
        if (filter === 'video' || filter === 'audio') return assetKind(asset) === filter;
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
    const pageCount = Math.max(1, Math.ceil(visible.length / LIBRARY_PAGE_SIZE));
    libraryPage = Math.max(0, Math.min(libraryPage, pageCount - 1));
    const pager = app.querySelector('[data-library-pages]'); pager.hidden = visible.length <= LIBRARY_PAGE_SIZE;
    app.querySelector('[data-library-page-label]').textContent = 'Page ' + (libraryPage + 1) + ' of ' + pageCount;
    app.querySelector('[data-library-prev]').disabled = libraryPage === 0;
    app.querySelector('[data-library-next]').disabled = libraryPage >= pageCount - 1;
    const pageAssets = visible.slice(libraryPage * LIBRARY_PAGE_SIZE, (libraryPage + 1) * LIBRARY_PAGE_SIZE);
    const totalBytes = videoLibraryAssets.reduce((sum, asset) => sum + (Number(asset.size) || 0), 0);
    const mode = videoLibraryReadOnly ? ' · public index fallback' : '';
    videoLibrarySummary.textContent = videoLibraryLoading
      ? 'Loading media library…'
      : `${visible.length === videoLibraryAssets.length ? videoLibraryAssets.length : `${visible.length} of ${videoLibraryAssets.length}`} media file${videoLibraryAssets.length === 1 ? '' : 's'} · ${formatBytes(totalBytes)}${mode}`;
    updateWorkspaceCounts();
  
    videoLibraryList.replaceChildren();
    if (videoLibraryLoading && !videoLibraryAssets.length) {
      const empty = document.createElement('p');
      empty.className = 'mfc-empty';
      empty.textContent = 'Loading uploaded media…';
      videoLibraryList.append(empty);
      return;
    }
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'mfc-empty';
      empty.textContent = (query || filter !== 'all') ? 'No uploaded media match the current search or filter.' : 'Upload videos and music to start your loop.';
      videoLibraryList.append(empty);
      return;
    }
  
    for (const asset of pageAssets) {
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
        assetKind(asset) === 'audio' ? 'Music' : 'Video',
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
      const addButton = smallButton(assetKind(asset) === 'audio' ? 'Add to Music' : 'Add to Program', async () => {
        if (busyAction || uploadRunning) return showToast('Wait for the current operation to finish.');
        addButton.disabled = true;
        setBusy('library');
        try { await addAssetToDraft(asset); showToast('Added to the draft loop.'); }
        catch (error) { showToast(error.message, 9000); }
        finally { addButton.disabled = false; setBusy(''); }
      });

      const copyButton = smallButton('Copy URL', async () => {
        try {
          await navigator.clipboard.writeText(asset.url);
          showToast('Media URL copied.');
        } catch {
          showToast(asset.url, 9000);
        }
      }, 'mfc-button-ghost');
  
      const releaseButton = smallButton('GitHub Release', () => {
        if (!asset.releaseTag) return;
        window.open(`https://github.com/MatlockFT/Matlock/releases/tag/${encodeURIComponent(asset.releaseTag)}`, '_blank', 'noopener,noreferrer');
      }, 'mfc-button-ghost');
      releaseButton.hidden = !asset.releaseTag;

      const deleteButton = smallButton('Delete', async () => {
        if (busyAction || uploadRunning) return showToast('Wait for the current operation to finish.');
        const currentUsage = videoUsage(asset);
        const warning = currentUsage.blocked
          ? `"${displayVideoName(asset.name)}" is currently referenced by ${[
              currentUsage.live ? 'the live Program' : '',
              currentUsage.draft || currentUsage.savedDraft ? 'the draft' : ''
            ].filter(Boolean).join(' and ')}. Delete it anyway? It will be removed from those rundowns first.`
          : `Permanently delete "${displayVideoName(asset.name)}"? This cannot be undone.`;
        if (currentUsage.blocked) return showToast('Remove this media from saved and live programming before deleting it.');
        if (!window.confirm(warning)) return;

        deleteButton.disabled = true;
        deleteButton.textContent = 'Deleting…';
        try {
          await queueBroadcastVideoDelete(asset);
          showToast('Delete queued. GitHub is removing the uploaded video…', 9000);
          const removed = await waitForVideoDeletion(asset.id);
          if (removed) {
            videoLibraryAssets = videoLibraryAssets.filter(row => row.id !== asset.id);
            for (const channel of [working, fullState?.draft, fullState?.live]) {
              if (channel?.mediaLibrary) channel.mediaLibrary = channel.mediaLibrary.filter(row => row.url !== asset.url);
            }
            markDirty();
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
      deleteButton.disabled = !asset.id || usage.blocked;
      deleteButton.hidden = assetKind(asset) === 'audio';
      if (usage.blocked) deleteButton.title = 'Remove from the draft, save, and take that change live before deleting the file.';
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
        cache: 'no-store', signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) throw new Error(`GitHub video library returned ${response.status}.`);
      const releases = await response.json();
      if (!Array.isArray(releases) || !releases.length) break;
      for (const release of releases) {
        if (!String(release?.tag_name || '').startsWith('writer-media-')) continue;
        const releaseAssets = [];
        for (let assetPage = 1; ; assetPage += 1) {
          const result = await fetch('https://api.github.com/repos/MatlockFT/Matlock/releases/' + release.id + '/assets?per_page=100&page=' + assetPage, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
          if (!result.ok) throw new Error('Could not load all media assets (' + result.status + ').');
          const rows = await result.json();
          releaseAssets.push(...rows);
          if (rows.length < 100) break;
        }
        for (const raw of releaseAssets) {
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
        // Compatibility with the older video-only auth bridge during rollout.
        if (!data.mediaKinds?.includes('audio')) {
          const publicAssets = await fetchPublicVideoLibrary();
          videoLibraryAssets = [...new Map([...videoLibraryAssets, ...publicAssets].map(asset => [asset.url, asset])).values()];
        }
        videoLibraryReadOnly = false;
      } catch (error) {
        if (error.status === 401 || !sessionId) throw error;
        videoLibraryAssets = await fetchPublicVideoLibrary();
        videoLibraryReadOnly = true;
        if (!quiet) showToast('Video library loaded from GitHub’s public index. Delete still works through the cleanup queue.', 7000);
      }
    } catch (error) {
      showToast(`Could not load media library: ${error.message}. You can retry Refresh.`, 8000);
    } finally {
      videoLibraryLoading = false;
      if (videoLibraryRefreshButton) videoLibraryRefreshButton.disabled = false;
      const remembered = [...(working?.mediaLibrary || [])];
      videoLibraryAssets = [...new Map([...remembered, ...videoLibraryAssets].map(asset => [asset.url, asset])).values()];
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
      if (item.type === 'video' || item.type === 'youtube') {
        duration.textContent = positive(item.duration) ? fmt(item.duration) : 'NEEDS DURATION';
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

    if (!['image', 'video', 'youtube'].includes(item.type)) {
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
      const hint = document.createElement('p'); hint.className = 'mfc-field-note mfc-field-wide'; hint.dataset.textFitHint = '';
      const suggest = smallButton('Use suggested reading time', () => {
        const layout = textLayouts.get(item.id);
        if (!layout || !working.program.includes(item)) return;
        item.duration = clamp(layout.suggestedDuration, 1, 3600); renderProgram(); markDirty();
      }, 'mfc-button-ghost');
      suggest.dataset.textFitDuration = ''; suggest.hidden = true;
      form.append(hint, buttonRow(suggest));
    }

    if (item.sourceUrl) {
      const source = document.createElement('a');
      try {
        const url = new URL(item.sourceUrl);
        if (['https:', 'http:'].includes(url.protocol)) {
          source.href = url.href; source.target = '_blank'; source.rel = 'noopener noreferrer';
          source.textContent = 'Original source: ' + (item.source || 'Open source'); form.append(source);
        }
      } catch {}
    }
    if (item.type === 'youtube') {
      form.append(field('Playback duration (min:sec)', 'duration', {
        value: fmtInput(item.duration), live: false,
        onChange: (value, input) => {
          const seconds = parseDurationInput(value);
          if (!Number.isFinite(seconds) || seconds <= 0 || seconds > item.sourceDuration) {
            input.value = fmtInput(item.duration); return showToast('Use a duration between 1 second and the original video length.');
          }
          item.duration = seconds; renderProgram(); markDirty();
        }
      }).wrap);
      form.append(field('Video audio', 'videoAudio', { type: 'select', value: item.videoAudio === false ? 'off' : 'on',
        options: [{ value: 'on', label: 'Use video audio' }, { value: 'off', label: 'Mute video audio' }],
        onChange: value => { item.videoAudio = value !== 'off'; markDirty(); } }).wrap);
      form.append(field('Music during this video', 'musicBehavior', { type: 'select', value: item.musicBehavior || 'duck',
        options: [{ value: 'duck', label: 'Duck music' }, { value: 'mute', label: 'Mute music' }, { value: 'keep', label: 'Keep music playing' }],
        onChange: value => { item.musicBehavior = value; markDirty(); } }).wrap);
      const note = document.createElement('p'); note.className = 'mfc-field-note';
      note.textContent = 'Original video: ' + fmt(item.sourceDuration) + '. Plays from the beginning; shorten the duration to trim the end. YouTube may restrict embedding or autoplay. Unavailable videos are skipped.';
      form.append(note);
    }
    if (item.type === 'image' || item.type === 'video') {
      const mediaField = field(item.type === 'video' ? 'Video URL' : 'Image URL', 'mediaUrl', {
        type: 'url',
        value: item.mediaUrl || '',
        placeholder: 'https://…',
        wide: true,
        live: false,
        onChange: async value => {
          const request = {}; mediaRequests.set(item, request);
          const current = () => working.program.includes(item) && mediaRequests.get(item) === request;
          let url;
          try { url = await resolveMediaUrl(value.trim()); }
          catch (error) { if (current()) showToast(error.message, 8500); return; }
          if (!current()) return;
          item.mediaUrl = url;
          if (item.type === 'video') item.duration = 0;
          markDirty();
          if (item.type === 'video' && url) {
            try {
              const duration = await probeUrlDuration(url, 'video');
              if (!current() || item.mediaUrl !== url) return;
              item.duration = duration;
              showToast('Video duration detected: ' + fmt(duration));
            } catch {
              if (!current()) return;
              showToast('Could not read video duration. Upload the file or enter its duration manually.', 7000);
            }
          }
          if (!current()) return;
          renderProgram(); markDirty(); renderVideoLibrary();
        }
      });
      form.append(mediaField.wrap);

      if (item.type === 'video') {
        const durationField = field('Video duration', 'duration', {
          value: positive(item.duration) ? fmtInput(item.duration) : '',
          placeholder: 'Read duration first',
          live: false,
          onChange: (value, input) => {
            const seconds = parseDurationInput(value);
            if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) { input.value = fmtInput(item.duration); return showToast('Enter a valid min:sec duration.'); }
            item.duration = seconds; renderProgram(); markDirty();
          }
        });
        form.append(durationField.wrap);

        const upload = document.createElement('input');
        upload.type = 'file';
        upload.accept = '.mp4,.webm,.m4v';
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
            const url = item.mediaUrl;
            const duration = await probeUrlDuration(url, 'video');
            if (!working.program.includes(item) || item.mediaUrl !== url) return;
            item.duration = duration;
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
        upload.addEventListener('change', () => {
          void uploadFiles(upload.files, 'video', item);
          upload.value = '';
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

    if (item.type === 'image') {
      form.append(field('Image duration (seconds)', 'duration', { type: 'number', min: 1, max: 3600, value: item.duration || 20, live: false,
        onChange: value => { item.duration = clamp(value, 1, 3600); renderProgram(); markDirty(); } }).wrap);
    }
    const playSelected = smallButton('Preview this item', () => {
      const index = working.program.indexOf(item);
      const offset = working.program.slice(0, index).reduce((sum, row) => sum + positive(row.duration), 0);
      previewStartedAt = new Date(Date.now() - offset * 1000).toISOString();
      postPreview();
    }, 'mfc-button-ghost');
    form.append(buttonRow(playSelected));
    const programIndex = working.program.findIndex(row => row.id === item.id);
    const moveLeft = smallButton('← Move left', () => moveProgram(item.id, -1), 'mfc-button-ghost');
    const moveRight = smallButton('Move right →', () => moveProgram(item.id, 1), 'mfc-button-ghost');
    moveLeft.disabled = programIndex <= 0;
    moveRight.disabled = programIndex < 0 || programIndex >= working.program.length - 1;
    form.append(buttonRow(moveLeft, moveRight));
    programFields.append(form);
    renderTextFitHint();
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
        video: { header: 'MMA VIDEO', eyebrow: 'VIDEO', title: 'VIDEO', mediaUrl: '', duration: 0, videoAudio: true },
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
    const urlField = field('Audio / YouTube URL', 'url', {
      type: 'url',
      value: track.url || '',
      wide: true,
      live: false,
      onChange: async value => {
        const request = {}; mediaRequests.set(track, request);
        const current = () => working.music.includes(track) && mediaRequests.get(track) === request;
        const raw = value.trim();
        const youtubeId = youtubeVideoId(raw);
        let url = '';
        try {
          url = youtubeId ? new URL(raw).href : await resolveMediaUrl(raw);
        } catch (error) {
          if (current()) showToast(error.message, 8500);
          return;
        }
        if (!current()) return;

        track.url = url;
        track.duration = 0;
        if (youtubeId) {
          track.sourceType = 'youtube';
          track.youtubeId = youtubeId;
        } else {
          delete track.sourceType;
          delete track.youtubeId;
        }
        markDirty();

        try {
          const metadata = youtubeId ? await probeYoutubeUrl(url) : { duration: await probeUrlDuration(url, 'audio') };
          if (!current() || track.url !== url) return;
          track.duration = Number(metadata.duration) || 0;
          if (youtubeId && !track.title && metadata.title) track.title = String(metadata.title);
        } catch {
          if (!current()) return;
          showToast(youtubeId
            ? 'Could not read this YouTube duration. Enter the song length manually.'
            : 'Could not read duration. Check the direct file or enter its duration manually.', 6500);
        }
        if (!current()) return;
        renderMusic();
        renderMusicEditor();
        markDirty();
      }
    });
    const durationField = field('Duration (min:sec)', 'duration', {
      type: 'text',
      value: positive(track.duration) ? fmtInput(track.duration) : '',
      placeholder: '3:30',
      live: false,
      onChange: (value, input) => {
        const seconds = parseDurationInput(value);
        if (!Number.isFinite(seconds) || seconds < 1 || seconds > 86400) {
          showToast('Use min:sec for duration, for example 3:30.', 5500);
          input.value = positive(track.duration) ? fmtInput(track.duration) : '';
          return;
        }
        track.duration = seconds;
        input.value = fmtInput(seconds);
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
    const detectButton = smallButton('Read duration', async () => {
      if (!track.url) return showToast('Add an audio or YouTube URL first.');
      try {
        const url = track.url;
        const youtubeId = String(track.youtubeId || youtubeVideoId(url) || '');
        const metadata = youtubeId ? await probeYoutubeUrl(url) : { duration: await probeUrlDuration(url, 'audio') };
        if (!working.music.includes(track) || track.url !== url) return;
        track.duration = Number(metadata.duration) || 0;
        if (youtubeId) {
          track.sourceType = 'youtube';
          track.youtubeId = youtubeId;
          if ((!track.title || track.title === 'YouTube music') && metadata.title) track.title = String(metadata.title);
        }
        renderMusic();
        renderMusicEditor();
        markDirty();
        showToast(`Duration detected: ${fmt(track.duration)}`);
      } catch {
        showToast('Could not read duration from that source. Enter the track length manually.', 6500);
      }
    }, 'mfc-button-ghost');

    if (youtubeVideoId(track.url) || track.youtubeId) {
      const auditionNote = document.createElement('p');
      auditionNote.className = 'mfc-track-help';
      auditionNote.textContent = 'YouTube audio plays through the Preview and Program monitors. Turn Listen on to audition this track in context.';
      form.append(auditionNote);
    } else {
      const audition = document.createElement('audio');
      audition.controls = true;
      audition.preload = 'none';
      audition.src = track.url || '';
      audition.className = 'mfc-track-audition';
      audition.setAttribute('aria-label', 'Audition selected music');
      audition.addEventListener('play', () => { setMonitorAudio('preview', false); setMonitorAudio('program', false); });
      form.append(audition);
    }
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

  tickerSpeedInput?.addEventListener('input', () => {
    if (!working) return;
    working.tickerSpeed = clamp(Number(tickerSpeedInput.value) / 100, .4, 2.5);
    if (tickerSpeedOutput) tickerSpeedOutput.textContent = Math.round(working.tickerSpeed * 100) + '%';
    markDirty();
  });

  function renderAll() {
    renderSummary();
    renderProgram();
    renderMusic();
    renderAudioSettings();
    tickerInput.value = (working.ticker || []).join('\n');
    renderTickerPreview();
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
    if (!working || !dirty || busyAction || uploadRunning) return;
    const originalLabel = saveDraftButton.textContent;
    const savingVersion = editVersion;
    setBusy('save');
    saveDraftButton.textContent = 'Saving…';
    try {
      const now = new Date().toISOString();
      working.updatedAt = now;
      working.revision = `draft-${Date.now()}`;
      const nextState = {
        ...(fullState || {}),
        version: 1,
        updatedAt: now,
        draft: clone(working)
      };
      await writeState(nextState, 'Update broadcast draft [skip ci]');
      fullState = nextState;
      setDirty(editVersion !== savingVersion);
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
    const issues = readinessIssues();
    if (issues.length) {
      const first = issues[0];
      activateWorkspace(first.kind === 'music' ? 'audio' : 'rundown');
      if (first.kind === 'music') {
        selectedMusicId = first.id;
        renderMusic();
      } else {
        selectedProgramId = first.id;
        renderProgram();
      }
      showToast('Cannot Take Live: ' + first.title + ' — ' + first.reasons.join('; ') + '.', 8500);
      return false;
    }
    if (!program.length) {
      return window.confirm('The rundown is empty. Take an empty standby program live?');
    }
    return true;
  }

  async function takeLive() {
    if (!working || busyAction || uploadRunning || !validateWorkingForLive()) return;
    const originalLabel = takeLiveButton.textContent;
    const savingVersion = editVersion;
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
      const nextState = {
        ...(fullState || {}),
        version: 1,
        updatedAt: now,
        draft: clone(working),
        live
      };
      await writeState(nextState, 'Take broadcast programming live [skip ci]');
      fullState = nextState;
      setDirty(editVersion !== savingVersion);
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
    if (!sessionId || busyAction || uploadRunning) return;
    if (dirty && !window.confirm('Discard unsaved Broadcast Control changes and reload the saved draft?')) return;
    const originalLabel = reloadStateButton.textContent;
    setBusy('reload');
    reloadStateButton.textContent = 'Reloading…';
    liveStatus.textContent = 'Reloading broadcast…';
    try {
      await loadState({ offerRecovery: false });
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
      const finish = error => {
        clearTimeout(timer);
        element.onloadedmetadata = element.onerror = null;
        const duration = Number(element.duration);
        if (error || !Number.isFinite(duration) || duration <= 0) reject(new Error('Cannot read playable media. Export MP4 with H.264/AAC or MP3/M4A audio, then retry.'));
        else resolve(duration);
      };
      const timer = window.setTimeout(() => finish(true), 20000);
      element.onloadedmetadata = () => finish(false);
      element.onerror = () => finish(true);
      element.load();
    });
  }

  function isDirectUrl(value) {
    try {
      const url = new URL(value, location.origin);
      return ['http:', 'https:'].includes(url.protocol) && !youtubeVideoId(value)
        && !(url.hostname === 'api.github.com' && /\/releases\/assets\//.test(url.pathname))
        && !(url.hostname === 'github.com' && !url.pathname.includes('/releases/download/') && !url.pathname.includes('/raw/'));
    } catch { return false; }
  }

  async function resolveMediaUrl(value) {
    if (!value) return '';
    const url = new URL(value, location.origin);
    if (url.hostname === 'api.github.com' && /^\/repos\/MatlockFT\/Matlock\/releases\/assets\/\d+$/i.test(url.pathname)) {
      const response = await fetch(url.href, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Could not resolve this GitHub asset. Choose it from Media instead.');
      const data = await response.json();
      if (!data.browser_download_url) throw new Error('This GitHub asset has no playable download URL.');
      return data.browser_download_url;
    }
    if (!isDirectUrl(value)) throw new Error('Use a direct media file URL or upload the file. YouTube/watch pages are not media files.');
    return url.href;
  }

  async function probeUrlDuration(url, kind = 'audio') {
    const element = document.createElement(kind === 'video' ? 'video' : 'audio');
    element.preload = 'metadata';
    element.src = url;
    try { return await probeMedia(element); }
    finally { element.removeAttribute('src'); element.load(); }
  }

  async function probeYoutubeUrl(value) {
    const id = youtubeVideoId(value);
    if (!id) throw new Error('That is not a valid YouTube video URL.');
    if (typeof window.matlockYoutubeProbe !== 'function') throw new Error('YouTube player is still loading. Try again in a moment.');
    return window.matlockYoutubeProbe(id);
  }

  async function probeFileDuration(file) {
    const url = URL.createObjectURL(file);
    try { return await probeUrlDuration(url, /\.(mp4|m4v|webm)$/i.test(file.name) ? 'video' : 'audio'); }
    finally { URL.revokeObjectURL(url); }
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
      signal: options.signal || AbortSignal.timeout(65000),
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
    const fileType = ({ mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac' })[safeExtension(file)] || file.type || 'application/octet-stream';
    const chunkCount = Math.ceil(file.size / CHUNK_BYTES);
    let uploaded = 0;

    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * CHUNK_BYTES;
      const end = Math.min(file.size, start + CHUNK_BYTES);
      const chunk = file.slice(start, end);
      await retryMediaBridge('/api/writer/media-chunk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Upload-Id': uploadId,
          'X-Chunk-Index': String(index),
          'X-Chunk-Count': String(chunkCount),
          'X-File-Size': String(file.size),
          'X-File-Type': fileType,
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
        fileType: fileType
      })
    });

    const started = Date.now();
    while (Date.now() - started < STATUS_TIMEOUT_MS) {
      const status = await retryMediaBridge(`/api/writer/media-status?uploadId=${encodeURIComponent(uploadId)}`);
      if (status.state === 'complete' && status.url) {
        setUploadProgress(100, `${file.name} uploaded.`);
        return { url: status.url, name: assetName, id: Number(status.assetId) || 0, size: file.size, contentType: fileType, createdAt: new Date().toISOString() };
      }
      if (status.state === 'error') throw new Error(status.error || 'GitHub Release upload failed.');
      if (status.state === 'publishing') setUploadProgress(94, `Publishing ${file.name}…`);
      else if (status.state === 'preparing') setUploadProgress(87, `Preparing ${file.name}…`);
      await new Promise(resolve => window.setTimeout(resolve, STATUS_POLL_MS));
    }
    throw new Error('Media upload timed out.');
  }

  async function retryMediaBridge(path, options) {
    for (let attempt = 0; ; attempt += 1) {
      try { return await mediaBridge(path, { ...options, signal: AbortSignal.timeout(60000) }); }
      catch (error) {
        if (attempt >= 2 || (error.status && error.status !== 429 && error.status < 500)) throw error;
        await new Promise(resolve => setTimeout(resolve, 800 * 2 ** attempt));
      }
    }
  }

  function rememberAsset(asset, duration, { render = true, changed = true } = {}) {
    asset.duration = duration;
    videoDurationCache.set(asset.url, duration);
    working.mediaLibrary = [...(working.mediaLibrary || []).filter(row => row.url !== asset.url), asset];
    videoLibraryAssets = [...videoLibraryAssets.filter(row => row.url !== asset.url), asset];
    if (changed) markDirty();
    if (render) renderVideoLibrary();
  }

  async function addAssetToDraft(asset, targetItem = null, { render = true } = {}) {
    const kind = assetKind(asset);
    const duration = knownVideoDuration(asset.url) || Number(asset.duration) || await probeUrlDuration(asset.url, kind);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Read a valid media duration before adding this file.');
    rememberAsset(asset, duration, { render: false, changed: false });
    if (kind === 'audio') {
      const track = { id: uid('music'), title: displayVideoName(asset.name), url: asset.url, duration, gainDb: 0, fadeIn: 0, fadeOut: 0 };
      working.music.push(track);
      selectedMusicId = track.id;
      if (render) renderMusic();
    } else {
      const item = { id: targetItem?.id || uid('program'), type: 'video', header: 'MMA VIDEO', eyebrow: 'VIDEO', title: displayVideoName(asset.name), mediaUrl: asset.url, duration, videoAudio: true };
      if (targetItem && working.program.includes(targetItem)) Object.assign(targetItem, item);
      else working.program.push(item);
      selectedProgramId = item.id;
      if (render) renderProgram();
    }
    markDirty();
    if (render) renderVideoLibrary();
  }

  async function uploadFiles(fileList, forceKind = '', targetItem = null) {
    if (uploadRunning || busyAction) return showToast('Wait for the current upload or save to finish.');
    const files = Array.from(fileList || []);
    if (!files.length || !working) return;
    uploadRunning = true;
    stopUploads = false;
    syncActionButtons();
    const queue = app.querySelector('[data-upload-queue]');
    const results = app.querySelector('[data-upload-results]');
    const cancel = app.querySelector('[data-cancel-uploads]');
    queue.hidden = false;
    cancel.disabled = false;
    results.replaceChildren();
    const rows = files.map(file => {
      const row = document.createElement('li');
      row.textContent = file.name + ' — Waiting';
      results.append(row);
      return row;
    });
    let completed = 0;
    const autoAdd = targetItem || forceKind === 'audio' || app.querySelector('[data-upload-auto-add]').checked;
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index], row = rows[index];
        if (stopUploads || !sessionId) { row.textContent = file.name + ' — Not uploaded'; continue; }
        try {
          const ext = safeExtension(file);
          if (!['mp4','m4v','webm','mp3','m4a','aac','wav','ogg','opus','flac'].includes(ext)) throw new Error('Unsupported format. Use MP4/WebM video or MP3/M4A audio.');
          if (!file.size || file.size >= 2 * 1024 ** 3) throw new Error('Choose a non-empty file under 2 GiB.');
          const kind = forceKind || (['mp4','m4v','webm'].includes(ext) ? 'video' : 'audio');
          if (kind === 'video' && !['mp4','m4v','webm'].includes(ext)) throw new Error('Choose an MP4, M4V or WebM video.');
          row.textContent = file.name + ' — Checking duration and format…';
          const duration = await probeFileDuration(file);
          row.textContent = file.name + ' — Uploading (' + fmt(duration) + ')…';
          const asset = await uploadMediaFile(file, kind);
          rememberAsset(asset, duration);
          if (autoAdd) await addAssetToDraft(asset, targetItem);
          completed += 1;
          row.textContent = file.name + (autoAdd ? ' — Ready in draft · ' : ' — Ready in library · ') + fmt(duration);
        } catch (error) {
          row.textContent = file.name + ' — ' + error.message + ' ';
          row.append(smallButton('Retry', () => void uploadFiles([file], forceKind, targetItem), 'mfc-button-ghost'));
        }
      }
      showToast(completed + ' of ' + files.length + ' uploaded. Review the queue, then Save Draft or Take Preview Live.', 8000);
    } finally {
      uploadRunning = false;
      cancel.disabled = true;
      syncActionButtons();
      clearUploadProgress();
      videoLibraryUploadInput.value = '';
      musicUploadInput.value = '';
    }
  }

  app.querySelector('[data-cancel-uploads]').addEventListener('click', () => { stopUploads = true; });
  app.querySelector('[data-preview-restart]').addEventListener('click', () => { previewStartedAt = new Date().toISOString(); postPreview(); });
  app.querySelector('[data-library-stop]').addEventListener('click', () => { stopLibraryAdd = true; });
  app.querySelector('[data-library-add-all]').addEventListener('click', async event => {
    const button = event.currentTarget, stop = app.querySelector('[data-library-stop]');
    if (uploadRunning || busyAction) return showToast('Wait for the current operation to finish.');
    const assets = videoLibraryAssets.filter(asset => !videoUsage(asset).draft);
    button.disabled = true; stop.hidden = false; stopLibraryAdd = false;
    setBusy('library');
    const failures = []; let added = 0;
    try {
      for (const [index, asset] of assets.entries()) {
        if (stopLibraryAdd || !sessionId) break;
        app.querySelector('[data-library-add-status]').textContent = 'Adding ' + (index + 1) + ' of ' + assets.length + '…';
        try { await addAssetToDraft(asset, null, { render: false }); added += 1; }
        catch { failures.push(displayVideoName(asset.name)); }
        await new Promise(resolve => window.setTimeout(resolve, 0));
      }
    } finally {
      button.disabled = false; stop.hidden = true;
      app.querySelector('[data-library-add-status]').textContent = added + ' of ' + assets.length + ' files added.';
      setBusy(''); renderAll(); persistRecovery();
    }
    showToast(added + ' files added.' + (stopLibraryAdd ? ' Stopped; remaining files stay in the library.' : '') + (failures.length ? ' Could not read ' + failures.length + ': ' + failures.slice(0, 4).join(', ') + '. Try these individually.' : ''), 9000);
  });

  function bindVideoLibraryHandlers() {
    const resetPage = () => { libraryPage = 0; renderVideoLibrary(); };
    videoLibrarySearch?.addEventListener('input', resetPage);
    videoLibraryFilter?.addEventListener('change', resetPage);
    videoLibrarySort?.addEventListener('change', resetPage);
    for (const [selector, delta] of [['[data-library-prev]', -1], ['[data-library-next]', 1]]) {
      app.querySelector(selector).addEventListener('click', () => {
        libraryPage += delta; renderVideoLibrary();
        videoLibraryPanel.scrollIntoView({ block: 'start' });
      });
    }
  
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
      void uploadFiles(videoLibraryUploadInput.files);
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
        void uploadFiles(event.dataTransfer.files);
      });
    }
  }

  bindVideoLibraryHandlers();

  musicUploadInput.addEventListener('change', () => { void uploadFiles(musicUploadInput.files, 'audio'); });

  addMusicUrlButton.addEventListener('click', () => {
    if (musicUploadInput.disabled) return showToast('Wait for the current media upload to finish.');
    musicUrlInput.value = '';
    musicUrlTitleInput.value = '';
    if (musicUrlDurationInput) musicUrlDurationInput.value = '';
    urlDialog.showModal();
  });

  confirmMusicUrlButton.addEventListener('click', async () => {
    if (!musicUrlInput.reportValidity() || !musicUrlInput.value.trim()) return;
    confirmMusicUrlButton.disabled = true;
    confirmMusicUrlButton.textContent = 'Adding…';
    try {
      const raw = musicUrlInput.value.trim();
      const typed = musicUrlDurationInput.value.trim();
      const youtubeId = youtubeVideoId(raw);
      let url = '';
      let duration = 0;
      let detectedTitle = '';

      if (youtubeId) {
        url = new URL(raw).href;
        if (typed) {
          duration = parseDurationInput(typed);
          if (!Number.isFinite(duration) || duration <= 0) throw new Error('Enter duration as min:sec, for example 3:42.');
        }

        if (!duration || !musicUrlTitleInput.value.trim()) {
          confirmMusicUrlButton.textContent = 'Reading YouTube…';
          try {
            const metadata = await probeYoutubeUrl(url);
            if (!duration) duration = Number(metadata.duration) || 0;
            detectedTitle = String(metadata.title || '');
          } catch (error) {
            if (!duration) showToast(error.message + ' You can still add it by entering the song length in min:sec.', 9500);
          }
        }
      } else {
        url = await resolveMediaUrl(raw);
        if (typed) {
          duration = parseDurationInput(typed);
          if (!Number.isFinite(duration) || duration <= 0) throw new Error('Enter duration as min:sec, for example 3:42.');
        } else {
          confirmMusicUrlButton.textContent = 'Checking…';
          try { duration = await probeUrlDuration(url, 'audio'); }
          catch { duration = 0; }
        }
      }

      const filename = (() => {
        try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '').replace(/\.[^.]+$/, ''); }
        catch { return ''; }
      })();
      const track = {
        id: uid('music'),
        title: musicUrlTitleInput.value.trim() || detectedTitle || filename || (youtubeId ? 'YouTube music' : 'Music'),
        url,
        duration,
        gainDb: 0,
        fadeIn: 0,
        fadeOut: 0,
        ...(youtubeId ? { sourceType: 'youtube', youtubeId } : {})
      };
      working.music.push(track);
      selectedMusicId = track.id;
      urlDialog.close();
      renderMusic();
      markDirty();

      if (duration > 0) {
        showToast((youtubeId ? 'YouTube music added · ' : 'Music URL added · ') + fmt(duration));
      } else {
        renderMusicEditor();
        showToast((youtubeId ? 'YouTube link added. ' : 'Music URL added. ') + 'Enter the track length in min:sec before Take Live.', 10000);
      }
    } catch (error) {
      showToast(error.message, 9000);
    } finally {
      confirmMusicUrlButton.disabled = false;
      confirmMusicUrlButton.textContent = 'Add Track';
    }
  });

  for (const input of [musicUrlInput, musicUrlTitleInput, musicUrlDurationInput].filter(Boolean)) {
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
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 's') { event.preventDefault(); if (!saveDraftButton.disabled) void saveDraft(); return; }
    if (event.target?.closest('input, textarea, select, [contenteditable="true"]') || app.querySelector('dialog[open]')) return;
    if (key === 'z' || key === 'y') { event.preventDefault(); navigateHistory(key === 'y' || event.shiftKey ? 1 : -1); }
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
    recoveryKey = RECOVERY_PREFIX + login.toLowerCase();
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
    if (!dirty && !uploadRunning) return;
    persistRecovery();
    event.preventDefault();
    event.returnValue = '';
  });

  bindWorkspaceTabs();
  app.querySelectorAll('.mfc-file-button').forEach(label => {
    label.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      label.querySelector('input[type="file"]')?.click();
    });
  });
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
