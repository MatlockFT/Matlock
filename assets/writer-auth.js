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

  if (!originalConnectButton || !connectDialog || !tokenInput || !manualAuthorizeButton) return;

  const SESSION_TOKEN_KEY = 'matlock-writer:github-token';
  const SESSION_LOGIN_KEY = 'matlock-writer:github-login';

  function readSession(key) {
    try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
  }

  function writeSession(key, value) {
    try {
      if (value) sessionStorage.setItem(key, value);
      else sessionStorage.removeItem(key);
    } catch {}
  }

  function clearSession() {
    writeSession(SESSION_TOKEN_KEY, '');
    writeSession(SESSION_LOGIN_KEY, '');
  }

  function saveSession(token, login = '') {
    writeSession(SESSION_TOKEN_KEY, token);
    if (login) writeSession(SESSION_LOGIN_KEY, login);
  }

  // writer.js attached the old manual-token click handler before this module ran.
  // Replacing the top-level button removes that handler while preserving the same
  // selector, so writer.js can still update its label after authorization succeeds.
  const connectButton = originalConnectButton.cloneNode(true);
  originalConnectButton.replaceWith(connectButton);
  connectButton.textContent = 'Sign in with GitHub';

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
    if (!authBase) return '';
    try {
      return new URL(authBase).origin;
    } catch {
      return '';
    }
  }

  function openFallback(message) {
    setStatus(message, 'error');
    if (!connectDialog.open) connectDialog.showModal();
  }

  function monitorConnectionAttempt(login = '') {
    window.clearInterval(connectionMonitor);
    const started = Date.now();

    connectionMonitor = window.setInterval(() => {
      // writer.js clears the password input only after it has successfully
      // verified the token against the Matlock repository.
      if (!tokenInput.value) {
        window.clearInterval(connectionMonitor);
        connectionMonitor = 0;
        const resolvedLogin = login || readSession(SESSION_LOGIN_KEY) || 'GitHub user';
        if (resolvedLogin && resolvedLogin !== 'GitHub user') writeSession(SESSION_LOGIN_KEY, resolvedLogin);
        connectButton.disabled = false;
        connectButton.textContent = 'GitHub connected';
        setStatus(`Signed in as ${resolvedLogin}. Refreshing this tab will keep you signed in.`, 'success');
        return;
      }

      // connectGitHub() re-enables its authorize button after both success and
      // failure. If the token input is still populated at that point, validation
      // failed, so do not keep a bad credential in sessionStorage.
      if (!manualAuthorizeButton.disabled && Date.now() - started > 350) {
        window.clearInterval(connectionMonitor);
        connectionMonitor = 0;
        clearSession();
        tokenInput.value = '';
        connectButton.disabled = false;
        connectButton.textContent = 'Sign in with GitHub';
        setStatus('GitHub session could not be restored. Please sign in again.', 'error');
      }
    }, 150);
  }

  function authorizeToken(token, login = '', { restoring = false } = {}) {
    if (!token) return false;
    saveSession(token, login);
    tokenInput.value = token;
    connectButton.disabled = true;
    connectButton.textContent = restoring ? 'Restoring GitHub…' : 'Connecting…';
    setStatus(restoring ? 'Restoring your GitHub session…' : `Authorized as ${login || 'GitHub user'}. Connecting Writer…`, 'working');
    monitorConnectionAttempt(login);
    manualAuthorizeButton.click();
    return true;
  }

  function restoreGithubSession() {
    const token = readSession(SESSION_TOKEN_KEY);
    if (!token) return false;
    return authorizeToken(token, readSession(SESSION_LOGIN_KEY), { restoring: true });
  }

  function beginGithubSignIn() {
    const alreadyConnected = Boolean(readSession(SESSION_TOKEN_KEY)) && githubStatus?.textContent?.startsWith('Connected to ');
    if (alreadyConnected) {
      if (!connectDialog.open) connectDialog.showModal();
      setStatus(`Signed in as ${readSession(SESSION_LOGIN_KEY) || 'GitHub user'}. This session survives refreshes in the current tab.`, 'success');
      return;
    }

    if (!authBase || !bridgeReady) {
      openFallback('GitHub sign-in is not ready yet. You can still use the advanced token fallback below.');
      return;
    }

    const url = `${authBase}/auth/github/start?origin=${encodeURIComponent(location.origin)}`;
    popup = window.open(
      url,
      'matlock-writer-github-auth',
      'popup=yes,width=720,height=820,resizable=yes,scrollbars=yes'
    );

    if (!popup) {
      openFallback('Your browser blocked the GitHub sign-in window. Allow popups for this page and try again.');
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
        if (!tokenInput.value && !readSession(SESSION_TOKEN_KEY)) {
          connectButton.disabled = false;
          connectButton.textContent = 'Sign in with GitHub';
          setStatus('Sign-in window closed.', '');
        }
      }
    }, 500);
  }

  connectButton.addEventListener('click', beginGithubSignIn);
  if (oauthButton) oauthButton.addEventListener('click', beginGithubSignIn);

  // The advanced manual-token fallback gets the same refresh behavior. The token
  // is kept in sessionStorage, not localStorage, so it is not a durable browser
  // credential and is discarded when the tab/browser session ends.
  manualAuthorizeButton.addEventListener('click', () => {
    const token = tokenInput.value.trim();
    if (!token) return;
    saveSession(token);
    monitorConnectionAttempt();
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

    if (!message.ok || !message.token) {
      clearSession();
      connectButton.textContent = 'Sign in with GitHub';
      openFallback(message.error || 'GitHub sign-in did not complete.');
      return;
    }

    authorizeToken(message.token, message.login || 'GitHub user');
  });

  async function checkBridge() {
    bridgeReady = false;
    if (!authBase) {
      if (!readSession(SESSION_TOKEN_KEY)) setStatus('GitHub sign-in bridge is not configured. Advanced token fallback is available.', '');
      return;
    }

    try {
      const response = await fetch(`${authBase}/auth/github/health`, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok || !data.configured) {
        throw new Error(data.message || 'Auth bridge is not configured');
      }
      bridgeReady = true;
      if (!readSession(SESSION_TOKEN_KEY)) setStatus('GitHub sign-in is ready.', 'success');
    } catch {
      if (!readSession(SESSION_TOKEN_KEY)) setStatus('GitHub sign-in bridge is not ready yet. Advanced token fallback is still available.', '');
    }
  }

  const restored = restoreGithubSession();
  checkBridge();

  if (restored) {
    // The token never touches localStorage. It survives ordinary refreshes only
    // for this browser tab/session, which is the intended balance between UX and
    // keeping a long-lived publishing credential off persistent storage.
    setStatus('Restoring your GitHub session…', 'working');
  }
})();
