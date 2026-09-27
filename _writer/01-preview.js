  function renderMarkdown(markdown) {
    let source = normalizeMarkdownDividers(markdown);
    source = source.replace(/<!--\s*WRITER_(?:IMAGE|VIDEO)_UPLOAD_[\w:-]+\s*-->/g, '');
    const rawHtmlBlocks = [];
    source = source.replace(/<section\b[\s\S]*?<\/section>/gi, html => {
      const safe = html.replace(/<script[\s\S]*?<\/script>/gi, '');
      rawHtmlBlocks.push(safe);
      return `\n@@RAWHTML${rawHtmlBlocks.length - 1}@@\n`;
    });
    source = source.replace(/<figure\b[^>]*class=["'][^"']*\barticle-inline-(?:image|video)\b[^"']*["'][^>]*>[\s\S]*?<\/figure>/gi, html => {
      const safe = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
        .replace(/\s(?:href|src)\s*=\s*(["'])javascript:[\s\S]*?\1/gi, '');
      rawHtmlBlocks.push(safe);
      return `\n@@RAWHTML${rawHtmlBlocks.length - 1}@@\n`;
    });
    const embeds = [];
    source = source.replace(/<div[^>]*>\s*(<iframe[\s\S]*?<\/iframe>)\s*<\/div>/gi, '$1');
    source = source.replace(/<iframe[\s\S]*?<\/iframe>/gi, html => {
      const allowed = allowedYoutubeEmbed(html);
      if (!allowed) return '';
      embeds.push(allowed);
      return `\n@@EMBED${embeds.length - 1}@@\n`;
    });
    source = source.replace(/<script[\s\S]*?<\/script>/gi, '');

    const lines = source.split('\n');
    const out = [];
    let tableRenderIndex = 0;
    let i = 0;
    const special = line => /^\s*(#{1,6}\s|```|>|[-*+]\s+|\d+\.\s+|(?:---+|___+|\*\*\*+)\s*$|@@(?:EMBED|RAWHTML)\d+@@\s*$)/.test(line);

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i += 1; continue; }
      const rawHtml = line.trim().match(/^@@RAWHTML(\d+)@@$/);
      if (rawHtml) { out.push(rawHtmlBlocks[Number(rawHtml[1])] || ''); i += 1; continue; }
      const embed = line.trim().match(/^@@EMBED(\d+)@@$/);
      if (embed) { out.push(embeds[Number(embed[1])] || ''); i += 1; continue; }
      const fence = line.match(/^\s*```([^\s]*)\s*$/);
      if (fence) {
        const code = [];
        i += 1;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i += 1; }
        if (i < lines.length) i += 1;
        out.push(`<pre><code${fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }
      const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        out.push(`<h${level}>${inlineMarkdown(heading[2].replace(/\s+#+\s*$/, ''))}</h${level}>`);
        i += 1;
        continue;
      }
      if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) { out.push('<hr>'); i += 1; continue; }
      if (i + 1 < lines.length && line.includes('|') && isTableSeparator(lines[i + 1])) {
        const headers = splitCells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !special(lines[i])) {
          rows.push(splitCells(lines[i]));
          i += 1;
        }
        out.push(`<table data-writer-table-index="${tableRenderIndex++}"><thead><tr>${headers.map(c => `<th>${inlineMarkdown(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, idx) => `<td>${inlineMarkdown(row[idx] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        continue;
      }
      if (/^\s*>/.test(line)) {
        const parts = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          parts.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        const paragraphs = [];
        let current = [];
        const flush = () => {
          if (!current.length) return;
          paragraphs.push(current.join('\n'));
          current = [];
        };
        parts.forEach(part => {
          if (!part.trim()) flush();
          else current.push(part.trim());
        });
        flush();
        out.push(`<blockquote>${(paragraphs.length ? paragraphs : ['']).map(part => `<p>${inlineMarkdown(part)}</p>`).join('')}</blockquote>`);
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i += 1; }
        out.push(`<ul>${items.map(item => `<li>${inlineMarkdown(item)}</li>`).join('')}</ul>`);
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i += 1; }
        out.push(`<ol>${items.map(item => `<li>${inlineMarkdown(item)}</li>`).join('')}</ol>`);
        continue;
      }
      const para = [line.trim()];
      i += 1;
      while (i < lines.length && lines[i].trim() && !special(lines[i]) && !(i + 1 < lines.length && lines[i].includes('|') && isTableSeparator(lines[i + 1]))) {
        para.push(lines[i].trim());
        i += 1;
      }
      out.push(`<p>${inlineMarkdown(para.join('\n'))}</p>`);
    }
    return out.join('\n');
  }

  function formatDate(dateString) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString || '')) return '';
    const [y,m,d] = dateString.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,d)));
  }

  function formatDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(d);
  }

  function writerPreviewAssetUrl(path, retry = 0) {
    const normalized = normalizeImagePath(path);
    if (/^\/assets\/uploads\//i.test(normalized)) {
      const base = `https://raw.githubusercontent.com/${repo}/main${normalized}`;
      return retry ? `${base}?writer_retry=${retry}-${Date.now()}` : base;
    }
    return normalized;
  }

  function clearFeaturedImageRetry() {
    window.clearTimeout(featuredImageRetryTimer);
    featuredImageRetryTimer = 0;
    featuredImageRetryCount = 0;
    featuredImageRetrySource = '';
  }

  function clearLocalFeaturedPreview() {
    if (localImageUrl) URL.revokeObjectURL(localImageUrl);
    localImageUrl = '';
    selectedImageFile = null;
    if (imageFileInput) imageFileInput.value = '';
    clearFeaturedImageRetry();
  }

  function loadFeaturedImagePreview(image, shell, imageError, source) {
    const canonical = normalizeImagePath(source);
    if (!canonical) return;

    if (featuredImageRetrySource !== canonical) {
      clearFeaturedImageRetry();
      featuredImageRetrySource = canonical;
    }

    shell.classList.remove('is-missing');
    shell.classList.add('is-loading');
    if (imageError) imageError.hidden = true;
    image.dataset.writerCanonicalSource = canonical;

    image.onload = () => {
      if (image.dataset.writerCanonicalSource !== canonical) return;
      window.clearTimeout(featuredImageRetryTimer);
      featuredImageRetryTimer = 0;
      featuredImageRetryCount = 0;
      shell.classList.remove('is-loading', 'is-missing');
      if (imageError) imageError.hidden = true;
    };

    image.onerror = () => {
      if (image.dataset.writerCanonicalSource !== canonical || localImageUrl) return;
      const delays = [900, 1600, 2800, 4500, 7000, 10000, 15000];
      if (featuredImageRetryCount < delays.length) {
        const attempt = featuredImageRetryCount + 1;
        const delay = delays[featuredImageRetryCount];
        featuredImageRetryCount = attempt;
        shell.classList.remove('is-missing');
        shell.classList.add('is-loading');
        if (imageError) imageError.hidden = true;
        window.clearTimeout(featuredImageRetryTimer);
        featuredImageRetryTimer = window.setTimeout(() => {
          if (image.dataset.writerCanonicalSource !== canonical || localImageUrl) return;
          image.src = writerPreviewAssetUrl(canonical, attempt);
        }, delay);
        return;
      }
      shell.classList.remove('is-loading');
      shell.classList.add('is-missing');
      if (imageError) imageError.hidden = false;
    };

    image.src = writerPreviewAssetUrl(canonical, featuredImageRetryCount);
  }

  function hydratePreviewImages() {
    if (!previewContent) return;
    previewContent.querySelectorAll('img').forEach(img => {
      const original = img.dataset.writerSource || img.getAttribute('src') || '';
      if (!img.dataset.writerSource && /^\/assets\/uploads\//i.test(original)) {
        img.dataset.writerSource = original;
      }
      const source = img.dataset.writerSource || original;
      if (!/^\/assets\/uploads\//i.test(source)) return;

      let attempt = Number(img.dataset.writerRetryAttempt || '0');
      const setSource = () => {
        img.setAttribute('src', writerPreviewAssetUrl(source, attempt));
      };

      img.onload = () => {
        img.dataset.writerRetryAttempt = '0';
        const timer = inlineImageRetryTimers.get(img);
        if (timer) window.clearTimeout(timer);
        inlineImageRetryTimers.delete(img);
      };

      img.onerror = () => {
        const delays = [900, 1600, 2800, 4500, 7000, 10000];
        if (attempt >= delays.length) return;
        const delay = delays[attempt];
        attempt += 1;
        img.dataset.writerRetryAttempt = String(attempt);
        const timer = window.setTimeout(() => {
          if (!img.isConnected) return;
          setSource();
        }, delay);
        inlineImageRetryTimers.set(img, timer);
      };

      const current = img.getAttribute('src') || '';
      const expected = writerPreviewAssetUrl(source, attempt);
      if (current !== expected && !/^https:\/\/raw\.githubusercontent\.com\//i.test(current)) {
        img.setAttribute('src', expected);
      }
    });
  }

  function normalizeImagePath(path) {
    const p = String(path || '').trim();
    if (!p) return '';
    if (/^(https?:\/\/|blob:|data:)/i.test(p)) return p;
    return p.startsWith('/') ? p : `/${p}`;
  }

  function countWords(text) {
    const clean = String(text || '').replace(/<[^>]+>/g,' ').replace(/[#*_>`|\[\]()!-]/g,' ');
    const words = clean.trim().match(/\b[\w’'-]+\b/g);
    return words ? words.length : 0;
  }

  function previewEmbedKey(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.matches('.writer-embed[data-writer-embed-src]')) {
      return `youtube:${node.getAttribute('data-writer-embed-src') || ''}`;
    }
    if (node.matches('.writer-x-embed[data-writer-x-url]')) {
      return `x:${node.getAttribute('data-writer-x-url') || ''}`;
    }
    if (node.matches('figure.article-inline-image, figure.article-inline-video')) {
      const mediaId = node.getAttribute('data-writer-media-id') || '';
      if (mediaId) return 'media:' + mediaId;
      if (node.matches('figure.article-inline-image')) {
        const img = node.querySelector('img');
        const source = img?.dataset.writerSource || img?.getAttribute('src') || '';
        if (source) return 'image:' + source;
      } else {
        const video = node.querySelector('video');
        const source = video?.getAttribute('src') || video?.querySelector('source')?.getAttribute('src') || video?.currentSrc || '';
        if (source) return 'video:' + source;
      }
    }
    if (node.matches('p')) {
      const links = node.querySelectorAll('a');
      if (links.length === 1 && node.textContent.trim().toUpperCase() === 'EMBED X') {
        const clean = xStatusUrl(links[0].href);
        if (clean) return `x:${clean}`;
      }
    }
    return '';
  }

  function syncPreviewMediaLayout(existing, next) {
    if (!existing?.matches?.('figure.article-inline-image, figure.article-inline-video')) return;
    if (!next?.matches?.('figure.article-inline-image, figure.article-inline-video')) return;

    [...existing.classList].forEach(name => {
      if (/^article-inline-(?:image|video)--(?:break|wrap|left|center|right|small|medium|large|full)$/.test(name)) existing.classList.remove(name);
    });
    [...next.classList].forEach(name => {
      if (/^article-inline-(?:image|video)--(?:break|wrap|left|center|right|small|medium|large|full)$/.test(name)) existing.classList.add(name);
    });
    ['writerMediaId','mediaFlow','mediaAlign','mediaWidth'].forEach(key => {
      if (next.dataset[key] !== undefined) existing.dataset[key] = next.dataset[key];
      else delete existing.dataset[key];
    });
    const width = next.style.getPropertyValue('--media-width');
    if (width) existing.style.setProperty('--media-width', width);
    else existing.style.removeProperty('--media-width');
  }

  function patchPreviewContent(html) {
    const template = document.createElement('template');
    template.innerHTML = html || '<p class="writer-preview-empty">Start writing on the left. Your article will appear here immediately.</p>';
    const nextElements = [...template.content.children];
    const neededEmbedKeys = new Set(nextElements.map(previewEmbedKey).filter(Boolean));
    let cursor = previewContent.firstElementChild;

    for (const next of nextElements) {
      const nextKey = previewEmbedKey(next);
      if (nextKey) {
        if (cursor && previewEmbedKey(cursor) === nextKey) {
          syncPreviewMediaLayout(cursor, next);
          cursor = cursor.nextElementSibling;
          continue;
        }
        const existing = [...previewContent.children].find(child => previewEmbedKey(child) === nextKey);
        if (existing) {
          syncPreviewMediaLayout(existing, next);
          previewContent.insertBefore(existing, cursor || null);
          cursor = existing.nextElementSibling;
          continue;
        }
      }

      if (cursor) {
        const cursorKey = previewEmbedKey(cursor);
        if (cursorKey && neededEmbedKeys.has(cursorKey)) {
          previewContent.insertBefore(next, cursor);
        } else {
          const old = cursor;
          cursor = old.nextElementSibling;
          previewContent.replaceChild(next, old);
        }
      } else {
        previewContent.appendChild(next);
      }
    }

    while (cursor) {
      const next = cursor.nextElementSibling;
      cursor.remove();
      cursor = next;
    }
    [...previewContent.childNodes].forEach(node => {
      if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) node.remove();
    });
  }

  function sourceMediaBlocks(text = bodyEditor.value) {
    return [...String(text || '').matchAll(/<figure\b[^>]*class=["'][^"']*\barticle-inline-(?:image|video)\b[^"']*["'][^>]*>[\s\S]*?<\/figure>/gi)];
  }

  function mediaSourceBlockForFigure(figure) {
    const previewFigures = [...previewContent.querySelectorAll('figure.article-inline-image, figure.article-inline-video')];
    const index = previewFigures.indexOf(figure);
    const blocks = sourceMediaBlocks();
    return index >= 0 ? (blocks[index] || null) : null;
  }

  function ensurePreviewMediaIdentity(figure) {
    if (!figure) return '';
    if (figure.dataset.writerMediaId) return figure.dataset.writerMediaId;

    const blockMatch = mediaSourceBlockForFigure(figure);
    if (!blockMatch) return '';

    const existing = blockMatch[0].match(/\bdata-writer-media-id=["']([^"']+)["']/i)?.[1] || '';
    const id = existing || mediaBlockId();
    figure.dataset.writerMediaId = id;
    if (existing) return id;

    const opening = blockMatch[0].match(/^<figure\b[^>]*>/i)?.[0] || '';
    if (!opening) return '';
    const replacementOpening = opening.replace(/^<figure\b/i, '<figure data-writer-media-id="' + id + '"');
    const replacementBlock = blockMatch[0].replace(opening, replacementOpening);
    bodyEditor.value = bodyEditor.value.slice(0, blockMatch.index) + replacementBlock + bodyEditor.value.slice(blockMatch.index + blockMatch[0].length);
    return id;
  }

  function readPreviewMediaLayout(figure) {
    const classList = figure?.classList;
    const flow = figure?.dataset.mediaFlow === 'wrap' || classList?.contains('article-inline-image--wrap') || classList?.contains('article-inline-video--wrap') ? 'wrap' : 'break';
    let align = figure?.dataset.mediaAlign || '';
    if (!['left','center','right'].includes(align)) {
      align = classList?.contains('article-inline-image--right') || classList?.contains('article-inline-video--right')
        ? 'right'
        : classList?.contains('article-inline-image--left') || classList?.contains('article-inline-video--left')
          ? 'left'
          : 'center';
    }
    let width = Number.parseFloat(figure?.dataset.mediaWidth || figure?.style.getPropertyValue('--media-width'));
    if (!Number.isFinite(width)) {
      if (classList?.contains('article-inline-image--small')) width = 35;
      else if (classList?.contains('article-inline-image--medium')) width = 50;
      else if (classList?.contains('article-inline-image--large')) width = 70;
      else width = flow === 'wrap' ? 50 : 100;
    }
    width = mediaWidthValue(width, flow);
    return { flow, align, width };
  }

  function applyPreviewMediaLayout(figure, layout) {
    if (!figure) return;
    const base = figure.matches('.article-inline-video') ? 'article-inline-video' : 'article-inline-image';
    const nextFlow = layout.flow === 'wrap' ? 'wrap' : 'break';
    let nextAlign = ['left','center','right'].includes(layout.align) ? layout.align : 'center';
    if (nextFlow === 'wrap' && nextAlign === 'center') nextAlign = 'left';
    const nextWidth = mediaWidthValue(layout.width, nextFlow);

    [...figure.classList].forEach(name => {
      if (new RegExp('^' + base + '--(?:break|wrap|left|center|right|small|medium|large|full)$').test(name)) figure.classList.remove(name);
    });
    figure.classList.add(base + '--' + nextFlow, base + '--' + nextAlign);
    figure.dataset.mediaFlow = nextFlow;
    figure.dataset.mediaAlign = nextAlign;
    figure.dataset.mediaWidth = String(Math.round(nextWidth * 10) / 10);
    figure.style.setProperty('--media-width', nextWidth + '%');
    syncPreviewMediaTools(figure);
  }

  function rewriteMediaOpeningTag(opening, figure) {
    const holder = document.createElement('div');
    holder.innerHTML = opening + '</figure>';
    const node = holder.querySelector('figure');
    if (!node) return opening;

    const layout = readPreviewMediaLayout(figure);
    const base = figure.matches('.article-inline-video') ? 'article-inline-video' : 'article-inline-image';
    [...node.classList].forEach(name => {
      if (new RegExp('^' + base + '--(?:break|wrap|left|center|right|small|medium|large|full)$').test(name)) node.classList.remove(name);
    });
    node.classList.add(base + '--' + layout.flow, base + '--' + layout.align);
    node.dataset.writerMediaId = figure.dataset.writerMediaId || node.dataset.writerMediaId || mediaBlockId();
    node.dataset.mediaFlow = layout.flow;
    node.dataset.mediaAlign = layout.align;
    node.dataset.mediaWidth = String(Math.round(layout.width * 10) / 10);
    node.style.setProperty('--media-width', layout.width + '%');

    return node.outerHTML.match(/^<figure\b[^>]*>/i)?.[0] || opening;
  }

  function persistPreviewMediaLayout(figure) {
    if (!ensurePreviewMediaIdentity(figure)) {
      showToast('Could not match that media block back to the article source.', 5000);
      return false;
    }

    const blockMatch = mediaSourceBlockForFigure(figure);
    if (!blockMatch) return false;
    const opening = blockMatch[0].match(/^<figure\b[^>]*>/i)?.[0] || '';
    if (!opening) return false;

    const replacementOpening = rewriteMediaOpeningTag(opening, figure);
    const replacementBlock = blockMatch[0].replace(opening, replacementOpening);
    bodyEditor.value = bodyEditor.value.slice(0, blockMatch.index) + replacementBlock + bodyEditor.value.slice(blockMatch.index + blockMatch[0].length);
    bodyEditor.dispatchEvent(new Event('input', { bubbles:true }));
    return true;
  }

  function snappedMediaWidth(value, flow) {
    const max = flow === 'wrap' ? 60 : 100;
    let width = Math.max(25, Math.min(max, value));
    const stops = flow === 'wrap' ? [33, 50, 60] : [33, 50, 66, 100];
    const snap = stops.find(stop => Math.abs(stop - width) <= 1.4);
    if (snap !== undefined) width = snap;
    return Math.round(width * 10) / 10;
  }

  function syncPreviewMediaTools(figure) {
    const toolbar = figure?.querySelector(':scope > .writer-media-toolbar');
    const handle = figure?.querySelector(':scope > .writer-media-resize-handle');
    if (!toolbar) return;
    const layout = readPreviewMediaLayout(figure);
    toolbar.querySelectorAll('[data-media-layout]').forEach(button => {
      const mode = button.dataset.mediaLayout;
      const active = mode === 'full'
        ? layout.flow === 'break' && layout.width >= 99.5
        : mode === 'break'
          ? layout.flow === 'break' && layout.width < 99.5
          : mode === 'wrap-left'
            ? layout.flow === 'wrap' && layout.align === 'left'
            : layout.flow === 'wrap' && layout.align === 'right';
      button.setAttribute('aria-pressed', String(active));
    });
    const label = toolbar.querySelector('[data-media-width-label]');
    if (label) label.textContent = Math.round(layout.width) + '%';
    if (handle) {
      handle.classList.toggle('is-left-handle', layout.align === 'right');
      handle.setAttribute('aria-label', 'Resize media, currently ' + Math.round(layout.width) + ' percent width');
    }
  }

  function hydratePreviewMediaTools() {
    if (!previewContent) return;
    previewContent.querySelectorAll('figure.article-inline-image, figure.article-inline-video').forEach(figure => {
      applyPreviewMediaLayout(figure, readPreviewMediaLayout(figure));
      if (figure.dataset.writerMediaTools === 'ready') {
        syncPreviewMediaTools(figure);
        return;
      }
      figure.dataset.writerMediaTools = 'ready';

      const toolbar = document.createElement('div');
      toolbar.className = 'writer-media-toolbar';
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', 'Media layout');
      toolbar.innerHTML = [
        '<button type="button" data-media-layout="break" aria-pressed="false" title="Keep text above and below">Break</button>',
        '<button type="button" data-media-layout="wrap-left" aria-pressed="false" title="Wrap text on the right">Wrap L</button>',
        '<button type="button" data-media-layout="wrap-right" aria-pressed="false" title="Wrap text on the left">Wrap R</button>',
        '<button type="button" data-media-layout="full" aria-pressed="false" title="Full article width">Full</button>',
        '<span data-media-width-label aria-hidden="true"></span>'
      ].join('');

      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'writer-media-resize-handle';
      handle.title = 'Drag to resize';
      handle.innerHTML = '<span aria-hidden="true"></span>';

      figure.append(toolbar, handle);
      syncPreviewMediaTools(figure);

      toolbar.addEventListener('pointerdown', event => event.stopPropagation());
      toolbar.addEventListener('click', event => {
        event.stopPropagation();
        const button = event.target.closest('[data-media-layout]');
        if (!button) return;

        ensurePreviewMediaIdentity(figure);
        const current = readPreviewMediaLayout(figure);
        let next = { ...current };
        if (button.dataset.mediaLayout === 'full') {
          next = { flow:'break', align:'center', width:100 };
        } else if (button.dataset.mediaLayout === 'break') {
          next = { flow:'break', align:'center', width:Math.min(100, current.width) };
        } else if (button.dataset.mediaLayout === 'wrap-left') {
          next = { flow:'wrap', align:'left', width:current.width > 60 ? 50 : current.width };
        } else if (button.dataset.mediaLayout === 'wrap-right') {
          next = { flow:'wrap', align:'right', width:current.width > 60 ? 50 : current.width };
        }
        applyPreviewMediaLayout(figure, next);
        persistPreviewMediaLayout(figure);
      });

      handle.addEventListener('click', event => event.stopPropagation());
      handle.addEventListener('pointerdown', event => {
        event.preventDefault();
        event.stopPropagation();
        ensurePreviewMediaIdentity(figure);

        const contentRect = previewContent.getBoundingClientRect();
        const figureRect = figure.getBoundingClientRect();
        const current = readPreviewMediaLayout(figure);
        const startWidth = Math.max(25, Math.min(current.flow === 'wrap' ? 60 : 100, (figureRect.width / contentRect.width) * 100));
        const startX = event.clientX;
        const multiplier = current.align === 'center' ? 2 : current.align === 'right' ? -1 : 1;

        figure.classList.add('is-resizing');
        handle.setPointerCapture?.(event.pointerId);

        const move = moveEvent => {
          const deltaPercent = ((moveEvent.clientX - startX) / contentRect.width) * 100 * multiplier;
          const width = snappedMediaWidth(startWidth + deltaPercent, current.flow);
          applyPreviewMediaLayout(figure, { ...current, width });
        };
        const finish = finishEvent => {
          handle.releasePointerCapture?.(event.pointerId);
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', finish);
          handle.removeEventListener('pointercancel', finish);
          figure.classList.remove('is-resizing');
          persistPreviewMediaLayout(figure);
          finishEvent?.stopPropagation?.();
        };

        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
      });
    });
  }

  function videoControlIcon(kind) {
    if (kind === 'play') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
    if (kind === 'pause') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"></path></svg>';
    if (kind === 'sound') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm11.5 3a3.5 3.5 0 0 0-1.5-2.87v5.74A3.5 3.5 0 0 0 15.5 12zm0-6.18v2.06A5.5 5.5 0 0 1 18 12a5.5 5.5 0 0 1-2.5 4.12v2.06A7.5 7.5 0 0 0 20 12a7.5 7.5 0 0 0-4.5-6.18z"></path></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.6 3 2.2-2.2-1.4-1.4-2.2 2.2L13 8.4 11.6 9.8l2.2 2.2-2.2 2.2 1.4 1.4 2.2-2.2 2.2 2.2 1.4-1.4z"></path></svg>';
  }

  function hydratePreviewVideos() {
    if (!previewContent) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    previewContent.querySelectorAll('figure.article-inline-video').forEach(figure => {
      const video = figure.querySelector('video');
      if (!video) return;

      let stage = figure.querySelector('.article-inline-video-stage');
      if (!stage) {
        stage = document.createElement('div');
        stage.className = 'article-inline-video-stage';
        video.before(stage);
        stage.appendChild(video);
      }

      video.controls = false;
      video.removeAttribute('controls');
      video.loop = true;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute('loop', '');
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('autoplay', '');
      video.tabIndex = 0;

      if (figure.dataset.writerVideoUi === 'ready') return;
      figure.dataset.writerVideoUi = 'ready';

      const controls = document.createElement('div');
      controls.className = 'article-inline-video-controls';
      controls.innerHTML = `
        <button type="button" class="article-inline-video-control" data-video-play aria-label="Pause video" title="Pause">${videoControlIcon('pause')}</button>
        <button type="button" class="article-inline-video-control" data-video-sound aria-label="Turn sound on" title="Sound on">${videoControlIcon('muted')}</button>
      `;
      stage.appendChild(controls);

      const playButton = controls.querySelector('[data-video-play]');
      const soundButton = controls.querySelector('[data-video-sound]');

      const sync = () => {
        const paused = video.paused;
        figure.classList.toggle('is-paused', paused);
        figure.classList.toggle('is-muted', video.muted);
        playButton.innerHTML = videoControlIcon(paused ? 'play' : 'pause');
        playButton.setAttribute('aria-label', paused ? 'Play video' : 'Pause video');
        playButton.title = paused ? 'Play' : 'Pause';
        soundButton.innerHTML = videoControlIcon(video.muted ? 'muted' : 'sound');
        soundButton.setAttribute('aria-label', video.muted ? 'Turn sound on' : 'Mute video');
        soundButton.title = video.muted ? 'Sound on' : 'Mute';
      };

      const togglePlay = () => {
        if (video.paused) video.play().catch(() => {});
        else video.pause();
      };

      playButton.addEventListener('click', event => {
        event.stopPropagation();
        togglePlay();
      });
      soundButton.addEventListener('click', event => {
        event.stopPropagation();
        video.muted = !video.muted;
        if (video.paused) video.play().catch(() => {});
        sync();
      });
      video.addEventListener('click', togglePlay);
      video.addEventListener('play', sync);
      video.addEventListener('pause', sync);
      video.addEventListener('volumechange', sync);
      video.addEventListener('keydown', event => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          togglePlay();
        } else if (event.key.toLowerCase() === 'm') {
          event.preventDefault();
          video.muted = !video.muted;
          sync();
        }
      });

      if (reducedMotion) video.pause();
      else video.play().catch(() => {});
      sync();
    });
  }


  function markdownTableRanges(text = bodyEditor.value) {
    const source = String(text || '').replace(/\r\n?/g, '\n');
    const lines = source.split('\n');
    const starts = [];
    let cursor = 0;
    lines.forEach((line, index) => {
      starts[index] = cursor;
      cursor += line.length + (index < lines.length - 1 ? 1 : 0);
    });

    const ranges = [];
    let i = 0;
    while (i < lines.length - 1) {
      if (!lines[i].includes('|') || !isTableSeparator(lines[i + 1])) {
        i += 1;
        continue;
      }

      const startLine = i;
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) i += 1;
      const endLine = Math.max(startLine + 1, i - 1);
      ranges.push({
        start: starts[startLine],
        end: starts[endLine] + lines[endLine].length
      });
    }
    return ranges;
  }

  function plainTableCell(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s*\n+\s*/g, ' ')
      .replace(/\|/g, '\\|')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function markdownFromPreviewTable(table) {
    const headers = [...table.querySelectorAll('thead th')].map(cell => plainTableCell(cell.textContent));
    if (headers.length < 2) return '';
    const rows = [...table.querySelectorAll('tbody tr')].map(row => {
      const cells = [...row.querySelectorAll('td')].map(cell => plainTableCell(cell.textContent));
      while (cells.length < headers.length) cells.push('');
      return cells.slice(0, headers.length);
    });
    return [
      '| ' + headers.join(' | ') + ' |',
      '| ' + headers.map(() => '---').join(' | ') + ' |',
      ...rows.map(row => '| ' + row.join(' | ') + ' |')
    ].join('\n');
  }

  function persistPreviewTable(table) {
    const index = Number(table?.dataset.writerTableIndex);
    if (!Number.isInteger(index) || index < 0) return false;
    const ranges = markdownTableRanges();
    const range = ranges[index];
    const markdown = markdownFromPreviewTable(table);
    if (!range || !markdown) return false;

    bodyEditor.value = bodyEditor.value.slice(0, range.start) + markdown + bodyEditor.value.slice(range.end);
    scheduleAutosave();
    return true;
  }

  function setPreviewTableEditing(shell, enabled) {
    const table = shell?.querySelector('table[data-writer-table-index]');
    if (!table) return;
    shell.classList.toggle('is-editing', enabled);
    table.querySelectorAll('th,td').forEach(cell => {
      if (enabled) {
        cell.setAttribute('contenteditable', 'plaintext-only');
        cell.setAttribute('spellcheck', 'true');
      } else {
        cell.removeAttribute('contenteditable');
        cell.removeAttribute('spellcheck');
      }
    });
    const button = shell.querySelector('[data-preview-table-edit]');
    if (button) button.textContent = enabled ? 'Done' : 'Edit cells';
    if (!enabled) {
      window.clearTimeout(table._writerTableTimer);
      persistPreviewTable(table);
      updatePreview();
    }
  }

  function hydratePreviewTables() {
    if (!previewContent) return;
    previewContent.querySelectorAll('table[data-writer-table-index]').forEach(table => {
      if (table.closest('.writer-preview-table-shell')) return;

      const shell = document.createElement('div');
      shell.className = 'writer-preview-table-shell';
      table.replaceWith(shell);
      shell.append(table);

      const tools = document.createElement('div');
      tools.className = 'writer-preview-block-tools writer-preview-table-tools';
      tools.innerHTML = '<span>Table</span><button type="button" data-preview-table-edit>Edit cells</button>';
      shell.prepend(tools);

      tools.querySelector('[data-preview-table-edit]').addEventListener('click', event => {
        event.stopPropagation();
        setPreviewTableEditing(shell, !shell.classList.contains('is-editing'));
      });

      table.addEventListener('input', () => {
        window.clearTimeout(table._writerTableTimer);
        table._writerTableTimer = window.setTimeout(() => persistPreviewTable(table), 120);
      });

      table.addEventListener('keydown', event => {
        if (event.key === 'Escape' && shell.classList.contains('is-editing')) {
          event.preventDefault();
          setPreviewTableEditing(shell, false);
        }
      });
    });
  }

  function previewHtmlCode(section) {
    const clone = section.cloneNode(true);
    clone.removeAttribute('data-writer-html-block-id');
    clone.removeAttribute('contenteditable');
    clone.removeAttribute('spellcheck');
    clone.querySelectorAll('[contenteditable]').forEach(node => node.removeAttribute('contenteditable'));
    clone.querySelectorAll('[spellcheck]').forEach(node => node.removeAttribute('spellcheck'));
    return clone.outerHTML.trim();
  }

  function persistPreviewHtmlVisual(section) {
    const id = section?.dataset.writerHtmlBlockId || '';
    const block = htmlBlocks.get(id);
    if (!block) return false;
    block.code = previewHtmlCode(section);
    scheduleAutosave();
    return true;
  }

  function setPreviewHtmlEditing(shell, enabled) {
    const section = shell?.querySelector('section[data-writer-html-block-id]');
    if (!section) return;
    shell.classList.toggle('is-editing', enabled);
    if (enabled) {
      section.setAttribute('contenteditable', 'true');
      section.setAttribute('spellcheck', 'true');
      section.focus({ preventScroll: true });
    } else {
      window.clearTimeout(section._writerHtmlTimer);
      persistPreviewHtmlVisual(section);
      section.removeAttribute('contenteditable');
      section.removeAttribute('spellcheck');
    }

    const button = shell.querySelector('[data-preview-html-visual-edit]');
    if (button) button.textContent = enabled ? 'Done' : 'Edit visually';
  }

  function hydratePreviewHtmlVisuals() {
    if (!previewContent) return;
    previewContent.querySelectorAll('section[data-writer-html-block-id]').forEach(section => {
      if (section.closest('.writer-preview-html-shell')) return;

      const id = section.dataset.writerHtmlBlockId || '';
      const block = htmlBlocks.get(id);
      if (!block) return;

      const shell = document.createElement('div');
      shell.className = 'writer-preview-html-shell';
      section.replaceWith(shell);
      shell.append(section);

      const tools = document.createElement('div');
      tools.className = 'writer-preview-block-tools writer-preview-html-tools';
      tools.innerHTML = '<span>' + escapeHtml(block.label) + '</span><button type="button" data-preview-html-visual-edit>Edit visually</button><button type="button" data-preview-html-source-edit>Edit HTML</button>';
      shell.prepend(tools);

      tools.querySelector('[data-preview-html-visual-edit]').addEventListener('click', event => {
        event.stopPropagation();
        setPreviewHtmlEditing(shell, !shell.classList.contains('is-editing'));
      });

      tools.querySelector('[data-preview-html-source-edit]').addEventListener('click', event => {
        event.stopPropagation();
        if (shell.classList.contains('is-editing')) setPreviewHtmlEditing(shell, false);
        openHtmlDialog(id);
      });

      section.addEventListener('input', () => {
        window.clearTimeout(section._writerHtmlTimer);
        section._writerHtmlTimer = window.setTimeout(() => persistPreviewHtmlVisual(section), 120);
      });

      section.addEventListener('keydown', event => {
        if (event.key === 'Escape' && shell.classList.contains('is-editing')) {
          event.preventDefault();
          setPreviewHtmlEditing(shell, false);
        }
      });

      section.addEventListener('click', event => {
        if (!shell.classList.contains('is-editing')) return;
        const link = event.target.closest('a[href]');
        if (link) event.preventDefault();
      });
    });
  }

  function updatePreview() {
    const title = fields.title.value.trim() || 'Untitled article';
    const description = fields.description.value.trim();
    const category = fields.category.value.trim() || 'Breakdown';
    const date = fields.date.value || today();
    const tags = fields.tags.value.split(',').map(v => v.trim()).filter(Boolean);
    const expandedBody = expandHtmlBlocks(bodyEditor.value, { preview: true });
    const words = countWords(expandedBody);
    const minutes = Math.max(1, Math.ceil(words / 200));

    const previewTitle = app.querySelector('[data-preview-title]');
    previewTitle.textContent = title;
    previewTitle.className = `post-title${title.length > 58 ? ' post-title-long' : title.length > 38 ? ' post-title-medium' : ''}`;
    app.querySelector('[data-preview-breadcrumb]').textContent = title;
    app.querySelector('[data-preview-category]').textContent = category;
    const desc = app.querySelector('[data-preview-description]');
    desc.textContent = description;
    desc.hidden = !description;
    app.querySelector('[data-preview-date]').textContent = formatDate(date);
    app.querySelector('[data-preview-read-time]').textContent = `${minutes} min read`;
    app.querySelector('[data-word-count]').textContent = `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}`;
    app.querySelector('[data-read-time]').textContent = `${minutes} min read`;
    app.querySelector('[data-title-count]').textContent = fields.title.value.length;
    app.querySelector('[data-description-count]').textContent = `${fields.description.value.length} / 160`;
    const metaSummary = app.querySelector('[data-meta-summary]');
    if (metaSummary) {
      const summaryBits = [category, formatDate(date)];
      if (fields.filename.value.trim()) summaryBits.push(fields.filename.value.trim().replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/i, ''));
      metaSummary.textContent = summaryBits.filter(Boolean).join(' · ');
    }

    const shell = app.querySelector('[data-preview-image-shell]');
    const image = app.querySelector('[data-preview-image]');
    const savedImageSrc = normalizeImagePath(fields.imagePath.value);
    const imageSrc = localImageUrl || savedImageSrc;
    shell.hidden = !imageSrc;
    if (imageSrc) {
      const imageError = shell.querySelector('[data-preview-image-error]');
      image.alt = fields.imageAlt.value.trim() || title;
      image.style.objectPosition = fields.imagePosition.value || 'center center';

      if (localImageUrl) {
        clearFeaturedImageRetry();
        shell.classList.remove('is-loading', 'is-missing');
        if (imageError) imageError.hidden = true;
        image.dataset.writerCanonicalSource = '';
        if (image.src !== localImageUrl) image.src = localImageUrl;
      } else if (image.dataset.writerCanonicalSource !== savedImageSrc) {
        loadFeaturedImagePreview(image, shell, imageError, savedImageSrc);
      }
    } else {
      clearFeaturedImageRetry();
      image.dataset.writerCanonicalSource = '';
      image.removeAttribute('src');
      shell.classList.remove('is-loading', 'is-missing');
    }

    app.querySelector('[data-preview-spoiler]').hidden = !fields.spoilerWarning.checked;
    patchPreviewContent(renderMarkdown(expandedBody));
    hydratePreviewImages();
    hydratePreviewVideos();
    hydratePreviewMediaTools();
    hydratePreviewTables();
    hydratePreviewHtmlVisuals();
    hydratePreviewXEmbeds();

    const topics = app.querySelector('[data-preview-topics]');
    app.querySelector('[data-preview-tags]').innerHTML = tags.map(tag => `<li>${escapeHtml(tag)}</li>`).join('');
    topics.hidden = tags.length === 0;
    suggestFilename();
    updateLiveLink();
  }

