(() => {
  const article = document.querySelector('.post-page-v3[data-writer-source-path]');
  if (!article) return;

  const SESSION_ID_KEY = 'matlock-writer:server-session';
  const SESSION_LOGIN_KEY = 'matlock-writer:server-login';
  const path = String(article.dataset.writerSourcePath || '');
  const authBase = String(article.dataset.writerAuthBase || '').replace(/\/$/, '');
  if (!/^_posts\/.+\.md$/i.test(path) || !authBase) return;

  let sessionId = '';
  try { sessionId = localStorage.getItem(SESSION_ID_KEY) || ''; } catch {}
  if (!sessionId) return;

  function clearSession() {
    try {
      localStorage.removeItem(SESSION_ID_KEY);
      localStorage.removeItem(SESSION_LOGIN_KEY);
    } catch {}
  }

  async function verifySession() {
    const response = await fetch(`${authBase}/api/writer/session`, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'X-Writer-Session': sessionId }
    });
    if (!response.ok) {
      if (response.status === 401) clearSession();
      return null;
    }
    const data = await response.json().catch(() => null);
    return data?.ok ? data : null;
  }

  async function githubRequest(apiPath, options = {}) {
    const response = await fetch(`${authBase}/api/writer/github?path=${encodeURIComponent(apiPath)}`, {
      ...options,
      mode: 'cors',
      headers: {
        Accept: 'application/json',
        'X-Writer-Session': sessionId,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) clearSession();
      const error = new Error(data.message || data.error || `GitHub request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function decodeBase64(value) {
    const binary = atob(String(value || '').replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function encodeBase64(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  function markUnpublished(markdown) {
    const normalized = String(markdown || '').replace(/\r\n?/g, '\n');
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) throw new Error('Article frontmatter is missing.');

    let frontmatter = match[1];
    if (/^published:/m.test(frontmatter)) {
      frontmatter = frontmatter.replace(/^published:.*$/m, 'published: false');
    } else {
      frontmatter = `${frontmatter.trimEnd()}\npublished: false`;
    }
    frontmatter = frontmatter.replace(/^publish_at:.*(?:\n|$)/m, '').trimEnd();

    return `---\n${frontmatter}\n---\n${normalized.slice(match[0].length)}`;
  }

  function articleApiPath() {
    return `/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`;
  }

  function buildControls(login) {
    const bar = document.createElement('aside');
    bar.className = 'post-writer-actions';
    bar.setAttribute('aria-label', 'Writer article controls');

    const label = document.createElement('strong');
    label.className = 'post-writer-actions-label';
    label.textContent = login ? `Writer · ${login}` : 'Writer';

    const edit = document.createElement('a');
    edit.className = 'post-writer-action';
    edit.href = `/write/?path=${encodeURIComponent(path)}`;
    edit.textContent = 'Edit';

    const unpublish = document.createElement('button');
    unpublish.className = 'post-writer-action';
    unpublish.type = 'button';
    unpublish.textContent = 'Unpublish';

    const remove = document.createElement('button');
    remove.className = 'post-writer-action is-danger';
    remove.type = 'button';
    remove.textContent = 'Delete';

    const status = document.createElement('span');
    status.className = 'post-writer-actions-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    bar.append(label, edit, unpublish, remove, status);
    article.insertBefore(bar, article.firstChild);

    const title = document.querySelector('#post-title')?.textContent?.trim() || 'this article';
    const buttons = [unpublish, remove];

    function setBusy(busy, message = '') {
      buttons.forEach(button => { button.disabled = busy; });
      if (message) status.textContent = message;
    }

    unpublish.addEventListener('click', async () => {
      if (!window.confirm(`Unpublish “${title}”?\n\nThe article will remain in Writer as a draft and disappear from the public site after the next deployment.`)) return;
      setBusy(true, 'Unpublishing…');
      try {
        const apiPath = articleApiPath();
        const file = await githubRequest(`${apiPath}?ref=main`);
        const content = markUnpublished(decodeBase64(file.content));
        await githubRequest(apiPath, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Unpublish ${path.split('/').pop()}`,
            content: encodeBase64(content),
            sha: file.sha,
            branch: 'main'
          })
        });
        unpublish.disabled = true;
        unpublish.textContent = 'Unpublished';
        remove.disabled = false;
        status.textContent = 'Unpublished. Public site is redeploying.';
      } catch (error) {
        setBusy(false, error.message || 'Could not unpublish.');
      }
    });

    remove.addEventListener('click', async () => {
      if (!window.confirm(`Delete “${title}”?\n\nThis removes the article source file from GitHub. The public page will disappear after the next deployment. Git history can recover it, but Writer has no undo button.`)) return;
      setBusy(true, 'Deleting…');
      try {
        const apiPath = articleApiPath();
        const file = await githubRequest(`${apiPath}?ref=main`);
        await githubRequest(apiPath, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Delete ${path.split('/').pop()}`,
            sha: file.sha,
            branch: 'main'
          })
        });
        edit.removeAttribute('href');
        edit.setAttribute('aria-disabled', 'true');
        unpublish.disabled = true;
        remove.disabled = true;
        remove.textContent = 'Deleted';
        status.textContent = 'Deleted from GitHub. Public site is redeploying.';
      } catch (error) {
        setBusy(false, error.message || 'Could not delete.');
      }
    });
  }

  verifySession()
    .then(session => {
      if (session) buildControls(session.login || '');
    })
    .catch(() => {});
})();
