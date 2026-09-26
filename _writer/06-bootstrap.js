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
    if (!/^\/(stats|tale|pick|video|youtube|image|html|source|divider)$/.test(line)) return '';
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
      setHtmlBlockPanel(true);
      showToast('HTML visual inserted. Open Visuals anytime to edit it.');
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

  const statsDialog=app.querySelector('[data-stats-dialog]');
  const taleDialog=app.querySelector('[data-tale-dialog]');

  statsDialog.querySelectorAll('[data-stats-fighter]').forEach(input=>input.addEventListener('input',()=>refreshStatsNameHeaders(statsDialog)));
  taleDialog.querySelectorAll('[data-tale-a],[data-tale-b]').forEach(input=>input.addEventListener('input',()=>refreshTaleNameHeaders(taleDialog)));
  statsDialog.addEventListener('click',event=>{
    const rowAction=event.target.closest('[data-structured-action]');
    if(rowAction){applyStructuredRowAction(rowAction);return;}
    const preset=event.target.closest('[data-stats-preset]')?.dataset.statsPreset;
    if(preset==='ufc'){renderComparisonRows(statsDialog.querySelector('[data-stats-row-list]'),[],statsDefaultRowLabels);return;}
    if(preset==='blank'){renderComparisonRows(statsDialog.querySelector('[data-stats-row-list]'),[]);return;}
    if(event.target.closest('[data-stats-add-row]')) appendComparisonRow(statsDialog.querySelector('[data-stats-row-list]'));
  });

  taleDialog.addEventListener('click',event=>{
    const rowAction=event.target.closest('[data-structured-action]');
    if(rowAction){applyStructuredRowAction(rowAction);return;}
    if(event.target.closest('[data-tale-rows-reset]')){renderComparisonRows(taleDialog.querySelector('[data-tale-row-list]'),[],taleDefaultRowLabels);return;}
    if(event.target.closest('[data-tale-row-add]')){appendComparisonRow(taleDialog.querySelector('[data-tale-row-list]'));return;}
    const formSide=event.target.closest('[data-tale-form-add]')?.dataset.taleFormAdd;
    if(formSide) appendRecentRow(taleDialog.querySelector('[data-tale-form-list="'+formSide+'"]'));
  });

  app.querySelector('[data-stats-insert]').addEventListener('click',()=>{
    const fighterA=statsDialog.querySelector('[data-stats-fighter="a"]').value.trim();
    const fighterB=statsDialog.querySelector('[data-stats-fighter="b"]').value.trim();
    const rows=collectComparisonRows(statsDialog.querySelector('[data-stats-row-list]'));
    if(!rows.length){showToast('Add at least one stat row.');return;}
    const cfg={version:2,fighterA,fighterB,rows};
    const label=fighterA&&fighterB?fighterA+' vs. '+fighterB+' · Stats':'Fight Stats';
    saveStructuredBlock('stats',label,buildStatsVisual(cfg));
    statsDialog.close();
  });

  app.querySelector('[data-tale-insert]').addEventListener('click',()=>{
    const collect=side=>({
      name:taleDialog.querySelector(side==='a'?'[data-tale-a]':'[data-tale-b]').value.trim(),
      division:taleDialog.querySelector('[data-tale-division="'+side+'"]').value.trim(),
      odds:taleDialog.querySelector('[data-tale-odds="'+side+'"]').value.trim(),
      last5:taleDialog.querySelector('[data-tale-last5="'+side+'"]').value.trim(),
      image:taleDialog.querySelector('[data-tale-image-path="'+side+'"]').value.trim(),
      x:Number(taleDialog.querySelector('[data-tale-image-x="'+side+'"]').value||50),
      y:Number(taleDialog.querySelector('[data-tale-image-y="'+side+'"]').value||50),
      zoom:Number(taleDialog.querySelector('[data-tale-image-zoom="'+side+'"]').value||100),
      recent:collectRecentRows(taleDialog.querySelector('[data-tale-form-list="'+side+'"]')),
      opponentsRecord:taleDialog.querySelector('[data-tale-opponents-record="'+side+'"]').value.trim(),
      opponentsPct:taleDialog.querySelector('[data-tale-opponents-pct="'+side+'"]').value.trim()
    });
    const cfg={version:2,a:collect('a'),b:collect('b'),rows:collectComparisonRows(taleDialog.querySelector('[data-tale-row-list]'))};
    if(!cfg.a.name||!cfg.b.name){showToast('Add both fighter names.');return;}
    if(!cfg.rows.length) cfg.rows=normalizeComparisonRows([],taleDefaultRowLabels);
    saveStructuredBlock('tale',cfg.a.name+' vs. '+cfg.b.name,buildTaleVisual(cfg));
    taleDialog.close();
  });

  app.querySelector('[data-pick-insert]').addEventListener('click', () => {
    const dialog = app.querySelector('[data-pick-dialog]');
    const cfg = {
      fighter: dialog.querySelector('[data-pick-fighter]').value.trim(),
      method: dialog.querySelector('[data-pick-method]').value,
      round: dialog.querySelector('[data-pick-round]').value,
      note: dialog.querySelector('[data-pick-note]').value.trim()
    };
    if (!cfg.fighter) { showToast('Add the fighter you are picking.'); return; }
    saveStructuredBlock('pick', 'Pick · ' + cfg.fighter, buildPickVisual(cfg));
    dialog.close();
  });

  async function uploadTalePortrait(side, file) {
    if (!file?.type?.startsWith('image/')) return;
    if (!githubCredential) {
      showToast('Connect GitHub before uploading fighter portraits.', 5000);
      if (!connectDialog.open) connectDialog.showModal();
      return;
    }
    const dialog = app.querySelector('[data-tale-dialog]');
    const localUrl = URL.createObjectURL(file);
    taleImagePreview(side, localUrl);
    try {
      const fighterName = dialog.querySelector(side === 'a' ? '[data-tale-a]' : '[data-tale-b]').value.trim();
      const ext = file.name.match(/\.[^.]+$/)?.[0] || '.jpg';
      const preferred = (slugify(fighterName || ('fighter-' + side)) || ('fighter-' + side)) + '-' + side + ext;
      const path = await uploadAsset(file, preferred);
      dialog.querySelector('[data-tale-image-path="' + side + '"]').value = path;
      taleImagePreview(side);
      showToast('Fighter portrait uploaded.');
    } catch (error) {
      showToast('Portrait upload failed: ' + error.message, 6000);
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(localUrl), 1000);
    }
  }

  ['a','b'].forEach(side => {
    const dialog = app.querySelector('[data-tale-dialog]');
    const drop = dialog.querySelector('[data-tale-image-drop="' + side + '"]');
    const file = dialog.querySelector('[data-tale-image-file="' + side + '"]');
    const path = dialog.querySelector('[data-tale-image-path="' + side + '"]');
    const image = dialog.querySelector('[data-tale-image-preview="' + side + '"]');

    drop.addEventListener('click', event => {
      if (!image.hidden && event.target === image) return;
      file.click();
    });
    drop.addEventListener('dblclick', event => {
      if (!image.hidden && event.target === image) file.click();
    });
    drop.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); file.click(); }
    });
    ['dragenter','dragover'].forEach(type => drop.addEventListener(type, event => {
      if (![...(event.dataTransfer?.items || [])].some(item => item.type.startsWith('image/'))) return;
      event.preventDefault();
      drop.classList.add('is-dragging');
    }));
    ['dragleave','drop'].forEach(type => drop.addEventListener(type, () => drop.classList.remove('is-dragging')));
    drop.addEventListener('drop', event => {
      const portrait = [...(event.dataTransfer?.files || [])].find(item => item.type.startsWith('image/'));
      if (!portrait) return;
      event.preventDefault();
      uploadTalePortrait(side, portrait);
    });
    file.addEventListener('change', () => {
      if (file.files?.[0]) uploadTalePortrait(side, file.files[0]);
    });
    path.addEventListener('input', () => taleImagePreview(side));
    ['x','y','zoom'].forEach(axis => {
      dialog.querySelector('[data-tale-image-' + axis + '="' + side + '"]').addEventListener('input', () => taleImagePreview(side));
    });

    let dragState = null;
    image.addEventListener('pointerdown', event => {
      if (image.hidden) return;
      event.preventDefault();
      image.setPointerCapture?.(event.pointerId);
      dragState = {
        x: event.clientX,
        y: event.clientY,
        startX: Number(dialog.querySelector('[data-tale-image-x="' + side + '"]').value || 50),
        startY: Number(dialog.querySelector('[data-tale-image-y="' + side + '"]').value || 50),
        rect: drop.getBoundingClientRect()
      };
    });
    image.addEventListener('pointermove', event => {
      if (!dragState) return;
      const xInput = dialog.querySelector('[data-tale-image-x="' + side + '"]');
      const yInput = dialog.querySelector('[data-tale-image-y="' + side + '"]');
      xInput.value = String(Math.round(Math.max(0, Math.min(100, dragState.startX + ((event.clientX - dragState.x) / Math.max(1, dragState.rect.width)) * 100))));
      yInput.value = String(Math.round(Math.max(0, Math.min(100, dragState.startY + ((event.clientY - dragState.y) / Math.max(1, dragState.rect.height)) * 100))));
      taleImagePreview(side);
    });
    const stopDrag = () => { dragState = null; };
    image.addEventListener('pointerup', stopDrag);
    image.addEventListener('pointercancel', stopDrag);
  });

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
    setHtmlBlockPanel(true);
    showToast('HTML visual added. Open Visuals anytime to edit it.');
  });

  bodyEditor.addEventListener('dblclick', () => {
    if (htmlBlockAtCursor()) openHtmlDialog();
  });

  htmlBlockPanelToggle?.addEventListener('click', () => {
    setHtmlBlockPanel(!htmlBlockPanelOpen, { focus: !htmlBlockPanelOpen });
  });

  if (htmlBlockRail) htmlBlockRail.addEventListener('click', event => {
    if (event.target.closest('[data-html-block-panel-close]')) {
      setHtmlBlockPanel(false);
      htmlBlockPanelToggle?.focus();
      return;
    }
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
