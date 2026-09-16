import {
  ALLOWED_LOGIN,
  callbackUrl,
  getAppConfig,
  randomToken,
  securityHeaders,
  setupCookie
} from './_github-auth.mjs';

export default async function handler(request) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: securityHeaders({ Allow: 'GET' }) });
  }

  const existing = await getAppConfig();
  const origin = new URL(request.url).origin;
  const state = randomToken(32);
  const manifestCallback = `${origin}/setup/github-app/callback`;
  const oauthCallback = callbackUrl(request);
  const webhookUrl = `${origin}/auth/github/webhook`;

  const manifest = {
    name: 'MMA Matlock Writer',
    url: 'https://mmamatlock.com/write/',
    description: 'Private publishing access for the MMA Matlock Writer.',
    redirect_url: manifestCallback,
    callback_urls: [oauthCallback],
    setup_url: 'https://mmamatlock.com/write/?github-app=installed',
    setup_on_update: false,
    public: false,
    request_oauth_on_install: false,
    default_permissions: {
      contents: 'write'
    },
    default_events: [],
    hook_attributes: {
      url: webhookUrl,
      active: false
    }
  };

  const formAction = `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`;
  const manifestValue = JSON.stringify(manifest)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const alreadyConfigured = Boolean(existing?.clientId && existing?.clientSecret);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Set up MMA Matlock Writer GitHub App</title>
<style>html{color-scheme:dark;background:#080808;color:#f3f3f3;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:1rem;box-sizing:border-box}.card{width:min(680px,100%);border:1px solid #292929;border-radius:14px;background:#101010;padding:1.5rem;box-sizing:border-box}.eyebrow{margin:0 0 .45rem;text-transform:uppercase;letter-spacing:.08em;font-size:.76rem;font-weight:800;color:#999}h1{margin:0 0 .8rem;font-size:clamp(1.7rem,5vw,2.5rem)}p,li{color:#bbb;line-height:1.55}.note{padding:.8rem 1rem;border:1px solid #333;border-radius:9px;background:#151515}.button{display:inline-block;margin-top:.6rem;border:0;border-radius:9px;background:#f2f2f2;color:#090909;padding:.8rem 1rem;font-weight:800;cursor:pointer}.small{font-size:.82rem;color:#888}</style>
</head>
<body>
<main class="card">
<p class="eyebrow">MMA Matlock Writer</p>
<h1>${alreadyConfigured ? 'GitHub App is already configured' : 'Create the Writer GitHub App'}</h1>
${alreadyConfigured ? `<p class="note">A GitHub App configuration already exists for this auth bridge. Creating another one will replace those stored client credentials.</p>` : ''}
<p>This uses GitHub's App Manifest flow to create a private GitHub App owned by <strong>${ALLOWED_LOGIN}</strong>. The requested repository permission is only <strong>Contents: read and write</strong>; no issue, pull request, administration, or webhook access is requested.</p>
<ol><li>Click the button below.</li><li>GitHub will show the preconfigured app. Confirm <strong>Create GitHub App</strong>.</li><li>Back here, click <strong>Install on Matlock</strong> and select only the <strong>Matlock</strong> repository.</li></ol>
<form action="${formAction}" method="post">
<input type="hidden" name="manifest" value="${manifestValue}">
<button class="button" type="submit">Create GitHub App</button>
</form>
<p class="small">The generated client secret is returned directly to this Netlify service and stored in its private Blobs store. It is never committed to GitHub or exposed in the Writer page.</p>
</main>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: securityHeaders({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com; base-uri 'none'; frame-ancestors 'none'",
      'Set-Cookie': setupCookie(state)
    })
  });
}

export const config = {
  path: '/setup/github-app'
};
