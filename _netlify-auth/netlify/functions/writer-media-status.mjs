import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import { mediaStore, requireWriterSession, statusKey, uploadScope, validUploadId } from './_writer-media.mjs';

export default async function handler(request) {
  const origin = normalizeOrigin(request.headers.get('origin'));
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    if (!isAllowedOrigin(origin)) return new Response(null, { status: 403, headers });
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, X-Writer-Session'
      }
    });
  }

  if (!isAllowedOrigin(origin)) {
    return Response.json({ ok: false, error: 'Origin not allowed' }, { status: 403, headers });
  }
  if (request.method !== 'GET') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET, OPTIONS' } });
  }

  const { id: sessionId, session } = await requireWriterSession(request);
  if (!session) return Response.json({ ok: false, error: 'Session expired' }, { status: 401, headers });

  const uploadId = validUploadId(new URL(request.url).searchParams.get('uploadId'));
  if (!uploadId) return Response.json({ ok: false, error: 'Invalid upload ID.' }, { status: 400, headers });

  const store = mediaStore();
  const status = await store.get(statusKey(uploadScope(sessionId), uploadId), { type: 'json', consistency: 'strong' });
  return Response.json(status || { state: 'processing' }, { status: 200, headers });
}

export const config = {
  path: '/api/writer/media-status'
};
