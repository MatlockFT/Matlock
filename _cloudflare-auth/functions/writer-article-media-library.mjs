import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import { githubJson, githubRepoFetch } from './_github-client.mjs';
import { requireWriterSession } from './_writer-media.mjs';

const RELEASE_PREFIX = 'writer-media-';
const ARTICLE_UPLOAD_PREFIX = 'assets/uploads/articles/';
const MAX_RELEASES = 36;
const MAX_ASSET_PAGES = 5;

function mediaKind(name, contentType = '') {
  const lowerName = String(name || '').toLowerCase();
  const lowerType = String(contentType || '').toLowerCase();
  if (lowerType.startsWith('image/') || /\.(?:png|jpe?g|webp|gif|avif)$/i.test(lowerName)) return 'image';
  if (lowerType.startsWith('video/') || /\.(?:mp4|m4v|webm|mov)$/i.test(lowerName)) return 'video';
  return '';
}

function isManagedRelease(release) {
  return String(release?.tag_name || '').startsWith(RELEASE_PREFIX);
}

function isBroadcastAsset(asset) {
  return /^broadcast-(?:video|audio|image)-/i.test(String(asset?.name || ''));
}

function shapeReleaseAsset(asset, release) {
  const kind = mediaKind(asset?.name, asset?.content_type);
  if (!kind || isBroadcastAsset(asset)) return null;
  return {
    id: Number(asset.id),
    key: 'release:' + Number(asset.id),
    storage: 'release',
    kind,
    name: String(asset.name || ''),
    url: String(asset.browser_download_url || ''),
    size: Number(asset.size) || 0,
    contentType: String(asset.content_type || ''),
    createdAt: asset.created_at || null,
    updatedAt: asset.updated_at || null,
    releaseId: Number(release?.id) || null,
    releaseTag: String(release?.tag_name || '')
  };
}

async function listManagedReleases(token) {
  const releases = [];
  for (let page = 1; page <= 4 && releases.length < MAX_RELEASES; page += 1) {
    const rows = await githubJson(token, '/releases?per_page=100&page=' + page);
    if (!Array.isArray(rows) || !rows.length) break;
    releases.push(...rows.filter(isManagedRelease));
    if (rows.length < 100) break;
  }
  return releases
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, MAX_RELEASES);
}

async function listReleaseAssets(token) {
  const releases = await listManagedReleases(token);
  const groups = await Promise.all(releases.map(async release => {
    const assets = [];
    for (let page = 1; page <= MAX_ASSET_PAGES; page += 1) {
      const rows = await githubJson(token, '/releases/' + release.id + '/assets?per_page=100&page=' + page);
      if (!Array.isArray(rows) || !rows.length) break;
      assets.push(...rows);
      if (rows.length < 100) break;
    }
    return assets.map(asset => shapeReleaseAsset(asset, release)).filter(Boolean);
  }));
  return groups.flat();
}

function shapeRepositoryAsset(item) {
  const path = String(item?.path || '');
  if (!path.startsWith(ARTICLE_UPLOAD_PREFIX) || item?.type !== 'blob') return null;
  const kind = mediaKind(path);
  if (!kind) return null;
  const name = path.split('/').pop() || path;
  return {
    id: path,
    key: 'repository:' + path,
    storage: 'repository',
    kind,
    name,
    path,
    url: '/' + path,
    size: Number(item.size) || 0,
    contentType: kind === 'image' ? 'image/*' : 'video/*',
    createdAt: null,
    updatedAt: null,
    sha: String(item.sha || '')
  };
}

async function listRepositoryAssets(token) {
  const tree = await githubJson(token, '/git/trees/main?recursive=1');
  const rows = Array.isArray(tree?.tree) ? tree.tree : [];
  return rows.map(shapeRepositoryAsset).filter(Boolean);
}

async function listArticleMedia(token) {
  const [releaseAssets, repositoryAssets] = await Promise.all([
    listReleaseAssets(token),
    listRepositoryAssets(token)
  ]);
  return [...repositoryAssets, ...releaseAssets].sort((a, b) => {
    const aDate = String(a.createdAt || '');
    const bDate = String(b.createdAt || '');
    if (aDate || bDate) return bDate.localeCompare(aDate);
    return String(b.path || b.name || '').localeCompare(String(a.path || a.name || ''));
  });
}

function jsonError(message, status, headers, extra = {}) {
  return Response.json({ ok: false, error: message, ...extra }, { status, headers });
}

export default async function handler(request) {
  const origin = normalizeOrigin(request.headers.get('origin'));
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    if (!isAllowedOrigin(origin)) return new Response(null, { status: 403, headers });
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, Content-Type, X-Writer-Session'
      }
    });
  }

  if (!isAllowedOrigin(origin)) return jsonError('Origin not allowed', 403, headers);
  if (!['GET', 'DELETE'].includes(request.method)) {
    return jsonError('Method not allowed', 405, { ...headers, Allow: 'GET, DELETE, OPTIONS' });
  }

  const { session } = await requireWriterSession(request);
  if (!session) return jsonError('Session expired', 401, headers);

  if (request.method === 'GET') {
    try {
      const assets = await listArticleMedia(session.token);
      return Response.json({
        ok: true,
        assets,
        count: assets.length,
        totalBytes: assets.reduce((sum, asset) => sum + (Number(asset.size) || 0), 0)
      }, { status: 200, headers });
    } catch (error) {
      return jsonError(error?.message || 'Could not load article media.', Number(error?.status) || 502, headers);
    }
  }

  const body = await request.json().catch(() => null);
  const storage = String(body?.storage || '');

  try {
    if (storage === 'release') {
      const assetId = Number(body?.assetId);
      if (!Number.isSafeInteger(assetId) || assetId < 1) {
        return jsonError('Invalid GitHub Release asset ID.', 400, headers);
      }
      const library = await listReleaseAssets(session.token);
      const asset = library.find(item => item.id === assetId);
      if (!asset) return jsonError('That Writer media file was not found.', 404, headers);

      const response = await githubRepoFetch(session.token, '/releases/assets/' + assetId, { method: 'DELETE' });
      if (response.status !== 204) {
        const data = await response.json().catch(() => ({}));
        throw Object.assign(new Error(data?.message || 'GitHub could not delete the release asset.'), { status: response.status });
      }
      return Response.json({ ok: true, storage, assetId }, { status: 200, headers });
    }

    if (storage === 'repository') {
      const path = String(body?.path || '').replace(/^\/+/, '');
      if (!path.startsWith(ARTICLE_UPLOAD_PREFIX) || !mediaKind(path)) {
        return jsonError('Invalid article media path.', 400, headers);
      }
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      const file = await githubJson(session.token, '/contents/' + encoded + '?ref=main');
      if (!file?.sha) return jsonError('That article media file was not found.', 404, headers);

      await githubJson(session.token, '/contents/' + encoded, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Delete Writer media ' + (path.split('/').pop() || path),
          sha: file.sha,
          branch: 'main'
        })
      });
      return Response.json({ ok: true, storage, path }, { status: 200, headers });
    }

    return jsonError('Unknown media storage type.', 400, headers);
  } catch (error) {
    return jsonError(error?.message || 'Could not delete article media.', Number(error?.status) || 502, headers);
  }
}

export const config = {
  path: '/api/writer/article-media-library'
};
