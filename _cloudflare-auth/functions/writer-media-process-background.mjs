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
    if (removed.status === 204 || removed.status === 404) {
      const retry = new Error('Removed an incomplete GitHub Release asset; retrying the upload.');
      retry.status = 503;
      throw retry;
    }
    throw new Error(`GitHub returned an incomplete Release asset (size ${existing.size}, expected ${expectedSize}) and it could not be removed (HTTP ${removed.status}).`);
  }
  throw new Error(`GitHub returned a Release asset with size ${existing.size}; expected ${expectedSize}.`);
}

async function readChunkWithRetry(store, key, expectedBytes = null, chunkNumber = null) {
  const delays = [250, 500, 1000, 2000, 4000, 8000];
  let lastError = null;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      const data = await store.get(key, { type: 'arrayBuffer' });
      if (data) {
        const bytes = new Uint8Array(data);
        if (expectedBytes !== null && bytes.byteLength !== expectedBytes) {
          throw new Error(
            `Staged video chunk ${chunkNumber ?? key} contained ${bytes.byteLength} bytes; expected ${expectedBytes}.`
          );
        }
        return data;
      }
      lastError = new Error(`Staged video chunk ${chunkNumber ?? key} is missing.`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < delays.length) {
      await mediaDelay(delays[attempt]);
    }
  }
  const context = chunkNumber === null ? key : `chunk ${chunkNumber}`;
  throw new Error(
    `Could not read ${context} from temporary video storage after ${delays.length + 1} attempts: ${String(lastError?.message || lastError || 'No response was received.')}`,
    { cause: lastError }
  );
}

const RELEASE_UPLOAD_TIMEOUT_MS = 4 * 60 * 1000;
// One full-asset request per queue attempt. Cross-job retries are capped and
// tracked in status, so hidden nested retries cannot exceed the status timeout.
const RELEASE_UPLOAD_RETRY_DELAYS = [];
const MAX_AUTOMATIC_PUBLISH_ATTEMPTS = 3;

function mediaDelay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isTransientMediaError(error) {
  const status = Number(error?.status);
  if (Number.isInteger(status)) {
    return [408, 425, 429, 500, 502, 503, 504].includes(status);
  }
  return /network connection lost|network error|fetch failed|failed to fetch|connection reset|connection lost|socket|timeout|timed?\s*out|aborted|temporarily unavailable/i
    .test(String(error?.message || error || ''));
}

const STREAM_SEGMENT_CHUNKS = 8;
const R2_VIDEO_MIN_BYTES = 80 * 1024 * 1024;
const STREAM_SEGMENT_RETRY_DELAYS = [500, 1000];
const STREAM_SEGMENT_TIMEOUT_MS = 30_000;

async function readStreamSegmentWithRetry(store, scope, uploadId, startIndex, count, fileSize, chunkCount) {
  const startByte = startIndex * MAX_CHUNK_BYTES;
  const endByte = Math.min(fileSize, (startIndex + count) * MAX_CHUNK_BYTES);
  const expectedBytes = Math.max(0, endByte - startByte);
  let lastError = null;

  for (let attempt = 0; attempt <= STREAM_SEGMENT_RETRY_DELAYS.length; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const error = new Error(`Cloudflare media-storage stream timed out after ${STREAM_SEGMENT_TIMEOUT_MS / 1000} seconds.`);
      error.status = 504;
      controller.abort(error);
    }, STREAM_SEGMENT_TIMEOUT_MS);

    try {
      const stream = await store.streamChunks(scope, uploadId, count, startIndex, controller.signal);
      const bytes = await new Response(stream).arrayBuffer();
      if (bytes.byteLength !== expectedBytes) {
        throw new Error(
          `Storage returned ${bytes.byteLength} bytes for video parts ${startIndex + 1}-${Math.min(startIndex + count, chunkCount)}; expected ${expectedBytes} bytes.`
        );
      }
      return new Uint8Array(bytes);
    } catch (error) {
      lastError = controller.signal.aborted && controller.signal.reason
        ? controller.signal.reason
        : error;
      if (attempt >= STREAM_SEGMENT_RETRY_DELAYS.length) break;
      await mediaDelay(STREAM_SEGMENT_RETRY_DELAYS[attempt]);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `Cloudflare staged-chunk read failed for parts ${startIndex + 1}-${Math.min(startIndex + count, chunkCount)} of ${chunkCount}: ${String(lastError?.message || lastError || 'No response was received.')}`,
    { cause: lastError }
  );
}

