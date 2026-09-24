import { chunkKey, cleanupChunks, mediaStore, requireWriterSession, setStatus, uploadScope, validUploadId } from './_writer-media.mjs';

function repoFullName() {
  return Netlify.env.get('GITHUB_REPOSITORY') || 'MatlockFT/Matlock';
}

async function githubJson(token, path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repoFullName()}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    },
    cache: 'no-store'
  });

  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.message || `${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

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

async function uploadAsset(token, release, store, scope, uploadId, chunkCount, fileSize, fileType, assetName) {
  const uploadUrl = String(release?.upload_url || '').replace(/\{\?name,label\}$/, '');
  if (!uploadUrl) throw new Error('GitHub did not provide a Release upload URL.');

  const response = await fetch(`${uploadUrl}?name=${encodeURIComponent(assetName)}`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': fileType || 'application/octet-stream',
      'Content-Length': String(fileSize)
    },
    body: chunkStream(store, scope, uploadId, chunkCount),
    duplex: 'half'
  });

  const data = await response.json().catch(() => ({}));
  if (response.status === 201 && data?.browser_download_url) return data;

  if (response.status === 422) {
    const existing = await existingReleaseAsset(token, release, assetName);
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
  const chunkCount = Number(body?.chunkCount);
  const fileSize = Number(body?.fileSize);
  const fileType = String(body?.fileType || 'application/octet-stream').slice(0, 120);
  const assetName = String(body?.assetName || '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 180);
  if (!uploadId || !Number.isInteger(chunkCount) || chunkCount < 1 || !Number.isFinite(fileSize) || fileSize < 1 || !assetName) return;

  const scope = uploadScope(sessionId);
  const store = mediaStore();

  try {
    const current = await store.get(`status/${scope}/${uploadId}`, { type: 'json', consistency: 'strong' });
    if (current?.state === 'complete' && current?.url) return;

    await setStatus(store, scope, uploadId, { state: 'preparing' });
    await verifyChunks(store, scope, uploadId, chunkCount, fileSize);

    const release = await ensureRelease(session.token);
    await setStatus(store, scope, uploadId, { state: 'publishing' });

    const asset = await uploadAsset(session.token, release, store, scope, uploadId, chunkCount, fileSize, fileType, assetName);
    await setStatus(store, scope, uploadId, {
      state: 'complete',
      url: asset.browser_download_url,
      assetId: asset.id,
      releaseId: release.id,
      assetName
    });
    await cleanupChunks(store, scope, uploadId, chunkCount);
  } catch (error) {
    await setStatus(store, scope, uploadId, {
      state: 'error',
      error: String(error?.message || error || 'GitHub Release upload failed.')
    });
    await cleanupChunks(store, scope, uploadId, chunkCount);
  }
}

export const config = {
  path: '/api/writer/media-process'
};
