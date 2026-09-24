import { cleanupChunks, isStaleStatus, mediaStore, parseStatusKey } from './_writer-media.mjs';

export default async function handler() {
  const store = mediaStore();
  const { blobs } = await store.list({ prefix: 'status/' });
  const now = Date.now();

  for (const entry of blobs) {
    const parsed = parseStatusKey(entry.key);
    if (!parsed) continue;

    const status = await store.get(entry.key, { type: 'json', consistency: 'strong' }).catch(() => null);
    if (!isStaleStatus(status, now)) continue;

    await cleanupChunks(store, parsed.scope, parsed.uploadId, status?.chunkCount);
    await store.delete(entry.key).catch(() => {});
  }
}

export const config = {
  schedule: '0 */6 * * *'
};
