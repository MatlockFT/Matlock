  function mediaBlockId() {
    return 'media-' + htmlBlockId();
  }

  function mediaWidthValue(value, flow = 'break') {
    const presets = { small:35, medium:50, large:70, full:100 };
    const parsed = typeof value === 'number' ? value : (presets[value] || Number.parseFloat(value));
    const fallback = flow === 'wrap' ? 50 : 100;
    const max = flow === 'wrap' ? 60 : 100;
    return Math.max(25, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
  }

  function inlineImageMarkup(url, alt = '', options = {}) {
    const flow = options.flow === 'wrap' ? 'wrap' : 'break';
    let align = ['left','center','right'].includes(options.align) ? options.align : 'center';
    let width = ['small','medium','large','full'].includes(options.width) ? options.width : 'full';
    if (flow === 'wrap' && align === 'center') align = 'left';
    if (flow === 'wrap' && width === 'full') width = 'medium';

    const src = safeUrl(url);
    const caption = String(options.caption || '').trim();
    const mediaId = mediaBlockId();
    const widthPercent = mediaWidthValue(width, flow);
    const classes = [
      'article-inline-image',
      'article-inline-image--' + flow,
      'article-inline-image--' + align,
      'article-inline-image--' + width
    ].join(' ');

    return [
      '<figure class="' + classes + '" data-writer-media-id="' + mediaId + '" data-media-flow="' + flow + '" data-media-align="' + align + '" data-media-width="' + widthPercent + '" style="--media-width:' + widthPercent + '%;">',
      '  <img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) + '" loading="lazy">',
      caption ? '  <figcaption>' + escapeHtml(caption) + '</figcaption>' : '',
      '</figure>'
    ].filter(Boolean).join('\n');
  }

  function inlineVideoMarkup(url, caption = '', options = {}) {
    const src = safeUrl(url);
    if (!src || src === '#') return '';
    const cleanCaption = String(caption || '').trim();
    const label = cleanCaption || 'Article video';
    const flow = options.flow === 'wrap' ? 'wrap' : 'break';
    let align = ['left','center','right'].includes(options.align) ? options.align : 'center';
    if (flow === 'wrap' && align === 'center') align = 'left';
    const widthPercent = mediaWidthValue(options.width || (flow === 'wrap' ? 50 : 100), flow);
    const mediaId = mediaBlockId();
    const classes = [
      'article-inline-video',
      'article-inline-video--' + flow,
      'article-inline-video--' + align
    ].join(' ');

    return [
      '<figure class="' + classes + '" data-writer-media-id="' + mediaId + '" data-media-flow="' + flow + '" data-media-align="' + align + '" data-media-width="' + widthPercent + '" style="--media-width:' + widthPercent + '%;">',
      '  <div class="article-inline-video-stage">',
      '    <video autoplay loop muted playsinline preload="metadata" src="' + escapeHtml(src) + '" aria-label="' + escapeHtml(label) + '"></video>',
      '  </div>',
      cleanCaption ? '  <figcaption>' + escapeHtml(cleanCaption) + '</figcaption>' : '',
      '</figure>'
    ].filter(Boolean).join('\n');
  }

  const videoMediaBase = String(app.dataset.mediaBase || authBase).replace(/\/$/, '');
  let videoMediaSession = null;
  let videoMediaSessionRequest = null;
  const VIDEO_CHUNK_BYTES = videoMediaBase === authBase ? 1_800_000 : 3_500_000;
  const VIDEO_STATUS_POLL_MS = 1500;
  const VIDEO_STATUS_TIMEOUT_MS = 35 * 60 * 1000;
  // Netlify background jobs can run for 15 minutes; never restart an active job at minute 6.
  const VIDEO_STALE_STATUS_MS = 16 * 60 * 1000;
  const VIDEO_RESUME_KEY = 'matlock-writer:video-upload-resume-v1';

  const VIDEO_DIAG_KEY = 'matlock-writer:video-upload-diagnostics-v1';
  let activeVideoDiagnosticId = '';

  // Diagnostic history intentionally stores no credentials, cookies or file bytes.
  function videoDiagnosticRecords() {
    try {
      const records = JSON.parse(window.localStorage.getItem(VIDEO_DIAG_KEY) || '[]');
      return Array.isArray(records) ? records.filter(item => item && /^[A-Za-z0-9_-]{12,96}$/.test(item.id || '')).slice(0, 8) : [];
    } catch { return []; }
  }

  function cleanVideoDiagnosticText(value) {
    return String(value || '').replace(/(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, '[redacted]').slice(0, 500);
  }

  function updateVideoDiagnostic(id, changes = {}) {
    if (!/^[A-Za-z0-9_-]{12,96}$/.test(id || '')) return;
    const records = videoDiagnosticRecords();
    const old = records.find(item => item.id === id) || { id, startedAt: new Date().toISOString(), events: [] };
    const now = new Date().toISOString();
    const stage = changes.stage || old.stage || 'uploading';
    const detail = changes.detail === undefined ? old.detail || '' : cleanVideoDiagnosticText(changes.detail);
    const events = Array.isArray(old.events) ? old.events.slice(-29) : [];
    if (stage !== old.stage || (changes.forceEvent && detail !== old.detail)) {
      events.push({ at: now, stage, detail });
    }
    const entry = {
      ...old, ...changes, stage, detail, events: events.slice(-30),
      updatedAt: now,
      ...(changes.error ? { error: cleanVideoDiagnosticText(changes.error) } : {})
    };
    const remaining = records.filter(item => item.id !== id);
    try { window.localStorage.setItem(VIDEO_DIAG_KEY, JSON.stringify([entry, ...remaining].slice(0, 8))); } catch {}
    renderVideoDiagnostics();
  }

  function videoDiagnosticSelected() {
    const chosenId = app.querySelector('[data-video-history-select]')?.value || activeVideoDiagnosticId;
    const records = videoDiagnosticRecords();
    return records.find(item => item.id === chosenId) || records[0] || null;
  }

  function renderVideoDiagnostics() {
    const section = app.querySelector('[data-video-diagnostics]');
    if (!section) return;
    const select = section.querySelector('[data-video-history-select]');
    const records = videoDiagnosticRecords();
    const preferred = activeVideoDiagnosticId && records[0]?.id === activeVideoDiagnosticId
      ? activeVideoDiagnosticId : select.value || records[0]?.id || '';
    if (select.options.length !== records.length || [...select.options].some((option, i) => option.value !== records[i]?.id)) {
      select.replaceChildren();
      for (const record of records) {
        const option = document.createElement('option');
        option.value = record.id;
        option.textContent = (record.fileName || record.assetName || 'Video') + ' · ' + new Date(record.startedAt).toLocaleString();
        select.append(option);
      }
    }
    select.value = records.some(item => item.id === preferred) ? preferred : (records[0]?.id || '');
    const record = videoDiagnosticSelected();
    const state = section.querySelector('[data-video-diag-state]');
    const detail = section.querySelector('[data-video-diag-detail]');
    const stages = [...section.querySelectorAll('[data-video-stages] li')];
    const timeline = section.querySelector('[data-video-history-events]');
    const useButton = section.querySelector('[data-video-use-upload]');
    const checkButton = section.querySelector('[data-video-check-status]');
    const copyButton = section.querySelector('[data-video-copy-diagnostics]');
    const note = section.querySelector('[data-video-recovery-note]');
    checkButton.disabled = !record || videoUploadInFlight;
    copyButton.disabled = !record;
    const stageLabels = { uploading: 'Transferring', verifying: 'Verifying', queued: 'Queued', preparing: 'Verifying', publishing: 'Publishing to GitHub', complete: 'On GitHub', placed: 'Placed in editor', error: 'Failed', missing: 'Not found', checking: 'Checking status' };
    state.textContent = record ? stageLabels[record.stage] || record.stage : 'Ready';
    if (!record) {
      detail.textContent = 'Select a video to start. Transfers and GitHub publishing are tracked separately.';
      note.textContent = 'Select the original file again to resume an unfinished transfer.';
    } else {
      const size = record.fileSize ? (record.fileSize / 1048576).toFixed(1) + ' MiB' : 'Unknown size';
      detail.textContent = (record.fileName || record.assetName || 'Video') + ' · ' + size + ' · ' + (record.detail || record.stage) +
        (record.stage === 'uploading' && Number.isFinite(record.transferPercent) ? ' · ' + Math.round(record.transferPercent) + '% transferred' : '');
      note.textContent = record.stage === 'complete' ? 'The file is on GitHub. Use Place recovered video to add it to this article.'
        : record.stage === 'placed' ? 'Video inserted into the editor. Save the article to keep the change.'
        : record.stage === 'error' ? (record.stagedComplete ? 'All staged parts are present. Choose the original file and Place video to retry publishing without transferring again.' : 'Choose the original file and Place video to check the resumable upload. Temporary parts expire after 24 hours.')
        : record.stage === 'missing' ? 'This server record is unavailable. The original video may need to be uploaded again.'
        : 'Uploading and publishing are separate steps. You can check status or copy this report.';
    }
    const index = !record ? -1 : record.stage === 'uploading' ? 0 : ['verifying','preparing'].includes(record.stage) ? 1
      : ['queued','publishing'].includes(record.stage) ? 2 : ['complete','placed'].includes(record.stage) ? 3
      : record.failureStage === 'verification' ? 1 : 2;
    stages.forEach((el, i) => {
      const status = index < 0 ? 'pending' : record.stage === 'error' || record.stage === 'missing'
        ? i < index ? 'done' : i === index ? 'failed' : 'pending'
        : i < index ? 'done' : i === index ? (record.stage === 'placed' ? 'done' : 'active') : 'pending';
      el.dataset.stageStatus = status;
    });
    useButton.hidden = !(record && ['complete', 'placed'].includes(record.stage) && /^https:\/\/github\.com\/MatlockFT\/Matlock\/releases\/download\//.test(record.url || ''));
    timeline.replaceChildren();
    if (record) {
      const entries = [...(record.events || []), ...(record.serverHistory || []).map(x => ({ at: x.at, stage: x.state, detail: x.description + (x.httpStatus ? ' · HTTP ' + x.httpStatus : '') }))];
      entries.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
      for (const item of entries.slice(-30)) {
        const li = document.createElement('li');
        const date = new Date(item.at);
        li.textContent = (Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : '--:--') + ' · ' + (item.stage || 'event') + (item.detail ? ' · ' + item.detail : '');
        timeline.append(li);
      }
    }
    if (!timeline.children.length) {
      const li = document.createElement('li');
      li.textContent = 'No upload attempts recorded in this browser.';
      timeline.append(li);
    }
  }

  async function checkVideoDiagnosticStatus() {
    const record = videoDiagnosticSelected();
    if (!record) return;
    if (record.service && record.service !== videoMediaBase) {
      showToast('This upload belongs to a different upload service.');
      return;
    }
    const button = app.querySelector('[data-video-check-status]');
    button.disabled = true;
    try {
      const status = await mediaBridgeFetch('/api/writer/media-status?uploadId=' + encodeURIComponent(record.id));
      updateVideoDiagnostic(record.id, {
        stage: status.state === 'complete' ? 'complete' : status.state === 'processing' ? 'checking' : status.state || 'checking',
        detail: status.error || ('Server status: ' + (status.state || 'processing')),
        error: status.error || '',
        url: status.url || record.url || '',
        stagedComplete: Boolean(status.stagedChunksComplete || status.stagedComplete),
        failureStage: status.failureStage || record.failureStage || '',
        httpStatus: status.httpStatus || record.httpStatus || null,
        serverHistory: Array.isArray(status.history) ? status.history.slice(-25) : record.serverHistory || []
      });
    } catch (error) {
      updateVideoDiagnostic(record.id, { detail: 'Could not check status: ' + error.message, httpStatus: error.status || null, forceEvent: true });
      showToast('Could not check upload status: ' + error.message, 6000);
    } finally {
      button.disabled = false;
      renderVideoDiagnostics();
    }
  }

  async function copyVideoDiagnostics() {
    const record = videoDiagnosticSelected();
    if (!record) return;
    const report = {
      uploadId: record.id, fileName: record.fileName, fileSize: record.fileSize,
      service: record.service, startedAt: record.startedAt, updatedAt: record.updatedAt,
      stage: record.stage, transferPercent: record.transferPercent,
      failureStage: record.failureStage || null, httpStatus: record.httpStatus || null,
      error: record.error || null, detail: record.detail,
      events: record.events || [], serverHistory: record.serverHistory || []
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      showToast('Upload diagnostics copied.');
    } catch { showToast('Clipboard access was blocked.'); }
  }

  function placeRecoveredVideo() {
    const record = videoDiagnosticSelected();
    if (!record || !/^https:\/\/github\.com\/MatlockFT\/Matlock\/releases\/download\//.test(record.url || '')) return;
    if (bodyEditor.value.includes(record.url)) { showToast('This video is already in the editor.'); return; }
    insertBlock(inlineVideoMarkup(record.url));
    updateVideoDiagnostic(record.id, { stage: 'placed', detail: 'Recovered video inserted. Save the article.' });
    showToast('Recovered video placed. Save the article to keep it.');
  }


  function videoResumeFingerprint(file) {
    return JSON.stringify({
      session: writerSessionId(),
      service: videoMediaBase,
      name: String(file?.name || ''),
      size: Number(file?.size || 0),
      lastModified: Number(file?.lastModified || 0),
      type: String(file?.type || 'application/octet-stream')
    });
  }

  function readVideoResume(fingerprint) {
    try {
      const value = JSON.parse(window.sessionStorage.getItem(VIDEO_RESUME_KEY) || 'null');
      if (!value || value.fingerprint !== fingerprint || !validResumeUpload(value)) return null;
      return value;
    } catch {
      return null;
    }
  }

  function validResumeUpload(value) {
    return Boolean(
      value && /^[A-Za-z0-9_-]{12,96}$/.test(String(value.uploadId || ''))
      && typeof value.assetName === 'string'
      && Number.isInteger(Number(value.chunkCount))
      && Number(value.chunkCount) > 0
      && Number.isInteger(Number(value.nextChunkIndex))
      && Number(value.nextChunkIndex) >= 0
      && Number(value.nextChunkIndex) <= Number(value.chunkCount)
    );
  }

  function saveVideoResume(value) {
    try {
      window.sessionStorage.setItem(VIDEO_RESUME_KEY, JSON.stringify(value));
    } catch {}
  }

  function clearVideoResume() {
    try { window.sessionStorage.removeItem(VIDEO_RESUME_KEY); } catch {}
  }

  function videoFileInfo(file) {
    if (!file) throw new Error('Choose a video file.');
    const extension = String(file.name || '').match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase() || '';
    const typeExtension = {
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/x-m4v': 'm4v'
    }[file.type] || '';
    const ext = extension || typeExtension;
    if (!['mp4','webm','m4v'].includes(ext)) throw new Error('Use an MP4, WebM or M4V video.');
    if (file.size >= 2 * 1024 * 1024 * 1024) throw new Error('GitHub Release assets must be smaller than 2 GiB.');
    return { ext };
  }

  function videoUploadName(file) {
    const { ext } = videoFileInfo(file);
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
      '-',
      String(now.getMilliseconds()).padStart(3, '0')
    ].join('');
    const stem = slugify(fields.title.value || file.name.replace(/\.[^.]+$/, '') || 'article').slice(0, 48) || 'article';
    return `${stem}-video-${stamp}.${ext}`;
  }

  function videoProgressElements() {
    const dialog = app.querySelector('[data-video-dialog]');
    return {
      shell: dialog?.querySelector('[data-video-upload-status]') || null,
      progress: dialog?.querySelector('[data-video-upload-progress]') || null,
      label: dialog?.querySelector('[data-video-upload-label]') || null
    };
  }

  function setVideoUploadProgress(percent = 0, label = '') {
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    const elements = videoProgressElements();
    if (elements.shell) elements.shell.hidden = false;
    const transfer = Math.max(0, Math.min(100, (safePercent - 5) / 70 * 100));
    if (elements.progress) elements.progress.value = transfer;
    if (elements.label) elements.label.textContent = label || `Uploading… ${Math.round(transfer)}%`;
    if (activeVideoDiagnosticId) {
      const stage = /^(Uploading video|Resuming video)/i.test(label) ? 'uploading'
        : /^(Sending video|Queued)/i.test(label) ? 'queued'
        : /^(Preparing GitHub|Publishing video)/i.test(label) ? 'publishing'
        : /^(Publishing was interrupted|Publishing job stopped)/i.test(label) ? 'publishing'
        : /^(Video received|Processing video)/i.test(label) ? 'verifying' : '';
      if (stage) updateVideoDiagnostic(activeVideoDiagnosticId, {
        stage, detail: label, transferPercent: stage === 'uploading' ? transfer : 100
      });
    }
    setSaveState(label || `Uploading video… ${Math.round(transfer)}%`);
  }

  function clearVideoUploadProgress() {
    const elements = videoProgressElements();
    if (elements.shell) elements.shell.hidden = true;
    if (elements.progress) elements.progress.value = 0;
    if (elements.label) elements.label.textContent = 'Preparing upload…';
  }

  function writerSessionId() {
    return isServerSession() ? githubCredential.slice('session:'.length) : '';
  }

  function videoUploadId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID().replace(/-/g, '');
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
  }

  async function delegatedVideoSession(force = false) {
    const writer = writerSessionId();
    if (videoMediaBase === authBase) return writer;
    if (force) videoMediaSession = null;
    if (videoMediaSession?.writer === writer && videoMediaSession.expiresAt > Date.now() + 60000) return videoMediaSession.sessionId;
    if (!videoMediaSessionRequest) {
      videoMediaSessionRequest = (async () => {
        const response = await fetch(authBase + '/api/writer/media-session', {
          method: 'POST', mode: 'cors', cache: 'no-store', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Writer-Session': writer }, body: JSON.stringify({ renew: force })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401) expireGithubConnection();
          const error = new Error(data.error || 'Could not connect the video upload service.'); error.status = response.status; error.uploadServiceUnavailable = true; throw error;
        }
        if (data.mediaBase !== videoMediaBase || !/^mwm_[A-Za-z0-9_-]{48}$/.test(data.sessionId || '') || !(data.expiresAt > Date.now())) throw new Error('Invalid video upload authorization.');
        videoMediaSession = { writer, sessionId: data.sessionId, expiresAt: data.expiresAt };
        return data.sessionId;
      })().finally(() => { videoMediaSessionRequest = null; });
    }
    return videoMediaSessionRequest;
  }

  async function mediaBridgeFetch(path, options = {}, renewed = false) {
    if (!authBase) throw new Error('Writer auth bridge is unavailable.');
    if (!writerSessionId()) throw new Error('Use the normal GitHub sign-in before uploading videos.');
    const session = await delegatedVideoSession();
    if (!session) throw new Error('Use the normal GitHub sign-in before uploading videos.');

    let response;
    try {
      response = await fetch(`${videoMediaBase}${path}`, {
        ...options,
        mode: 'cors',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'X-Writer-Session': session,
          ...(options.headers || {})
        }
      });
    } catch (cause) {
      const endpoint = String(path || '').split('?')[0];
      const detail = String(cause?.message || cause || 'No response was received.');
      const error = new Error(`The Writer upload service did not return a response for ${endpoint}. Browser detail: ${detail.slice(0, 180)}`);
      error.name = cause?.name || 'NetworkError';
      error.networkError = true;
      error.cause = cause;
      throw error;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && videoMediaBase !== authBase && !renewed) {
        await delegatedVideoSession(true);
        return mediaBridgeFetch(path, options, true);
      }
      if (response.status === 401 && videoMediaBase === authBase) expireGithubConnection();
      const error = new Error(data.error || data.message || (videoMediaBase !== authBase ? 'Netlify video uploads are unavailable. Article saving and GitHub sign-in are unaffected.' : `${response.status} ${response.statusText}`));
      error.status = response.status;
      error.endpoint = String(path || '').split('?')[0];
      throw error;
    }
    return data;
  }

  async function uploadVideoChunk(uploadId, file, assetName, index, count) {
    const start = index * VIDEO_CHUNK_BYTES;
    const end = Math.min(file.size, start + VIDEO_CHUNK_BYTES);
    const chunk = file.slice(start, end);
    const headers = {
      'Content-Type': 'application/octet-stream',
      'X-Upload-Id': uploadId,
      'X-Chunk-Index': String(index),
      'X-Chunk-Count': String(count),
      'X-File-Size': String(file.size),
      'X-File-Type': file.type || 'application/octet-stream',
      'X-Asset-Name': assetName
    };

    let lastError = null;
    const retryDelays = [500, 1000, 2000, 4000, 8000, 12000, 16000];
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      try {
        await mediaBridgeFetch('/api/writer/media-chunk', {
          method: 'POST',
          headers,
          body: chunk
        });
        return chunk.size;
      } catch (error) {
        lastError = error;

        // A staged chunk may have committed even when the browser lost the
        // response. Confirm that exact chunk before retrying or abandoning the
        // entire 282 MB upload.
        if (error?.networkError) {
          try {
            const confirmation = await mediaBridgeFetch(
              `/api/writer/media-chunk?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${index}`
            );
            if (confirmation?.found && Number(confirmation.chunkSize) === chunk.size) {
              return chunk.size;
            }
          } catch {
            // The status check is best-effort. Continue with an idempotent retry.
          }
        }

        const retryable = retryableMediaRequestError(error);
        if (!retryable || attempt >= retryDelays.length) {
          const detail = String(error?.message || error || 'No response was received.');
          const finalError = new Error(
            `The Writer upload service could not confirm video chunk ${index + 1} of ${count} after ${attempt + 1} attempt${attempt === 0 ? '' : 's'}. ${detail}`
          );
          // Preserve transport metadata so the caller can retain staged chunks
          // and resume at this precise chunk rather than deleting the whole file.
          finalError.networkError = Boolean(error?.networkError);
          finalError.uploadServiceUnavailable = Boolean(error?.uploadServiceUnavailable);
          finalError.status = error?.status;
          finalError.cause = error;
          finalError.chunkIndex = index;
          throw finalError;
        }
        await new Promise(resolve => window.setTimeout(resolve, retryDelays[attempt]));
      }
    }
    throw lastError || new Error('Video chunk upload failed.');
  }

  function retryableMediaRequestError(error) {
    if (error?.uploadServiceUnavailable) return false;
    return Boolean(error?.networkError)
      || !Number.isInteger(error?.status)
      || [408, 429, 500, 502, 503, 504].includes(error.status);
  }

  async function finalizeVideoUpload(payload) {
    const delays = [750, 1500, 3000, 5000, 8000];
    let lastError = null;

    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      try {
        return await mediaBridgeFetch('/api/writer/media-finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } catch (error) {
        lastError = error;
        if (!retryableMediaRequestError(error) || attempt >= delays.length) throw error;

        // The server may have queued the job even when the response was lost.
        // This status check is safe and lets us avoid treating a completed
        // finalization as a failed upload.
        try {
          const status = await mediaBridgeFetch(`/api/writer/media-status?uploadId=${encodeURIComponent(payload.uploadId)}`);
          if (status.state === 'complete' && status.url) {
            return { ok: true, uploadId: payload.uploadId, state: 'complete', url: status.url };
          }
          if (['queued', 'preparing', 'publishing'].includes(status.state)) {
            return { ok: true, uploadId: payload.uploadId, state: status.state };
          }
          if (status.state === 'error' && !status.retryable) {
            const error = new Error(status.error || 'GitHub Release upload failed.');
            error.status = 409;
            throw error;
          }
        } catch (statusError) {
          if (statusError?.message && !retryableMediaRequestError(statusError)) throw statusError;
        }

        setVideoUploadProgress(80, 'Upload received. Reconnecting to confirm publishing…');
        await new Promise(resolve => window.setTimeout(resolve, delays[attempt]));
      }
    }

    throw lastError || new Error('Could not confirm that GitHub accepted the video for publishing.');
  }

  async function waitForVideoRelease(uploadId, retryPayload = null) {
    const started = Date.now();
    let failedPolls = 0;
    let lastPollError = null;

    while (Date.now() - started < VIDEO_STATUS_TIMEOUT_MS) {
      let status;
      try {
        status = await mediaBridgeFetch(`/api/writer/media-status?uploadId=${encodeURIComponent(uploadId)}`);
        failedPolls = 0;
        lastPollError = null;
      } catch (error) {
        if (!retryableMediaRequestError(error)) throw error;
        failedPolls += 1;
        lastPollError = error;
        const wait = Math.min(5000, 750 * (2 ** Math.min(failedPolls - 1, 3)));
        setVideoUploadProgress(84, 'Video received. Connection interrupted while checking GitHub publishing; retrying…');
        await new Promise(resolve => window.setTimeout(resolve, wait));
        continue;
      }

      if (activeVideoDiagnosticId) updateVideoDiagnostic(activeVideoDiagnosticId, {
        stage: status.state === 'complete' ? 'complete' : status.state || 'checking',
        detail: status.error || ('Server status: ' + (status.state || 'processing')),
        error: status.error || '',
        url: status.url || '',
        failureStage: status.failureStage || '',
        httpStatus: status.httpStatus || null,
        stagedComplete: Boolean(status.stagedChunksComplete || status.stagedComplete),
        serverHistory: Array.isArray(status.history) ? status.history.slice(-25) : []
      });
      if (status.state === 'complete' && status.url) return status.url;
      if (status.state === 'error') {
        if (status.retryable && retryPayload) {
          setVideoUploadProgress(82, 'Publishing was interrupted. Retrying the staged video without re-uploading it…');
          await finalizeVideoUpload(retryPayload);
          continue;
        }
        throw new Error(status.error || 'GitHub Release upload failed.');
      }

      const stage = status.state || 'processing';
      const statusUpdatedAt = Date.parse(status.updatedAt || '');
      if (
        retryPayload
        && ['queued', 'preparing', 'publishing'].includes(stage)
        && Number.isFinite(statusUpdatedAt)
        && Date.now() - statusUpdatedAt > VIDEO_STALE_STATUS_MS
      ) {
        setVideoUploadProgress(82, 'Publishing job stopped responding. Restarting from staged video…');
        await finalizeVideoUpload(retryPayload);
        continue;
      }
      if (stage === 'queued') setVideoUploadProgress(82, 'Queued for GitHub Releases…');
      else if (stage === 'preparing') setVideoUploadProgress(86, 'Preparing GitHub Release…');
      else if (stage === 'publishing') setVideoUploadProgress(92, 'Publishing video to GitHub Releases…');
      else if (stage === 'uploading') setVideoUploadProgress(80, 'Video received. Confirming publishing job…');
      else setVideoUploadProgress(84, 'Processing video…');

      await new Promise(resolve => window.setTimeout(resolve, VIDEO_STATUS_POLL_MS));
    }

    if (lastPollError) {
      throw new Error('The video was uploaded, but the Writer could not confirm the GitHub Release result before timing out. Retry status checking before uploading the file again.');
    }
    throw new Error('GitHub Release upload timed out. The video may still be processing; check the media library before uploading it again.');
  }

  async function uploadVideoAsset(file) {
    videoFileInfo(file);
    if (!writerSessionId()) throw new Error('Use the normal GitHub sign-in before uploading videos.');

    const fingerprint = videoResumeFingerprint(file);
    const chunkCount = Math.ceil(file.size / VIDEO_CHUNK_BYTES);
    let resume = readVideoResume(fingerprint);
    if (resume) {
      activeVideoDiagnosticId = resume.uploadId;
      updateVideoDiagnostic(resume.uploadId, {
        fileName: file.name, fileSize: file.size, service: videoMediaBase,
        stage: 'checking', detail: 'Checking the previous upload checkpoint.'
      });
    }

    if (resume && Number(resume.chunkCount) === chunkCount) {
      // The earlier request may have succeeded even though the browser lost
      // its response. Keep this upload ID and staged prefix across retries.
      let status;
      try {
        status = await mediaBridgeFetch(`/api/writer/media-status?uploadId=${encodeURIComponent(resume.uploadId)}`);
      } catch (error) {
        throw new Error(`Could not check the previous video upload before resuming: ${error.message}`);
      }

      if (status.state === 'complete' && status.url) {
        clearVideoResume();
        return status.url;
      }
      const retryPayload = {
        uploadId: resume.uploadId,
        assetName: resume.assetName,
        chunkCount,
        fileSize: file.size,
        fileType: file.type || 'application/octet-stream'
      };
      if (['queued', 'preparing', 'publishing'].includes(status.state)) {
        const url = await waitForVideoRelease(resume.uploadId, retryPayload);
        clearVideoResume();
        return url;
      }
      if (status.state === 'error' && (status.stagedChunksComplete === true || status.stagedComplete === true)) {
        // Reuse the retained bytes when every staged chunk is present. A
        // non-retryable old status needs an explicit new attempt so the current
        // server diagnostics, rather than a stale browser message, are shown.
        if (!status.retryable) retryPayload.manualRetry = true;
        await finalizeVideoUpload(retryPayload);
        const url = await waitForVideoRelease(resume.uploadId, retryPayload);
        clearVideoResume();
        return url;
      }
      if (status.state === 'error') {
        // Older failures can have a status record after their staged chunks
        // have already been deleted. Do not show that stale error again: clean
        // the old ID and restage from the File selected in this interaction.
        try {
          await mediaBridgeFetch('/api/writer/media-abort', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uploadId: resume.uploadId, chunkCount })
          });
        } catch {}
        clearVideoResume();
        resume = null;
      }
      if (status.state !== 'uploading') {
        try {
          await mediaBridgeFetch('/api/writer/media-abort', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uploadId: resume.uploadId, chunkCount })
          });
        } catch {}
        clearVideoResume();
        resume = null;
      } else if (Number(resume.nextChunkIndex) > 0) {
        const priorIndex = Number(resume.nextChunkIndex) - 1;
        const priorChunk = file.slice(
          priorIndex * VIDEO_CHUNK_BYTES,
          Math.min(file.size, (priorIndex + 1) * VIDEO_CHUNK_BYTES)
        );
        try {
          const confirmation = await mediaBridgeFetch(
            `/api/writer/media-chunk?uploadId=${encodeURIComponent(resume.uploadId)}&chunkIndex=${priorIndex}`
          );
          if (!confirmation?.found || Number(confirmation.chunkSize) !== priorChunk.size) {
            throw new Error('The saved upload checkpoint is missing from temporary storage.');
          }
        } catch {
          try {
            await mediaBridgeFetch('/api/writer/media-abort', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uploadId: resume.uploadId, chunkCount })
            });
          } catch {}
          clearVideoResume();
          resume = null;
        }
      }
    } else if (resume) {
      try {
        await mediaBridgeFetch('/api/writer/media-abort', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId: resume.uploadId, chunkCount: Number(resume.chunkCount) || chunkCount })
        });
      } catch {}
      clearVideoResume();
      resume = null;
    }

    const uploadId = resume?.uploadId || videoUploadId();
    const assetName = resume?.assetName || videoUploadName(file).replace(/[^A-Za-z0-9._-]+/g, '-');
    activeVideoDiagnosticId = uploadId;
    updateVideoDiagnostic(uploadId, {
      fileName: file.name, fileSize: file.size, assetName, service: videoMediaBase,
      stage: 'uploading', detail: resume ? 'Resuming staged video parts.' : 'Beginning video transfer.'
    });
    const startIndex = resume ? Number(resume.nextChunkIndex) : 0;
    let uploaded = Math.min(file.size, startIndex * VIDEO_CHUNK_BYTES);
    resume = { fingerprint, uploadId, assetName, chunkCount, nextChunkIndex: startIndex };
    saveVideoResume(resume);

    setVideoUploadProgress(
      5 + (uploaded / file.size) * 70,
      startIndex
        ? `Resuming video at part ${startIndex + 1} of ${chunkCount}…`
        : `Uploading video in ${chunkCount} part${chunkCount === 1 ? '' : 's'}…`
    );

    for (let index = startIndex; index < chunkCount; index += 1) {
      // Confirm the first unacknowledged chunk before sending it again. This
      // covers the case where staging succeeded but the response never arrived.
      if (index === startIndex) {
        try {
          const confirmation = await mediaBridgeFetch(
            `/api/writer/media-chunk?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${index}`
          );
          const expectedSize = file.slice(
            index * VIDEO_CHUNK_BYTES,
            Math.min(file.size, (index + 1) * VIDEO_CHUNK_BYTES)
          ).size;
          if (confirmation?.found && Number(confirmation.chunkSize) === expectedSize) {
            uploaded += expectedSize;
            resume.nextChunkIndex = index + 1;
            saveVideoResume(resume);
            setVideoUploadProgress(
              5 + (uploaded / file.size) * 70,
              `Resuming video… ${Math.round((uploaded / file.size) * 100)}%`
            );
            continue;
          }
        } catch {
          // The retry logic below performs the same check after a lost response.
        }
      }

      try {
        uploaded += await uploadVideoChunk(uploadId, file, assetName, index, chunkCount);
        resume.nextChunkIndex = index + 1;
        saveVideoResume(resume);
        const percent = 5 + (uploaded / file.size) * 70;
        setVideoUploadProgress(percent, `Uploading video… ${Math.round((uploaded / file.size) * 100)}%`);
      } catch (error) {
        // Keep the checkpoint and temporary chunks after transport failures.
        // Selecting the same file again resumes here instead of starting over.
        if (!error?.networkError && !error?.uploadServiceUnavailable) {
          try {
            await mediaBridgeFetch('/api/writer/media-abort', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uploadId, chunkCount })
            });
          } catch {}
          clearVideoResume();
        }
        throw error;
      }
    }

    setVideoUploadProgress(78, 'Sending video to GitHub Releases…');
    const finalizePayload = {
      uploadId,
      assetName,
      chunkCount,
      fileSize: file.size,
      fileType: file.type || 'application/octet-stream'
    };
    await finalizeVideoUpload(finalizePayload);

    const url = await waitForVideoRelease(uploadId, finalizePayload);
    clearVideoResume();
    return url;
  }

  async function insertInlineVideo(file, caption = '') {
    if (!githubCredential) {
      showToast('Connect GitHub before uploading a video, then try again.', 6000);
      if (!connectDialog.open) connectDialog.showModal();
      return '';
    }

    try {
      videoFileInfo(file);
    } catch (error) {
      showToast(error.message, 6000);
      return '';
    }

    const token = `<!-- WRITER_VIDEO_UPLOAD_${Date.now()} -->`;
    insertBlock(token);
    videoUploadInFlight = true;
    setPublishingControls(Boolean(githubCredential));
    clearVideoUploadProgress();
    showToast('Uploading video…', 3000);

    try {
      const url = await uploadVideoAsset(file);
      updateVideoDiagnostic(activeVideoDiagnosticId, { stage: 'complete', detail: 'GitHub confirmed the published asset.', url, transferPercent: 100 });
      setVideoUploadProgress(100, 'Upload complete · placing video…');
      if (replaceUploadToken(token, inlineVideoMarkup(url, caption))) {
        updateVideoDiagnostic(activeVideoDiagnosticId, { stage: 'placed', detail: 'Video inserted into the editor. Save the article.' });
        showToast('Video uploaded to GitHub Releases and placed.');
      }
      scheduleAutosave();
      return url;
    } catch (error) {
      replaceUploadToken(token, '');
      updateVideoDiagnostic(activeVideoDiagnosticId, {
        stage: 'error', error: error.message, detail: error.message,
        httpStatus: error.status || null, failureStage: error.endpoint || 'upload'
      });
      showToast(`Video upload failed: ${error.message}`, 9000);
      return '';
    } finally {
      videoUploadInFlight = false;
      setPublishingControls(Boolean(githubCredential));
      window.setTimeout(clearVideoUploadProgress, 1200);
      setSaveState('Unsaved changes');
    }
  }

  async function optimizeImage(file) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Choose an image file.');
    if (file.type === 'image/gif') {
      if (file.size > 5 * 1024 * 1024) throw new Error('Keep GIF uploads under 5 MB.');
      return { blob: file, name: file.name };
    }

    const directTypes = new Set(['image/png','image/jpeg','image/webp','image/avif']);
    if (directTypes.has(file.type) && file.size <= 4 * 1024 * 1024) return { blob: file, name: file.name };

    const bitmap = await createImageBitmap(file);
    const maxDimension = 2400;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.88));
    if (!blob) throw new Error('Could not optimize image.');
    return { blob, name: `${file.name.replace(/\.[^.]+$/, '')}.webp` };
  }

  function articleAssetScope() {
    const currentFilename = currentPath ? currentPath.split('/').pop() : fields.filename.value.trim();
    const filenameMatch = String(currentFilename || '').match(/^(\d{4})-(\d{2})-(\d{2})-(.+?)\.(?:md|markdown|html)$/i);

    if (filenameMatch) {
      return {
        year: filenameMatch[1],
        month: filenameMatch[2],
        slug: slugify(filenameMatch[4])
      };
    }

    const articleDate = String(fields.date.value || today());
    const dateMatch = articleDate.match(/^(\d{4})-(\d{2})-\d{2}$/);
    const now = new Date();
    return {
      year: dateMatch?.[1] || String(now.getFullYear()),
      month: dateMatch?.[2] || String(now.getMonth() + 1).padStart(2, '0'),
      slug: slugify(fields.title.value || 'article')
    };
  }

  function articleUploadPath(filename) {
    const scope = articleAssetScope();
    return 'assets/uploads/articles/' + scope.year + '/' + scope.month + '/' + scope.slug + '/' + filename;
  }
  async function uploadAsset(file, preferredName = '') {
    if (!githubCredential) throw new Error('Sign in with GitHub before uploading images.');
    const optimized = await optimizeImage(file);
    let uploadName = preferredName || optimized.name;
    const optimizedExtension = optimized.name.match(/\.[^.]+$/)?.[0] || '';
    const preferredExtension = uploadName.match(/\.[^.]+$/)?.[0] || '';
    if (preferredName && optimizedExtension && preferredExtension.toLowerCase() !== optimizedExtension.toLowerCase()) {
      uploadName = `${preferredName.replace(/\.[^.]+$/, '')}${optimizedExtension}`;
    }
    const safeName = uploadName.replace(/[^A-Za-z0-9._-]+/g,'-');
    const path = articleUploadPath(safeName);
    const bytes = new Uint8Array(await optimized.blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    let existingSha = '';
    try { const existing = await githubFetch(`/contents/${path}?ref=main`); existingSha = existing.sha || ''; } catch {}
    const payload = { message: `Upload article image ${safeName}`, content: btoa(binary), branch: 'main' };
    if (existingSha) payload.sha = existingSha;
    await githubFetch(`/contents/${path}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }, true);
    return `/${path}`;
  }

  async function uploadFeaturedImage() {
    if (!selectedImageFile) { showToast('Choose an image first.'); return; }
    if (imageUploadInFlight) return;
    imageUploadInFlight = true;
    setPublishingControls(Boolean(githubCredential));
    uploadButton.disabled = true;
    uploadButton.textContent = 'Uploading…';
    try {
      // A replacement cover must have a new URL. Reusing the old filename can
      // leave Jekyll's existing responsive WebP variants and browser/CDN caches
      // serving the previous photo even after the original image is replaced.
      const originalName = selectedImageFile.name || 'cover.png';
      const stem = originalName.replace(/\.[^.]+$/, '').slice(0, 64) || 'cover';
      const extension = originalName.match(/\.[A-Za-z0-9]+$/)?.[0] || '.png';
      const nonce = (window.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 8);
      const preferred = `${stem}-${Date.now().toString(36)}-${nonce}${extension}`;
      const path = await uploadAsset(selectedImageFile, preferred);
      fields.imagePath.value = path;
      // Keep the local blob alive for this editing session. GitHub's raw/CDN
      // endpoint can lag the successful commit briefly; swapping immediately
      // makes a good upload look broken.
      selectedImageFile = null;
      imageFileInput.value = '';
      showToast(currentPath ? 'Cover uploaded. Click Save changes to update the article.' : 'Cover uploaded. Save the article to use it.', 6000);
      scheduleAutosave();
      updatePreview();
    } catch (error) {
      showToast(`Image upload failed: ${error.message}`, 6000);
    } finally {
      imageUploadInFlight = false;
      uploadButton.textContent = 'Upload';
      setPublishingControls(Boolean(githubCredential));
    }
  }

  function clipboardImageFile(clipboardData) {
    if (!clipboardData) return null;
    const direct = [...(clipboardData.files || [])].find(file => file?.type?.startsWith('image/'));
    if (direct) return direct;
    for (const item of [...(clipboardData.items || [])]) {
      if (item.kind !== 'file' || !item.type?.startsWith('image/')) continue;
      const file = item.getAsFile?.();
      if (file) return file;
    }
    return null;
  }

  function namedClipboardImage(file) {
    const extensionByType = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/avif': 'avif'
    };
    const extension = extensionByType[file.type] || (file.name.match(/\.([A-Za-z0-9]+)$/)?.[1] || 'png').toLowerCase();
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
      '-',
      String(now.getMilliseconds()).padStart(3, '0')
    ].join('');
    const articleStem = slugify(fields.title.value || 'article').slice(0, 42) || 'article';
    return new File([file], `${articleStem}-pasted-${stamp}.${extension}`, {
      type: file.type || `image/${extension}`,
      lastModified: Date.now()
    });
  }

  function replaceUploadToken(token, replacement) {
    const index = bodyEditor.value.indexOf(token);
    if (index < 0) return false;
    bodyEditor.setRangeText(replacement, index, index + token.length, 'preserve');
    bodyEditor.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  async function insertClipboardImage(file) {
    if (!githubCredential) {
      showToast('Connect GitHub before pasting images, then paste the image again.', 6000);
      if (!connectDialog.open) connectDialog.showModal();
      return;
    }

    const named = namedClipboardImage(file);
    const token = `<!-- WRITER_IMAGE_UPLOAD_${Date.now()} -->`;
    insertBlock(token);
    showToast('Uploading pasted image…', 3000);

    try {
      const path = await uploadAsset(named);
      const alt = named.name.replace(/-pasted-\d{8}-\d{6}-\d{3}\.[^.]+$/i, '').replace(/[-_]+/g, ' ').trim();
      if (replaceUploadToken(token, inlineImageMarkup(path, alt))) {
        showToast('Pasted image uploaded and placed.');
      }
    } catch (error) {
      replaceUploadToken(token, '');
      showToast(`Pasted image failed: ${error.message}`, 6000);
    }
  }

  async function insertInlineImage(file, alt = '', options = {}) {
    try {
      const path = await uploadAsset(file);
      insertBlock(inlineImageMarkup(path, alt || file.name.replace(/\.[^.]+$/, ''), options));
      showToast('Image uploaded and placed.');
      return path;
    } catch (error) {
      showToast(`Image insert failed: ${error.message}`, 6000);
      throw error;
    }
  }

