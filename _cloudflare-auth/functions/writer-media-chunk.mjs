import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import {
  MAX_CHUNK_BYTES,
  chunkKey,
  mediaStore,
  requireWriterSession,
  uploadScope,
  validUploadId,
  validateMediaMetadata,
  cleanupAbandonedUploads,
  setStatus
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
    meta = validateMediaMetadata({
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

  const scope = uploadScope(sessionId);
  try {
    const store = mediaStore();

    // Failed finalizations from older versions could leave an error status plus
    // a complete set of temporary chunks. Reclaim them before a new upload.
    if (chunkIndex === 0) {
      await cleanupAbandonedUploads(store, scope, uploadId);
    }

    // Mark this upload as live so another new upload does not purge its chunks.
    // Refresh activity periodically for very large files without writing a status
    // record for every chunk.
    if (chunkIndex === 0 || chunkIndex % 25 === 0) {
      await setStatus(store, scope, uploadId, {
        state: 'uploading',
        chunkCount: meta.chunkCount,
        fileSize: meta.fileSize,
        fileType: meta.fileType,
        assetName: meta.assetName,
        receivedChunks: chunkIndex + 1
      });
    }

    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_CHUNK_BYTES) {
      return Response.json({ ok: false, error: 'Media chunk is too large.' }, { status: 413, headers });
    }

    await store.set(chunkKey(scope, uploadId, chunkIndex), bytes, {
      metadata: {
        chunkIndex,
        chunkCount: meta.chunkCount,
        chunkSize: bytes.byteLength,
        fileSize: meta.fileSize,
        fileType: meta.fileType,
        assetName: meta.assetName,
        createdAt: new Date().toISOString()
      },
      // Abandoned chunks expire automatically; explicit cleanup removes them sooner.
      expirationTtl: 24 * 60 * 60
    });

    return Response.json({ ok: true, chunkIndex, chunkSize: bytes.byteLength }, { status: 200, headers });
  } catch (error) {
    const detail = String(error?.message || error || 'Unknown staging error.');
    console.error('Writer media chunk staging failed:', detail);
    const full = /SQLITE_FULL|database or disk is full/i.test(detail);
    const message = full
      ? 'Temporary video storage is full. The writer is cleaning up failed uploads; retry after a moment.'
      : `Could not stage video chunk: ${detail}`;
    return Response.json({ ok: false, error: message }, { status: full ? 507 : 503, headers });
  }
}

export const config = {
  path: '/api/writer/media-chunk'
};
