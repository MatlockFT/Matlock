import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import { mediaStore, requireWriterSession, setStatus, uploadScope, validUploadId } from './_writer-media.mjs';

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
  const fileSize = Number(body?.fileSize);
  const fileType = String(body?.fileType || 'application/octet-stream').slice(0, 120);
  const assetName = String(body?.assetName || '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 180);

  if (!uploadId || !Number.isInteger(chunkCount) || chunkCount < 1 || !Number.isFinite(fileSize) || fileSize < 1 || fileSize >= 2 * 1024 * 1024 * 1024 || !assetName) {
    return Response.json({ ok: false, error: 'Invalid finalize request.' }, { status: 400, headers });
  }

  const scope = uploadScope(sessionId);
  const store = mediaStore();
  await setStatus(store, scope, uploadId, { state: 'queued' });

  const processUrl = `${new URL(request.url).origin}/api/writer/media-process`;
  const processResponse = await fetch(processUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Writer-Session': sessionId
    },
    body: JSON.stringify({ uploadId, chunkCount, fileSize, fileType, assetName }),
    cache: 'no-store'
  });

  if (!processResponse.ok) {
    await setStatus(store, scope, uploadId, { state: 'error', error: 'Could not start the GitHub Release publishing job.' });
    return Response.json({ ok: false, error: 'Could not start the GitHub Release publishing job.' }, { status: 502, headers });
  }

  return Response.json({ ok: true, uploadId, state: 'queued' }, { status: 202, headers });
}

export const config = {
  path: '/api/writer/media-finalize'
};
