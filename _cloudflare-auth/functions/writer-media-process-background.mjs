import { githubFetchUrl, githubJson } from './_github-client.mjs';
import {
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

async function existingReleaseAsset(token, release, assetName) {
  const assets = await githubJson(token, `/releases/${release.id}/assets?per_page=100`);
  return Array.isArray(assets) ? assets.find(asset => asset.name === assetName && asset.browser_download_url) || null : null;
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

async function chunkStream(store, scope, uploadId, chunkCount) {
  if (typeof store.streamChunks === 'function') {
    return store.streamChunks(scope, uploadId, chunkCount);
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

async function uploadAsset(token, release, store, scope, uploadId, meta) {
  const uploadUrl = String(release?.upload_url || '').replace(/\{\?name,label\}$/, '');
  if (!uploadUrl) throw new Error('GitHub did not provide a Release upload URL.');

  // A normal ReadableStream body is sent with chunked transfer encoding in
  // Workers; setting Content-Length in headers is ignored by the runtime.
  // GitHub's Release asset endpoint requires the exact byte length, so pipe the
  // staged data through FixedLengthStream. This still streams the video and
  // never buffers the full asset in Worker memory.
  const fixedBody = new FixedLengthStream(meta.fileSize);
  const source = await chunkStream(store, scope, uploadId, meta.chunkCount);
  const pumping = source.pipeTo(fixedBody.writable);
  const uploading = githubFetchUrl(token, `${uploadUrl}?name=${encodeURIComponent(meta.assetName)}`, {
    method: 'POST',
    headers: {
      'Content-Type': meta.fileType || 'application/octet-stream'
    },
    body: fixedBody.readable,
    duplex: 'half'
  });

  const [response] = await Promise.all([uploading, pumping]);
  const responseText = await response.text().catch(() => '');
  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = { message: responseText.trim().slice(0, 500) };
  }
  if (response.status === 201 && data?.browser_download_url) return data;

  if (response.status === 422) {
    const existing = await existingReleaseAsset(token, release, meta.assetName);
    if (existing) return existing;
  }
  const requestId = response.headers.get('x-github-request-id');
  const detail = data?.message || responseText.trim().slice(0, 500);
  throw new Error(
    detail
      ? `GitHub Release upload failed with status ${response.status}: ${detail}`
      : `GitHub Release upload failed with status ${response.status}.${requestId ? ` GitHub request ID: ${requestId}.` : ''}`
  );
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

  try {
    const current = await store.get(statusKey(scope, uploadId), { type: 'json', consistency: 'strong' });
    if (current?.state === 'complete' && current?.url) return;

    await setStatus(store, scope, uploadId, { state: 'preparing', ...meta });
    await verifyChunks(store, scope, uploadId, meta.chunkCount, meta.fileSize);

    const release = await ensureRelease(session.token);
    await setStatus(store, scope, uploadId, { state: 'publishing', ...meta });

    const asset = await uploadAsset(session.token, release, store, scope, uploadId, meta);
    await setStatus(store, scope, uploadId, {
      state: 'complete',
      url: asset.browser_download_url,
      assetId: asset.id,
      releaseId: release.id,
      ...meta
    });
    await cleanupChunks(store, scope, uploadId, meta.chunkCount);
  } catch (error) {
    await setStatus(store, scope, uploadId, {
      state: 'error',
      error: String(error?.message || error || 'GitHub Release upload failed.'),
      ...meta
    });
    await cleanupChunks(store, scope, uploadId, meta.chunkCount);
  }
}

export const config = {
  path: '/api/writer/media-process'
};
