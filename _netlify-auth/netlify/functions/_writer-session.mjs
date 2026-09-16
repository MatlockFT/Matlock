import { createHash } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getAppConfig, randomToken, REPO_FULL_NAME } from './_github-auth.mjs';

const SESSION_STORE = 'matlock-writer-sessions';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;

function store() {
  return getStore({ name: SESSION_STORE, consistency: 'strong' });
}

function sessionKey(id) {
  return createHash('sha256').update(String(id || '')).digest('hex');
}

export async function createWriterSession({ token, login, repo = REPO_FULL_NAME, expiresIn = null, refreshToken = '', refreshTokenExpiresIn = null }) {
  const id = `mws_${randomToken(36)}`;
  const now = Date.now();
  await store().setJSON(sessionKey(id), {
    token,
    login,
    repo,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: expiresIn ? now + Number(expiresIn) * 1000 : null,
    refreshToken: refreshToken || '',
    refreshTokenExpiresAt: refreshTokenExpiresIn ? now + Number(refreshTokenExpiresIn) * 1000 : null,
    sessionExpiresAt: now + SESSION_MAX_AGE_MS
  });
  return id;
}

export async function deleteWriterSession(id) {
  if (!id) return;
  try { await store().delete(sessionKey(id)); } catch {}
}

async function refreshGithubToken(id, session) {
  if (!session.refreshToken) return session;
  if (session.refreshTokenExpiresAt && session.refreshTokenExpiresAt <= Date.now()) return session;

  const app = await getAppConfig();
  if (!app?.clientId || !app?.clientSecret) return session;

  const form = new URLSearchParams({
    client_id: app.clientId,
    client_secret: app.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken
  });

  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'MMA-Matlock-Writer-Auth'
    },
    body: form,
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) return session;

  const now = Date.now();
  const updated = {
    ...session,
    token: data.access_token,
    expiresAt: data.expires_in ? now + Number(data.expires_in) * 1000 : null,
    refreshToken: data.refresh_token || session.refreshToken,
    refreshTokenExpiresAt: data.refresh_token_expires_in ? now + Number(data.refresh_token_expires_in) * 1000 : session.refreshTokenExpiresAt,
    lastUsedAt: now
  };
  await store().setJSON(sessionKey(id), updated);
  return updated;
}

export async function getWriterSession(id, { touch = true } = {}) {
  if (!id || !String(id).startsWith('mws_')) return null;
  const key = sessionKey(id);
  let session = null;
  try { session = await store().get(key, { type: 'json', consistency: 'strong' }); } catch { return null; }
  if (!session?.token || session.repo !== REPO_FULL_NAME) return null;

  const now = Date.now();
  if (session.sessionExpiresAt && session.sessionExpiresAt <= now) {
    await deleteWriterSession(id);
    return null;
  }

  if (session.expiresAt && session.expiresAt <= now + REFRESH_SKEW_MS) {
    session = await refreshGithubToken(id, session);
  }
  if (session.expiresAt && session.expiresAt <= now) {
    await deleteWriterSession(id);
    return null;
  }

  if (touch && (!session.lastUsedAt || now - session.lastUsedAt > 10 * 60 * 1000)) {
    session.lastUsedAt = now;
    try { await store().setJSON(key, session); } catch {}
  }
  return session;
}
