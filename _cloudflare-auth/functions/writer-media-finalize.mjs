import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';

function isTransientMediaError(error) {
  const status = Number(error?.status);
  if (Number.isInteger(status)) return [408, 425, 429, 500, 502, 503, 504].includes(status);
  return /network connection lost|network error|fetch failed|failed to fetch|connection reset|connection lost|socket|timed?\s*out|temporarily unavailable/i
    .test(String(error?.message || error || ''));
}
import { cleanupChunks, mediaStore, requireWriterSession, setStatus, statusKey, uploadScope, validUploadId, validateMediaMetadata } from './_writer-media.mjs';

export default async function handler(request, env) {
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
  if (!uploadId) return Response.json({ ok: false, error: 'Invalid upload ID.' }, { status: 400, headers });

  let meta;
  try {
    meta = validateMediaMetadata({
      assetName: body?.assetName,
      fileSize: body?.fileSize,
      fileType: body?.fileType,
      chunkCount: body?.chunkCount
    });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 400, headers });
  }

  const scope = uploadScope(sessionId);
  const store = mediaStore();

  // The browser may retry after the server queued successfully but the response
  // was lost. Do not enqueue the same upload twice in that case.
  const current = await store.get(statusKey(scope, uploadId), {
    type: 'json',
    consistency: 'strong'
  });
  if (current?.state === 'complete' && current?.url) {
    return Response.json({ ok: true, uploadId, state: 'complete', url: current.url }, { status: 200, headers });
  }
  if (['queued', 'preparing', 'publishing'].includes(current?.state)) {
    return Response.json({ ok: true, uploadId, state: current.state }, { status: 202, headers });
  }
  if (current?.state === 'error' && !current.retryable) {
    return Response.json({ ok: false, uploadId, state: 'error', error: current.error || 'The previous publishing attempt failed.' }, { status: 409, headers });
  }

  if (!env?.WRITER_MEDIA_QUEUE) {
    const error = 'Media processing queue is not configured.';
    await setStatus(store, scope, uploadId, {
      state: 'error',
      error,
      chunkCount: meta.chunkCount,
      fileSize: meta.fileSize,
      fileType: meta.fileType,
      assetName: meta.assetName
    });
    await cleanupChunks(store, scope, uploadId, meta.chunkCount);
    return Response.json({ ok: false, error }, { status: 503, headers });
  }

  await setStatus(store, scope, uploadId, {
    state: 'queued',
    chunkCount: meta.chunkCount,
    fileSize: meta.fileSize,
    fileType: meta.fileType,
    assetName: meta.assetName
  });

  try {
    await env.WRITER_MEDIA_QUEUE.send({
      sessionId,
      body: { uploadId, ...meta }
    });
  } catch (error) {
    const retryable = isTransientMediaError(error);
    const detail = String(error?.message || error || 'No response was received.');
    const message = `Could not queue the GitHub Release publishing job: ${detail}`;
    console.error(message);
    await setStatus(store, scope, uploadId, {
      state: 'error',
      error: message,
      retryable,
      chunkCount: meta.chunkCount,
      fileSize: meta.fileSize,
      fileType: meta.fileType,
      assetName: meta.assetName
    });
    if (!retryable) {
      await cleanupChunks(store, scope, uploadId, meta.chunkCount);
    }
    return Response.json({ ok: false, error: message, retryable }, { status: 502, headers });
  }

  return Response.json({ ok: true, uploadId, state: 'queued' }, { status: 202, headers });
}

export const config = {
  path: '/api/writer/media-finalize'
};
