import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import {
  MAX_CHUNK_BYTES,
  chunkKey,
  mediaStore,
  requireWriterSession,
  setStatus,
  uploadScope,
  validUploadId,
  validateVideoMetadata
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
        'Access-Control-Allow-Headers': [
          'Accept',
          'Content-Type',
          'X-Writer-Session',
          'X-Upload-Id',
          'X-Chunk-Index',
          'X-Chunk-Count',
          'X-File-Size',
          'X-File-Type',
          'X-Asset-Name'
        ].join(', ')
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

  const uploadId = validUploadId(request.headers.get('x-upload-id'));
  const chunkIndex = Number(request.headers.get('x-chunk-index'));
  const rawChunkCount = Number(request.headers.get('x-chunk-count'));

  if (!uploadId || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return Response.json({ ok: false, error: 'Invalid upload chunk metadata.' }, { status: 400, headers });
  }

  let meta;
  try {
    meta = validateVideoMetadata({
      assetName: request.headers.get('x-asset-name'),
      fileSize: request.headers.get('x-file-size'),
      fileType: request.headers.get('x-file-type'),
      chunkCount: rawChunkCount
    });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 400, headers });
  }

  if (chunkIndex >= meta.chunkCount) {
    return Response.json({ ok: false, error: 'Invalid upload chunk index.' }, { status: 400, headers });
  }

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_CHUNK_BYTES) {
    return Response.json({ ok: false, error: 'Video chunk is too large.' }, { status: 413, headers });
  }

  const scope = uploadScope(sessionId);
  const store = mediaStore();
  await store.set(chunkKey(scope, uploadId, chunkIndex), bytes, {
    metadata: {
      chunkIndex,
      chunkCount: meta.chunkCount,
      chunkSize: bytes.byteLength,
      fileSize: meta.fileSize,
      fileType: meta.fileType,
      assetName: meta.assetName,
      createdAt: new Date().toISOString()
    }
  });
  await setStatus(store, scope, uploadId, {
    state: 'uploading',
    chunkCount: meta.chunkCount,
    fileSize: meta.fileSize,
    fileType: meta.fileType,
    assetName: meta.assetName
  });

  return Response.json({ ok: true, chunkIndex, chunkSize: bytes.byteLength }, { status: 200, headers });
}

export const config = {
  path: '/api/writer/media-chunk'
};
