import { createHash } from 'node:crypto';
import { getStore } from './_cloudflare-store.mjs';
import { createDurableObjectMediaStore } from './_writer-media-do-store.mjs';
import { getWriterSession } from './_writer-session.mjs';

export const MEDIA_STORE_NAME = 'matlock-writer-media-staging';
export const MAX_CHUNK_BYTES = 1_800_000;
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_VIDEO_CHUNKS = 1200;
export const ACTIVE_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
export const COMPLETE_STATUS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const VIDEO_TYPES = new Map([
  ['mp4', new Set(['video/mp4', 'application/octet-stream'])],
  ['m4v', new Set(['video/x-m4v', 'video/mp4', 'application/octet-stream'])],
  ['webm', new Set(['video/webm', 'application/octet-stream'])]
]);

const AUDIO_TYPES = new Map([
  ['mp3', new Set(['audio/mpeg', 'audio/mp3', 'application/octet-stream'])],
  ['m4a', new Set(['audio/mp4', 'audio/x-m4a', 'application/octet-stream'])],
  ['aac', new Set(['audio/aac', 'audio/mp4', 'application/octet-stream'])],
  ['wav', new Set(['audio/wav', 'audio/x-wav', 'application/octet-stream'])],
  ['ogg', new Set(['audio/ogg', 'application/ogg', 'application/octet-stream'])],
  ['opus', new Set(['audio/ogg', 'audio/opus', 'application/octet-stream'])],
  ['flac', new Set(['audio/flac', 'audio/x-flac', 'application/octet-stream'])]
]);

const IMAGE_TYPES = new Map([
  ['png', new Set(['image/png', 'application/octet-stream'])],
  ['jpg', new Set(['image/jpeg', 'application/octet-stream'])],
  ['jpeg', new Set(['image/jpeg', 'application/octet-stream'])],
  ['webp', new Set(['image/webp', 'application/octet-stream'])],
  ['gif', new Set(['image/gif', 'application/octet-stream'])]
]);

const MEDIA_TYPES = new Map([...VIDEO_TYPES, ...AUDIO_TYPES, ...IMAGE_TYPES]);

export function writerSessionId(request) {
  return request.headers.get('x-writer-session') || '';
}

export async function requireWriterSession(request) {
  const id = writerSessionId(request);
  const session = await getWriterSession(id);
  return { id, session };
}

export function uploadScope(sessionId) {
  return createHash('sha256').update(String(sessionId || '')).digest('hex').slice(0, 24);
}

export function validUploadId(value) {
  const id = String(value || '');
  return /^[A-Za-z0-9_-]{12,96}$/.test(id) ? id : '';
}

