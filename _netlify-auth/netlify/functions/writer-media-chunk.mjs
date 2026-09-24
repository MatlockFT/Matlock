import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import {
  MAX_CHUNK_BYTES,
  chunkKey,
  mediaStore,
  requireWriterSession,
  uploadScope,
  validUploadId
} from './_writer-media.mjs';

function responseHeaders(request) {
  return corsHeaders(request);
}

export default async function handler(request) {
  const origin = normalizeOrigin(request.headers.get('origin'));
  const headers = responseHeaders(request);

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
  const chunkCount = Number(request.headers.get('x-chunk-count'));
  const fileSize = Number(request.headers.get('x-file-size'));
  const fileType = String(request.headers.get('x-file-type') || 'application/octet-stream').slice(0, 120);
  const assetName = String(request.headers.get('x-asset-name') || '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 180);

  if (!uploadId || !Number.isInteger(chunkIndex) || chunkIndex < 0 || !Number.isInteger(chunkCount) || chunkCount < 1 || chunkIndex >= chunkCount) {
    return Response.json({ ok: false, error: 'Invalid upload chunk metadata.' }, { status: 400, headers });
  }
  if (!Number.isFinite(fileSize) || fileSize < 1 || fileSize >= 2 * 1024 * 1024 * 1024 || !assetName) {
    return Response.json({ ok: false, error: 'Invalid video upload metadata.' }, { status: 400, headers });
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
      chunkCount,
      chunkSize: bytes.byteLength,
      fileSize,
      fileType,
      assetName,
      createdAt: new Date().toISOString()
    }
  });

  return Response.json({ ok: true, chunkIndex, chunkSize: bytes.byteLength }, { status: 200, headers });
}

export const config = {
  path: '/api/writer/media-chunk'
};
