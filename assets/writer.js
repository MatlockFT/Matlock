(() => {
  const app = document.querySelector('[data-writer-app]');
  if (!app) return;

  const repo = app.dataset.repo || 'MatlockFT/Matlock';
  const mediaRepo = app.dataset.mediaRepo || repo;
  const authBase = String(app.dataset.authBase || '').replace(/\/$/, '');
  const fields = Object.fromEntries([...app.querySelectorAll('[data-field]')].map(el => [el.dataset.field, el]));
  const bodyEditor = fields.body;
  const libraryView = app.querySelector('[data-library-view]');
  const editorView = app.querySelector('[data-editor-view]');
  const workspace = app.querySelector('[data-workspace]');
  const previewFrame = app.querySelector('[data-preview-frame]');
  const previewThemeToggle = app.querySelector('[data-preview-theme-toggle]');
  const previewContent = app.querySelector('[data-preview-content]');
  const saveDraftButton = app.querySelector('[data-save-draft]');
  const publishButton = app.querySelector('[data-publish]');
  const scheduleButton = app.querySelector('[data-schedule]');
  const uploadButton = app.querySelector('[data-upload-image]');
  const imageFileInput = app.querySelector('[data-image-file]');
  const connectDialog = app.querySelector('[data-connect-dialog]');
  const tokenInput = app.querySelector('[data-github-token]');
  const toast = app.querySelector('[data-toast]');
  const libraryList = app.querySelector('[data-library-list]');
  const librarySearch = app.querySelector('[data-library-search]');
  const libraryStats = app.querySelector('[data-library-stats]');
  const historyDialog = app.querySelector('[data-history-dialog]');
  const historyList = app.querySelector('[data-history-list]');
  const conflictDialog = app.querySelector('[data-conflict-dialog]');
  const metaDetails = app.querySelector('.writer-meta');
  const htmlBlockRail = app.querySelector('[data-html-block-rail]');
  const splitter = app.querySelector('[data-writer-splitter]');
  const publishCheckDialog = app.querySelector('[data-publish-check-dialog]');
  const publishCheckSummary = app.querySelector('[data-publish-check-summary]');
  const publishCheckList = app.querySelector('[data-publish-check-list]');
  const publishCheckProceed = app.querySelector('[data-publish-check-proceed]');

  let githubCredential = '';
  let githubLogin = '';
  let currentPath = '';
  let currentSha = '';
  let originalFrontmatter = '';
  let currentPublished = false;
  let selectedImageFile = null;
  let localImageUrl = '';
  let filenameTouched = false;
  let toastTimer = 0;
  let autosaveTimer = 0;
  let dirty = false;
  let libraryEntries = [];
  let libraryFilter = 'all';
  let pendingConflictMode = '';
  let pendingRemoteSha = '';
  let linkMode = 'link';
  let saveInFlight = false;
  let imageUploadInFlight = false;
  let videoUploadInFlight = false;
  let featuredImageRetryTimer = 0;
  let featuredImageRetryCount = 0;
  let featuredImageRetrySource = '';
  const inlineImageRetryTimers = new WeakMap();
  let previewTimer = 0;
  let librarySearchTimer = 0;
  let htmlBlocks = new Map();
  let editingHtmlBlockId = '';
  let splitRatio = 50;

  const controlledKeys = [
    'layout','title','description','date','category','author','image','tags',
    'show_toc','pinned','listing_visibility','spoiler_warning','preserve_line_breaks','publish_at','published'
  ];

  const templateBodies = {
    breakdown: {
      category: 'Breakdown',
      body: `## Fighter A vs. Fighter B\n\n|  | FIGHTER A | FIGHTER B |\n| --- | ---: | ---: |\n| Record |  |  |\n| Age |  |  |\n| Height |  |  |\n| Reach |  |  |\n| Weight |  |  |\n| Stance |  |  |\n\nStart with the style matchup and the question the fight is really asking.\n\nThen work through the specific technical edges, where each fighter is vulnerable, and what could change the fight.\n\n**Pick: Fighter A by KO/TKO, Round 1**\n`
    },
    card: {
      category: 'Breakdown',
      body: `Opening thoughts on the event and what matters most on the card.\n\n**Fight Predictions**\n\n- [Fighter A vs. Fighter B](#fighter-a-vs-fighter-b)\n- [Fighter C vs. Fighter D](#fighter-c-vs-fighter-d)\n\n---\n\n## Fighter A vs. Fighter B\n\nBreak down the matchup here.\n\n**Pick: Fighter A by Decision**\n\n---\n\n## Fighter C vs. Fighter D\n\nBreak down the matchup here.\n\n**Pick: Fighter C by KO/TKO, Round 2**\n`
    },
    news: {
      category: 'News',
      body: `Lead with the actual news in plain English.\n\nAdd the most important context: who said it, when it happened, and why it matters.\n\n([Source](https://example.com))\n\nClose with what is known, what is not known, and what happens next.\n`
    },
    opinion: {
      category: 'Opinion',
      body: `State the point clearly up front.\n\nExplain why you see it that way, using the strongest concrete examples first.\n\nAddress the most reasonable counterpoint without turning the article into a debate transcript.\n\nFinish with the consequence or larger point rather than repeating the opening sentence.\n`
    }
  };

  const today = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  function showToast(message, ms = 3200) {
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, ms);
  }

  function saveStateKind(message) {
    const value = String(message || '').toLowerCase();
    if (/failed|expired|error/.test(value)) return 'error';
    if (/unsaved/.test(value)) return 'dirty';
    if (/saving|publishing|scheduling|loading|restoring/.test(value)) return 'working';
    if (/saved|published|scheduled/.test(value)) return 'saved';
    return 'neutral';
  }

  function setSaveState(message) {
    const el = app.querySelector('[data-save-state]');
    el.textContent = message;
    el.dataset.state = saveStateKind(message);
  }

  function setDocumentStatus(message) {
    const el = app.querySelector('[data-document-status]');
    el.textContent = message;
    el.dataset.state = String(message || 'document').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'document';
  }

  function setLocalStatus(message, state = 'saved') {
    const el = app.querySelector('[data-local-status]');
    if (!el) return;
    const text = el.querySelector('span') || el;
    text.textContent = message;
    el.dataset.state = state;
  }

  function readPreviewTheme() {
    try {
      return localStorage.getItem('matlock-v3-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  function setPreviewTheme(theme, { persist = false } = {}) {
    const next = theme === 'dark' ? 'dark' : 'light';
    previewFrame.dataset.previewTheme = next;

    if (previewThemeToggle) {
      const dark = next === 'dark';
      previewThemeToggle.setAttribute('aria-pressed', String(dark));
      previewThemeToggle.setAttribute('aria-label', dark ? 'Use light preview' : 'Use dark preview');
      previewThemeToggle.title = dark ? 'Switch preview to light mode' : 'Switch preview to dark mode';
    }

    if (persist) {
      try { localStorage.setItem('matlock-v3-theme', next); } catch {}
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function scalar(value) {
    if (value === undefined || value === null) return '';
    let v = String(value).trim();
    if (!v) return '';
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).replace(/\\"/g, '"').replace(/''/g, "'");
    }
    if (v === 'true') return true;
    if (v === 'false') return false;
    return v;
  }

  function parseFrontmatter(text) {
    const normalized = String(text || '').replace(/\r\n?/g, '\n');
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return { meta: {}, body: normalized, frontmatter: '' };
    const frontmatter = match[1];
    const meta = {};
    const lines = frontmatter.split('\n');
    let key = '';

    for (const line of lines) {
      const top = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
      if (top) {
        key = top[1];
        meta[key] = top[2] ? scalar(top[2]) : '';
        continue;
      }
      if (!key) continue;
      const nested = line.match(/^\s{2}([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
      if (nested) {
        if (!meta[key] || typeof meta[key] !== 'object' || Array.isArray(meta[key])) meta[key] = {};
        meta[key][nested[1]] = scalar(nested[2] || '');
        continue;
      }
      const item = line.match(/^\s*-\s*(.*)$/);
      if (item) {
        if (!Array.isArray(meta[key])) meta[key] = [];
        meta[key].push(scalar(item[1]));
        continue;
      }
      if (/^\s{2,}\S/.test(line) && typeof meta[key] === 'string') {
        meta[key] = `${meta[key]} ${line.trim()}`.trim();
      }
    }
    return { meta, body: normalized.slice(match[0].length), frontmatter };
  }

  function yamlQuote(value) {
    const s = String(value ?? '');
    if (!s) return '""';
    if (/[:#\[\]{}&,*!|>'"%@`\n\r]|^[-?:]\s|\s$|^\s/.test(s) || /^(true|false|null|~|\d+(?:\.\d+)?)$/i.test(s)) {
      return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return s;
  }

  function blockMap(frontmatter) {
    const lines = (frontmatter || '').split('\n');
    const blocks = [];
    let current = null;
    for (const line of lines) {
      const m = line.match(/^([A-Za-z0-9_-]+):/);
      if (m) {
        if (current) blocks.push(current);
        current = { key: m[1], lines: [line] };
      } else if (current) {
        current.lines.push(line);
      }
    }
    if (current) blocks.push(current);
    return blocks;
  }

  function localInputToIso(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }

  function isoToLocalInput(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const offset = d.getTimezoneOffset();
    return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 16);
  }

  function buildControlledBlocks(publishedValue, { clearSchedule = false } = {}) {
    const tags = fields.tags.value.split(',').map(v => v.trim()).filter(Boolean);
    const imagePath = fields.imagePath.value.trim();
    const imageAlt = fields.imageAlt.value.trim();
    const imagePosition = fields.imagePosition.value;
    const publishIso = clearSchedule ? '' : localInputToIso(fields.publishAt.value);
    return {
      layout: ['layout: post'],
      title: [`title: ${yamlQuote(fields.title.value.trim())}`],
      description: [`description: ${yamlQuote(fields.description.value.trim())}`],
      date: [`date: ${yamlQuote(fields.date.value || today())}`],
      category: [`category: ${yamlQuote(fields.category.value.trim() || 'Breakdown')}`],
      author: ['author: Matlock'],
      image: imagePath ? ['image:', `  path: ${yamlQuote(imagePath)}`, `  alt: ${yamlQuote(imageAlt || fields.title.value.trim())}`, `  position: ${yamlQuote(imagePosition || 'center center')}`] : ['image: ""'],
      tags: tags.length ? ['tags:', ...tags.map(tag => `  - ${yamlQuote(tag)}`)] : ['tags: []'],
      show_toc: [`show_toc: ${fields.showToc.checked ? 'true' : 'false'}`],
      pinned: [`pinned: ${fields.pinned.checked ? 'true' : 'false'}`],
      listing_visibility: ['listing_visibility: normal'],
      spoiler_warning: [`spoiler_warning: ${fields.spoilerWarning.checked ? 'true' : 'false'}`],
      preserve_line_breaks: ['preserve_line_breaks: true'],
      publish_at: publishIso && !publishedValue ? [`publish_at: ${yamlQuote(publishIso)}`] : [],
      published: [`published: ${publishedValue ? 'true' : 'false'}`]
    };
  }

  function buildFrontmatter(publishedValue = currentPublished, options = {}) {
    const replacements = buildControlledBlocks(publishedValue, options);
    const existing = blockMap(originalFrontmatter);
    const used = new Set();
    const output = [];

    for (const block of existing) {
      if (Object.prototype.hasOwnProperty.call(replacements, block.key)) {
        output.push(...replacements[block.key]);
        used.add(block.key);
      } else {
        output.push(...block.lines);
      }
    }
    for (const key of controlledKeys) {
      if (!used.has(key) && Object.prototype.hasOwnProperty.call(replacements, key)) output.push(...replacements[key]);
    }
    return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function fullMarkdown(publishedValue = currentPublished, options = {}) {
    return `---\n${buildFrontmatter(publishedValue, options)}\n---\n\n${expandHtmlBlocks(bodyEditor.value).replace(/^\s+/, '')}`;
  }

  function slugify(value) {
    return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'article';
  }

  function suggestFilename() {
    if (currentPath || filenameTouched) return;
    const title = fields.title.value.trim();
    if (!title) return;
    fields.filename.value = `${fields.date.value || today()}-${slugify(title)}.md`;
  }

  function safeUrl(value) {
    const url = String(value || '').trim();
    if (/^(https?:\/\/|\/|#|mailto:)/i.test(url)) return url.replace(/"/g, '&quot;');
    return '#';
  }

  function htmlBlockId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    return Math.random().toString(36).slice(2, 10);
  }

  function cleanHtmlLabel(value) {
    return String(value || 'HTML visual').replace(/[\]\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'HTML visual';
  }

  function inferHtmlLabel(code) {
    const heading = String(code || '').match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    if (heading) {
      const label = heading[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
      if (label) return cleanHtmlLabel(label);
    }
    const sectionClass = String(code || '').match(/<section\b[^>]*class=["']([^"']+)["']/i);
    if (sectionClass) return cleanHtmlLabel(sectionClass[1].split(/\s+/).join(' '));
    return 'HTML visual';
  }

  function htmlBlockToken(block) {
    return `[HTML VISUAL · ${cleanHtmlLabel(block.label)} · #${block.id}]`;
  }

  function htmlTokenMatch(line) {
    return String(line || '').trim().match(/^\[HTML VISUAL · .*? · #([A-Za-z0-9_-]+)\]$/);
  }

  function expandHtmlBlocks(text) {
    return String(text || '').replace(/^\[HTML VISUAL · .*? · #([A-Za-z0-9_-]+)\]\s*$/gm, (token, id) => htmlBlocks.get(id)?.code || token);
  }

  function collapseRawHtmlSections(text) {
    return String(text || '').replace(/<section\b[\s\S]*?<\/section>/gi, code => {
      const id = htmlBlockId();
      const block = { id, label: inferHtmlLabel(code), code: code.trim() };
      htmlBlocks.set(id, block);
      return htmlBlockToken(block);
    });
  }

  function prepareEditorBody(body, savedBlocks = []) {
    htmlBlocks = new Map();
    for (const item of Array.isArray(savedBlocks) ? savedBlocks : []) {
      if (!item?.id || !item?.code) continue;
      htmlBlocks.set(String(item.id), { id: String(item.id), label: cleanHtmlLabel(item.label), code: String(item.code) });
    }
    const source = String(body || '');
    if (htmlBlocks.size) return source;
    return collapseRawHtmlSections(source);
  }

  function htmlBlockAtCursor() {
    const value = bodyEditor.value;
    const cursor = bodyEditor.selectionStart;
    const start = value.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1;
    const next = value.indexOf('\n', cursor);
    const end = next === -1 ? value.length : next;
    const line = value.slice(start, end);
    const match = htmlTokenMatch(line);
    if (!match) return null;
    const block = htmlBlocks.get(match[1]);
    return block ? { block, start, end } : null;
  }

  function replaceHtmlToken(id, replacement) {
    const escaped = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^\\[HTML VISUAL · .*? · #${escaped}\\]\\s*$`, 'm');
    bodyEditor.value = bodyEditor.value.replace(re, replacement);
  }

  function openHtmlDialog(blockId = '') {
    const dialog = app.querySelector('[data-html-dialog]');
    const current = blockId && htmlBlocks.has(blockId) ? { block: htmlBlocks.get(blockId) } : htmlBlockAtCursor();
    editingHtmlBlockId = current?.block?.id || '';
    dialog.querySelector('[data-html-dialog-title]').textContent = current ? 'Edit HTML visual' : 'Insert HTML visual';
    dialog.querySelector('[data-html-label]').value = current?.block?.label || '';
    dialog.querySelector('[data-html-code]').value = current?.block?.code || '';
    dialog.querySelector('[data-html-insert]').textContent = current ? 'Save changes' : 'Insert visual';
    dialog.querySelector('[data-html-delete]').hidden = !current;
    dialog.showModal();
    window.setTimeout(() => dialog.querySelector('[data-html-code]').focus(), 0);
  }

  function renderHtmlBlockRail() {
    if (!htmlBlockRail) return;
    const blocks = [...htmlBlocks.values()];
    htmlBlockRail.hidden = blocks.length === 0;
    if (!blocks.length) { htmlBlockRail.innerHTML = ''; return; }
    htmlBlockRail.innerHTML = `<div class="writer-html-block-rail-head"><span>Embedded visuals</span><small>${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'}</small></div><div class="writer-html-block-list">${blocks.map(block => `<button type="button" class="writer-html-block-card" data-html-block-edit="${escapeHtml(block.id)}" title="Edit ${escapeHtml(block.label)}"><span class="writer-html-block-badge">HTML</span><strong>${escapeHtml(block.label)}</strong><span class="writer-html-block-action">Edit</span></button>`).join('')}</div>`;
  }

  function focusHtmlBlockToken(id) {
    const block = htmlBlocks.get(id);
    if (!block) return false;
    const token = htmlBlockToken(block);
    const index = bodyEditor.value.indexOf(token);
    if (index >= 0) {
      bodyEditor.focus({ preventScroll: true });
      bodyEditor.setSelectionRange(index, index + token.length);
    }
    return true;
  }

  function openHtmlBlockById(id) {
    if (!focusHtmlBlockToken(id)) return;
    openHtmlDialog(id);
  }

  function setArticleDetailsOpen(open) {
    if (metaDetails) metaDetails.open = Boolean(open);
  }

  function applySplitRatio(value, { persist = false } = {}) {
    const next = Math.max(32, Math.min(68, Number(value) || 50));
    splitRatio = next;
    workspace.style.setProperty('--writer-split', `${next}%`);
    if (splitter) splitter.setAttribute('aria-valuenow', String(Math.round(next)));
    if (persist) {
      try { localStorage.setItem('matlock-writer:split-ratio', String(next)); } catch {}
    }
  }

  function restoreSplitRatio() {
    try { applySplitRatio(Number(localStorage.getItem('matlock-writer:split-ratio') || 50)); }
    catch { applySplitRatio(50); }
  }

  function inlineMarkdown(text) {
    let s = escapeHtml(text);
    const code = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { code.push(`<code>${c}</code>`); return `@@CODE${code.length - 1}@@`; });
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g, (_, alt, url, title) => `<img src="${safeUrl(url)}" alt="${alt}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy">`);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g, (_, label, url, title) => `<a href="${safeUrl(url)}"${/^https?:\/\//i.test(url) ? ' target="_blank" rel="noopener noreferrer"' : ''}${title ? ` title="${escapeHtml(title)}"` : ''}>${label}</a>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    code.forEach((value, i) => { s = s.replace(`@@CODE${i}@@`, value); });
    return s;
  }

  function isTableSeparator(line) {
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(v => v.trim());
    return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
  }

  function splitCells(line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map(v => v.trim());
  }

  function allowedYoutubeEmbed(html) {
    const srcMatch = html.match(/src=["']([^"']+)["']/i);
    if (!srcMatch) return '';
    try {
      const u = new URL(srcMatch[1], location.origin);
      const okHost = ['youtube.com','www.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(u.hostname);
      if (!okHost || !/^\/embed\//.test(u.pathname)) return '';
      const src = escapeHtml(u.href);
      return `<div class="writer-embed" data-writer-embed="youtube" data-writer-embed-src="${src}"><iframe src="${src}" title="YouTube video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`;
    } catch { return ''; }
  }

  function renderMarkdown(markdown) {
    let source = String(markdown || '').replace(/\r\n?/g, '\n');
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
        out.push(`<table><thead><tr>${headers.map(c => `<th>${inlineMarkdown(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, idx) => `<td>${inlineMarkdown(row[idx] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
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
    if (node.matches('figure.article-inline-image')) {
      const img = node.querySelector('img');
      const source = img?.dataset.writerSource || img?.getAttribute('src') || '';
      if (source) return `image:${source}`;
    }
    if (node.matches('figure.article-inline-video')) {
      const video = node.querySelector('video');
      const source = video?.getAttribute('src') || video?.querySelector('source')?.getAttribute('src') || video?.currentSrc || '';
      if (source) return `video:${source}`;
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
          cursor = cursor.nextElementSibling;
          continue;
        }
        const existing = [...previewContent.children].find(child => previewEmbedKey(child) === nextKey);
        if (existing) {
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

  function updatePreview() {
    const title = fields.title.value.trim() || 'Untitled article';
    const description = fields.description.value.trim();
    const category = fields.category.value.trim() || 'Breakdown';
    const date = fields.date.value || today();
    const tags = fields.tags.value.split(',').map(v => v.trim()).filter(Boolean);
    const expandedBody = expandHtmlBlocks(bodyEditor.value);
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
    hydratePreviewXEmbeds();

    const topics = app.querySelector('[data-preview-topics]');
    app.querySelector('[data-preview-tags]').innerHTML = tags.map(tag => `<li>${escapeHtml(tag)}</li>`).join('');
    topics.hidden = tags.length === 0;
    suggestFilename();
    updateLiveLink();
  }

  function getState() {
    return {
      title: fields.title.value,
      description: fields.description.value,
      date: fields.date.value,
      category: fields.category.value,
      tags: fields.tags.value,
      imagePath: fields.imagePath.value,
      imageAlt: fields.imageAlt.value,
      imagePosition: fields.imagePosition.value,
      filename: fields.filename.value,
      publishAt: fields.publishAt.value,
      showToc: fields.showToc.checked,
      spoilerWarning: fields.spoilerWarning.checked,
      pinned: fields.pinned.checked,
      body: bodyEditor.value,
      htmlBlocks: [...htmlBlocks.values()].map(block => ({ ...block })),
      currentPath,
      currentSha,
      originalFrontmatter,
      currentPublished,
      savedAt: Date.now()
    };
  }

  function applyState(state, { remote = false } = {}) {
    fields.title.value = state.title || '';
    fields.description.value = state.description || '';
    fields.date.value = (state.date || today()).slice(0,10);
    fields.category.value = state.category || 'Breakdown';
    fields.tags.value = state.tags || '';
    fields.imagePath.value = state.imagePath || '';
    fields.imageAlt.value = state.imageAlt || '';
    fields.imagePosition.value = state.imagePosition || 'center center';
    fields.filename.value = state.filename || '';
    fields.publishAt.value = state.publishAt || '';
    fields.showToc.checked = Boolean(state.showToc);
    fields.spoilerWarning.checked = Boolean(state.spoilerWarning);
    fields.pinned.checked = Boolean(state.pinned);
    bodyEditor.value = prepareEditorBody(state.body || '', state.htmlBlocks || []);
    renderHtmlBlockRail();
    if (remote) {
      currentPath = state.currentPath || '';
      currentSha = state.currentSha || '';
      originalFrontmatter = state.originalFrontmatter || '';
      currentPublished = Boolean(state.currentPublished);
      filenameTouched = Boolean(currentPath);
      fields.filename.disabled = Boolean(currentPath);
      dirty = false;
      updateSaveButtonLabel();
      updateUrlPath();
    }
    updatePreview();
    updateDocumentStatus();
  }

  function stateFromFile(text, path, sha) {
    const parsed = parseFrontmatter(text);
    const m = parsed.meta;
    const image = (m.image && typeof m.image === 'object') ? m.image : { path: typeof m.image === 'string' ? m.image : '' };
    return {
      title: m.title || '',
      description: m.description || '',
      date: String(m.date || '').slice(0,10) || today(),
      category: m.category || (Array.isArray(m.categories) ? m.categories[0] : '') || 'Breakdown',
      tags: Array.isArray(m.tags) ? m.tags.join(', ') : (m.tags || ''),
      imagePath: image.path || '',
      imageAlt: image.alt || '',
      imagePosition: image.position || 'center center',
      filename: path.split('/').pop(),
      publishAt: isoToLocalInput(m.publish_at || ''),
      showToc: Boolean(m.show_toc),
      spoilerWarning: Boolean(m.spoiler_warning),
      pinned: Boolean(m.pinned),
      body: parsed.body.replace(/^\n+/, ''),
      currentPath: path,
      currentSha: sha,
      originalFrontmatter: parsed.frontmatter,
      currentPublished: m.published !== false
    };
  }

  function encodeBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  function decodeBase64(value) {
    const binary = atob(String(value || '').replace(/\n/g,''));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function isServerSession() {
  return githubCredential.startsWith('session:');
}

function setPublishingControls(enabled) {
  const active = Boolean(enabled) && !saveInFlight && !imageUploadInFlight && !videoUploadInFlight;
  saveDraftButton.disabled = !active;
  publishButton.disabled = !active;
  scheduleButton.disabled = !active;
  uploadButton.disabled = !active || !selectedImageFile;
}

function expireGithubConnection(message = 'GitHub session expired. Sign in again to save or publish.') {
  githubCredential = '';
  githubLogin = '';
  setPublishingControls(false);
  app.querySelector('[data-github-status]').textContent = 'GitHub session expired';
  const topConnect = app.querySelector('[data-github-connect]');
  if (topConnect) {
    topConnect.textContent = 'GitHub';
    topConnect.dataset.connected = 'false';
    topConnect.title = 'Connect GitHub';
  }
  window.dispatchEvent(new CustomEvent('matlock-writer:auth-expired'));
  showToast(message, 6000);
}

async function githubFetch(path, options = {}, requireAuth = false) {
  const method = options.method || 'GET';
  if (requireAuth && !githubCredential) throw new Error('Sign in with GitHub first.');

  let response;
  try {
    if (githubCredential && isServerSession()) {
      if (!authBase) throw new Error('Writer auth bridge is unavailable.');
      const id = githubCredential.slice('session:'.length);
      const headers = { Accept: 'application/json', 'X-Writer-Session': id, ...(options.headers || {}) };
      response = await fetch(`${authBase}/api/writer/github?path=${encodeURIComponent(path)}`, { ...options, method, headers, mode: 'cors' });
    } else {
      const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(options.headers || {}) };
      if (githubCredential) headers.Authorization = `Bearer ${githubCredential}`;
      response = await fetch(`https://api.github.com/repos/${repo}${path}`, { ...options, method, headers });
    }
  } catch (error) {
    if (error?.message === 'Writer auth bridge is unavailable.') throw error;
    throw new Error(navigator.onLine === false
      ? 'You appear to be offline. Your local autosave is safe.'
      : 'Could not reach GitHub. Your local autosave is safe; try again in a moment.');
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = await response.json();
      if (data.message || data.error) message = data.message || data.error;
    } catch {}
    if (response.status === 401 && githubCredential) expireGithubConnection();
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

  async function connectGitHub() {
  const credential = tokenInput.value.trim();
  if (!credential) { showToast('Sign in with GitHub or enter a fine-grained token.'); return; }
  const button = app.querySelector('[data-github-authorize]');
  button.disabled = true;
  button.textContent = 'Connecting…';
  try {
    githubCredential = credential;
    const info = await githubFetch('', {}, true);
    githubLogin = info.owner?.login || 'GitHub';
    tokenInput.value = '';
    if (connectDialog.open) connectDialog.close();
    app.querySelector('[data-github-status]').textContent = `Connected to ${repo} as ${githubLogin}`;
    const topConnect = app.querySelector('[data-github-connect]');
    if (topConnect) {
      topConnect.textContent = 'GitHub';
      topConnect.dataset.connected = 'true';
      topConnect.title = `GitHub connected as ${githubLogin}`;
    }
    setPublishingControls(true);
    window.dispatchEvent(new CustomEvent('matlock-writer:auth', { detail: { login: githubLogin } }));
    showToast('GitHub connected.');
    if (selectedImageFile && !imageUploadInFlight) uploadFeaturedImage();
  } catch (error) {
    githubCredential = '';
    setPublishingControls(false);
    showToast(`Could not connect: ${error.message}`, 5000);
  } finally {
    button.disabled = false;
    button.textContent = 'Connect with token';
  }
}

  function showLibrary() {
    if (dirty && !window.confirm('Leave the editor with unsaved changes? Your local autosave will remain available.')) return;
    libraryView.hidden = false;
    editorView.hidden = true;
    setSaveState('Library');
    setDocumentStatus('Library');
    history.replaceState(null, '', '/write/');
    renderLibrary();
  }

  function showEditor() {
    libraryView.hidden = true;
    editorView.hidden = false;
  }

  function localKey() { return `matlock-writer:${currentPath || 'new'}`; }

function persistLocalAutosave() {
  if (!dirty) return;
  try {
    localStorage.setItem(localKey(), JSON.stringify(getState()));
    const stamp = new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
    setLocalStatus(`Saved locally · ${stamp}`, 'saved');
  } catch {
    setLocalStatus('Local autosave unavailable', 'error');
  }
}

function scheduleAutosave() {
  dirty = true;
  setSaveState('Unsaved changes');
  setLocalStatus('Saving locally…', 'working');
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(persistLocalAutosave, 500);
}

  function maybeRestoreLocal(key, remoteState = null) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (remoteState && saved.currentSha !== remoteState.currentSha) return false;
      const hasWork = (saved.title || saved.body || '').trim();
      if (!hasWork) return false;
      if (remoteState && !window.confirm('A local autosave exists for this article. Restore it?')) return false;
      applyState(saved, { remote: Boolean(remoteState) });
      dirty = true;
      showEditor();
      setSaveState('Restored local changes');
      showToast('Restored your local autosave.');
      return true;
    } catch { return false; }
  }

  function resetNewArticle({ template = '' } = {}) {
    if (dirty && !window.confirm('Start a new article and leave the current unsaved changes?')) return;
    clearLocalFeaturedPreview();
    currentPath = '';
    currentSha = '';
    originalFrontmatter = '';
    currentPublished = false;
    filenameTouched = false;
    fields.filename.disabled = false;
    const initial = { date: today(), category: 'Breakdown', imagePosition: 'center center' };
    if (template && templateBodies[template]) {
      initial.category = templateBodies[template].category;
      initial.body = templateBodies[template].body;
    }
    applyState(initial, { remote: true });
    setArticleDetailsOpen(true);
    showEditor();
    history.replaceState(null, '', '/write/');
    if (!template) maybeRestoreLocal('matlock-writer:new');
    setSaveState(template ? 'New article from template' : 'New article');
  }

  function articleStatus(meta) {
    if (meta.published !== false) return 'published';
    const when = meta.publish_at ? Date.parse(meta.publish_at) : NaN;
    return !Number.isNaN(when) && when > Date.now() ? 'scheduled' : 'draft';
  }

  function loadLibraryCache() {
    try { return JSON.parse(localStorage.getItem('matlock-writer:library-cache') || '{}'); } catch { return {}; }
  }

  function saveLibraryCache(cache) {
    try { localStorage.setItem('matlock-writer:library-cache', JSON.stringify(cache)); } catch {}
  }

  async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let index = 0;
    async function run() {
      while (index < items.length) {
        const i = index++;
        results[i] = await worker(items[i], i);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
  }

  async function loadLibrary({ hydrate = Boolean(githubCredential) } = {}) {
    libraryList.innerHTML = '<div class="writer-library-empty">Loading article library…</div>';
    try {
      const files = await githubFetch('/contents/_posts?ref=main');
      const markdownFiles = files.filter(item => item.type === 'file' && /\.md$/i.test(item.name)).sort((a,b) => b.name.localeCompare(a.name));
      const cache = loadLibraryCache();
      libraryEntries = markdownFiles.map(item => {
        const cached = cache[item.path];
        if (cached?.sha === item.sha) return { ...cached, path: item.path, name: item.name, sha: item.sha };
        return {
          path: item.path,
          name: item.name,
          sha: item.sha,
          title: item.name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/i,'').replace(/-/g,' '),
          date: item.name.slice(0,10),
          category: '', tags: [], imagePath: '', status: 'unknown', publishAt: '', editedAt: ''
        };
      });
      renderLibrary();
      if (hydrate) await hydrateLibrary();
    } catch (error) {
      libraryList.innerHTML = `<div class="writer-library-empty">Could not load articles: ${escapeHtml(error.message)}</div>`;
    }
  }

  async function hydrateLibrary() {
    if (!libraryEntries.length || !githubCredential) return;
    const cache = loadLibraryCache();
    const needs = libraryEntries.filter(entry => !cache[entry.path] || cache[entry.path].sha !== entry.sha || cache[entry.path].status === 'unknown');
    if (!needs.length) { renderLibrary(); hydrateEditedTimes(); return; }

    await mapLimit(needs, 6, async entry => {
      try {
        const data = await githubFetch(`/contents/${encodeURIComponent(entry.path).replace(/%2F/g,'/')}?ref=main`);
        const parsed = parseFrontmatter(decodeBase64(data.content));
        const m = parsed.meta;
        const image = (m.image && typeof m.image === 'object') ? m.image : { path: typeof m.image === 'string' ? m.image : '' };
        const summary = {
          path: entry.path,
          name: entry.name,
          sha: data.sha || entry.sha,
          title: m.title || entry.title,
          description: m.description || '',
          date: String(m.date || entry.date).slice(0,10),
          category: m.category || '',
          tags: Array.isArray(m.tags) ? m.tags : (m.tags ? [m.tags] : []),
          imagePath: image.path || '',
          status: articleStatus(m),
          publishAt: m.publish_at || '',
          editedAt: cache[entry.path]?.editedAt || ''
        };
        cache[entry.path] = summary;
        const idx = libraryEntries.findIndex(item => item.path === entry.path);
        if (idx >= 0) libraryEntries[idx] = summary;
      } catch {}
    });
    saveLibraryCache(cache);
    renderLibrary();
    hydrateEditedTimes();
  }

  async function hydrateEditedTimes() {
    if (!githubCredential) return;
    const cache = loadLibraryCache();
    const visible = filteredLibraryEntries().slice(0, 24).filter(entry => !entry.editedAt);
    await mapLimit(visible, 4, async entry => {
      try {
        const commits = await githubFetch(`/commits?path=${encodeURIComponent(entry.path)}&per_page=1`);
        const editedAt = commits?.[0]?.commit?.committer?.date || commits?.[0]?.commit?.author?.date || '';
        if (!editedAt) return;
        entry.editedAt = editedAt;
        if (cache[entry.path]) cache[entry.path].editedAt = editedAt;
      } catch {}
    });
    saveLibraryCache(cache);
    renderLibrary();
  }

  function filteredLibraryEntries() {
    const query = (librarySearch.value || '').trim().toLowerCase();
    return libraryEntries.filter(entry => {
      if (libraryFilter !== 'all' && entry.status !== libraryFilter) return false;
      if (!query) return true;
      return [entry.title, entry.name, entry.category, ...(entry.tags || [])].join(' ').toLowerCase().includes(query);
    });
  }

  function libraryLiveUrl(entry) {
    if (entry.status !== 'published') return '';
    const match = entry.name.replace(/\.md$/i,'').match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
    return match ? `/${match[1]}/${match[2]}/${match[3]}/${match[4]}.html` : '';
  }

  function renderLibrary() {
    const counts = {
      total: libraryEntries.length,
      draft: libraryEntries.filter(x => x.status === 'draft').length,
      scheduled: libraryEntries.filter(x => x.status === 'scheduled').length,
      published: libraryEntries.filter(x => x.status === 'published').length
    };
    libraryStats.innerHTML = `<span><strong>${counts.total}</strong> total</span><span><strong>${counts.draft}</strong> drafts</span><span><strong>${counts.scheduled}</strong> scheduled</span><span><strong>${counts.published}</strong> published</span>`;

    const entries = filteredLibraryEntries();
    if (!entries.length) {
      libraryList.innerHTML = '<div class="writer-library-empty">No matching articles.</div>';
      return;
    }

    libraryList.innerHTML = entries.map(entry => {
      const image = normalizeImagePath(entry.imagePath);
      const status = entry.status || 'unknown';
      const statusText = status === 'scheduled' ? `Scheduled ${formatDateTime(entry.publishAt)}` : status === 'published' ? 'Published' : status === 'draft' ? 'Draft' : 'Loading';
      const edited = entry.editedAt ? `Edited ${formatDateTime(entry.editedAt)}` : entry.date ? `Dated ${formatDate(entry.date)}` : '';
      const live = libraryLiveUrl(entry);
      return `<article class="writer-library-card" data-library-path="${escapeHtml(entry.path)}">
        <div class="writer-library-thumb">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : '<span>MATLOCK</span>'}</div>
        <div class="writer-library-card-body">
          <div class="writer-library-card-meta"><span class="writer-status-badge is-${status}">${escapeHtml(statusText)}</span>${entry.category ? `<span>${escapeHtml(entry.category)}</span>` : ''}</div>
          <h3>${escapeHtml(entry.title || entry.name)}</h3>
          <p>${escapeHtml(entry.description || edited || entry.name)}</p>
          <div class="writer-library-card-foot"><span>${escapeHtml(edited)}</span><div class="writer-library-actions"><button type="button" data-library-edit>Edit</button><button type="button" data-library-duplicate>Duplicate</button>${live ? `<a href="${escapeHtml(live)}" target="_blank" rel="noopener noreferrer">View live</a>` : ''}</div></div>
        </div>
      </article>`;
    }).join('');
  }

  async function loadArticle(path, { force = false } = {}) {
    if (!force && dirty && !window.confirm('Open another article and leave the current unsaved changes?')) return;
    clearLocalFeaturedPreview();
    setSaveState('Loading…');
    try {
      const data = await githubFetch(`/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}?ref=main`);
      const state = stateFromFile(decodeBase64(data.content), path, data.sha);
      applyState(state, { remote: true });
      const restored = maybeRestoreLocal(`matlock-writer:${path}`, state);
      if (!restored) dirty = false;
      showEditor();
      if ((state.body || '').trim() || state.title) setArticleDetailsOpen(false);
      setSaveState(currentPublished ? 'Published article' : fields.publishAt.value ? 'Scheduled article' : 'Draft article');
      showToast('Article loaded.');
    } catch (error) {
      setSaveState('Load failed');
      showToast(`Could not load article: ${error.message}`, 5000);
    }
  }

  async function duplicateArticle(path) {
    if (dirty && !window.confirm('Duplicate another article and leave the current unsaved changes?')) return;
    clearLocalFeaturedPreview();
    try {
      const data = await githubFetch(`/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}?ref=main`);
      const state = stateFromFile(decodeBase64(data.content), path, data.sha);
      state.title = `${state.title} — Copy`;
      state.filename = `${today()}-${slugify(state.title.replace(/— Copy$/, '').trim())}-copy.md`;
      state.publishAt = '';
      state.currentPath = '';
      state.currentSha = '';
      state.currentPublished = false;
      applyState(state, { remote: true });
      currentPath = '';
      currentSha = '';
      currentPublished = false;
      fields.filename.disabled = false;
      filenameTouched = true;
      setArticleDetailsOpen(true);
      showEditor();
      dirty = true;
      setSaveState('Duplicated • unsaved');
      showToast('Article duplicated into a new draft.');
    } catch (error) {
      showToast(`Could not duplicate article: ${error.message}`, 5000);
    }
  }

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

  function insertAtCursor(before, after = '', placeholder = '') {
  const start = bodyEditor.selectionStart;
  const end = bodyEditor.selectionEnd;
  const hasSelection = end > start;
  const selected = bodyEditor.value.slice(start, end) || placeholder;
  const inserted = `${before}${selected}${after}`;
  bodyEditor.setRangeText(inserted, start, end, 'end');
  bodyEditor.focus();
  if (!hasSelection && placeholder) {
    bodyEditor.setSelectionRange(start + before.length, start + before.length + placeholder.length);
  } else {
    const cursor = start + inserted.length;
    bodyEditor.setSelectionRange(cursor, cursor);
  }
  scheduleAutosave();
  updatePreview();
}

function insertQuoteBlock() {
  const start = bodyEditor.selectionStart;
  const end = bodyEditor.selectionEnd;
  if (end <= start) return insertAtCursor('> ', '', 'Quote');

  const selected = bodyEditor.value.slice(start, end).replace(/\r\n?/g, '\n');
  const lines = selected.split('\n');
  const meaningful = lines.filter(line => line.trim());
  const alreadyQuoted = meaningful.length > 0 && meaningful.every(line => /^\s*>\s?/.test(line));
  const transformed = lines.map(line => {
    if (alreadyQuoted) return line.replace(/^(\s*)>\s?/, '$1');
    if (!line.trim()) return '>';
    return `> ${line}`;
  }).join('\n');

  bodyEditor.setRangeText(transformed, start, end, 'select');
  bodyEditor.focus();
  scheduleAutosave();
  updatePreview();
}

function insertBlock(text) {
  const start = bodyEditor.selectionStart;
  const end = bodyEditor.selectionEnd;
  const before = bodyEditor.value.slice(0, start);
  const after = bodyEditor.value.slice(end);
  const prefix = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const suffix = !after ? '\n\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const inserted = `${prefix}${String(text).trim()}${suffix}`;
  bodyEditor.setRangeText(inserted, start, end, 'end');
  bodyEditor.focus();
  const cursor = start + inserted.length;
  bodyEditor.setSelectionRange(cursor, cursor);
  scheduleAutosave();
  updatePreview();
}

  function youtubeId(value) {
    try {
      const u = new URL(value);
      if (u.hostname === 'youtu.be') return u.pathname.split('/').filter(Boolean)[0] || '';
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const match = u.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/);
      return match ? match[1] : '';
    } catch { return /^[A-Za-z0-9_-]{6,}$/.test(value) ? value : ''; }
  }

  function xStatusUrl(value) {
    try {
      const u = new URL(value);
      const host = u.hostname.toLowerCase();
      const allowedHosts = ['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com'];
      if (!allowedHosts.includes(host)) return '';
      const match = u.pathname.match(/^\/(.+?)\/status\/(\d+)/i);
      if (!match) return '';
      return `https://x.com/${match[1]}/status/${match[2]}`;
    } catch {
      return '';
    }
  }

  function loadPreviewXWidgets(container) {
    const render = () => {
      if (window.twttr?.widgets) window.twttr.widgets.load(container);
    };
    if (window.twttr?.widgets) {
      render();
      return;
    }
    let script = document.querySelector('script[src="https://platform.x.com/widgets.js"]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://platform.x.com/widgets.js';
      script.async = true;
      script.charset = 'utf-8';
      document.body.appendChild(script);
    }
    script.addEventListener('load', render, { once: true });
  }

  function hydratePreviewXEmbeds() {
    if (!previewContent) return;
    let found = false;
    [...previewContent.querySelectorAll('a')].forEach(link => {
      if (link.textContent.trim().toUpperCase() !== 'EMBED X') return;
      const cleanUrl = xStatusUrl(link.href);
      if (!cleanUrl) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'writer-x-embed';
      wrapper.dataset.writerXUrl = cleanUrl;

      const blockquote = document.createElement('blockquote');
      blockquote.className = 'twitter-tweet';
      blockquote.dataset.dnt = 'true';
      blockquote.dataset.theme = 'dark';

      const xLink = document.createElement('a');
      xLink.href = cleanUrl;
      xLink.textContent = 'View post on X';
      blockquote.appendChild(xLink);
      wrapper.appendChild(blockquote);

      const paragraph = link.closest('p');
      if (paragraph && paragraph.textContent.trim().toUpperCase() === 'EMBED X') paragraph.replaceWith(wrapper);
      else link.replaceWith(wrapper);
      found = true;
    });
    if (found) loadPreviewXWidgets(previewContent);
  }

  function handleSimpleInsert(type) {
    if (type === 'h2') return insertAtCursor('## ', '', 'Section heading');
    if (type === 'bold') return insertAtCursor('**', '**', 'bold text');
    if (type === 'italic') return insertAtCursor('*', '*', 'italic text');
    if (type === 'quote') return insertQuoteBlock();
    if (type === 'divider') return insertBlock('---');
  }

  function openTool(type) {
    if (type === 'link' || type === 'citation') {
      linkMode = type;
      const dialog = app.querySelector('[data-link-dialog]');
      dialog.querySelector('[data-link-dialog-title]').textContent = type === 'citation' ? 'Add source' : 'Add link';
      dialog.querySelector('[data-link-label]').value = bodyEditor.value.slice(bodyEditor.selectionStart, bodyEditor.selectionEnd) || (type === 'citation' ? 'Source' : '');
      dialog.querySelector('[data-link-url]').value = '';
      dialog.showModal();
      dialog.querySelector('[data-link-url]').focus();
      return;
    }
    if (type === 'html') {
      openHtmlDialog();
      return;
    }
    const map = {
      image: '[data-image-dialog]', video: '[data-video-dialog]', youtube: '[data-youtube-dialog]', x: '[data-x-dialog]', table: '[data-table-dialog]',
      tale: '[data-tale-dialog]', prediction: '[data-pick-dialog]', template: '[data-template-dialog]'
    };
    const dialog = app.querySelector(map[type]);
    if (dialog) {
      if (type === 'image') syncInlineImagePlacementControls(dialog);
      dialog.showModal();
    }
  }

  function syncInlineImagePlacementControls(dialog = app.querySelector('[data-image-dialog]')) {
    if (!dialog) return;
    const flow = dialog.querySelector('[data-inline-image-flow]');
    const align = dialog.querySelector('[data-inline-image-align]');
    const width = dialog.querySelector('[data-inline-image-width]');
    if (!flow || !align || !width) return;

    const wrap = flow.value === 'wrap';
    const center = align.querySelector('option[value="center"]');
    const full = width.querySelector('option[value="full"]');
    if (center) center.disabled = wrap;
    if (full) full.disabled = wrap;
    if (wrap && align.value === 'center') align.value = 'left';
    if (wrap && width.value === 'full') width.value = 'medium';
  }

  function inlineImageMarkup(url, alt = '', options = {}) {
    const flow = options.flow === 'wrap' ? 'wrap' : 'break';
    let align = ['left','center','right'].includes(options.align) ? options.align : 'center';
    let width = ['small','medium','large','full'].includes(options.width) ? options.width : 'full';
    if (flow === 'wrap' && align === 'center') align = 'left';
    if (flow === 'wrap' && width === 'full') width = 'medium';

    const src = safeUrl(url);
    const caption = String(options.caption || '').trim();
    const classes = [
      'article-inline-image',
      `article-inline-image--${flow}`,
      `article-inline-image--${align}`,
      `article-inline-image--${width}`
    ].join(' ');

    return [
      `<figure class="${classes}">`,
      `  <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy">`,
      caption ? `  <figcaption>${escapeHtml(caption)}</figcaption>` : '',
      '</figure>'
    ].filter(Boolean).join('\n');
  }

  function inlineVideoMarkup(url, caption = '') {
    const src = safeUrl(url);
    if (!src || src === '#') return '';
    const cleanCaption = String(caption || '').trim();
    const label = cleanCaption || 'Article video';
    return [
      '<figure class="article-inline-video">',
      '  <div class="article-inline-video-stage">',
      `    <video autoplay loop muted playsinline preload="metadata" src="${escapeHtml(src)}" aria-label="${escapeHtml(label)}"></video>`,
      '  </div>',
      cleanCaption ? `  <figcaption>${escapeHtml(cleanCaption)}</figcaption>` : '',
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
    const path = `assets/uploads/${safeName}`;
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
    if (!/^<section\b[\s\S]*<\/section>\s*$/i.test(code)) { showToast('Wrap the visual in one self-contained <section>...</section> block.', 5500); return; }
    const label = cleanHtmlLabel(dialog.querySelector('[data-html-label]').value || inferHtmlLabel(code));

    if (editingHtmlBlockId && htmlBlocks.has(editingHtmlBlockId)) {
      const block = htmlBlocks.get(editingHtmlBlockId);
      block.label = label;
      block.code = code;
      replaceHtmlToken(editingHtmlBlockId, htmlBlockToken(block));
      renderHtmlBlockRail();
      showToast('HTML visual updated.');
    } else {
      const id = htmlBlockId();
      const block = { id, label, code };
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
    if (!/^<section\b[\s\S]*<\/section>\s*$/i.test(pasted)) return;
    if (/<script\b/i.test(pasted)) { event.preventDefault(); showToast('Script tags are not supported in article HTML visuals.', 5000); return; }
    event.preventDefault();
    const id = htmlBlockId();
    const block = { id, label: inferHtmlLabel(pasted), code: pasted };
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
