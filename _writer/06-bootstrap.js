  async function loadHistory() {
    if (!currentPath) { showToast('Save the article before viewing history.'); return; }
    historyList.innerHTML = '<p>Loading history…</p>';
    historyDialog.showModal();
    try {
      const commits = await githubFetch(`/commits?path=${encodeURIComponent(currentPath)}&per_page=12`);
      historyList.innerHTML = commits.length ? commits.map(commit => {
        const message = commit.commit?.message?.split('\n')[0] || 'Update';
        const date = commit.commit?.committer?.date || commit.commit?.author?.date || '';
        return `<a class="writer-history-item" href="${escapeHtml(commit.html_url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(message)}</strong><span>${escapeHtml(formatDateTime(date))} • ${escapeHtml(commit.sha.slice(0,7))}</span></a>`;
      }).join('') : '<p>No revision history found.</p>';
    } catch (error) {
      historyList.innerHTML = `<p>Could not load history: ${escapeHtml(error.message)}</p>`;
    }
  }

  function removeSlashCommand() {
    const cursor = bodyEditor.selectionStart;
    const before = bodyEditor.value.slice(0, cursor);
    const lineStart = before.lastIndexOf('\n') + 1;
    const line = before.slice(lineStart).trim();
    if (!/^\/(table|tale|pick|video|youtube|image|html|source|template|divider)$/.test(line)) return '';
    bodyEditor.setRangeText('', lineStart, cursor, 'end');
    return line.slice(1);
  }

  function copyMarkdown() {
    navigator.clipboard.writeText(fullMarkdown(currentPublished)).then(() => showToast('Full Markdown copied.')).catch(() => showToast('Clipboard access was blocked.'));
  }

  function downloadMarkdown() {
    const blob = new Blob([fullMarkdown(currentPublished)], { type:'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fields.filename.value.trim() || `${fields.date.value || today()}-${slugify(fields.title.value || 'article')}.md`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function schedulePreview() {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(updatePreview, 45);
}

Object.values(fields).forEach(el => {
  el.addEventListener('input', () => {
    if (el === fields.filename && !currentPath) filenameTouched = true;
    schedulePreview();
    updateDocumentStatus();
    scheduleAutosave();
  });
  el.addEventListener('change', () => {
    schedulePreview();
    updateDocumentStatus();
    scheduleAutosave();
  });
});

  app.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    workspace.dataset.viewMode = button.dataset.view;
    app.querySelectorAll('[data-view]').forEach(btn => btn.setAttribute('aria-pressed', String(btn === button)));
  }));
  app.querySelectorAll('[data-preview-size]').forEach(button => button.addEventListener('click', () => {
    previewFrame.dataset.previewSize = button.dataset.previewSize;
    app.querySelectorAll('[data-preview-size]').forEach(btn => btn.setAttribute('aria-pressed', String(btn === button)));
  }));

  setPreviewTheme(readPreviewTheme());
  previewThemeToggle?.addEventListener('click', () => {
    setPreviewTheme(previewFrame.dataset.previewTheme === 'dark' ? 'light' : 'dark', { persist: true });
  });

  app.querySelectorAll('[data-library-filter]').forEach(button => button.addEventListener('click', () => {
    libraryFilter = button.dataset.libraryFilter;
    app.querySelectorAll('[data-library-filter]').forEach(btn => btn.setAttribute('aria-pressed', String(btn === button)));
    renderLibrary();
    hydrateEditedTimes();
  }));

  app.querySelectorAll('[data-insert]').forEach(button => button.addEventListener('click', () => handleSimpleInsert(button.dataset.insert)));
  app.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => openTool(button.dataset.tool)));
  app.querySelector('[data-show-library]').addEventListener('click', showLibrary);
  app.querySelector('[data-new-article]').addEventListener('click', () => resetNewArticle());
  app.querySelector('[data-library-new]').addEventListener('click', () => resetNewArticle());
  app.querySelector('[data-github-connect]').addEventListener('click', () => connectDialog.showModal());
  app.querySelector('[data-github-authorize]').addEventListener('click', connectGitHub);
  saveDraftButton.addEventListener('click', () => saveArticle('save'));
  publishButton.addEventListener('click', requestPublishWithChecks);
  scheduleButton.addEventListener('click', () => saveArticle('schedule'));
  publishCheckProceed.addEventListener('click', () => { publishCheckDialog.close(); saveArticle('publish'); });
  uploadButton.addEventListener('click', uploadFeaturedImage);
  app.querySelector('[data-history]').addEventListener('click', loadHistory);
  app.querySelector('[data-copy-markdown]').addEventListener('click', copyMarkdown);
  app.querySelector('[data-download-markdown]').addEventListener('click', downloadMarkdown);
  librarySearch.addEventListener('input', () => {
    renderLibrary();
    window.clearTimeout(librarySearchTimer);
    librarySearchTimer = window.setTimeout(hydrateEditedTimes, 300);
  });

  libraryList.addEventListener('click', event => {
    const card = event.target.closest('[data-library-path]');
    if (!card) return;
    const path = card.dataset.libraryPath;
    if (event.target.closest('[data-library-edit]')) loadArticle(path);
    if (event.target.closest('[data-library-duplicate]')) duplicateArticle(path);
  });

  imageFileInput.addEventListener('change', () => {
    selectedImageFile = imageFileInput.files?.[0] || null;
    if (localImageUrl) URL.revokeObjectURL(localImageUrl);
    localImageUrl = selectedImageFile ? URL.createObjectURL(selectedImageFile) : '';
    uploadButton.disabled = !selectedImageFile || !githubCredential;
    updatePreview();

    if (!selectedImageFile) return;
    if (githubCredential) {
      uploadFeaturedImage();
    } else {
      showToast('Cover selected locally. Connect GitHub to upload it before saving.', 6000);
    }
  });

  app.querySelector('[data-link-insert]').addEventListener('click', () => {
    const dialog = app.querySelector('[data-link-dialog]');
    const label = dialog.querySelector('[data-link-label]').value.trim() || (linkMode === 'citation' ? 'Source' : 'link');
    const url = dialog.querySelector('[data-link-url]').value.trim();
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) { showToast('Enter a valid URL.'); return; }
    insertAtCursor('[', `](${url})`, label);
    dialog.close();
  });

  app.querySelector('[data-video-insert]').addEventListener('click', async () => {
    const dialog = app.querySelector('[data-video-dialog]');
    const fileInput = dialog.querySelector('[data-inline-video-file]');
    const urlInput = dialog.querySelector('[data-inline-video-url]');
    const captionInput = dialog.querySelector('[data-inline-video-caption]');
    const file = fileInput.files?.[0];
    const url = urlInput.value.trim();
    const caption = captionInput.value.trim();
    const button = dialog.querySelector('[data-video-insert]');

    button.disabled = true;
    button.textContent = file ? 'Uploading…' : 'Placing…';
    try {
      let placed = false;
      if (file) {
        placed = Boolean(await insertInlineVideo(file, caption));
      } else if (url) {
        const markup = inlineVideoMarkup(url, caption);
        if (!markup) { showToast('Enter a valid direct video URL.'); return; }
        insertBlock(markup);
        showToast('Video placed.');
        placed = true;
      } else {
        showToast('Choose a video or enter a direct video URL.');
        return;
      }

      if (placed) {
        fileInput.value = '';
        urlInput.value = '';
        captionInput.value = '';
        window.setTimeout(() => dialog.close(), file ? 500 : 0);
      }
    } finally {
      button.disabled = false;
      button.textContent = 'Place video';
    }
  });

  app.querySelector('[data-youtube-insert]').addEventListener('click', () => {
    const dialog = app.querySelector('[data-youtube-dialog]');
    const id = youtubeId(dialog.querySelector('[data-youtube-url]').value.trim());
    if (!id) { showToast('I could not read that YouTube URL.'); return; }
    const title = dialog.querySelector('[data-youtube-title]').value.trim() || 'YouTube video';
    insertBlock(`<div class="article-video-embed"><iframe src="https://www.youtube.com/embed/${id}" title="${title.replace(/"/g,'&quot;')}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`);
    dialog.close();
  });

  app.querySelector('[data-x-insert]').addEventListener('click', () => {
    const dialog = app.querySelector('[data-x-dialog]');
    const url = xStatusUrl(dialog.querySelector('[data-x-url]').value.trim());
    if (!url) { showToast('Paste a valid X or Twitter status URL.'); return; }
    insertBlock(`[EMBED X](${url})`);
    dialog.querySelector('[data-x-url]').value = '';
    dialog.close();
  });

  app.querySelector('[data-image-insert]').addEventListener('click', async () => {
    const dialog = app.querySelector('[data-image-dialog]');
    const file = dialog.querySelector('[data-inline-image-file]').files?.[0];
    const url = dialog.querySelector('[data-inline-image-url]').value.trim();
    const alt = dialog.querySelector('[data-inline-image-alt]').value.trim();
    const caption = dialog.querySelector('[data-inline-image-caption]').value.trim();
    const flow = dialog.querySelector('[data-inline-image-flow]').value;
    const align = dialog.querySelector('[data-inline-image-align]').value;
    const width = dialog.querySelector('[data-inline-image-width]').value;
    const options = { caption, flow, align, width };
    const button = dialog.querySelector('[data-image-insert]');
    button.disabled = true;
    button.textContent = file ? 'Uploading…' : 'Placing…';
    try {
      if (file) await insertInlineImage(file, alt, options);
      else if (url) insertBlock(inlineImageMarkup(url, alt, options));
      else { showToast('Choose an image or enter an image URL.'); return; }
      dialog.querySelector('[data-inline-image-file]').value = '';
      dialog.querySelector('[data-inline-image-url]').value = '';
      dialog.querySelector('[data-inline-image-alt]').value = '';
      dialog.querySelector('[data-inline-image-caption]').value = '';
      dialog.querySelector('[data-inline-image-flow]').value = 'break';
      dialog.querySelector('[data-inline-image-align]').value = 'center';
      dialog.querySelector('[data-inline-image-width]').value = 'full';
      syncInlineImagePlacementControls(dialog);
      dialog.close();
    } finally {
      button.disabled = false;
      button.textContent = 'Place image';
    }
  });

  app.querySelector('[data-inline-image-flow]').addEventListener('change', event => {
    syncInlineImagePlacementControls(event.currentTarget.closest('[data-image-dialog]'));
  });

  app.querySelector('[data-html-insert]').addEventListener('click', () => {
    const dialog = app.querySelector('[data-html-dialog]');
    const code = dialog.querySelector('[data-html-code]').value.trim();
    if (!code) { showToast('Paste the HTML for the visual first.'); return; }
    if (/<script\b/i.test(code)) {
      const isXEmbed = /twitter-tweet|platform\.(?:twitter|x)\.com\/widgets\.js/i.test(code);
      showToast(isXEmbed
        ? 'Use the Tweet button instead and paste only the X/Twitter post URL.'
        : 'Script tags are not supported in article HTML visuals.', 5000);
      return;
    }
    const normalizedCode = normalizeHtmlVisual(code);
    const label = cleanHtmlLabel(dialog.querySelector('[data-html-label]').value || inferHtmlLabel(normalizedCode));

    if (editingHtmlBlockId && htmlBlocks.has(editingHtmlBlockId)) {
      const block = htmlBlocks.get(editingHtmlBlockId);
      block.label = label;
      block.code = normalizedCode;
      replaceHtmlToken(editingHtmlBlockId, htmlBlockToken(block));
      renderHtmlBlockRail();
      showToast('HTML visual updated.');
    } else {
      const id = htmlBlockId();
      const block = { id, label, code: normalizedCode };
      htmlBlocks.set(id, block);
      insertBlock(htmlBlockToken(block));
      renderHtmlBlockRail();
      showToast('HTML visual inserted as a compact block.');
    }

    editingHtmlBlockId = '';
    dialog.close();
    scheduleAutosave();
    updatePreview();
  });

  app.querySelector('[data-html-delete]').addEventListener('click', () => {
    if (!editingHtmlBlockId || !htmlBlocks.has(editingHtmlBlockId)) return;
    replaceHtmlToken(editingHtmlBlockId, '');
    htmlBlocks.delete(editingHtmlBlockId);
    renderHtmlBlockRail();
    editingHtmlBlockId = '';
    app.querySelector('[data-html-dialog]').close();
    scheduleAutosave();
    updatePreview();
    showToast('HTML visual removed.');
  });

  app.querySelector('[data-table-insert]').addEventListener('click', () => {
    const dialog = app.querySelector('[data-table-dialog]');
    const headers = dialog.querySelector('[data-table-headers]').value.split(',').map(v => v.trim()).filter(Boolean);
    const rows = dialog.querySelector('[data-table-rows]').value.split('\n').map(v => v.trim()).filter(Boolean);
    if (headers.length < 2) { showToast('Add at least two column headers.'); return; }
    const table = [
      `| ${headers.join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`,
      ...rows.map(label => `| ${[label, ...Array(headers.length - 1).fill('')].join(' | ')} |`)
    ].join('\n');
    insertBlock(table);
    dialog.close();
  });

  app.querySelector('[data-tale-insert]').addEventListener('click', () => {
    const dialog = app.querySelector('[data-tale-dialog]');
    const a = dialog.querySelector('[data-tale-a]').value.trim() || 'FIGHTER A';
    const b = dialog.querySelector('[data-tale-b]').value.trim() || 'FIGHTER B';
    const labels = { record:'Record', age:'Age', height:'Height', reach:'Reach', weight:'Weight', stance:'Stance', ko:'KO/TKO Wins', sub:'Submission Wins', dec:'Decision Wins', r1:'1st-Round Finishes' };
    const rows = Object.entries(labels).map(([key,label]) => {
      const va = dialog.querySelector(`[data-tale-row="${key}"][data-side="a"]`).value.trim();
      const vb = dialog.querySelector(`[data-tale-row="${key}"][data-side="b"]`).value.trim();
      return `| ${label} | ${va} | ${vb} |`;
    });
    insertBlock([`|  | ${a.toUpperCase()} | ${b.toUpperCase()} |`, '| --- | ---: | ---: |', ...rows].join('\n'));
    dialog.close();
  });

  app.querySelector('[data-pick-insert]').addEventListener('click', () => {
    const dialog = app.querySelector('[data-pick-dialog]');
    const fighter = dialog.querySelector('[data-pick-fighter]').value.trim();
    if (!fighter) { showToast('Add the fighter you are picking.'); return; }
    const method = dialog.querySelector('[data-pick-method]').value;
    const round = dialog.querySelector('[data-pick-round]').value;
    const confidence = dialog.querySelector('[data-pick-confidence]').value.trim();
    const pick = `**Pick: ${fighter} by ${method}${round ? `, ${round}` : ''}**${confidence ? `\n\nConfidence: ${confidence}/10` : ''}`;
    insertBlock(pick);
    dialog.close();
  });

  app.querySelectorAll('[data-template]').forEach(button => button.addEventListener('click', () => {
    app.querySelector('[data-template-dialog]').close();
    resetNewArticle({ template: button.dataset.template });
  }));

  app.querySelector('[data-conflict-reload]').addEventListener('click', () => {
    conflictDialog.close();
    loadArticle(currentPath, { force: true });
  });
  app.querySelector('[data-conflict-overwrite]').addEventListener('click', () => {
    conflictDialog.close();
    if (pendingRemoteSha) currentSha = pendingRemoteSha;
    const mode = pendingConflictMode || 'save';
    pendingRemoteSha = '';
    pendingConflictMode = '';
    saveArticle(mode, { skipConflict: true });
  });

  const dropzone = app.querySelector('[data-editor-dropzone]');
  const dropHint = app.querySelector('[data-drop-hint]');
  ['dragenter','dragover'].forEach(type => dropzone.addEventListener(type, event => {
    if ([...(event.dataTransfer?.items || [])].some(item => item.type.startsWith('image/') || item.type.startsWith('video/'))) {
      event.preventDefault();
      dropHint.hidden = false;
    }
  }));
  ['dragleave','drop'].forEach(type => dropzone.addEventListener(type, () => { dropHint.hidden = true; }));
  dropzone.addEventListener('drop', async event => {
    const files = [...(event.dataTransfer?.files || [])];
    const file = files.find(item => item.type.startsWith('video/')) || files.find(item => item.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    bodyEditor.focus();
    if (file.type.startsWith('video/')) await insertInlineVideo(file);
    else await insertInlineImage(file);
  });

  bodyEditor.addEventListener('paste', event => {
    const clipboardImage = clipboardImageFile(event.clipboardData);
    if (clipboardImage) {
      event.preventDefault();
      event.stopImmediatePropagation();
      insertClipboardImage(clipboardImage);
      return;
    }

    const pasted = event.clipboardData?.getData('text/plain')?.trim() || '';
    if (!/<(?:section|article|div|table|figure|style|aside|details|svg)\b/i.test(pasted)) return;
    if (/<script\b/i.test(pasted)) { event.preventDefault(); showToast('Script tags are not supported in article HTML visuals.', 5000); return; }
    event.preventDefault();
    const normalizedCode = normalizeHtmlVisual(pasted);
    const id = htmlBlockId();
    const block = { id, label: inferHtmlLabel(normalizedCode), code: normalizedCode };
    htmlBlocks.set(id, block);
    insertBlock(htmlBlockToken(block));
    renderHtmlBlockRail();
    showToast('HTML visual collapsed into one Writer block. Use Embedded visuals to edit it.');
  });

  bodyEditor.addEventListener('dblclick', () => {
    if (htmlBlockAtCursor()) openHtmlDialog();
  });

  if (htmlBlockRail) htmlBlockRail.addEventListener('click', event => {
    const button = event.target.closest('[data-html-block-edit]');
    if (!button) return;
    openHtmlBlockById(button.dataset.htmlBlockEdit);
  });

  if (splitter) {
    splitter.addEventListener('pointerdown', event => {
      if (workspace.dataset.viewMode !== 'split' || window.innerWidth <= 1100) return;
      event.preventDefault();
      splitter.setPointerCapture?.(event.pointerId);
      document.body.classList.add('writer-is-resizing');
      const rect = workspace.getBoundingClientRect();
      const move = moveEvent => {
        const percent = ((moveEvent.clientX - rect.left) / rect.width) * 100;
        applySplitRatio(percent);
      };
      const finish = () => {
        splitter.removeEventListener('pointermove', move);
        splitter.removeEventListener('pointerup', finish);
        splitter.removeEventListener('pointercancel', finish);
        document.body.classList.remove('writer-is-resizing');
        applySplitRatio(splitRatio, { persist: true });
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', finish);
      splitter.addEventListener('pointercancel', finish);
    });
    splitter.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Home') applySplitRatio(50, { persist: true });
      else applySplitRatio(splitRatio + (event.key === 'ArrowRight' ? 2 : -2), { persist: true });
    });
  }

  bodyEditor.addEventListener('keydown', event => {
  const modifier = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (modifier && key === 'b') { event.preventDefault(); handleSimpleInsert('bold'); return; }
  if (modifier && key === 'i') { event.preventDefault(); handleSimpleInsert('italic'); return; }
  if (modifier && key === 'k') { event.preventDefault(); openTool('link'); return; }
  if (event.key === 'Tab' && !modifier) {
    event.preventDefault();
    insertAtCursor('  ');
    return;
  }
  if (event.key === 'Enter') {
    const command = removeSlashCommand();
    if (command) {
      event.preventDefault();
      if (command === 'divider') handleSimpleInsert('divider');
      else openTool(command === 'pick' ? 'prediction' : command);
    }
  }
});

