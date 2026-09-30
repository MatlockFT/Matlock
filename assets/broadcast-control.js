(() => {
  const app = document.querySelector('[data-mfc-control]');
  if (!app) return;

  const authBase = String(app.dataset.authBase || '').replace(/\/$/, '');
  const SESSION_ID_KEY = 'matlock-writer:server-session';
  const SESSION_LOGIN_KEY = 'matlock-writer:server-login';
  const STATE_API_PATH = '/contents/assets/uploads/broadcast.json';
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
  const previewFrame = app.querySelector('.mfc-monitor-frame iframe');
  const programTrack = app.querySelector('[data-program-track]');
  const programRuler = app.querySelector('[data-program-ruler]');
  const programFields = app.querySelector('[data-program-fields]');
  const programEditorTitle = app.querySelector('[data-program-editor-title]');
  const deleteProgramButton = app.querySelector('[data-delete-program]');
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

  function syncActionButtons() {
    const busy = Boolean(busyAction);
    saveDraftButton.disabled = !sessionId || !working || !dirty || busy;
    takeLiveButton.disabled = !sessionId || !working || busy;
    if (reloadStateButton) reloadStateButton.disabled = !sessionId || busy;
  }

  function setDirty(value = true) {
    dirty = Boolean(value);
    if (draftStatus) {
      draftStatus.textContent = dirty ? 'Unsaved changes' : 'Draft saved';
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
    if (authStatus) authStatus.textContent = 'GitHub: session expired';
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
    if (!channel.startedAt) channel.startedAt = new Date().toISOString();
    previewFrame.contentWindow.postMessage({
      type: 'matlock-broadcast-preview',
      channel
    }, location.origin);
  }

  function renderSummary() {
    const total = totalProgramDuration();
    loopTotal.textContent = `Loop ${fmt(total)}`;
    previewDuration.textContent = fmt(total);
    previewNow.textContent = `${working?.program?.length || 0} program item${working?.program?.length === 1 ? '' : 's'} · ${working?.music?.length || 0} song${working?.music?.length === 1 ? '' : 's'}`;

    const liveStamp = fullState?.live?.updatedAt || fullState?.live?.startedAt || '';
    liveStatus.textContent = liveStamp
      ? `Live · ${new Date(liveStamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Live';
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
      kind.textContent = String(item.type || 'headline').toUpperCase();

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
            item.mediaUrl = url;
            item.duration = duration;
            showToast('Video uploaded and added to the program.');
            renderProgram();
            renderProgramEditor();
            markDirty();
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
        try {
          if (track.url) track.duration = await probeUrlDuration(track.url);
        } catch {
          showToast('Could not read duration from that host. Set the duration manually.', 6500);
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
      if (!track.url) return showToast('Add a direct audio URL first.');
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
    markDirty();
  });

  function renderAll() {
    renderSummary();
    renderProgram();
    renderMusic();
    renderAudioSettings();
    tickerInput.value = (working.ticker || []).join('\n');
    setDirty(false);
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
    } catch (error) {
      if (error.status === 409) showToast('Broadcast state changed remotely. Use Reload State, then try again.', 8500);
      else showToast(`Could not save draft: ${error.message}`, 8500);
    } finally {
      saveDraftButton.textContent = originalLabel;
      setBusy('');
    }
  }

  async function takeLive() {
    if (!working || busyAction) return;
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
      showToast('New programming is live. Existing viewers will sync automatically.');
      renderSummary();
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
    if (!url) return showToast('Enter a direct audio URL.');
    if (!musicUrlInput.checkValidity()) {
      musicUrlInput.reportValidity();
      return;
    }
    const originalLabel = confirmMusicUrlButton.textContent;
    confirmMusicUrlButton.disabled = true;
    confirmMusicUrlButton.textContent = 'Checking…';
    let duration = 180;
    try {
      try {
        duration = await probeUrlDuration(url, 'audio');
      } catch {
        showToast('Track added, but the host did not expose its duration. Set the duration manually.', 6500);
      }
      const track = {
        id: uid('music'),
        title: musicUrlTitleInput.value.trim() || 'Remote track',
        url,
        duration,
        gainDb: 0,
        fadeIn: 1.5,
        fadeOut: 2
      };
      working.music.push(track);
      selectedMusicId = track.id;
      urlDialog.close();
      renderMusic();
      markDirty();
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

  previewFrame.addEventListener('load', () => {
    window.setTimeout(postPreview, 150);
  });

  async function startWorkspace({ preserveWorking = false } = {}) {
    const valid = await verifySession(sessionId);
    if (!valid) {
      sessionId = '';
      localWrite(SESSION_ID_KEY, '');
      authPanel.hidden = false;
      workspace.hidden = true;
      liveStatus.textContent = 'Sign in required';
      if (authStatus) authStatus.textContent = 'GitHub: signed out';
      return;
    }

    const login = valid.login || localRead(SESSION_LOGIN_KEY) || 'GitHub';
    authPanel.hidden = true;
    workspace.hidden = false;
    if (authStatus) authStatus.textContent = `GitHub: ${login}`;
    syncActionButtons();
    if (preserveWorking && working) {
      renderSummary();
      setDirty(true);
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
        if (authStatus) authStatus.textContent = 'GitHub: session expired';
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

  sessionId = localRead(SESSION_ID_KEY);
  if (sessionId) startWorkspace();
  else {
    authPanel.hidden = false;
    workspace.hidden = true;
    liveStatus.textContent = 'Sign in required';
    if (authStatus) authStatus.textContent = 'GitHub: signed out';
  }
})();
