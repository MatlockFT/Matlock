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
  validateVideoMetadata
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
        body: 'Article media uploaded automatically by MMA Matlock Writer. Do not delete assets that are embedded in published articles.',
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

function chunkStream(store, scope, uploadId, chunkCount) {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index >= chunkCount) {
        controller.close();
        return;
      }
      try {
        const data = await store.get(chunkKey(scope, uploadId, index), { type: 'arrayBuffer', consistency: 'strong' });
        if (!data) throw new Error(`Missing staged video chunk ${index + 1} of ${chunkCount}.`);
        index += 1;
        controller.enqueue(new Uint8Array(data));
      } catch (error) {
        controller.error(error);
      }
    }
  });
}

async function verifyChunks(store, scope, uploadId, chunkCount, fileSize) {
  let stagedBytes = 0;
  for (let index = 0; index < chunkCount; index += 1) {
    const entry = await store.getMetadata(chunkKey(scope, uploadId, index), { consistency: 'strong' });
    const chunkSize = Number(entry?.metadata?.chunkSize);
    if (!entry || !Number.isFinite(chunkSize) || chunkSize < 1) {
      throw new Error(`Missing staged video chunk ${index + 1} of ${chunkCount}.`);
    }
    stagedBytes += chunkSize;
  }
  if (stagedBytes !== fileSize) throw new Error('Staged video size did not match the original upload.');
}

async function uploadAsset(token, release, store, scope, uploadId, meta) {
  const uploadUrl = String(release?.upload_url || '').replace(/\{\?name,label\}$/, '');
  if (!uploadUrl) throw new Error('GitHub did not provide a Release upload URL.');

  const response = await githubFetchUrl(token, `${uploadUrl}?name=${encodeURIComponent(meta.assetName)}`, {
    method: 'POST',
    headers: {
      'Content-Type': meta.fileType || 'application/octet-stream',
      'Content-Length': String(meta.fileSize)
    },
    body: chunkStream(store, scope, uploadId, meta.chunkCount),
    duplex: 'half'
  });

  const data = await response.json().catch(() => ({}));
  if (response.status === 201 && data?.browser_download_url) return data;

  if (response.status === 422) {
    const existing = await existingReleaseAsset(token, release, meta.assetName);
    if (existing) return existing;
  }
  throw new Error(data?.message || `GitHub Release upload failed with status ${response.status}.`);
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
    meta = validateVideoMetadata({
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
