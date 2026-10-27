import { createHash, randomBytes } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { ALLOWED_LOGIN, REPO_FULL_NAME, securityHeaders } from './_github-auth.mjs';

const ID_PATTERN = /^mwm_[A-Za-z0-9_-]{48}$/;
const LIFETIME_MS = 60 * 60 * 1000;
export const mediaSessionStore = () => getStore({ name: 'matlock-writer-upload-sessions', consistency: 'strong' });
const keyFor = id => createHash('sha256').update(id).digest('hex');

export async function getMediaSession(id, { store = mediaSessionStore() } = {}) {
  if (!ID_PATTERN.test(String(id || ''))) return null;
  const session = await store.get(keyFor(id), { type: 'json', consistency: 'strong' });
  if (!session?.token || session.repo !== REPO_FULL_NAME || session.login?.toLowerCase() !== ALLOWED_LOGIN.toLowerCase()) return null;
  if (!Number.isFinite(Number(session.sessionExpiresAt)) || Number(session.sessionExpiresAt) <= Date.now()) return null;
  return session;
}

// Called by Cloudflare over HTTPS. The GitHub credential never passes through
// the browser: it receives only this separate, media-only session identifier.
export function createMediaSessionHandler({ fetcher = fetch, storeFactory = mediaSessionStore } = {}) {
  return async request => {
    const headers = securityHeaders();
    if (request.method === 'GET') return Response.json({ ok: true, service: 'netlify-video-uploads', maxFileBytes: 2 * 1024 ** 3, chunkBytes: 3_500_000 }, { headers });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, POST' } });
    // This exchange is server-to-server; a browser may only use the resulting
    // media session on the existing origin-checked upload endpoints.
    if (request.headers.has('origin')) return Response.json({ ok: false, error: 'Server exchange required.' }, { status: 403, headers });
    const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_]{10,512})$/)?.[1];
    if (!token) return Response.json({ ok: false, error: 'GitHub authorization required.' }, { status: 401, headers });
    try {
      const githubHeaders = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Matlock-Writer-Upload-Bridge', 'X-GitHub-Api-Version': '2022-11-28' };
      const userResponse = await fetcher('https://api.github.com/user', { headers: githubHeaders, signal: AbortSignal.timeout(15000) });
      const user = await userResponse.json();
      if (!userResponse.ok || user.login?.toLowerCase() !== ALLOWED_LOGIN.toLowerCase()) return Response.json({ ok: false, error: 'Writer owner authorization required.' }, { status: 403, headers });
      const repoResponse = await fetcher(`https://api.github.com/repos/${REPO_FULL_NAME}`, { headers: githubHeaders, signal: AbortSignal.timeout(15000) });
      const repo = await repoResponse.json();
      if (!repoResponse.ok || repo.full_name?.toLowerCase() !== REPO_FULL_NAME.toLowerCase() || !repo.permissions?.push) return Response.json({ ok: false, error: 'Repository write access required.' }, { status: 403, headers });
      const body = await request.json().catch(() => ({}));
      const store = storeFactory();
      const priorId = ID_PATTERN.test(String(body.previousId || '')) ? body.previousId : '';
      const previous = priorId ? await store.get(keyFor(priorId), { type: 'json', consistency: 'strong' }) : null;
      const id = previous?.login?.toLowerCase() === user.login.toLowerCase() && previous.repo === REPO_FULL_NAME ? priorId : `mwm_${randomBytes(36).toString('base64url')}`;
      const expiresAt = Math.min(Date.now() + LIFETIME_MS, Number(body.tokenExpiresAt) || Infinity);
      if (expiresAt <= Date.now() + 60000) return Response.json({ ok: false, error: 'GitHub authorization expires too soon; sign in again.' }, { status: 401, headers });
      await store.setJSON(keyFor(id), { token, login: user.login, repo: REPO_FULL_NAME, sessionExpiresAt: expiresAt }, { metadata: { expiresAt } });
      return Response.json({ ok: true, sessionId: id, expiresAt }, { headers });
    } catch {
      return Response.json({ ok: false, error: 'Could not authorize the Netlify upload service. Try again shortly.' }, { status: 503, headers });
    }
  };
}

export async function cleanupMediaSessions() {
  const store = mediaSessionStore();
  const { blobs } = await store.list();
  for (const entry of blobs) {
    const meta = await store.getMetadata(entry.key, { consistency: 'strong' });
    // Preserve one day for renewing an interrupted upload under its same ID.
    if (Number(meta?.metadata?.expiresAt) < Date.now() - 24 * 60 * 60 * 1000) await store.delete(entry.key);
  }
}

export default createMediaSessionHandler();
export const config = { path: '/api/writer/media-session' };
