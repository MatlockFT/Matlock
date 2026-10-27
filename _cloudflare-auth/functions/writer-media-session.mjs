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
    try {
      const store = storeFactory();
      const key = createHash('sha256').update(id).digest('hex');
      const cached = await store.get(key, { type: 'json' });
      const { renew } = await request.json().catch(() => ({}));
      if (!renew && cached?.expiresAt > Date.now() + 5 * 60 * 1000) return Response.json({ ok: true, mediaBase: NETLIFY_MEDIA_BASE, ...cached }, { headers });
      const response = await fetcher(`${NETLIFY_MEDIA_BASE}/api/writer/media-session`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ previousId: cached?.sessionId || '', tokenExpiresAt: session.expiresAt || session.sessionExpiresAt }),
        signal: AbortSignal.timeout(45000), redirect: 'error'
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !/^mwm_[A-Za-z0-9_-]{48}$/.test(data.sessionId || '') || !(data.expiresAt > Date.now() + 60000)) throw new Error('Upload service unavailable.');
      const media = { sessionId: data.sessionId, expiresAt: Math.min(data.expiresAt, session.sessionExpiresAt || Infinity) };
      await store.setJSON(key, media);
      return Response.json({ ok: true, mediaBase: NETLIFY_MEDIA_BASE, ...media }, { headers });
    } catch {
      return Response.json({ ok: false, error: 'Netlify video uploads are unavailable. Your Cloudflare sign-in and article saving are still available. Try again later or check the Netlify monthly allowance.' }, { status: 503, headers });
    }
  };
}
export default createMediaSessionHandler();
