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

  if (!originalConnectButton || !connectDialog || !tokenInput || !manualAuthorizeButton) return;

  // writer.js attached the old manual-token click handler before this module ran.
  // Replacing the node removes that handler while preserving the same selector so
  // writer.js can still update the button after a successful connection.
  const connectButton = originalConnectButton.cloneNode(true);
  originalConnectButton.replaceWith(connectButton);
  connectButton.textContent = 'Sign in with GitHub';

  let popup = null;
  let popupWatch = 0;

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
    connectDialog.showModal();
  }

  function beginGithubSignIn() {
    if (!authBase) {
      openFallback('GitHub sign-in is not configured yet. You can still use the advanced token fallback below.');
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
        if (!tokenInput.value) {
          connectButton.disabled = false;
          connectButton.textContent = 'Sign in with GitHub';
          setStatus('Sign-in window closed.', '');
        }
      }
    }, 500);
  }

  connectButton.addEventListener('click', beginGithubSignIn);
  if (oauthButton) oauthButton.addEventListener('click', beginGithubSignIn);

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
      connectButton.textContent = 'Sign in with GitHub';
      openFallback(message.error || 'GitHub sign-in did not complete.');
      return;
    }

    setStatus(`Authorized as ${message.login || 'GitHub user'}. Connecting Writer…`, 'working');

    // Hand the short-lived/repository-limited GitHub App user token to the
    // existing Writer connection path. writer.js immediately moves it into its
    // in-memory variable and clears this password input; nothing is persisted.
    tokenInput.value = message.token;
    manualAuthorizeButton.click();

    window.setTimeout(() => {
      if (!tokenInput.value) {
        setStatus(`Signed in as ${message.login || 'GitHub user'}.`, 'success');
      }
    }, 250);
  });

  async function checkBridge() {
    if (!authBase) {
      setStatus('GitHub sign-in bridge is not configured. Advanced token fallback is available.', '');
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
      setStatus('GitHub sign-in is ready.', 'success');
    } catch {
      setStatus('GitHub sign-in bridge is not ready yet. Advanced token fallback is still available.', '');
    }
  }

  checkBridge();
})();
