import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import { MAX_CHUNK_BYTES, chunkKey, mediaStore, requireWriterSession, statusKey, uploadScope, validUploadId } from './_writer-media.mjs';

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
  const scope = uploadScope(sessionId);
  const status = await store.get(statusKey(scope, uploadId), { type: 'json', consistency: 'strong' });

  // A failed publish may have retained all staged chunks, or an older version
  // may have already cleaned them up. Tell the Writer which case applies so a
  // same-file retry can either republish the staged bytes or restage the file.
  let responseStatus = status || { state: 'processing' };
  if (status?.state === 'error') {
    const chunkCount = Number(status.chunkCount);
    const fileSize = Number(status.fileSize);
    let stagedChunksPresent = 0;
    let stagedBytes = 0;
    let stagedChunksComplete = false;

    if (
      Number.isInteger(chunkCount) && chunkCount > 0 && chunkCount <= 1200
      && Number.isSafeInteger(fileSize) && fileSize > 0
    ) {
      try {
        const listed = await store.list({
          prefix: `chunks/${scope}/${uploadId}/`,
          limit: chunkCount + 1
        });
        const byKey = new Map((listed.blobs || []).map(entry => [String(entry.key || ''), entry]));
        let chunksValid = true;

        for (let index = 0; index < chunkCount; index += 1) {
          const entry = byKey.get(chunkKey(scope, uploadId, index));
          if (!entry) {
            chunksValid = false;
            continue;
          }

          stagedChunksPresent += 1;
          const actualBytes = Number(entry.metadata?.chunkSize ?? entry.size) || 0;
          const expectedBytes = Math.max(0, Math.min(MAX_CHUNK_BYTES, fileSize - index * MAX_CHUNK_BYTES));
          stagedBytes += actualBytes;
          if (actualBytes !== expectedBytes) chunksValid = false;
        }

        stagedChunksComplete = chunksValid
          && stagedChunksPresent === chunkCount
          && stagedBytes === fileSize;
      } catch {
        // Treat a failed verification as incomplete. The browser still holds
        // the selected File and can restage it using a new upload ID.
        stagedChunksComplete = false;
      }
    }

    responseStatus = {
      ...status,
      stagedChunksComplete,
      stagedChunksPresent,
      stagedBytes
    };
  }

  return Response.json(responseStatus, { status: 200, headers });
}

export const config = {
  path: '/api/writer/media-status'
};
