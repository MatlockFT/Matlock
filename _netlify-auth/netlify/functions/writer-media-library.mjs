import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import { githubJson, githubRepoFetch } from './_github-client.mjs';
import { requireWriterSession } from './_writer-media.mjs';

const RELEASE_PREFIX = 'writer-media-';
const BROADCAST_VIDEO_PREFIX = 'broadcast-video-';
const MAX_RELEASES = 36;
const MAX_ASSET_PAGES = 5;

export function isManagedMediaRelease(release) {
  return String(release?.tag_name || '').startsWith(RELEASE_PREFIX);
}

export function isBroadcastVideoAsset(asset) {
  const name = String(asset?.name || '').toLowerCase();
  const type = String(asset?.content_type || '').toLowerCase();
  return name.startsWith(BROADCAST_VIDEO_PREFIX)
    && (type.startsWith('video/') || /\.(?:mp4|m4v|webm)$/i.test(name));
}

export function broadcastVideoUsage(state, url) {
  const target = String(url || '');
  const usage = { draft: false, live: false };
  if (!target || !state || typeof state !== 'object') return usage;

  for (const key of ['draft', 'live']) {
    const program = Array.isArray(state?.[key]?.program) ? state[key].program : [];
    usage[key] = program.some(item =>
      String(item?.type || '').toLowerCase() === 'video'
      && String(item?.mediaUrl || '') === target
    );
  }
  return usage;
}

function shapeAsset(asset, release) {
  return {
    id: Number(asset.id),
    name: String(asset.name || ''),
    url: String(asset.browser_download_url || ''),
    size: Number(asset.size) || 0,
    contentType: String(asset.content_type || ''),
    createdAt: asset.created_at || null,
    updatedAt: asset.updated_at || null,
    downloadCount: Number(asset.download_count) || 0,
    releaseId: Number(release?.id) || null,
    releaseTag: String(release?.tag_name || '')
  };
}

async function listManagedReleases(token) {
  const releases = [];
  for (let page = 1; page <= 4 && releases.length < MAX_RELEASES; page += 1) {
    const rows = await githubJson(token, `/releases?per_page=100&page=${page}`);
    if (!Array.isArray(rows) || !rows.length) break;
    releases.push(...rows.filter(isManagedMediaRelease));
    if (rows.length < 100) break;
  }
  return releases
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, MAX_RELEASES);
}

async function listReleaseAssets(token, release) {
  const assets = [];
  for (let page = 1; page <= MAX_ASSET_PAGES; page += 1) {
    const rows = await githubJson(token, `/releases/${release.id}/assets?per_page=100&page=${page}`);
    if (!Array.isArray(rows) || !rows.length) break;
    assets.push(...rows);
    if (rows.length < 100) break;
  }
  return assets;
}

async function listBroadcastVideos(token) {
  const releases = await listManagedReleases(token);
  const groups = await Promise.all(releases.map(async release => {
    const assets = await listReleaseAssets(token, release);
    return assets.filter(isBroadcastVideoAsset).map(asset => shapeAsset(asset, release));
  }));
  return groups.flat().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function decodeContent(value) {
  return Buffer.from(String(value || '').replace(/\s+/g, ''), 'base64').toString('utf8');
}

async function loadBroadcastState(token) {
  const paths = [
    '/contents/assets/uploads/broadcast.json?ref=main',
    '/contents/assets/data/broadcast.json?ref=main'
  ];
  let lastError = null;
  for (const path of paths) {
    try {
      const file = await githubJson(token, path);
      const parsed = JSON.parse(decodeContent(file?.content || 'e30='));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      lastError = error;
      if (error?.status !== 404) throw error;
    }
  }
  throw lastError || new Error('Broadcast state is unavailable.');
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
      const assets = await listBroadcastVideos(session.token);
      return Response.json({
        ok: true,
        assets,
        count: assets.length,
        totalBytes: assets.reduce((sum, asset) => sum + (Number(asset.size) || 0), 0)
      }, { status: 200, headers });
    } catch (error) {
      return jsonError(error?.message || 'Could not load the video library.', Number(error?.status) || 502, headers);
    }
  }

  const body = await request.json().catch(() => null);
  const assetId = Number(body?.assetId);
  if (!Number.isSafeInteger(assetId) || assetId < 1) {
    return jsonError('Invalid GitHub Release asset ID.', 400, headers);
  }

  try {
    const library = await listBroadcastVideos(session.token);
    const asset = library.find(item => item.id === assetId);
    if (!asset) {
      return jsonError('That Broadcast Control video was not found in the managed media releases.', 404, headers);
    }

    const state = await loadBroadcastState(session.token);
    const usage = broadcastVideoUsage(state, asset.url);
    if (usage.draft || usage.live) {
      const places = [usage.draft ? 'draft' : '', usage.live ? 'live broadcast' : ''].filter(Boolean).join(' and ');
      return jsonError(`This video is still used by the ${places}. Remove it from programming and save the state before deleting it permanently.`, 409, headers, { usage });
    }

    const response = await githubRepoFetch(session.token, `/releases/assets/${assetId}`, { method: 'DELETE' });
    if (response.status !== 204) {
      const data = await response.json().catch(() => ({}));
      throw Object.assign(new Error(data?.message || `GitHub returned ${response.status} while deleting the video.`), { status: response.status });
    }

    return Response.json({ ok: true, assetId }, { status: 200, headers });
  } catch (error) {
    return jsonError(error?.message || 'Could not delete the video.', Number(error?.status) || 502, headers);
  }
}

export const config = {
  path: '/api/writer/media-library'
};
