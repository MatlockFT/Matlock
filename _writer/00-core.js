/* Generated public bundle source. Edit _writer/*.js, then run npm run build:frontend. */
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

