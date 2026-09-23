(() => {
  const app = document.querySelector('[data-writer-app]');
  if (!app) return;

  const authBase = String(app.dataset.authBase || '').replace(/\/$/, '');
  const originalConnectButton = app.querySelector('[data-github-connect]');
  const connectDialog = app.querySelector('[data-connect-dialog]');
  const oauthButton = app.querySelector('[data-github-oauth]');
  const oauthStatus = app.querySelector('[data-oauth-status]');
  const tokenInput = app.querySelector('[data-github-token]');
  const manualAuthorizeButton = app.querySelector('[data-github-authorize]');
  const githubStatus = app.querySelector('[data-github-status]');
  const signOutButton = app.querySelector('[data-github-signout]');

  if (!originalConnectButton || !connectDialog || !tokenInput || !manualAuthorizeButton) return;

  const SESSION_ID_KEY = 'matlock-writer:server-session';
  const SESSION_LOGIN_KEY = 'matlock-writer:server-login';
  const PAT_KEY = 'matlock-writer:pat-session';

  function localRead(key) {
    try { return localStorage.getItem(key) || ''; } catch { return ''; }
  }
  function localWrite(key, value) {
    try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch {}
  }
  function sessionRead(key) {
    try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
  }
  function sessionWrite(key, value) {
    try { value ? sessionStorage.setItem(key, value) : sessionStorage.removeItem(key); } catch {}
  }

  function clearServerSessionLocal() {
    localWrite(SESSION_ID_KEY, '');
    localWrite(SESSION_LOGIN_KEY, '');
  }

  const connectButton = originalConnectButton.cloneNode(true);
  originalConnectButton.replaceWith(connectButton);
  connectButton.textContent = 'GitHub';
  connectButton.dataset.connected = 'false';
  connectButton.title = 'Connect GitHub';

  let popup = null;
  let popupWatch = 0;
  let bridgeReady = false;
  let connectionMonitor = 0;

  function setStatus(message, state = '') {
    if (!oauthStatus) return;
    oauthStatus.textContent = message;
    oauthStatus.dataset.state = state;
  }

  function authOrigin() {
    try { return new URL(authBase).origin; } catch { return ''; }
  }

  function openDialog(message = '') {
    if (message) setStatus(message, 'error');
    if (!connectDialog.open) connectDialog.showModal();
  }

  function monitorConnectionAttempt(login = '', { server = false } = {}) {
    window.clearInterval(connectionMonitor);
    const started = Date.now();
    connectionMonitor = window.setInterval(() => {
      if (!tokenInput.value) {
        window.clearInterval(connectionMonitor);
        connectionMonitor = 0;
        const resolvedLogin = login || localRead(SESSION_LOGIN_KEY) || 'GitHub user';
        connectButton.disabled = false;
        connectButton.textContent = 'GitHub';
        connectButton.dataset.connected = 'true';
        connectButton.title = `GitHub connected as ${resolvedLogin}`;
        if (server) localWrite(SESSION_LOGIN_KEY, resolvedLogin);
        setStatus(server
          ? `Signed in as ${resolvedLogin}. This browser will stay signed in until you sign out or the session expires.`
          : `Connected as ${resolvedLogin} for this browser tab.`, 'success');
        if (signOutButton) signOutButton.hidden = false;
        return;
      }

      if (!manualAuthorizeButton.disabled && Date.now() - started > 500) {
        window.clearInterval(connectionMonitor);
        connectionMonitor = 0;
        if (server) clearServerSessionLocal();
        else sessionWrite(PAT_KEY, '');
        tokenInput.value = '';
        connectButton.disabled = false;
        connectButton.textContent = 'GitHub';
        connectButton.dataset.connected = 'false';
        connectButton.title = 'Connect GitHub';
        setStatus('GitHub session could not be restored. Please sign in again.', 'error');
      }
    }, 150);
  }

  function authorizeCredential(value, login = '', { restoring = false, server = false } = {}) {
    if (!value) return;
    tokenInput.value = value;
    connectButton.disabled = true;
    connectButton.textContent = restoring ? 'Restoring GitHub…' : 'Connecting…';
    setStatus(restoring ? 'Restoring your GitHub session…' : `Authorized as ${login || 'GitHub user'}. Connecting Writer…`, 'working');
    monitorConnectionAttempt(login, { server });
    manualAuthorizeButton.click();
  }

  async function verifyServerSession(id) {
    if (!id || !authBase) return null;
    try {
      const response = await fetch(`${authBase}/api/writer/session`, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'X-Writer-Session': id }
      });
      const data = await response.json().catch(() => ({}));
      return response.ok && data.ok ? data : null;
    } catch { return null; }
  }

  async function restoreSession() {
    const id = localRead(SESSION_ID_KEY);
    if (id) {
      setStatus('Restoring your GitHub session…', 'working');
      const status = await verifyServerSession(id);
      if (status) {
        localWrite(SESSION_LOGIN_KEY, status.login || 'GitHub user');
        authorizeCredential(`session:${id}`, status.login || '', { restoring: true, server: true });
        return true;
      }
      clearServerSessionLocal();
    }

    const pat = sessionRead(PAT_KEY);
    if (pat) {
      authorizeCredential(pat, '', { restoring: true, server: false });
      return true;
    }
    return false;
  }

  function beginGithubSignIn() {
    if (githubStatus?.textContent?.startsWith('Connected to ')) {
      if (!connectDialog.open) connectDialog.showModal();
      setStatus(`Signed in as ${localRead(SESSION_LOGIN_KEY) || 'GitHub user'}.`, 'success');
      return;
    }
    if (!authBase || !bridgeReady) {
      openDialog('GitHub sign-in is not ready yet. The advanced token fallback remains available.');
      return;
    }

    const url = `${authBase}/auth/github/start?origin=${encodeURIComponent(location.origin)}`;
    popup = window.open(url, 'matlock-writer-github-auth', 'popup=yes,width=720,height=820,resizable=yes,scrollbars=yes');
    if (!popup) {
      openDialog('Your browser blocked the GitHub sign-in window. Allow popups for this page and try again.');
      return;
    }

    setStatus('Waiting for GitHub authorization…', 'working');
    connectButton.disabled = true;
    connectButton.textContent = 'Signing in…';
    window.clearInterval(popupWatch);
    popupWatch = window.setInterval(() => {
      if (!popup || popup.closed) {
        window.clearInterval(popupWatch);
        popupWatch = 0;
        if (!tokenInput.value && !localRead(SESSION_ID_KEY)) {
          connectButton.disabled = false;
          connectButton.textContent = 'Sign in with GitHub';
          setStatus('Sign-in window closed.', '');
        }
      }
    }, 500);
  }

  connectButton.addEventListener('click', beginGithubSignIn);
  if (oauthButton) oauthButton.addEventListener('click', beginGithubSignIn);

  manualAuthorizeButton.addEventListener('click', () => {
    const credential = tokenInput.value.trim();
    if (!credential || credential.startsWith('session:')) return;
    sessionWrite(PAT_KEY, credential);
    monitorConnectionAttempt('', { server: false });
  }, { capture: true });

  window.addEventListener('message', event => {
    const expectedOrigin = authOrigin();
    if (!expectedOrigin || event.origin !== expectedOrigin) return;
    const message = event.data;
    if (!message || message.type !== 'matlock-writer-github-auth') return;

    window.clearInterval(popupWatch);
    popupWatch = 0;
    if (popup && !popup.closed) popup.close();
    popup = null;
    connectButton.disabled = false;

    if (!message.ok || !message.sessionId) {
      clearServerSessionLocal();
      connectButton.textContent = 'Sign in with GitHub';
      openDialog(message.error || 'GitHub sign-in did not complete.');
      return;
    }

    localWrite(SESSION_ID_KEY, message.sessionId);
    localWrite(SESSION_LOGIN_KEY, message.login || 'GitHub user');
    sessionWrite(PAT_KEY, '');
    authorizeCredential(`session:${message.sessionId}`, message.login || '', { server: true });
  });

  async function signOut() {
    const id = localRead(SESSION_ID_KEY);
    if (id && authBase) {
      try {
        await fetch(`${authBase}/api/writer/session`, {
          method: 'DELETE',
          mode: 'cors',
          headers: { 'X-Writer-Session': id }
        });
      } catch {}
    }
    clearServerSessionLocal();
    sessionWrite(PAT_KEY, '');
    location.reload();
  }
  if (signOutButton) signOutButton.addEventListener('click', signOut);

  window.addEventListener('matlock-writer:auth-expired', () => {
    clearServerSessionLocal();
    sessionWrite(PAT_KEY, '');
    window.clearInterval(connectionMonitor);
    connectionMonitor = 0;
    connectButton.disabled = false;
    connectButton.textContent = 'Sign in with GitHub';
    if (signOutButton) signOutButton.hidden = true;
    setStatus('Your GitHub session expired. Sign in again to save or publish.', 'error');
  });

  async function checkBridge() {
    bridgeReady = false;
    if (!authBase) return;
    try {
      const response = await fetch(`${authBase}/auth/github/health`, { method: 'GET', mode: 'cors', cache: 'no-store', headers: { Accept: 'application/json' } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !data.configured) throw new Error('Auth bridge is not configured');
      bridgeReady = true;
      if (!localRead(SESSION_ID_KEY) && !sessionRead(PAT_KEY)) setStatus('GitHub sign-in is ready.', 'success');
    } catch {
      if (!localRead(SESSION_ID_KEY) && !sessionRead(PAT_KEY)) setStatus('GitHub sign-in bridge is unavailable. Advanced token fallback is still available.', '');
    }
  }

  restoreSession();
  checkBridge();
})();
