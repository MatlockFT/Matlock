import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

export const REPO_FULL_NAME = process.env.GITHUB_REPOSITORY || 'MatlockFT/Matlock';
export const REPO_ID = process.env.GITHUB_REPOSITORY_ID || '925864034';
export const ALLOWED_LOGIN = (process.env.GITHUB_ALLOWED_LOGIN || 'MatlockFT').trim();
export const COOKIE_NAME = 'matlock_writer_oauth';
export const SETUP_COOKIE_NAME = 'matlock_writer_app_setup';
const STORE_NAME = 'matlock-writer-auth';
const CONFIG_KEY = 'github-app';

export function allowedOrigins() {
  return (process.env.WRITER_ORIGINS || 'https://mmamatlock.com,https://www.mmamatlock.com')
    .split(',')
    .map(value => value.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function normalizeOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    if (!/^https?:$/.test(url.protocol)) return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function isAllowedOrigin(origin) {
  return allowedOrigins().includes(normalizeOrigin(origin));
}

export async function getAppConfig() {
  const envClientId = process.env.GITHUB_CLIENT_ID || '';
  const envClientSecret = process.env.GITHUB_CLIENT_SECRET || '';
  if (envClientId && envClientSecret) {
    return {
      clientId: envClientId,
      clientSecret: envClientSecret,
      appId: process.env.GITHUB_APP_ID || '',
      appSlug: process.env.GITHUB_APP_SLUG || '',
      ownerLogin: ALLOWED_LOGIN,
      stateSecret: process.env.MATLOCK_OAUTH_STATE_SECRET || envClientSecret,
      source: 'environment'
    };
  }

  try {
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const stored = await store.get(CONFIG_KEY, { type: 'json', consistency: 'strong' });
    if (!stored?.clientId || !stored?.clientSecret) return null;
    return { ...stored, source: 'netlify-blobs' };
  } catch {
    return null;
  }
}

export async function saveAppConfig(config) {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  await store.setJSON(CONFIG_KEY, {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    appId: config.appId || '',
    appSlug: config.appSlug || '',
    htmlUrl: config.htmlUrl || '',
    ownerLogin: config.ownerLogin || ALLOWED_LOGIN,
    stateSecret: config.stateSecret || randomToken(48),
    createdAt: config.createdAt || new Date().toISOString()
  });
}

export function stateSecret(config) {
  return process.env.MATLOCK_OAUTH_STATE_SECRET || config?.stateSecret || config?.clientSecret || '';
}

export function encodeSession(session, secret) {
  if (!secret) throw new Error('Auth state secret is not configured.');
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function decodeSession(value, secret) {
  if (!secret || !value || !value.includes('.')) return null;
  const [payload, signature] = value.split('.', 2);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session || typeof session !== 'object') return null;
    return session;
  } catch {
    return null;
  }
}

export function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  return Object.fromEntries(
    raw.split(';').map(part => part.trim()).filter(Boolean).map(part => {
      const index = part.indexOf('=');
      const key = index >= 0 ? part.slice(0, index) : part;
      const value = index >= 0 ? part.slice(index + 1) : '';
      return [key, decodeURIComponent(value)];
    })
  );
}

export function sessionCookie(value, maxAge = 600) {
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/auth/github; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/auth/github; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function setupCookie(value, maxAge = 3600) {
  return `${SETUP_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/setup/github-app; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSetupCookie() {
  return `${SETUP_COOKIE_NAME}=; Path=/setup/github-app; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function pkceChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function callbackUrl(request) {
  return `${new URL(request.url).origin}/auth/github/callback`;
}

export function securityHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extra
  };
}

export function corsHeaders(request) {
  const origin = normalizeOrigin(request.headers.get('origin'));
  return {
    ...securityHeaders(),
    ...(isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {})
  };
}

export function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function popupResponse({ origin, payload, status = 200, clearCookie = true }) {
  const nonce = randomBytes(18).toString('base64');
  const safePayload = escapeScriptJson({ type: 'matlock-writer-github-auth', ...payload });
  const safeOrigin = escapeScriptJson(normalizeOrigin(origin));
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>MMA Matlock Writer — GitHub sign-in</title>
<style>html{color-scheme:dark;background:#080808;color:#f3f3f3;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{min-height:100vh;margin:0;display:grid;place-items:center}.card{width:min(520px,calc(100% - 2rem));border:1px solid #2b2b2b;border-radius:14px;padding:1.5rem;background:#101010}.eyebrow{margin:0 0 .5rem;text-transform:uppercase;letter-spacing:.08em;color:#999;font-size:.76rem;font-weight:800}h1{margin:0 0 .7rem;font-size:1.55rem}p{color:#bbb;line-height:1.55;margin:.4rem 0}</style>
</head>
<body>
<div class="card"><p class="eyebrow">MMA Matlock Writer</p><h1>GitHub authorization complete</h1><p>You can return to the Writer. This window will close automatically.</p></div>
<script nonce="${nonce}">
(() => {
  const payload = ${safePayload};
  const targetOrigin = ${safeOrigin};
  if (window.opener && targetOrigin) window.opener.postMessage(payload, targetOrigin);
  setTimeout(() => window.close(), 180);
})();
</script>
</body>
</html>`;

  const headers = securityHeaders({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`
  });
  if (clearCookie) headers['Set-Cookie'] = clearSessionCookie();
  return new Response(html, { status, headers });
}

export async function verifyGitHubToken(token) {
  const commonHeaders = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'MMA-Matlock-Writer-Auth'
  };

  const userResponse = await fetch('https://api.github.com/user', { headers: commonHeaders, cache: 'no-store' });
  if (!userResponse.ok) throw new Error('GitHub could not verify the signed-in user.');
  const user = await userResponse.json();

  if (ALLOWED_LOGIN && String(user.login || '').toLowerCase() !== ALLOWED_LOGIN.toLowerCase()) {
    throw new Error(`This Writer only allows the ${ALLOWED_LOGIN} GitHub account.`);
  }

  const repoResponse = await fetch(`https://api.github.com/repos/${REPO_FULL_NAME}`, { headers: commonHeaders, cache: 'no-store' });
  if (!repoResponse.ok) throw new Error(`The GitHub App does not have access to ${REPO_FULL_NAME}.`);
  const repo = await repoResponse.json();
  const permissions = repo.permissions || {};
  if (!(permissions.push || permissions.admin || permissions.maintain)) {
    throw new Error(`The GitHub App does not have write access to ${REPO_FULL_NAME}.`);
  }

  return { login: user.login, id: user.id, repo: repo.full_name, permissions };
}
