  function isAllowedPublishUrl(value) {
    const url = String(value || '').trim();
    if (!url) return false;
    if (/^(\/|#|mailto:)/i.test(url)) return true;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch { return false; }
  }

  function collectPublishChecks() {
    const issues = [];
    const body = bodyEditor.value || '';
    const expandedBody = expandHtmlBlocks(body);
    const title = fields.title.value.trim();
    const description = fields.description.value.trim();
    const filename = fields.filename.value.trim();
    const articleDate = fields.date.value;

    const add = (level, title, detail = '') => issues.push({ level, title, detail });

    if (!title) add('blocker', 'Title is missing', 'Add the article title before publishing.');
    if (!articleDate) add('blocker', 'Article date is missing', 'Choose the article date before publishing.');
    if (!filename) {
      add('blocker', 'Filename is missing', 'Add a Jekyll post filename before publishing.');
    } else if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/i.test(filename)) {
      add('blocker', 'Filename format is invalid', 'Use YYYY-MM-DD-article-name.md.');
    } else {
      if (articleDate && !filename.startsWith(`${articleDate}-`)) add('warning', 'Filename date does not match article date', `Article date is ${articleDate}, but the filename is ${filename}.`);
      if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(filename)) {
        add('warning', 'Filename looks unusual', 'Lowercase words separated by single hyphens are safest for the public article URL.');
      }
      const slug = filename.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/i, '');
      if (/^(?:article|untitled|draft|test|new-article|copy)(?:-\d+)?$/i.test(slug)) {
        add('warning', 'Filename looks temporary', `The filename is ${filename}. Make sure this is the public URL slug you want.`);
      }
    }

    if (!description) add('warning', 'Description is empty', 'The article can publish, but its listing and social summary will have no description.');
    if (!expandedBody.trim()) add('warning', 'Article body is empty', 'There is no article content below the front matter.');
    if (fields.imagePath.value.trim() && !fields.imageAlt.value.trim()) add('warning', 'Featured image alt text is missing', 'Add a short description of the featured image for accessibility.');
    if (/!\[\s*\]\([^)]+\)/.test(body)) add('warning', 'Inline image is missing alt text', 'At least one Markdown image uses ![](...) with no description.');
    if (dirty) add('warning', 'Unsaved local changes', currentPath
      ? 'This article has changes that have not yet been saved to GitHub. Publishing will save the current version.'
      : 'This new article has not yet been saved to GitHub. Publishing will save the current version.');

    const tokenMatches = [...body.matchAll(/^\[HTML VISUAL · .*? · #([A-Za-z0-9_-]+)\]\s*$/gm)];
    for (const match of tokenMatches) {
      if (!htmlBlocks.has(match[1])) add('blocker', 'HTML visual reference is broken', `Writer cannot find the saved HTML for block #${match[1]}.`);
    }
    for (const block of htmlBlocks.values()) {
      const code = String(block.code || '').trim();
      if (!/^<section\b[\s\S]*<\/section>\s*$/i.test(code)) add('blocker', `HTML visual is malformed: ${cleanHtmlLabel(block.label)}`, 'Each visual must be one complete <section>...</section> block.');
      if (/<script\b/i.test(code)) add('blocker', `HTML visual contains a script: ${cleanHtmlLabel(block.label)}`, 'Script tags are not supported in article visuals.');
    }
    if (/^\[HTML VISUAL · .*? · #[A-Za-z0-9_-]+\]\s*$/m.test(expandedBody)) add('blocker', 'An HTML visual would publish as a placeholder', 'One or more compact Writer HTML blocks could not be expanded back into their original code.');

    const badLinks = new Set();
    for (const match of body.matchAll(/!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
      const url = match[1].trim();
      if (!isAllowedPublishUrl(url)) badLinks.add(url || '(empty URL)');
    }
    for (const line of body.split('\n')) {
      if (/\[[^\]\n]+\]\([^)]*$/.test(line)) badLinks.add('(incomplete Markdown link)');
    }
    for (const match of expandedBody.matchAll(/<a\b[^>]*href=["']([^"']*)["']/gi)) {
      const url = match[1].trim();
      if (!isAllowedPublishUrl(url)) badLinks.add(url || '(empty href)');
    }
    if (badLinks.size) add('blocker', 'Unsafe or malformed link', [...badLinks].slice(0, 3).join(', '));

    return issues;
  }

  function renderPublishChecks(issues) {
    const blockers = issues.filter(item => item.level === 'blocker');
    const warnings = issues.filter(item => item.level === 'warning');
    publishCheckSummary.className = `writer-publish-check-summary ${blockers.length ? 'has-blockers' : 'has-warnings'}`;
    publishCheckSummary.innerHTML = blockers.length
      ? `<strong>${blockers.length} item${blockers.length === 1 ? '' : 's'} must be fixed before publishing.</strong><span>${warnings.length ? `${warnings.length} additional warning${warnings.length === 1 ? '' : 's'} can be reviewed too.` : 'Writer will not publish until the blocking issue is fixed.'}</span>`
      : `<strong>${warnings.length} warning${warnings.length === 1 ? '' : 's'} found.</strong><span>Nothing here blocks publication; review the items or publish anyway.</span>`;
    publishCheckList.innerHTML = issues.map(item => `<div class="writer-publish-check-item is-${item.level}"><span class="writer-publish-check-icon" aria-hidden="true">${item.level === 'blocker' ? '!' : 'i'}</span><div><strong>${escapeHtml(item.title)}</strong>${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ''}</div></div>`).join('');
    publishCheckProceed.hidden = blockers.length > 0;
    publishCheckProceed.disabled = blockers.length > 0;
    publishCheckDialog.showModal();
  }

  function requestPublishWithChecks() {
    const issues = collectPublishChecks();
    if (!issues.length) { saveArticle('publish'); return; }
    renderPublishChecks(issues);
  }

  function validateForSave(mode) {
    if (imageUploadInFlight) throw new Error('Wait for the cover image upload to finish.');
    if (selectedImageFile) throw new Error('Upload the selected cover image before saving.');
    if (!fields.title.value.trim()) throw new Error('Add a title first.');
    if (!fields.date.value) throw new Error('Choose an article date.');
    if (!fields.filename.value.trim()) throw new Error('Add a filename.');
    if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/i.test(fields.filename.value.trim())) throw new Error('Filename must look like YYYY-MM-DD-article-name.md.');
    if (mode === 'schedule') {
      const when = new Date(fields.publishAt.value);
      if (!fields.publishAt.value || Number.isNaN(when.getTime())) throw new Error('Choose a valid publication date and time first.');
      if (when.getTime() <= Date.now() + 60 * 1000) throw new Error('Scheduled publication must be in the future.');
    }
  }

  function updateSaveButtonLabel() {
    saveDraftButton.textContent = currentPublished ? 'Save changes' : 'Save draft';
  }

  function updateDocumentStatus() {
    if (!editorView || editorView.hidden) return;
    if (currentPublished) setDocumentStatus('Published');
    else if (fields.publishAt.value) setDocumentStatus(`Scheduled ${formatDateTime(localInputToIso(fields.publishAt.value))}`);
    else if (currentPath) setDocumentStatus('Draft');
    else setDocumentStatus('New article');
  }

  async function checkRemoteConflict(mode) {
  if (!currentPath || !currentSha) return false;
  try {
    const remote = await githubFetch(`/contents/${encodeURIComponent(currentPath).replace(/%2F/g,'/')}?ref=main`);
    if (remote.sha && remote.sha !== currentSha) {
      pendingConflictMode = mode;
      pendingRemoteSha = remote.sha;
      conflictDialog.showModal();
      return true;
    }
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  return false;
}

async function saveArticle(mode = 'save', { skipConflict = false } = {}) {
  if (saveInFlight) { showToast('A save is already in progress.'); return; }
  try { validateForSave(mode); } catch (error) { showToast(error.message); return; }
  if (!githubCredential) { connectDialog.showModal(); return; }

  const desiredPublished = mode === 'publish' ? true : mode === 'schedule' ? false : currentPublished;
  const filename = fields.filename.value.trim();
  const path = currentPath || `_posts/${filename}`;
  const autosaveKeyBeforeSave = localKey();
  const button = mode === 'publish' ? publishButton : mode === 'schedule' ? scheduleButton : saveDraftButton;
  const oldLabel = button.textContent;
  const clearSchedule = mode === 'publish';

  saveInFlight = true;
  setPublishingControls(false);
  button.textContent = mode === 'publish' ? 'Publishing…' : mode === 'schedule' ? 'Scheduling…' : 'Saving…';
  setSaveState(button.textContent);

  try {
    if (!skipConflict && await checkRemoteConflict(mode)) return;

    if (!currentPath && !skipConflict) {
      try {
        await githubFetch(`/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}?ref=main`);
        showToast('That filename already exists. Change the filename before saving.', 6000);
        return;
      } catch (error) {
        if (error.status !== 404) throw new Error(`Could not verify the filename: ${error.message}`);
      }
    }

    const payload = {
      message: `${mode === 'publish' ? 'Publish' : mode === 'schedule' ? 'Schedule' : 'Update'} ${filename}`,
      content: encodeBase64(fullMarkdown(desiredPublished, { clearSchedule })),
      branch: 'main'
    };
    if (currentSha) payload.sha = currentSha;
    const result = await githubFetch(`/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    }, true);

    currentPath = path;
    currentSha = result.content?.sha || currentSha;
    currentPublished = desiredPublished;
    if (clearSchedule) fields.publishAt.value = '';
    originalFrontmatter = buildFrontmatter(desiredPublished, { clearSchedule });
    fields.filename.disabled = true;
    filenameTouched = true;
    dirty = false;
    window.clearTimeout(autosaveTimer);
    try {
      localStorage.removeItem(autosaveKeyBeforeSave);
      localStorage.removeItem(localKey());
      if (autosaveKeyBeforeSave === 'matlock-writer:new') localStorage.removeItem('matlock-writer:new');
    } catch {}
    updateUrlPath();
    updateSaveButtonLabel();
    updateLiveLink();
    updateDocumentStatus();
    const stamp = new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
    setSaveState(mode === 'publish' ? `Published • ${stamp}` : mode === 'schedule' ? `Scheduled • ${stamp}` : `Saved • ${stamp}`);
    setLocalStatus(`Saved to GitHub · ${stamp}`, 'github');
    showToast(mode === 'publish'
      ? 'Published to GitHub. The public site is deploying now.'
      : mode === 'schedule'
        ? `Scheduled for ${formatDateTime(localInputToIso(fields.publishAt.value))}. GitHub checks due posts about every 15 minutes.`
        : 'Saved to GitHub.');
    loadLibrary({ hydrate: true });
  } catch (error) {
    persistLocalAutosave();
    setSaveState('Save failed • local copy safe');
    showToast(`Save failed: ${error.message}`, 6000);
  } finally {
    saveInFlight = false;
    setPublishingControls(Boolean(githubCredential));
    if (button.textContent.endsWith('…')) button.textContent = oldLabel;
    updateSaveButtonLabel();
  }
}

  function liveUrl() {
    if (!currentPath || !currentPublished) return '';
    const file = currentPath.split('/').pop().replace(/\.md$/i,'');
    const match = file.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
    return match ? `/${match[1]}/${match[2]}/${match[3]}/${match[4]}.html` : '';
  }

  function updateLiveLink() {
    const link = app.querySelector('[data-live-link]');
    const url = liveUrl();
    link.hidden = !url;
    if (url) link.href = url;
  }

  function updateUrlPath() {
    if (!currentPath) return;
    const url = new URL(location.href);
    url.searchParams.set('path', currentPath);
    history.replaceState(null, '', url.pathname + url.search);
  }

