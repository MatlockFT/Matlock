import { createHash } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getWriterSession } from './_writer-session.mjs';

export const MEDIA_STORE_NAME = 'matlock-writer-media-staging';
export const MAX_CHUNK_BYTES = Math.floor(3.75 * 1024 * 1024);

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

export function chunkKey(scope, uploadId, index) {
  return `chunks/${scope}/${uploadId}/${String(index).padStart(5, '0')}`;
}

export function statusKey(scope, uploadId) {
  return `status/${scope}/${uploadId}`;
}

export function mediaStore() {
  return getStore({ name: MEDIA_STORE_NAME, consistency: 'strong' });
}

export async function setStatus(store, scope, uploadId, status) {
  await store.setJSON(statusKey(scope, uploadId), {
    ...status,
    updatedAt: new Date().toISOString()
  });
}

export async function cleanupChunks(store, scope, uploadId, chunkCount) {
  await Promise.allSettled(
    Array.from({ length: chunkCount }, (_, index) => store.delete(chunkKey(scope, uploadId, index)))
  );
}
