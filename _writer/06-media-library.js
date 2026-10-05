  const mediaLibraryView = app.querySelector('[data-media-library-view]');
  const mediaLibraryList = app.querySelector('[data-media-library-list]');
  const mediaLibrarySearch = app.querySelector('[data-media-library-search]');
  const mediaLibraryStats = app.querySelector('[data-media-library-stats]');
  let mediaLibraryEntries = [];
  let mediaLibraryFilter = 'all';
  let mediaLibraryLoaded = false;
  let mediaLibraryLoading = false;

  function normalizeMediaRef(value) {
    let ref = String(value || '').trim();
    if (!ref) return '';
    ref = ref.replace(/&amp;/g, '&').replace(/[),.;!?]+$/g, '');
    try {
      const url = new URL(ref, location.origin);
      if (url.origin === location.origin && url.pathname.startsWith('/assets/uploads/articles/')) {
        return decodeURIComponent(url.pathname);
      }
      if (/github\.com$/i.test(url.hostname) && url.pathname.includes('/releases/download/writer-media-')) {
        return url.origin + url.pathname;
      }
    } catch {}
    if (ref.startsWith('assets/uploads/articles/')) ref = '/' + ref;
    return ref;
  }

  function collectArticleMediaRefs({ imagePath = '', body = '' } = {}) {
    const refs = new Set();
    const add = value => {
      const normalized = normalizeMediaRef(value);
      if (normalized) refs.add(normalized);
    };

    add(imagePath);
    const source = String(body || '');
    for (const match of source.matchAll(/(?:https?:\/\/[^\s<>"'\])]+|\/?assets\/uploads\/articles\/[A-Za-z0-9_./%+-]+)/gi)) {
      const value = match[0];
      if (/assets\/uploads\/articles\//i.test(value) || /\/releases\/download\/writer-media-/i.test(value)) add(value);
    }
    return [...refs];
  }

  function mediaLibraryUsage(item) {
    const target = normalizeMediaRef(item?.url || item?.path || '');
    if (!target) return [];
    const usage = [];

    for (const remote of libraryEntries) {
      const entry = libraryDisplayEntry(remote);
      const refs = Array.isArray(entry.mediaRefs) ? entry.mediaRefs : [];
      if (!refs.some(ref => normalizeMediaRef(ref) === target)) continue;
      usage.push({
        path: entry.path,
        title: entry.title || entry.name,
        status: entry.status || 'draft'
      });
    }

    const localDraft = readLocalNewDraft();
    if (localDraft) {
      const refs = collectArticleMediaRefs({
        imagePath: localDraft.imagePath || '',
        body: localDraft.body || ''
      });
      if (refs.some(ref => normalizeMediaRef(ref) === target)) {
        usage.push({
          path: '',
          title: String(localDraft.title || '').trim() || 'Untitled local draft',
          status: 'local'
        });
      }
    }
    return usage;
  }

  function formatMediaBytes(bytes) {
    const size = Number(bytes) || 0;
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(size < 10 * 1024 ? 1 : 0) + ' KB';
    if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
    return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function mediaLibraryFilteredEntries() {
    const query = String(mediaLibrarySearch?.value || '').trim().toLowerCase();
    return mediaLibraryEntries.filter(item => {
      const usage = mediaLibraryUsage(item);
      if (mediaLibraryFilter === 'image' && item.kind !== 'image') return false;
      if (mediaLibraryFilter === 'video' && item.kind !== 'video') return false;
      if (mediaLibraryFilter === 'unused' && usage.length) return false;
      if (!query) return true;
      const haystack = [
        item.name,
        item.path,
        item.releaseTag,
        ...usage.map(link => link.title)
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  function mediaPreviewMarkup(item) {
    const src = escapeHtml(item.url || '');
    if (item.kind === 'video') {
      return '<video src="' + src + '" controls muted playsinline preload="metadata" aria-label="' + escapeHtml(item.name || 'Video') + '"></video>';
    }
    return '<img src="' + src + '" alt="" loading="lazy">';
  }

  function renderMediaLibrary() {
    if (!mediaLibraryList || !mediaLibraryStats) return;

    const allUsage = mediaLibraryEntries.map(item => mediaLibraryUsage(item));
    const counts = {
      total: mediaLibraryEntries.length,
      images: mediaLibraryEntries.filter(item => item.kind === 'image').length,
      videos: mediaLibraryEntries.filter(item => item.kind === 'video').length,
      unused: allUsage.filter(usage => usage.length === 0).length
    };
    mediaLibraryStats.innerHTML =
      '<span><strong>' + counts.total + '</strong> total</span>' +
      '<span><strong>' + counts.images + '</strong> images</span>' +
      '<span><strong>' + counts.videos + '</strong> videos</span>' +
      '<span><strong>' + counts.unused + '</strong> unused</span>';

    const entries = mediaLibraryFilteredEntries();
    if (!entries.length) {
      mediaLibraryList.innerHTML = '<div class="writer-library-empty">No matching media.</div>';
      return;
    }

    mediaLibraryList.innerHTML = entries.map(item => {
      const usage = mediaLibraryUsage(item);
      const unused = usage.length === 0;
      const association = unused
        ? '<span class="writer-media-unused">Unused</span>'
        : '<span class="writer-media-used">Used in ' + usage.length + ' article' + (usage.length === 1 ? '' : 's') + '</span>';
      const articleLinks = usage.length
        ? '<div class="writer-media-associations">' + usage.map(link => link.path
            ? '<button type="button" data-media-open-article="' + escapeHtml(link.path) + '">' + escapeHtml(link.title) + '</button>'
            : '<span>' + escapeHtml(link.title) + '</span>'
          ).join('') + '</div>'
        : '<p class="writer-media-orphan-note">Nothing in Writer currently references this file. It is safe to review as an orphaned upload.</p>';
      const meta = [
        item.kind === 'video' ? 'Video' : 'Image',
        formatMediaBytes(item.size),
        item.createdAt ? formatDateTime(item.createdAt) : (item.storage === 'repository' ? 'Article upload' : '')
      ].filter(Boolean).join(' • ');

      return '<article class="writer-media-card' + (unused ? ' is-unused' : '') + '" data-media-key="' + escapeHtml(item.key || '') + '">' +
        '<div class="writer-media-preview">' + mediaPreviewMarkup(item) + '</div>' +
        '<div class="writer-media-card-body">' +
          '<div class="writer-media-card-status">' + association + '<span>' + escapeHtml(meta) + '</span></div>' +
          '<h3 title="' + escapeHtml(item.name || '') + '">' + escapeHtml(item.name || 'Untitled media') + '</h3>' +
          articleLinks +
          '<div class="writer-media-card-foot">' +
            '<span title="' + escapeHtml(item.url || item.path || '') + '">' + escapeHtml(item.storage === 'release' ? (item.releaseTag || 'GitHub Release') : (item.path || 'Repository')) + '</span>' +
            '<div class="writer-media-card-actions">' +
              '<a href="' + escapeHtml(item.url || '#') + '" target="_blank" rel="noopener noreferrer">Open</a>' +
              '<button type="button" data-media-delete>Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  function mediaKindFromName(name, contentType = '') {
    const lowerName = String(name || '').toLowerCase();
    const lowerType = String(contentType || '').toLowerCase();
    if (lowerType.startsWith('image/') || /\.(?:png|jpe?g|webp|gif|avif)$/i.test(lowerName)) return 'image';
    if (lowerType.startsWith('video/') || /\.(?:mp4|m4v|webm|mov)$/i.test(lowerName)) return 'video';
    return '';
  }

  async function publicRepoJson(path) {
    let response;
    try {
      response = await fetch('https://api.github.com/repos/' + repo + path, {
        mode: 'cors',
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
    } catch {
      throw new Error('Could not reach GitHub to scan uploaded media.');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (response.status === 403 && remaining === '0') {
        throw new Error('GitHub temporarily rate-limited the media scan. Try Refresh again in a few minutes.');
      }
      throw new Error(data?.message || ('GitHub returned ' + response.status + ' while scanning media.'));
    }
    return data;
  }

  async function scanArticleMedia() {
    const [tree, releases] = await Promise.all([
      publicRepoJson('/git/trees/main?recursive=1'),
      publicRepoJson('/releases?per_page=100')
    ]);

    if (tree?.truncated) throw new Error('GitHub returned an incomplete repository scan. Try Refresh again.');

    const repositoryAssets = (Array.isArray(tree?.tree) ? tree.tree : [])
      .filter(item => item?.type === 'blob' && String(item.path || '').startsWith('assets/uploads/articles/'))
      .map(item => {
        const kind = mediaKindFromName(item.path);
        if (!kind) return null;
        const path = String(item.path);
        return {
          id: path,
          key: 'repository:' + path,
          storage: 'repository',
          kind,
          name: path.split('/').pop() || path,
          path,
          url: '/' + path,
          size: Number(item.size) || 0,
          contentType: kind === 'image' ? 'image/*' : 'video/*',
          createdAt: null,
          updatedAt: null,
          sha: String(item.sha || '')
        };
      })
      .filter(Boolean);

    const releaseAssets = (Array.isArray(releases) ? releases : [])
      .filter(release => String(release?.tag_name || '').startsWith('writer-media-'))
      .flatMap(release => (Array.isArray(release?.assets) ? release.assets : []).map(asset => {
        const name = String(asset?.name || '');
        if (/^broadcast-(?:video|audio|image)-/i.test(name)) return null;
        const kind = mediaKindFromName(name, asset?.content_type);
        if (!kind) return null;
        return {
          id: Number(asset.id),
          key: 'release:' + Number(asset.id),
          storage: 'release',
          kind,
          name,
          url: String(asset.browser_download_url || ''),
          size: Number(asset.size) || 0,
          contentType: String(asset.content_type || ''),
          createdAt: asset.created_at || null,
          updatedAt: asset.updated_at || null,
          releaseId: Number(release.id) || null,
          releaseTag: String(release.tag_name || '')
        };
      }).filter(Boolean));

    return [...repositoryAssets, ...releaseAssets].sort((a, b) => {
      const aDate = String(a.createdAt || '');
      const bDate = String(b.createdAt || '');
      if (aDate || bDate) return bDate.localeCompare(aDate);
      return String(b.path || b.name || '').localeCompare(String(a.path || a.name || ''));
    });
  }

  function mediaDeleteRequestId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID().replace(/-/g, '');
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 14);
  }

  async function queueMediaDeletion(item) {
    const requestId = mediaDeleteRequestId();
    const requestPath = 'assets/uploads/.writer-media-delete-requests/' + requestId + '.json';
    const request = {
      version: 1,
      requestId,
      requestedAt: new Date().toISOString(),
      storage: item.storage,
      kind: item.kind,
      name: item.name || '',
      assetId: item.storage === 'release' ? Number(item.id) : null,
      path: item.storage === 'repository' ? String(item.path || '') : ''
    };

    await githubFetch('/contents/' + requestPath, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Queue Writer media delete ' + requestId.slice(0, 8),
        content: encodeBase64(JSON.stringify(request, null, 2)),
        branch: 'main'
      })
    }, true);
  }

  async function loadMediaLibrary({ force = false } = {}) {
    if (!mediaLibraryView || mediaLibraryLoading) return;
    if (mediaLibraryLoaded && !force) {
      renderMediaLibrary();
      return;
    }
    if (!githubCredential) {
      mediaLibraryList.innerHTML = '<div class="writer-library-empty">Connect GitHub to load your uploaded media.</div>';
      return;
    }

    mediaLibraryLoading = true;
    mediaLibraryList.innerHTML = '<div class="writer-library-empty">Scanning images, videos and article references…</div>';
    try {
      if (!libraryEntries.length) await loadLibrary({ hydrate: true });
      else await hydrateLibrary();
      mediaLibraryEntries = await scanArticleMedia();
      mediaLibraryLoaded = true;
      renderMediaLibrary();
    } catch (error) {
      mediaLibraryList.innerHTML = '<div class="writer-library-empty">Could not load media: ' + escapeHtml(error.message) + '</div>';
    } finally {
      mediaLibraryLoading = false;
    }
  }

  async function deleteMediaLibraryItem(item) {
    if (!item || !githubCredential) return;
    const usage = mediaLibraryUsage(item);
    const names = usage.map(link => link.title).filter(Boolean);
    const warning = usage.length
      ? '\n\nWARNING: this file is still referenced by ' + names.join(', ') + '. Deleting it will leave broken media in ' + (usage.length === 1 ? 'that article' : 'those articles') + '.'
      : '\n\nWriter does not currently find this file in any article.';
    if (!window.confirm('Delete “' + (item.name || 'this media file') + '” permanently?' + warning + '\n\nThe deletion will be processed by GitHub in the background.')) return;

    try {
      await queueMediaDeletion(item);
      mediaLibraryEntries = mediaLibraryEntries.filter(entry => entry.key !== item.key);
      renderMediaLibrary();
      showToast('Media deletion queued. GitHub will remove the stored file shortly.', 6000);
    } catch (error) {
      showToast('Could not queue media deletion: ' + error.message, 7000);
    }
  }

  function showMediaLibrary({ updateRoute = true, replaceRoute = false } = {}) {
    if (dirty) {
      persistLocalAutosave();
      dirty = false;
    }
    app.dataset.writerScreen = 'media';
    libraryView.hidden = true;
    editorView.hidden = true;
    mediaLibraryView.hidden = false;
    setPublishingControls(Boolean(githubCredential));
    setSaveState('Media');
    setDocumentStatus('Media library');
    setLocalStatus('Uploads and article usage', 'ready');
    if (updateRoute) setWriterRoute('media', { replace: replaceRoute });
    void loadMediaLibrary();
    return true;
  }
