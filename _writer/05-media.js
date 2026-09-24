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

  const VIDEO_CHUNK_BYTES = 3.5 * 1024 * 1024;
  const VIDEO_STATUS_POLL_MS = 1500;
  const VIDEO_STATUS_TIMEOUT_MS = 15 * 60 * 1000;

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
    if (elements.progress) elements.progress.value = safePercent;
    if (elements.label) elements.label.textContent = label || `Uploading… ${Math.round(safePercent)}%`;
    setSaveState(label || `Uploading video… ${Math.round(safePercent)}%`);
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

  async function mediaBridgeFetch(path, options = {}) {
    if (!authBase) throw new Error('Writer auth bridge is unavailable.');
    const session = writerSessionId();
    if (!session) throw new Error('Use the normal GitHub sign-in before uploading videos.');

    let response;
    try {
      response = await fetch(`${authBase}${path}`, {
        ...options,
        mode: 'cors',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'X-Writer-Session': session,
          ...(options.headers || {})
        }
      });
    } catch {
      throw new Error('Could not reach the Writer upload bridge.');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) expireGithubConnection();
      throw new Error(data.error || data.message || `${response.status} ${response.statusText}`);
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
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await mediaBridgeFetch('/api/writer/media-chunk', {
          method: 'POST',
          headers,
          body: chunk
        });
        return chunk.size;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise(resolve => window.setTimeout(resolve, 350 * (attempt + 1)));
      }
    }
    throw lastError || new Error('Video chunk upload failed.');
  }

  async function waitForVideoRelease(uploadId) {
    const started = Date.now();
    while (Date.now() - started < VIDEO_STATUS_TIMEOUT_MS) {
      const status = await mediaBridgeFetch(`/api/writer/media-status?uploadId=${encodeURIComponent(uploadId)}`);
      if (status.state === 'complete' && status.url) return status.url;
      if (status.state === 'error') throw new Error(status.error || 'GitHub Release upload failed.');

      const stage = status.state || 'processing';
      if (stage === 'queued') setVideoUploadProgress(82, 'Queued for GitHub Releases…');
      else if (stage === 'preparing') setVideoUploadProgress(86, 'Preparing GitHub Release…');
      else if (stage === 'publishing') setVideoUploadProgress(92, 'Publishing video to GitHub Releases…');
      else setVideoUploadProgress(84, 'Processing video…');

      await new Promise(resolve => window.setTimeout(resolve, VIDEO_STATUS_POLL_MS));
    }
    throw new Error('GitHub Release upload timed out. Try the upload again.');
  }

  async function uploadVideoAsset(file) {
    videoFileInfo(file);
    if (!writerSessionId()) throw new Error('Use the normal GitHub sign-in before uploading videos.');

    const uploadId = videoUploadId();
    const assetName = videoUploadName(file).replace(/[^A-Za-z0-9._-]+/g, '-');
    const chunkCount = Math.ceil(file.size / VIDEO_CHUNK_BYTES);
    let uploaded = 0;

    setVideoUploadProgress(2, `Uploading video in ${chunkCount} part${chunkCount === 1 ? '' : 's'}…`);
    for (let index = 0; index < chunkCount; index += 1) {
      uploaded += await uploadVideoChunk(uploadId, file, assetName, index, chunkCount);
      const percent = 5 + (uploaded / file.size) * 70;
      setVideoUploadProgress(percent, `Uploading video… ${Math.round((uploaded / file.size) * 100)}%`);
    }

    setVideoUploadProgress(78, 'Sending video to GitHub Releases…');
    await mediaBridgeFetch('/api/writer/media-finalize', {
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

    return waitForVideoRelease(uploadId);
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
      setVideoUploadProgress(100, 'Upload complete · placing video…');
      if (replaceUploadToken(token, inlineVideoMarkup(url, caption))) {
        showToast('Video uploaded to GitHub Releases and placed.');
      }
      scheduleAutosave();
      return url;
    } catch (error) {
      replaceUploadToken(token, '');
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
      const preferred = fields.imagePath.value.trim().split('/').pop() || selectedImageFile.name;
      const path = await uploadAsset(selectedImageFile, preferred);
      fields.imagePath.value = path;
      // Keep the local blob alive for this editing session. GitHub's raw/CDN
      // endpoint can lag the successful commit briefly; swapping immediately
      // makes a good upload look broken.
      selectedImageFile = null;
      imageFileInput.value = '';
      showToast('Featured image uploaded and verified in GitHub.');
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