export function sanitizeAssetName(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function validateMetadata({ assetName, fileSize, fileType, chunkCount = null }, acceptedTypes, invalidTypeMessage) {
  const safeName = sanitizeAssetName(assetName);
  const size = Number(fileSize);
  const type = String(fileType || 'application/octet-stream').toLowerCase().trim() || 'application/octet-stream';
  const ext = safeName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';

  if (!safeName || !acceptedTypes.has(ext)) throw new Error(invalidTypeMessage);
  if (!Number.isFinite(size) || size < 1 || size >= MAX_VIDEO_BYTES) {
    throw new Error('Media file size is invalid or exceeds the 2 GiB GitHub Release upload limit.');
  }
  if (!acceptedTypes.get(ext).has(type)) throw new Error('Media MIME type does not match the file extension.');

  let chunks = null;
  if (chunkCount !== null && chunkCount !== undefined) {
    chunks = Number(chunkCount);
    if (!Number.isInteger(chunks) || chunks < 1 || chunks > MAX_VIDEO_CHUNKS) {
      throw new Error('Media chunk count is invalid.');
    }
    if (chunks * MAX_CHUNK_BYTES < size) {
      throw new Error('Media chunk count is too small for the declared file size.');
    }
  }

  return { assetName: safeName, fileSize: size, fileType: type, ext, chunkCount: chunks };
}

export function validateMediaMetadata(meta) {
  return validateMetadata(
    meta,
    MEDIA_TYPES,
    'Use MP4, WebM or M4V video; MP3, M4A, AAC, WAV, OGG, Opus or FLAC audio; or PNG, JPG, WebP or GIF images.'
  );
}

export function validateVideoMetadata(meta) {
  return validateMetadata(meta, VIDEO_TYPES, 'Use an MP4, WebM or M4V video.');
}

export function chunkKey(scope, uploadId, index) {
  return `chunks/${scope}/${uploadId}/${String(index).padStart(5, '0')}`;
}

export function statusKey(scope, uploadId) {
  return `status/${scope}/${uploadId}`;
}

export function parseStatusKey(key) {
  const match = String(key || '').match(/^status\/([a-f0-9]{24})\/([A-Za-z0-9_-]{12,96})$/);
  return match ? { scope: match[1], uploadId: match[2] } : null;
}

export function mediaStore() {
  if (globalThis.__MATLOCK_WRITER_MEDIA_STORAGE) {
    return createDurableObjectMediaStore({ name: MEDIA_STORE_NAME });
  }
  // Preserve the KV adapter for unit tests and local compatibility checks.
  return getStore({ name: MEDIA_STORE_NAME, consistency: 'strong' });
}

export async function setStatus(store, scope, uploadId, status) {
  await store.setJSON(statusKey(scope, uploadId), {
    ...status,
    updatedAt: new Date().toISOString()
  });
}

export function statusTtlMs(status) {
  return status?.state === 'complete' ? COMPLETE_STATUS_TTL_MS : ACTIVE_UPLOAD_TTL_MS;
}

export function isStaleStatus(status, now = Date.now()) {
  const updated = Date.parse(status?.updatedAt || '');
  if (!Number.isFinite(updated)) return true;
  return now - updated > statusTtlMs(status);
}

export async function cleanupChunks(store, scope, uploadId, chunkCount) {
  const count = Number(chunkCount);
  if (!Number.isInteger(count) || count < 1 || count > MAX_VIDEO_CHUNKS) return;
  const prefix = `chunks/${scope}/${uploadId}/`;
  if (typeof store.deletePrefix === 'function') {
    await store.deletePrefix(prefix);
    return;
  }
  await Promise.allSettled(
    Array.from({ length: count }, (_, index) => store.delete(chunkKey(scope, uploadId, index)))
  );
}


const ABANDONED_UPLOAD_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * Reclaim chunks left behind by failed or abandoned browser uploads before
 * accepting another upload for the same signed-in writer. This also recovers
 * failed finalizations from older versions that left their staged chunks in
 * SQLite storage.
 */
export async function cleanupAbandonedUploads(store, scope, currentUploadId, now = Date.now()) {
  const listing = await store.list({ prefix: `chunks/${scope}/`, limit: 5000 });
  const uploads = new Map();

  for (const entry of listing.blobs || []) {
    const key = String(entry.key || '');
    const parts = key.split('/');
    if (parts.length !== 4 || parts[0] !== 'chunks' || parts[1] !== scope || !validUploadId(parts[2]) || !/^\d{5}$/.test(parts[3])) continue;

    const uploadId = parts[2];
    const createdAt = Date.parse(entry.metadata?.createdAt || entry.uploaded || '');
    const group = uploads.get(uploadId) || { oldestCreatedAt: Infinity, chunkCount: 0 };
    if (Number.isFinite(createdAt)) group.oldestCreatedAt = Math.min(group.oldestCreatedAt, createdAt);
    group.chunkCount = Math.max(group.chunkCount, Number(entry.metadata?.chunkCount) || 0);
    uploads.set(uploadId, group);
  }

  let cleaned = 0;
  for (const [uploadId, group] of uploads) {
    if (uploadId === currentUploadId) continue;

    const currentStatus = await store.get(statusKey(scope, uploadId), {
      type: 'json',
      consistency: 'strong'
    });
    const failed = currentStatus?.state === 'error' || currentStatus?.state === 'aborted';
    const stale = Number.isFinite(group.oldestCreatedAt)
      && now - group.oldestCreatedAt >= ABANDONED_UPLOAD_AGE_MS;
    if (!failed && !stale) continue;

    const chunkCount = Number(currentStatus?.chunkCount) || group.chunkCount;
    await cleanupChunks(store, scope, uploadId, chunkCount);
    if (typeof store.delete === 'function') await store.delete(statusKey(scope, uploadId));
    cleaned += 1;
  }

  return cleaned;
}
