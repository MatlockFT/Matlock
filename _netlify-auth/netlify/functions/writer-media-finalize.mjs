import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import { mediaStore, requireWriterSession, setStatus, uploadScope, validUploadId, validateVideoMetadata } from './_writer-media.mjs';

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
  if (!uploadId) return Response.json({ ok: false, error: 'Invalid upload ID.' }, { status: 400, headers });

  let meta;
  try {
    meta = validateVideoMetadata({
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
  await setStatus(store, scope, uploadId, {
    state: 'queued',
    chunkCount: meta.chunkCount,
    fileSize: meta.fileSize,
    fileType: meta.fileType,
    assetName: meta.assetName
  });

  const processUrl = `${new URL(request.url).origin}/api/writer/media-process`;
  const processResponse = await fetch(processUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Writer-Session': sessionId
    },
    body: JSON.stringify({
      uploadId,
      chunkCount: meta.chunkCount,
      fileSize: meta.fileSize,
      fileType: meta.fileType,
      assetName: meta.assetName
    }),
    cache: 'no-store'
  });

  if (!processResponse.ok) {
    await setStatus(store, scope, uploadId, {
      state: 'error',
      error: 'Could not start the GitHub Release publishing job.',
      chunkCount: meta.chunkCount,
      fileSize: meta.fileSize,
      fileType: meta.fileType,
      assetName: meta.assetName
    });
    return Response.json({ ok: false, error: 'Could not start the GitHub Release publishing job.' }, { status: 502, headers });
  }

  return Response.json({ ok: true, uploadId, state: 'queued' }, { status: 202, headers });
}

export const config = {
  path: '/api/writer/media-finalize'
};
