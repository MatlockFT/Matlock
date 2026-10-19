import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';

import { cleanupChunks, mediaStore, requireWriterSession, setStatus, statusKey, uploadScope, validUploadId, validateMediaMetadata } from './_writer-media.mjs';

const MAX_AUTOMATIC_PUBLISH_ATTEMPTS = 3;
const STALE_PUBLISH_STATUS_MS = 6 * 60 * 1000;

function isTransientMediaError(error) {
  const status = Number(error?.status);
  if (Number.isInteger(status)) return [408, 425, 429, 500, 502, 503, 504].includes(status);
  return /network connection lost|network error|fetch failed|failed to fetch|connection reset|connection lost|socket|timeout|timed?\s*out|aborted|temporarily unavailable/i
    .test(String(error?.message || error || ''));
}

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
  let current = await store.get(statusKey(scope, uploadId), {
    type: 'json',
    consistency: 'strong'
  });
  if (current?.state === 'complete' && current?.url) {
    return Response.json({ ok: true, uploadId, state: 'complete', url: current.url }, { status: 200, headers });
  }
  if (['queued', 'preparing', 'publishing'].includes(current?.state)) {
    const updatedAt = Date.parse(current.updatedAt || '');
    const age = Number.isFinite(updatedAt) ? Date.now() - updatedAt : 0;
    if (age <= STALE_PUBLISH_STATUS_MS) {
      return Response.json({ ok: true, uploadId, state: current.state }, { status: 202, headers });
    }

    // A worker can be terminated while a network/body stream hangs, leaving a
    // permanent "publishing" status. Count that abandoned job as an attempt
    // and let the staged media be queued again on the same upload ID.
    current = {
      ...current,
      state: 'error',
      error: `The previous publishing job stopped updating while ${current.state}; restarting from staged media.`,
      retryable: true,
      publishAttempts: Math.max(1, Math.floor(Number(current.publishAttempts) || 1))
    };
    await setStatus(store, scope, uploadId, current);
  }
  if (
    current?.state === 'error'
    && !current.retryable
    && body?.manualRetry === true
  ) {
    // The status endpoint verifies the complete staged set before the browser
    // asks for a manual retry. Allow the same recovery for older permanent
    // failures that predate the current diagnostic message format.
    current = {
      ...current,
      state: 'error',
      error: 'Manual retry requested for the verified staged video.',
      retryable: true,
      publishAttempts: 0
    };
    await setStatus(store, scope, uploadId, current);
  }

  const previousAttempts = Math.max(0, Math.floor(Number(current?.publishAttempts) || 0));
  const retryingPublish = current?.state === 'error' && Boolean(current.retryable);
  if (current?.state === 'error' && !current.retryable) {
    return Response.json({ ok: false, uploadId, state: 'error', error: current.error || 'The previous publishing attempt failed.' }, { status: 409, headers });
  }
  if (retryingPublish && previousAttempts >= MAX_AUTOMATIC_PUBLISH_ATTEMPTS) {
    const error = `GitHub Release publishing failed after ${MAX_AUTOMATIC_PUBLISH_ATTEMPTS} attempts. The staged video has been retained; automatic retries stopped to prevent a loop. ${String(current.error || '').trim()}`.trim();
    await setStatus(store, scope, uploadId, {
      ...current,
      ...meta,
      state: 'error',
      error,
      retryable: false,
      publishAttempts: previousAttempts
    });
    return Response.json({ ok: false, uploadId, state: 'error', retryable: false, error }, { status: 409, headers });
  }
  const publishAttempt = retryingPublish ? previousAttempts + 1 : 1;

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
    assetName: meta.assetName,
    publishAttempts: publishAttempt
  });

  try {
    await env.WRITER_MEDIA_QUEUE.send({
      sessionId,
      body: { uploadId, ...meta, publishAttempt }
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
      assetName: meta.assetName,
      publishAttempts: publishAttempt
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
