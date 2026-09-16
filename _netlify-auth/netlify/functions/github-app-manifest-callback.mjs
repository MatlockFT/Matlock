import {
  ALLOWED_LOGIN,
  SETUP_COOKIE_NAME,
  clearSetupCookie,
  escapeHtml,
  parseCookies,
  randomToken,
  saveAppConfig,
  securityHeaders
} from './_github-auth.mjs';

function page({ title, body, status = 200, clearCookie = true }) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>${escapeHtml(title)}</title>
<style>html{color-scheme:dark;background:#080808;color:#f3f3f3;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:1rem;box-sizing:border-box}.card{width:min(680px,100%);border:1px solid #292929;border-radius:14px;background:#101010;padding:1.5rem;box-sizing:border-box}.eyebrow{margin:0 0 .45rem;text-transform:uppercase;letter-spacing:.08em;font-size:.76rem;font-weight:800;color:#999}h1{margin:0 0 .8rem;font-size:clamp(1.7rem,5vw,2.5rem)}p,li{color:#bbb;line-height:1.55}.button{display:inline-block;margin:.6rem .45rem 0 0;border:0;border-radius:9px;background:#f2f2f2;color:#090909;padding:.8rem 1rem;font-weight:800;text-decoration:none}.button.secondary{background:#1b1b1b;color:#eee;border:1px solid #333}.note{padding:.8rem 1rem;border:1px solid #333;border-radius:9px;background:#151515}</style>
</head>
<body><main class="card"><p class="eyebrow">MMA Matlock Writer</p><h1>${escapeHtml(title)}</h1>${body}</main></body>
</html>`;
  const headers = securityHeaders({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
  });
  if (clearCookie) headers['Set-Cookie'] = clearSetupCookie();
  return new Response(html, { status, headers });
}

export default async function handler(request) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: securityHeaders({ Allow: 'GET' }) });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const cookies = parseCookies(request);
  const expectedState = cookies[SETUP_COOKIE_NAME] || '';

  if (!code || !state || !expectedState || state !== expectedState) {
    return page({
      title: 'GitHub App setup could not be verified',
      body: '<p>The setup session expired or the state value did not match. Start the GitHub App setup again.</p>',
      status: 400
    });
  }

  try {
    const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'MMA-Matlock-Writer-Auth'
      },
      cache: 'no-store'
    });
    const app = await response.json().catch(() => ({}));
    if (!response.ok || !app.client_id || !app.client_secret) {
      throw new Error(app.message || 'GitHub did not return the new app credentials.');
    }

    const ownerLogin = String(app.owner?.login || '');
    if (!ownerLogin || ownerLogin.toLowerCase() !== ALLOWED_LOGIN.toLowerCase()) {
      throw new Error(`The GitHub App must be owned by ${ALLOWED_LOGIN}.`);
    }

    if (app.permissions?.contents !== 'write') {
      throw new Error('The created GitHub App does not have the expected Contents: write permission.');
    }

    await saveAppConfig({
      clientId: app.client_id,
      clientSecret: app.client_secret,
      appId: app.id,
      appSlug: app.slug,
      htmlUrl: app.html_url,
      ownerLogin,
      stateSecret: randomToken(48),
      createdAt: new Date().toISOString()
    });

    const slug = encodeURIComponent(app.slug || '');
    const installUrl = `https://github.com/apps/${slug}/installations/new`;
    const settingsUrl = app.html_url || `https://github.com/settings/apps/${slug}`;

    return page({
      title: 'GitHub App created',
      body: `<p>The Writer app credentials are now stored privately in Netlify. One GitHub step remains: install the app on the repository it is allowed to edit.</p><p class="note">On GitHub choose <strong>Only select repositories</strong>, then select <strong>Matlock</strong>. Do not grant it to every repository.</p><a class="button" href="${escapeHtml(installUrl)}">Install on Matlock</a><a class="button secondary" href="${escapeHtml(settingsUrl)}">View GitHub App</a><p>After installation GitHub will send you back to the MMA Matlock Writer. Then <strong>Sign in with GitHub</strong> will work without a personal access token.</p>`
    });
  } catch (error) {
    return page({
      title: 'GitHub App setup failed',
      body: `<p>${escapeHtml(error?.message || 'The GitHub App could not be created.')}</p><p>Start the setup flow again after correcting the issue.</p>`,
      status: 400
    });
  }
}

export const config = {
  path: '/setup/github-app/callback'
};