async function chunkStream(store, scope, uploadId, chunkCount, fileSize, diagnostics = {}) {
  if (typeof store.streamChunks === 'function') {
    let nextIndex = 0;
    return new ReadableStream({
      async pull(controller) {
        if (nextIndex >= chunkCount) {
          controller.close();
          return;
        }
        const startIndex = nextIndex;
        const count = Math.min(STREAM_SEGMENT_CHUNKS, chunkCount - nextIndex);
        try {
          // Keep each staging request bounded, but avoid one Durable Object
          // subrequest per 1.8 MB row. That would exhaust the Workers Free
          // 50-subrequest limit on ordinary 282-400 MB videos.
          const bytes = await readStreamSegmentWithRetry(
            store, scope, uploadId, startIndex, count, fileSize, chunkCount
          );
          nextIndex += count;
          diagnostics.chunksRead = (diagnostics.chunksRead || 0) + count;
          diagnostics.bytesRead = (diagnostics.bytesRead || 0) + bytes.byteLength;
          controller.enqueue(bytes);
        } catch (error) {
          diagnostics.error = error;
          controller.error(error);
        }
      }
    });
  }

  // KV-backed test/local compatibility fallback; production Durable Objects
  // use bounded segment reads above.
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index >= chunkCount) {
        controller.close();
        return;
      }
      const currentIndex = index;
      const expectedBytes = Math.max(0, Math.min(MAX_CHUNK_BYTES, fileSize - currentIndex * MAX_CHUNK_BYTES));
      try {
        const data = await readChunkWithRetry(store, chunkKey(scope, uploadId, currentIndex), expectedBytes, currentIndex + 1);
        const bytes = new Uint8Array(data);
        index += 1;
        diagnostics.chunksRead = (diagnostics.chunksRead || 0) + 1;
        diagnostics.bytesRead = (diagnostics.bytesRead || 0) + bytes.byteLength;
        controller.enqueue(bytes);
      } catch (error) {
        diagnostics.error = error;
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

  // GitHub requires an exact Content-Length. FixedLengthStream supplies it,
  // but Cloudflare can report a stream-close error after the expected bytes
  // have already passed through. Do not let that local error abort GitHub's
  // request before checking the authoritative Release response.
  const fixedBody = new FixedLengthStream(meta.fileSize);
  const sourceDiagnostics = {};
  const source = await chunkStream(store, scope, uploadId, meta.chunkCount, meta.fileSize, sourceDiagnostics);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const timeoutError = new Error(`GitHub Release upload timed out after ${RELEASE_UPLOAD_TIMEOUT_MS / 60_000} minutes.`);
    timeoutError.status = 504;
    controller.abort(timeoutError);
  }, RELEASE_UPLOAD_TIMEOUT_MS);

  let pipelineError = null;
  let requestError = null;

  const pumping = source.pipeTo(fixedBody.writable, {
    signal: controller.signal,
    preventClose: true
  }).catch(error => {
    pipelineError = error;
    // Intentionally do not abort the HTTP request here. GitHub can still
    // receive and commit the complete Content-Length body despite this error.
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

  try {
    // Promise.all rejects immediately on either failure and previously caused
    // the request to be aborted before GitHub could return its result. Wait
    // for both sides (bounded by the upload timeout) and inspect each result.
    const [uploadResult, pipelineResult] = await Promise.allSettled([uploading, pumping]);
    const bytesRead = Number(sourceDiagnostics.bytesRead) || 0;
    const chunksRead = Number(sourceDiagnostics.chunksRead) || 0;
    const progress = `Staged data read: ${bytesRead} of ${meta.fileSize} bytes across ${chunksRead} of ${meta.chunkCount} chunks.`;

    if (uploadResult.status === 'rejected') {
      const cause = sourceDiagnostics.error || requestError || pipelineError || uploadResult.reason;
      throw new Error(
        `GitHub Release request did not return a response: ${String(cause?.message || cause || 'Network connection lost.')}. ${progress}`,
        { cause }
      );
    }

    const response = uploadResult.value;
    const responseText = await response.text().catch(() => '');
    let data = {};
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      data = { message: responseText.trim().slice(0, 500) };
    }

    if (response.status === 201 && data?.browser_download_url) {
      // GitHub is authoritative. If it reports the exact expected asset size,
      // accept success even if Cloudflare's stream-close promise rejected.
      if (Number(data.size) === meta.fileSize) return data;

      const existing = await existingReleaseAsset(token, release, meta.assetName, meta.fileSize);
      if (existing) return existing;
      const mismatch = new Error(
        `GitHub created the asset but reported size ${Number(data.size) || 0}; expected ${meta.fileSize}. ${progress}`
      );
      mismatch.status = 502;
      throw mismatch;
    }

    if (response.status === 422) {
      const existing = await existingReleaseAsset(token, release, meta.assetName, meta.fileSize);
      if (existing) return existing;
    }

    const requestId = response.headers.get('x-github-request-id');
    const responseOrigin = (() => {
      try { return new URL(response.url || uploadUrl).origin; }
      catch { return 'unknown endpoint'; }
    })();
    const headerDetails = [
      ['server', response.headers.get('server')],
      ['via', response.headers.get('via')],
      ['cf-ray', response.headers.get('cf-ray')],
      ['x-github-request-id', requestId],
      ['content-type', response.headers.get('content-type')],
      ['content-length', response.headers.get('content-length')]
    ].filter(([, value]) => value).map(([name, value]) => `${name}=${value}`).join('; ');
    const detail = data?.message || responseText.trim().slice(0, 500);
    const streamDetail = pipelineResult.status === 'rejected'
      ? ` Local streaming error: ${String(pipelineError?.message || pipelineResult.reason || 'unknown stream error')}.`
      : '';
    const diagnostics = [
      `endpoint: ${responseOrigin}`,
      `expected upload bytes: ${meta.fileSize}`,
      `response headers: ${headerDetails || 'none exposed'}`,
      detail ? `response body: ${String(detail).slice(0, 500)}` : ''
    ].filter(Boolean).join('. ');
    const error = new Error(
      `GitHub Release upload returned HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}. ${diagnostics}. ${progress}${streamDetail}`
    );
    error.status = response.status;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export async function uploadAssetToR2(bucket, store, scope, uploadId, meta, publicBaseUrl = "https://mmamatlock-writer-auth.fighttalkmma.workers.dev") {
  if (!bucket?.createMultipartUpload || !bucket?.head) {
    throw new Error("Cloudflare R2 video storage is not configured. The large video was retained in temporary storage.");
  }

  const key = `videos/${uploadId}/${meta.assetName}`;
  const baseUrl = String(publicBaseUrl || "https://mmamatlock-writer-auth.fighttalkmma.workers.dev").replace(/\/+$/, "");
  const publicUrl = `${baseUrl}/media/${encodeURIComponent(uploadId)}/${encodeURIComponent(meta.assetName)}`;
  const existing = await bucket.head(key).catch(() => null);
  if (existing && Number(existing.size) === Number(meta.fileSize)) {
    return { id: key, size: Number(existing.size), browser_download_url: publicUrl, storage: "cloudflare-r2" };
  }

  const multipart = await bucket.createMultipartUpload(key, {
    httpMetadata: { contentType: meta.fileType || "application/octet-stream", cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { assetName: meta.assetName, uploadId, source: "Matlock Writer" }
  });
  const parts = [];
  let stagedBytes = 0;
  try {
    let startIndex = 0;
    let partNumber = 1;
    while (startIndex < meta.chunkCount) {
      const count = Math.min(STREAM_SEGMENT_CHUNKS, meta.chunkCount - startIndex);
      const bytes = await readStreamSegmentWithRetry(store, scope, uploadId, startIndex, count, meta.fileSize, meta.chunkCount);
      parts.push(await multipart.uploadPart(partNumber, bytes));
      stagedBytes += bytes.byteLength;
      startIndex += count;
      partNumber += 1;
    }
    if (stagedBytes !== meta.fileSize) throw new Error(`R2 received ${stagedBytes} staged bytes; expected ${meta.fileSize}.`);

    const object = await multipart.complete(parts);
    if (Number(object?.size) !== Number(meta.fileSize)) {
      await bucket.delete(key).catch(() => {});
      throw new Error(`R2 completed the video with ${Number(object?.size) || 0} bytes; expected ${meta.fileSize}.`);
    }
    return { id: key, size: Number(object.size), browser_download_url: publicUrl, storage: "cloudflare-r2" };
  } catch (error) {
    await multipart.abort().catch(() => {});
    throw new Error(`Cloudflare R2 multipart upload failed after ${parts.length} of ${Math.ceil(meta.chunkCount / STREAM_SEGMENT_CHUNKS)} parts: ${String(error?.message || error || "Unknown R2 error.")}`, { cause: error });
  }
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

export default async function handler(request, env = null) {
  if (request.method !== 'POST') return new Response(null, { status: 405 });

  const { id: sessionId, session } = await requireWriterSession(request);
  if (!session) return;

  const body = await request.json().catch(() => null);
  const uploadId = validUploadId(body?.uploadId);
  if (!uploadId) return;
  const publishAttempt = Math.max(
    1,
    Math.min(MAX_AUTOMATIC_PUBLISH_ATTEMPTS, Math.floor(Number(body?.publishAttempt) || 1))
  );

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
    await setStatus(store, scope, uploadId, {
      state: 'preparing',
      publishAttempts: publishAttempt,
      ...meta
    });
    await verifyChunks(store, scope, uploadId, meta.chunkCount, meta.fileSize);

    let release = null;
    let asset = null;
    await setStatus(store, scope, uploadId, { state: 'publishing', publishAttempts: publishAttempt, ...meta });

    if (meta.fileSize >= R2_VIDEO_MIN_BYTES) {
      stage = 'streaming video to Cloudflare R2';
      asset = await uploadAssetToR2(env?.WRITER_VIDEO_BUCKET, store, scope, uploadId, meta, env?.WRITER_MEDIA_PUBLIC_BASE_URL);
    } else {
      stage = 'preparing GitHub Releases';
      release = await ensureRelease(session.token);
      stage = 'streaming video to GitHub Releases';
      asset = await uploadAsset(session.token, release, store, scope, uploadId, meta);
    }

    stage = 'recording published video';
    await setStatus(store, scope, uploadId, {
      state: 'complete',
      url: asset.browser_download_url,
      assetId: asset.id,
      releaseId: release?.id || null,
      storage: asset.storage || 'github-releases',
      publishAttempts: publishAttempt,
      ...meta
    });
    await cleanupChunks(store, scope, uploadId, meta.chunkCount).catch(error => {
      console.warn('Published video, but temporary media cleanup failed:', error?.message || error);
    });
  } catch (error) {
    const transientFailure = Boolean(error?.retryable) || isTransientMediaError(error);
    const retryable = transientFailure && publishAttempt < MAX_AUTOMATIC_PUBLISH_ATTEMPTS;
    const detail = String(error?.message || error || 'GitHub Release upload failed.');
    const exhausted = transientFailure && !retryable;
    const message = exhausted
      ? `Publishing failed while ${stage} after ${publishAttempt} attempts. Automatic retries have stopped to prevent a loop. The staged video has been retained. ${detail}`
      : `Publishing failed while ${stage}: ${detail}`;
    console.error(message);
    await setStatus(store, scope, uploadId, {
      state: 'error',
      error: message,
      retryable,
      publishAttempts: publishAttempt,
      ...meta
    });
    // Keep staged data after transient failures, including exhausted retries,
    // so it can be inspected or manually recovered without another full upload.
    if (!transientFailure) await cleanupChunks(store, scope, uploadId, meta.chunkCount);
  }
}

export const config = {
  path: '/api/writer/media-process'
};

export { uploadAssetOnce };
