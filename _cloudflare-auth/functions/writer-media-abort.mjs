import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import {
  cleanupChunks,
  mediaStore,
  requireWriterSession,
  statusKey,
  uploadScope,
  validUploadId
} from './_writer-media.mjs';

export default async function handler(request) {
  const origin = normalizeOrigin(request.headers.get('origin'));
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    if (!isAllowedOrigin(origin)) return new Response(null, { status: 403, headers });
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, Content-Type, X-Writer-Session'
      }
    });
  }

  if (!isAllowedOrigin(origin)) {
    return Response.json({ ok: false, error: 'Origin not allowed' }, { status: 403, headers });
  }
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'POST, OPTIONS' } });
  }

  const { id: sessionId, session } = await requireWriterSession(request);
  if (!session) return Response.json({ ok: false, error: 'Session expired' }, { status: 401, headers });

  const body = await request.json().catch(() => null);
  const uploadId = validUploadId(body?.uploadId);
  const chunkCount = Number(body?.chunkCount);
  if (!uploadId || !Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 1200) {
    return Response.json({ ok: false, error: 'Invalid upload cleanup metadata.' }, { status: 400, headers });
  }

  const scope = uploadScope(sessionId);
  try {
    const store = mediaStore();
    await cleanupChunks(store, scope, uploadId, chunkCount);
    if (typeof store.delete === 'function') await store.delete(statusKey(scope, uploadId));
    return Response.json({ ok: true, cleaned: true }, { status: 200, headers });
  } catch (error) {
    const detail = String(error?.message || error || 'Unknown cleanup error.');
    console.error('Writer media upload cleanup failed:', detail);
    return Response.json({ ok: false, error: 'Could not clean up the failed video upload.' }, { status: 503, headers });
  }
}

export const config = {
  path: '/api/writer/media-abort'
};
