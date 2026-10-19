import { githubFetchUrl, githubJson } from './_github-client.mjs';
import {
  MAX_CHUNK_BYTES,
  chunkKey,
  cleanupChunks,
  mediaStore,
  requireWriterSession,
  setStatus,
  statusKey,
  uploadScope,
  validUploadId,
  validateMediaMetadata
} from './_writer-media.mjs';

function releaseTag() {
  const now = new Date();
  return `writer-media-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function ensureRelease(token) {
  const tag = releaseTag();
  try {
    return await githubJson(token, `/releases/tags/${encodeURIComponent(tag)}`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  try {
    return await githubJson(token, '/releases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: 'main',
        name: `Website media · ${tag.replace('writer-media-', '')}`,
        body: 'Website media uploaded automatically by MMA Matlock Writer and Broadcast Control. Do not delete assets that are embedded in published articles or broadcast playlists.',
        draft: false,
        prerelease: true
      })
    });
  } catch (error) {
    if (error.status === 422) return githubJson(token, `/releases/tags/${encodeURIComponent(tag)}`);
    throw error;
  }
}

async function existingReleaseAsset(token, release, assetName, expectedSize = null) {
  const assets = await githubJson(token, `/releases/${release.id}/assets?per_page=100`);
  if (!Array.isArray(assets)) return null;
  const existing = assets.find(asset => asset.name === assetName && asset.browser_download_url);
  if (!existing) return null;
  if (expectedSize === null || Number(existing.size) === Number(expectedSize)) return existing;

  // A unique Writer asset can be left behind incomplete if GitHub accepted a
  // streaming request but its response was lost. Remove only that exact,
  // mismatched-size asset before retrying this same upload.
  if (existing.url) {
    const removed = await githubFetchUrl(token, existing.url, { method: 'DELETE' });
    if (removed.status === 204 || removed.status === 404) return null;
    throw new Error(`GitHub returned an incomplete Release asset (size ${existing.size}, expected ${expectedSize}) and it could not be removed (HTTP ${removed.status}).`);
  }
  throw new Error(`GitHub returned a Release asset with size ${existing.size}; expected ${expectedSize}.`);
}

async function readChunkWithRetry(store, key) {
  const delays = [500, 1000, 2000, 4000, 8000, 12000];
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      const data = await store.get(key, { type: 'arrayBuffer' });
      if (data) return data;
    } catch (error) {
      if (attempt === delays.length) throw error;
    }
    if (attempt < delays.length) {
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    }
  }
  throw new Error('A staged media chunk is not visible in Workers KV yet. Please retry publishing.');
}

const STREAM_SEGMENT_CHUNKS = 8;
const STREAM_SEGMENT_RETRY_DELAYS = [500, 1000, 2000, 4000, 8000];
const RELEASE_UPLOAD_RETRY_DELAYS = [1000, 3000, 7000, 12000];

function mediaDelay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isTransientMediaError(error) {
  const status = Number(error?.status);
  if (Number.isInteger(status)) {
    return [408, 425, 429, 500, 502, 503, 504].includes(status);
  }
  return /network connection lost|network error|fetch failed|failed to fetch|connection reset|connection lost|socket|timed?\s*out|temporarily unavailable/i
    .test(String(error?.message || error || ''));
}

async function readStreamSegmentWithRetry(store, scope, uploadId, startIndex, count, fileSize, chunkCount) {
  const startByte = startIndex * MAX_CHUNK_BYTES;
  const endByte = Math.min(fileSize, (startIndex + count) * MAX_CHUNK_BYTES);
  const expectedBytes = Math.max(0, endByte - startByte);
  let lastError = null;

  for (let attempt = 0; attempt <= STREAM_SEGMENT_RETRY_DELAYS.length; attempt += 1) {
    try {
      const stream = await store.streamChunks(scope, uploadId, count, startIndex);
      const bytes = await new Response(stream).arrayBuffer();
      if (bytes.byteLength !== expectedBytes) {
        throw new Error(
          `Storage returned ${bytes.byteLength} bytes for video parts ${startIndex + 1}-${Math.min(startIndex + count, chunkCount)}; expected ${expectedBytes} bytes.`
        );
      }
      return new Uint8Array(bytes);
    } catch (error) {
      lastError = error;
      if (attempt >= STREAM_SEGMENT_RETRY_DELAYS.length) break;
      await mediaDelay(STREAM_SEGMENT_RETRY_DELAYS[attempt]);
    }
  }

  throw new Error(
    `Cloudflare media-storage stream failed for parts ${startIndex + 1}-${Math.min(startIndex + count, chunkCount)} of ${chunkCount} after ${STREAM_SEGMENT_RETRY_DELAYS.length + 1} attempts: ${String(lastError?.message || lastError || 'No response was received.')}`,
    { cause: lastError }
  );
}

async function chunkStream(store, scope, uploadId, chunkCount, fileSize) {
  if (typeof store.streamChunks === 'function') {
    let nextIndex = 0;
    return new ReadableStream({
      async pull(controller) {
        if (nextIndex >= chunkCount) {
          controller.close();
          return;
        }
        const count = Math.min(STREAM_SEGMENT_CHUNKS, chunkCount - nextIndex);
        try {
          // Buffer at most 14.4 MB, then pass the segment to the GitHub upload.
          // A storage-binding interruption can retry this segment alone.
          const bytes = await readStreamSegmentWithRetry(
            store, scope, uploadId, nextIndex, count, fileSize, chunkCount
          );
          nextIndex += count;
          controller.enqueue(bytes);
        } catch (error) {
          controller.error(error);
        }
      }
    });
  }

  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index >= chunkCount) {
        controller.close();
        return;
      }
      try {
        const data = await readChunkWithRetry(store, chunkKey(scope, uploadId, index));
        index += 1;
        controller.enqueue(new Uint8Array(data));
      } catch (error) {
        controller.error(error);
      }
    }
  });
}

async function verifyChunks(store, scope, uploadId, chunkCount, fileSize) {
  // Workers KV is eventually consistent across locations. Retry list visibility instead
  // of deleting a valid upload immediately if the queue consumer runs in another colo.
  const delays = [1000, 2000, 4000, 8000, 12000, 12000, 12000];
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    const listed = await store.list({
      prefix: `chunks/${scope}/${uploadId}/`,
      limit: 2000
    });
    const byKey = new Map((listed.blobs || []).map(entry => [entry.key, entry]));
    let stagedBytes = 0;
    let missingChunk = 0;

    for (let index = 0; index < chunkCount; index += 1) {
      const entry = byKey.get(chunkKey(scope, uploadId, index));
      const chunkSize = Number(entry?.metadata?.chunkSize);
      if (!entry || !Number.isFinite(chunkSize) || chunkSize < 1) {
        missingChunk = index + 1;
        break;
      }
      stagedBytes += chunkSize;
    }

    if (!missingChunk && stagedBytes === fileSize) return;
    if (!missingChunk && stagedBytes !== fileSize) {
      if (attempt === delays.length) throw new Error('Staged video size did not match the original upload.');
    }
    if (attempt < delays.length) {
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    } else {
      throw new Error(`Staged media chunk ${missingChunk || chunkCount} of ${chunkCount} is not visible in Workers KV yet. Please retry publishing.`);
    }
  }
}

async function uploadAssetOnce(token, release, store, scope, uploadId, meta) {
  const uploadUrl = String(release?.upload_url || '').replace(/\{\?name,label\}$/, '');
  if (!uploadUrl) throw new Error('GitHub did not provide a Release upload URL.');

  // FixedLengthStream gives GitHub the exact Content-Length it requires.
  const fixedBody = new FixedLengthStream(meta.fileSize);
  const source = await chunkStream(store, scope, uploadId, meta.chunkCount, meta.fileSize);
  const controller = new AbortController();
  let sourceError = null;
  let requestError = null;

  const pumping = source.pipeTo(fixedBody.writable, { signal: controller.signal }).catch(error => {
    sourceError = error;
    throw error;
  });
  const uploading = githubFetchUrl(token, `${uploadUrl}?name=${encodeURIComponent(meta.assetName)}`, {
    method: 'POST',
    headers: {
      'Content-Type': meta.fileType || 'application/octet-stream'
    },
    body: fixedBody.readable,
    duplex: 'half',
    signal: controller.signal
  }).catch(error => {
    requestError = error;
    throw error;
  });

  let response;
  try {
    [response] = await Promise.all([uploading, pumping]);
  } catch (error) {
    controller.abort(error);
    await Promise.allSettled([uploading, pumping]);
    const phase = error === sourceError
      ? 'Cloudflare Durable Object media stream'
      : error === requestError
        ? 'GitHub Release network request'
        : 'GitHub Release streaming pipeline';
    const wrapped = new Error(`${phase}: ${String(error?.message || error || 'Network connection lost.')}`, { cause: error });
    if (Number.isInteger(error?.status)) wrapped.status = error.status;
    throw wrapped;
  }

  const responseText = await response.text().catch(() => '');
  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = { message: responseText.trim().slice(0, 500) };
  }
  if (response.status === 201 && data?.browser_download_url) return data;

  if (response.status === 422) {
    const existing = await existingReleaseAsset(token, release, meta.assetName, meta.fileSize);
    if (existing) return existing;
  }
  const requestId = response.headers.get('x-github-request-id');
  const detail = data?.message || responseText.trim().slice(0, 500);
  const error = new Error(
    detail
      ? `GitHub Release upload failed with status ${response.status}: ${detail}`
      : `GitHub Release upload failed with status ${response.status}.${requestId ? ` GitHub request ID: ${requestId}.` : ''}`
  );
  error.status = response.status;
  throw error;
}

async function uploadAsset(token, release, store, scope, uploadId, meta) {
  let lastError = null;
  for (let attempt = 0; attempt <= RELEASE_UPLOAD_RETRY_DELAYS.length; attempt += 1) {
    try {
      return await uploadAssetOnce(token, release, store, scope, uploadId, meta);
    } catch (error) {
      lastError = error;
      if (!isTransientMediaError(error)) throw error;

      // GitHub may have accepted the asset even if this Worker never received
      // its response. Recover a complete asset before attempting another POST.
      try {
        const existing = await existingReleaseAsset(token, release, meta.assetName, meta.fileSize);
        if (existing) return existing;
      } catch {}

      if (attempt >= RELEASE_UPLOAD_RETRY_DELAYS.length) {
        const exhausted = new Error(
          `GitHub Release publishing exhausted ${RELEASE_UPLOAD_RETRY_DELAYS.length + 1} attempts: ${String(error?.message || error || 'Network connection lost.')}`,
          { cause: error }
        );
        exhausted.retryable = true;
        if (Number.isInteger(error?.status)) exhausted.status = error.status;
        throw exhausted;
      }
      await mediaDelay(RELEASE_UPLOAD_RETRY_DELAYS[attempt]);
    }
  }
  throw lastError || new Error('GitHub Release upload failed.');
}

export default async function handler(request) {
  if (request.method !== 'POST') return new Response(null, { status: 405 });

  const { id: sessionId, session } = await requireWriterSession(request);
  if (!session) return;

  const body = await request.json().catch(() => null);
  const uploadId = validUploadId(body?.uploadId);
  if (!uploadId) return;

  let meta;
  try {
    meta = validateMediaMetadata({
      assetName: body?.assetName,
      fileSize: body?.fileSize,
      fileType: body?.fileType,
      chunkCount: body?.chunkCount
    });
  } catch {
    return;
  }

  const scope = uploadScope(sessionId);
  const store = mediaStore();
  let stage = 'checking upload status';

  try {
    const current = await store.get(statusKey(scope, uploadId), { type: 'json', consistency: 'strong' });
    if (current?.state === 'complete' && current?.url) return;

    stage = 'verifying staged video chunks';
    await setStatus(store, scope, uploadId, { state: 'preparing', ...meta });
    await verifyChunks(store, scope, uploadId, meta.chunkCount, meta.fileSize);

    stage = 'preparing GitHub Releases';
    const release = await ensureRelease(session.token);
    await setStatus(store, scope, uploadId, { state: 'publishing', ...meta });

    stage = 'streaming video to GitHub Releases';
    const asset = await uploadAsset(session.token, release, store, scope, uploadId, meta);

    stage = 'recording published video';
    await setStatus(store, scope, uploadId, {
      state: 'complete',
      url: asset.browser_download_url,
      assetId: asset.id,
      releaseId: release.id,
      ...meta
    });
    await cleanupChunks(store, scope, uploadId, meta.chunkCount).catch(error => {
      console.warn('Published video, but temporary media cleanup failed:', error?.message || error);
    });
  } catch (error) {
    const retryable = Boolean(error?.retryable) || isTransientMediaError(error);
    const message = `Publishing failed while ${stage}: ${String(error?.message || error || 'GitHub Release upload failed.')}`;
    console.error(message);
    await setStatus(store, scope, uploadId, {
      state: 'error',
      error: message,
      retryable,
      ...meta
    });
    // Keep fully staged data for retryable runtime failures. A subsequent
    // finalize request can enqueue it again without uploading 282 MB twice.
    if (!retryable) await cleanupChunks(store, scope, uploadId, meta.chunkCount);
  }
}

export const config = {
  path: '/api/writer/media-process'
};
