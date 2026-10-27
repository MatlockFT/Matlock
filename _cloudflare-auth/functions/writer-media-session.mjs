import { createHash } from 'node:crypto';
import { getStore } from './_cloudflare-store.mjs';
import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import { getWriterSession } from './_writer-session.mjs';

export const NETLIFY_MEDIA_BASE = 'https://mmamatlock-writer-auth.netlify.app';
export function createMediaSessionHandler({ getSession = getWriterSession, fetcher = fetch, storeFactory = () => getStore({ name: 'matlock-writer-media-delegations', consistency: 'strong' }) } = {}) {
  return async request => {
    const headers = corsHeaders(request);
    if (!isAllowedOrigin(normalizeOrigin(request.headers.get('origin')))) return Response.json({ ok: false, error: 'Origin not allowed.' }, { status: 403, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Accept, X-Writer-Session, Content-Type' } });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, Allow: 'POST, OPTIONS' } });
    const id = request.headers.get('x-writer-session') || '';
    const session = await getSession(id);
    if (!session) return Response.json({ ok: false, error: 'Sign in with GitHub before uploading.' }, { status: 401, headers });
    const unavailable = (code, message) => Response.json({ ok: false, code, error: `${message} Your Cloudflare sign-in and article saving are still available.` }, { status: 503, headers });
    let stage = 'storage';
    try {
      const store = storeFactory();
      const key = createHash('sha256').update(id).digest('hex');
      const cached = await store.get(key, { type: 'json' });
      const { renew } = await request.json().catch(() => ({}));
      if (!renew && cached?.expiresAt > Date.now() + 5 * 60 * 1000) return Response.json({ ok: true, mediaBase: NETLIFY_MEDIA_BASE, ...cached }, { headers });
      stage = 'connection';
      const response = await fetcher(`${NETLIFY_MEDIA_BASE}/api/writer/media-session`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ previousId: cached?.sessionId || '', tokenExpiresAt: session.expiresAt || session.sessionExpiresAt }),
        // Workers rejects redirect: 'error' before sending a request. Manual
        // mode lets us reject redirects without forwarding the GitHub token.
        signal: AbortSignal.timeout(45000), redirect: 'manual'
      });
      if (response.status >= 300 && response.status < 400) return unavailable('MEDIA_AUTH_REDIRECT', 'The upload service returned an unexpected redirect.');
      if (response.status === 401 || response.status === 403) return unavailable('MEDIA_AUTH_DENIED', 'The upload service could not verify your GitHub repository access. Sign out and sign in again before retrying.');
      if (response.status === 402) return unavailable('MEDIA_ACCOUNT_REJECTED', 'Netlify refused upload authorization (HTTP 402). Check the Netlify account status.');
      if (!response.ok) return unavailable('MEDIA_SERVICE_RESPONSE', `The upload service could not authorize this upload (HTTP ${response.status}).`);
      const data = await response.json().catch(() => ({}));
      if (!/^mwm_[A-Za-z0-9_-]{48}$/.test(data.sessionId || '') || !(data.expiresAt > Date.now() + 60000)) return unavailable('MEDIA_AUTH_INVALID_RESPONSE', 'The upload service returned an invalid authorization response.');
      const media = { sessionId: data.sessionId, expiresAt: Math.min(data.expiresAt, session.sessionExpiresAt || Infinity) };
      stage = 'storage';
      await store.setJSON(key, media);
      return Response.json({ ok: true, mediaBase: NETLIFY_MEDIA_BASE, ...media }, { headers });
    } catch {
      return stage === 'storage'
        ? unavailable('MEDIA_AUTH_STORAGE', 'Cloudflare could not save the upload authorization. Please retry shortly.')
        : unavailable('MEDIA_AUTH_CONNECTION', 'Cloudflare could not connect to the upload service. Please retry shortly.');
    }
  };
}
export default createMediaSessionHandler();
