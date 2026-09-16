(() => {
  const app = document.querySelector('[data-writer-app]');
  if (!app) return;

  const repo = app.dataset.repo || 'MatlockFT/Matlock';
  const fields = Object.fromEntries([...app.querySelectorAll('[data-field]')].map(el => [el.dataset.field, el]));
  const bodyEditor = fields.body;
  const workspace = app.querySelector('[data-workspace]');
  const previewFrame = app.querySelector('[data-preview-frame]');
  const previewContent = app.querySelector('[data-preview-content]');
  const saveDraftButton = app.querySelector('[data-save-draft]');
  const publishButton = app.querySelector('[data-publish]');
  const uploadButton = app.querySelector('[data-upload-image]');
  const imageFileInput = app.querySelector('[data-image-file]');
  const openDialog = app.querySelector('[data-open-dialog]');
  const connectDialog = app.querySelector('[data-connect-dialog]');
  const tokenInput = app.querySelector('[data-github-token]');
  const articleList = app.querySelector('[data-article-list]');
  const filterInput = app.querySelector('[data-article-filter]');
  const toast = app.querySelector('[data-toast]');

  let githubToken = '';
  let githubLogin = '';
  let currentPath = '';
  let currentSha = '';
  let originalFrontmatter = '';
  let currentPublished = false;
  let selectedImageFile = null;
  let localImageUrl = '';
  let filenameTouched = false;
  let articleEntries = [];
  let toastTimer = 0;
  let autosaveTimer = 0;
  let dirty = false;

  const controlledKeys = ['layout','title','description','date','category','author','image','tags','show_toc','pinned','listing_visibility','spoiler_warning','published'];

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

  function setSaveState(message) {
    app.querySelector('[data-save-state]').textContent = message;
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
    const normalized = text.replace(/\r\n?/g, '\n');
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

  function buildControlledBlocks(publishedValue) {
    const tags = fields.tags.value.split(',').map(v => v.trim()).filter(Boolean);
    const imagePath = fields.imagePath.value.trim();
    const imageAlt = fields.imageAlt.value.trim();
    const imagePosition = fields.imagePosition.value;
    const blocks = {
      layout: ['layout: post'],
      title: [`title: ${yamlQuote(fields.title.value.trim())}`],
      description: [`description: ${yamlQuote(fields.description.value.trim())}`],
      date: [`date: ${yamlQuote(fields.date.value || today())}`],
      category: [`category: ${yamlQuote(fields.category.value.trim() || 'Breakdown')}`],
      author: ['author: MMA Matlock'],
      image: imagePath ? ['image:', `  path: ${yamlQuote(imagePath)}`, `  alt: ${yamlQuote(imageAlt || fields.title.value.trim())}`, `  position: ${yamlQuote(imagePosition || 'center center')}`] : ['image: ""'],
      tags: tags.length ? ['tags:', ...tags.map(tag => `  - ${yamlQuote(tag)}`)] : ['tags: []'],
      show_toc: [`show_toc: ${fields.showToc.checked ? 'true' : 'false'}`],
      pinned: [`pinned: ${fields.pinned.checked ? 'true' : 'false'}`],
      listing_visibility: ['listing_visibility: normal'],
      spoiler_warning: [`spoiler_warning: ${fields.spoilerWarning.checked ? 'true' : 'false'}`],
      published: [`published: ${publishedValue ? 'true' : 'false'}`]
    };
    return blocks;
  }

  function buildFrontmatter(publishedValue = currentPublished) {
    const replacements = buildControlledBlocks(publishedValue);
    const existing = blockMap(originalFrontmatter);
    const used = new Set();
    const output = [];

    for (const block of existing) {
      if (replacements[block.key]) {
        output.push(...replacements[block.key]);
        used.add(block.key);
      } else {
        output.push(...block.lines);
      }
    }

    for (const key of controlledKeys) {
      if (!used.has(key) && replacements[key]) output.push(...replacements[key]);
    }

    return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function fullMarkdown(publishedValue = currentPublished) {
    return `---\n${buildFrontmatter(publishedValue)}\n---\n\n${bodyEditor.value.replace(/^\s+/, '')}`;
  }

  function slugify(value) {
    return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'article';
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

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
      return `<div class="writer-embed"><iframe src="${escapeHtml(u.href)}" title="YouTube video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>`;
    } catch { return ''; }
  }

  function renderMarkdown(markdown) {
    let source = String(markdown || '').replace(/\r\n?/g, '\n');
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
    const special = line => /^\s*(#{1,6}\s|```|>|[-*+]\s+|\d+\.\s+|(?:---+|___+|\*\*\*+)\s*$|@@EMBED\d+@@\s*$)/.test(line);

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i += 1; continue; }

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
        const text = heading[2].replace(/\s+#+\s*$/, '');
        out.push(`<h${level}>${inlineMarkdown(text)}</h${level}>`);
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
        while (i < lines.length && /^\s*>/.test(lines[i])) { parts.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
        out.push(`<blockquote><p>${inlineMarkdown(parts.join(' '))}</p></blockquote>`);
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
      out.push(`<p>${inlineMarkdown(para.join(' '))}</p>`);
    }

    return out.join('\n');
  }

  function formatDate(dateString) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString || '')) return '';
    const [y,m,d] = dateString.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,d)));
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

  function updatePreview() {
    const title = fields.title.value.trim() || 'Untitled article';
    const description = fields.description.value.trim();
    const category = fields.category.value.trim() || 'Breakdown';
    const date = fields.date.value || today();
    const tags = fields.tags.value.split(',').map(v => v.trim()).filter(Boolean);
    const words = countWords(bodyEditor.value);
    const minutes = Math.max(1, Math.ceil(words / 200));

    app.querySelector('[data-preview-title]').textContent = title;
    app.querySelector('[data-preview-title]').className = `post-title${title.length > 58 ? ' post-title-long' : title.length > 38 ? ' post-title-medium' : ''}`;
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

    const shell = app.querySelector('[data-preview-image-shell]');
    const image = app.querySelector('[data-preview-image]');
    const imageSrc = localImageUrl || normalizeImagePath(fields.imagePath.value);
    shell.hidden = !imageSrc;
    if (imageSrc) {
      image.src = imageSrc;
      image.alt = fields.imageAlt.value.trim() || title;
      image.style.objectPosition = fields.imagePosition.value || 'center center';
    }

    app.querySelector('[data-preview-spoiler]').hidden = !fields.spoilerWarning.checked;
    const rendered = renderMarkdown(bodyEditor.value);
    previewContent.innerHTML = rendered || '<p class="writer-preview-empty">Start writing on the left. Your article will appear here immediately.</p>';

    const topics = app.querySelector('[data-preview-topics]');
    const tagList = app.querySelector('[data-preview-tags]');
    tagList.innerHTML = tags.map(tag => `<li>${escapeHtml(tag)}</li>`).join('');
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
      showToc: fields.showToc.checked,
      spoilerWarning: fields.spoilerWarning.checked,
      pinned: fields.pinned.checked,
      body: bodyEditor.value,
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
    fields.showToc.checked = Boolean(state.showToc);
    fields.spoilerWarning.checked = Boolean(state.spoilerWarning);
    fields.pinned.checked = Boolean(state.pinned);
    bodyEditor.value = state.body || '';
    if (remote) {
      currentPath = state.currentPath || '';
      currentSha = state.currentSha || '';
      originalFrontmatter = state.originalFrontmatter || '';
      currentPublished = Boolean(state.currentPublished);
      filenameTouched = Boolean(currentPath);
      fields.filename.disabled = Boolean(currentPath);
      dirty = false;
      setSaveState(currentPath ? (currentPublished ? 'Published article' : 'Draft article') : 'New article');
      updateSaveButtonLabel();
      updateUrlPath();
    }
    updatePreview();
  }

  function localKey() { return `matlock-writer:${currentPath || 'new'}`; }

  function scheduleAutosave() {
    dirty = true;
    setSaveState('Unsaved changes');
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(localKey(), JSON.stringify(getState()));
        app.querySelector('[data-local-status]').textContent = `Autosaved locally at ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}.`;
      } catch {}
    }, 700);
  }

  function maybeRestoreLocal(key, remoteState = null) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (remoteState && saved.currentSha !== remoteState.currentSha) return false;
      const hasWork = (saved.title || saved.body || '').trim();
      if (!hasWork) return false;
      if (remoteState && !window.confirm('A newer local edit exists for this article. Restore the local version?')) return false;
      applyState(saved, { remote: Boolean(remoteState) });
      dirty = true;
      setSaveState('Restored local changes');
      showToast('Restored your local autosave.');
      return true;
    } catch { return false; }
  }

  function resetNewArticle() {
    if (dirty && !window.confirm('Start a new article and leave the current unsaved changes?')) return;
    if (localImageUrl) URL.revokeObjectURL(localImageUrl);
    localImageUrl = '';
    selectedImageFile = null;
    currentPath = '';
    currentSha = '';
    originalFrontmatter = '';
    currentPublished = false;
    filenameTouched = false;
    fields.filename.disabled = false;
    applyState({ date: today(), category: 'Breakdown', imagePosition: 'center center' }, { remote: true });
    history.replaceState(null, '', '/write/');
    maybeRestoreLocal('matlock-writer:new');
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

  async function githubFetch(path, options = {}, requireAuth = false) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(options.headers || {}) };
    if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
    if (requireAuth && !githubToken) throw new Error('Connect GitHub first.');
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, { ...options, headers });
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try { const data = await response.json(); if (data.message) message = data.message; } catch {}
      throw new Error(message);
    }
    return response.status === 204 ? null : response.json();
  }

  async function connectGitHub() {
    const token = tokenInput.value.trim();
    if (!token) { showToast('Enter a fine-grained token.'); return; }
    const button = app.querySelector('[data-github-authorize]');
    button.disabled = true;
    button.textContent = 'Connecting…';
    try {
      githubToken = token;
      const info = await githubFetch('', {}, true);
      githubLogin = info.owner?.login || 'GitHub';
      tokenInput.value = '';
      connectDialog.close();
      app.querySelector('[data-github-status]').textContent = `Connected to ${repo} as ${githubLogin}`;
      app.querySelector('[data-github-connect]').textContent = 'GitHub connected';
      saveDraftButton.disabled = false;
      publishButton.disabled = false;
      uploadButton.disabled = !selectedImageFile;
      showToast('GitHub connected for this tab only.');
    } catch (error) {
      githubToken = '';
      showToast(`Could not connect: ${error.message}`, 5000);
    } finally {
      button.disabled = false;
      button.textContent = 'Connect';
    }
  }

  async function listArticles() {
    articleList.innerHTML = '<p>Loading articles…</p>';
    try {
      const data = await githubFetch('/contents/_posts?ref=main');
      articleEntries = data.filter(item => item.type === 'file' && /\.md$/i.test(item.name)).sort((a,b) => b.name.localeCompare(a.name));
      renderArticleList();
    } catch (error) {
      articleList.innerHTML = `<p>Could not load articles: ${escapeHtml(error.message)}</p>`;
    }
  }

  function renderArticleList() {
    const query = (filterInput.value || '').trim().toLowerCase();
    const filtered = articleEntries.filter(item => item.name.toLowerCase().includes(query));
    articleList.innerHTML = filtered.length ? filtered.map(item => `<button class="writer-article-item" type="button" data-article-path="${escapeHtml(item.path)}"><span>${escapeHtml(item.name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/i,''))}</span><small>${escapeHtml(item.name.slice(0,10))}</small></button>`).join('') : '<p>No matching articles.</p>';
  }

  async function loadArticle(path) {
    if (dirty && !window.confirm('Open another article and leave the current unsaved changes?')) return;
    setSaveState('Loading…');
    try {
      const data = await githubFetch(`/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}?ref=main`);
      const state = stateFromFile(decodeBase64(data.content), path, data.sha);
      applyState(state, { remote: true });
      const restored = maybeRestoreLocal(`matlock-writer:${path}`, state);
      if (!restored) dirty = false;
      if (openDialog.open) openDialog.close();
      showToast('Article loaded.');
    } catch (error) {
      setSaveState('Load failed');
      showToast(`Could not load article: ${error.message}`, 5000);
    }
  }

  function validateForSave() {
    if (!fields.title.value.trim()) throw new Error('Add a title first.');
    if (!fields.date.value) throw new Error('Choose a publication date.');
    if (!fields.filename.value.trim()) throw new Error('Add a filename.');
    if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/i.test(fields.filename.value.trim())) throw new Error('Filename must look like YYYY-MM-DD-article-name.md.');
  }

  function updateSaveButtonLabel() {
    saveDraftButton.textContent = currentPublished ? 'Save changes' : 'Save draft';
  }

  async function saveArticle(publishNow) {
    try { validateForSave(); } catch (error) { showToast(error.message); return; }
    if (!githubToken) { connectDialog.showModal(); return; }
    const desiredPublished = publishNow ? true : currentPublished;
    const filename = fields.filename.value.trim();
    const path = currentPath || `_posts/${filename}`;
    const button = publishNow ? publishButton : saveDraftButton;
    const oldLabel = button.textContent;
    button.disabled = true;
    button.textContent = publishNow ? 'Publishing…' : 'Saving…';
    setSaveState(publishNow ? 'Publishing…' : 'Saving…');

    try {
      const payload = {
        message: `${publishNow ? 'Publish' : 'Update'} ${filename}`,
        content: encodeBase64(fullMarkdown(desiredPublished)),
        branch: 'main'
      };
      if (currentSha) payload.sha = currentSha;
      const result = await githubFetch(`/contents/${encodeURIComponent(path).replace(/%2F/g,'/')}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, true);
      currentPath = path;
      currentSha = result.content?.sha || currentSha;
      currentPublished = desiredPublished;
      originalFrontmatter = buildFrontmatter(desiredPublished);
      fields.filename.disabled = true;
      filenameTouched = true;
      dirty = false;
      try { localStorage.removeItem(localKey()); } catch {}
      updateUrlPath();
      updateSaveButtonLabel();
      updateLiveLink();
      setSaveState(currentPublished ? 'Published • deployment started' : 'Draft saved');
      showToast(currentPublished ? 'Published to GitHub. The public site is deploying now.' : 'Draft saved to GitHub.');
    } catch (error) {
      setSaveState('Save failed');
      showToast(`Save failed: ${error.message}`, 6000);
    } finally {
      button.disabled = false;
      if (button.textContent === 'Saving…' || button.textContent === 'Publishing…') button.textContent = oldLabel;
      updateSaveButtonLabel();
    }
  }

  async function uploadImage() {
    if (!selectedImageFile) { showToast('Choose an image first.'); return; }
    if (!githubToken) { connectDialog.showModal(); return; }
    if (selectedImageFile.size > 20 * 1024 * 1024) { showToast('Keep uploads under 20 MB.'); return; }
    const filename = fields.imagePath.value.trim().split('/').pop() || selectedImageFile.name;
    const path = `assets/uploads/${filename.replace(/[^A-Za-z0-9._-]+/g,'-')}`;
    uploadButton.disabled = true;
    uploadButton.textContent = 'Uploading…';
    try {
      const bytes = new Uint8Array(await selectedImageFile.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      let existingSha = '';
      try { const existing = await githubFetch(`/contents/${path}?ref=main`); existingSha = existing.sha || ''; } catch {}
      const payload = { message: `Upload article image ${filename}`, content: btoa(binary), branch: 'main' };
      if (existingSha) payload.sha = existingSha;
      await githubFetch(`/contents/${path}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }, true);
      fields.imagePath.value = `/${path}`;
      showToast('Image uploaded. Responsive image generation will run automatically.');
      scheduleAutosave();
    } catch (error) {
      showToast(`Image upload failed: ${error.message}`, 6000);
    } finally {
      uploadButton.textContent = 'Upload';
      uploadButton.disabled = false;
      updatePreview();
    }
  }

  function liveUrl() {
    if (!currentPath || !currentPublished) return '';
    const file = currentPath.split('/').pop().replace(/\.md$/i,'');
    const match = file.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
    if (!match) return '';
    return `/${match[1]}/${match[2]}/${match[3]}/${match[4]}.html`;
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
    const selected = bodyEditor.value.slice(start, end) || placeholder;
    bodyEditor.setRangeText(`${before}${selected}${after}`, start, end, 'end');
    bodyEditor.focus();
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

  function handleInsert(type) {
    if (type === 'h2') return insertAtCursor('## ', '', 'Section heading');
    if (type === 'bold') return insertAtCursor('**', '**', 'bold text');
    if (type === 'italic') return insertAtCursor('*', '*', 'italic text');
    if (type === 'quote') return insertAtCursor('> ', '', 'Quote');
    if (type === 'divider') return insertAtCursor('\n\n---\n\n');
    if (type === 'table') return insertAtCursor('\n\n|  | Fighter A | Fighter B |\n| --- | ---: | ---: |\n| Record | 0-0 | 0-0 |\n| Age | 0 | 0 |\n\n');
    if (type === 'prediction') return insertAtCursor('\n\n**Pick: ', '**\n\n', 'Fighter by KO/TKO, Round 1');
    if (type === 'link' || type === 'citation') {
      const url = window.prompt(type === 'citation' ? 'Source URL:' : 'Link URL:');
      if (!url) return;
      const selected = bodyEditor.value.slice(bodyEditor.selectionStart, bodyEditor.selectionEnd);
      const label = selected || (type === 'citation' ? 'Source' : 'link text');
      return insertAtCursor('[', `](${url.trim()})`, label);
    }
    if (type === 'youtube') {
      const value = window.prompt('YouTube URL or video ID:');
      if (!value) return;
      const id = youtubeId(value.trim());
      if (!id) { showToast('I could not read that YouTube URL.'); return; }
      return insertAtCursor(`\n\n<iframe src="https://www.youtube.com/embed/${id}" title="YouTube video" allowfullscreen></iframe>\n\n`);
    }
  }

  async function copyMarkdown() {
    const text = fullMarkdown(currentPublished);
    try {
      await navigator.clipboard.writeText(text);
      showToast('Full Markdown copied.');
    } catch {
      bodyEditor.focus();
      showToast('Clipboard access was blocked. Use Download .md instead.');
    }
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

  Object.values(fields).forEach(el => {
    el.addEventListener('input', () => {
      if (el === fields.filename && !currentPath) filenameTouched = true;
      updatePreview();
      scheduleAutosave();
    });
    el.addEventListener('change', () => {
      updatePreview();
      scheduleAutosave();
    });
  });

  app.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
    const mode = button.dataset.view;
    workspace.dataset.viewMode = mode;
    app.querySelectorAll('[data-view]').forEach(btn => btn.setAttribute('aria-pressed', String(btn === button)));
  }));

  app.querySelectorAll('[data-preview-size]').forEach(button => button.addEventListener('click', () => {
    previewFrame.dataset.previewSize = button.dataset.previewSize;
    app.querySelectorAll('[data-preview-size]').forEach(btn => btn.setAttribute('aria-pressed', String(btn === button)));
  }));

  app.querySelectorAll('[data-insert]').forEach(button => button.addEventListener('click', () => handleInsert(button.dataset.insert)));
  app.querySelector('[data-new-article]').addEventListener('click', resetNewArticle);
  app.querySelector('[data-open-article]').addEventListener('click', () => { openDialog.showModal(); listArticles(); });
  app.querySelector('[data-github-connect]').addEventListener('click', () => connectDialog.showModal());
  app.querySelector('[data-github-authorize]').addEventListener('click', connectGitHub);
  saveDraftButton.addEventListener('click', () => saveArticle(false));
  publishButton.addEventListener('click', () => saveArticle(true));
  uploadButton.addEventListener('click', uploadImage);
  app.querySelector('[data-copy-markdown]').addEventListener('click', copyMarkdown);
  app.querySelector('[data-download-markdown]').addEventListener('click', downloadMarkdown);
  filterInput.addEventListener('input', renderArticleList);
  articleList.addEventListener('click', event => {
    const button = event.target.closest('[data-article-path]');
    if (button) loadArticle(button.dataset.articlePath);
  });

  imageFileInput.addEventListener('change', () => {
    selectedImageFile = imageFileInput.files?.[0] || null;
    if (localImageUrl) URL.revokeObjectURL(localImageUrl);
    localImageUrl = selectedImageFile ? URL.createObjectURL(selectedImageFile) : '';
    if (selectedImageFile && !fields.imagePath.value.trim()) fields.imagePath.value = `/assets/uploads/${selectedImageFile.name.replace(/[^A-Za-z0-9._-]+/g,'-')}`;
    uploadButton.disabled = !selectedImageFile || !githubToken;
    updatePreview();
    scheduleAutosave();
  });

  window.addEventListener('beforeunload', event => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  fields.date.value = today();
  fields.category.value = 'Breakdown';
  fields.imagePosition.value = 'center center';
  updatePreview();
  updateSaveButtonLabel();

  const path = new URLSearchParams(location.search).get('path');
  if (path && /^_posts\/.+\.md$/i.test(path)) {
    loadArticle(path);
  } else if (!maybeRestoreLocal('matlock-writer:new')) {
    setSaveState('New article');
  }
})();