window.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
  event.preventDefault();
  if (!editorView.hidden) saveArticle('save');
});

window.addEventListener('beforeunload', event => {
  if (!dirty) return;
  persistLocalAutosave();
  event.preventDefault();
  event.returnValue = '';
});
window.addEventListener('pagehide', persistLocalAutosave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistLocalAutosave();
});

window.addEventListener('matlock-writer:auth', () => {
  setPublishingControls(true);
  loadLibrary({ hydrate: true });
});
window.addEventListener('matlock-writer:auth-expired', () => setPublishingControls(false));

  fields.date.value = today();
  fields.category.value = 'Breakdown';
  fields.imagePosition.value = 'center center';
  restoreSplitRatio();
  updatePreview();
  updateSaveButtonLabel();
  loadLibrary({ hydrate: false });

  const path = new URLSearchParams(location.search).get('path');
  if (path && /^_posts\/.+\.md$/i.test(path)) {
    loadArticle(path);
  } else {
    const hasNewDraft = (() => {
      try {
        const saved = JSON.parse(localStorage.getItem('matlock-writer:new') || 'null');
        return Boolean(saved && ((saved.title || '') + (saved.body || '')).trim());
      } catch { return false; }
    })();
    if (hasNewDraft) {
      showEditor();
      maybeRestoreLocal('matlock-writer:new');
    } else {
      showLibrary();
    }
  }
})();
