import {
  ACTIVE_UPLOAD_TTL_MS,
  cleanupChunks,
  isStaleStatus,
  mediaStore,
  parseStatusKey
} from './_writer-media.mjs';

export default async function handler() {
  const store = mediaStore();
  const now = Date.now();

  const { blobs: statuses } = await store.list({ prefix: 'status/' });
  for (const entry of statuses) {
    const parsed = parseStatusKey(entry.key);
    if (!parsed) continue;

    const status = await store.get(entry.key, { type: 'json', consistency: 'strong' }).catch(() => null);
    if (!isStaleStatus(status, now)) continue;

    await cleanupChunks(store, parsed.scope, parsed.uploadId, status?.chunkCount);
    await store.delete(entry.key).catch(() => {});
  }

  // Safety net for uploads abandoned before a status record could be written.
  const { blobs: chunks } = await store.list({ prefix: 'chunks/' });
  for (const entry of chunks) {
    const metadata = await store.getMetadata(entry.key, { consistency: 'strong' }).catch(() => null);
    const createdAt = Date.parse(metadata?.metadata?.createdAt || '');
    if (!Number.isFinite(createdAt) || now - createdAt > ACTIVE_UPLOAD_TTL_MS) {
      await store.delete(entry.key).catch(() => {});
    }
  }
}

export const config = {
  schedule: '0 */6 * * *'
};
