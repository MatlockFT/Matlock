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

  const { blobs: statuses } = await store.list({ prefix: 'status/', limit: 5000 });
  for (const entry of statuses) {
    const parsed = parseStatusKey(entry.key);
    if (!parsed) continue;

    const status = await store.get(entry.key, { type: 'json', consistency: 'strong' }).catch(() => null);
    if (!isStaleStatus(status, now)) continue;

    await cleanupChunks(store, parsed.scope, parsed.uploadId, status?.chunkCount);
    await store.delete(entry.key).catch(() => {});
  }

  // Safety net for uploads abandoned before a status record could be written.
  const { blobs: chunks } = await store.list({ prefix: 'chunks/', limit: 5000 });
  const abandonedPrefixes = new Set();
  const individualDeletes = [];
  for (const entry of chunks) {
    const createdAt = Date.parse(entry?.metadata?.createdAt || '');
    if (Number.isFinite(createdAt) && now - createdAt <= ACTIVE_UPLOAD_TTL_MS) continue;
    const match = String(entry.key || '').match(/^(chunks\/[a-f0-9]{24}\/[A-Za-z0-9_-]{12,96}\/)/);
    if (match) abandonedPrefixes.add(match[1]);
    else individualDeletes.push(entry.key);
  }

  if (typeof store.deletePrefix === 'function') {
    for (const prefix of abandonedPrefixes) {
      await store.deletePrefix(prefix).catch(() => {});
    }
  } else {
    for (const key of abandonedPrefixes) {
      const matching = chunks.filter(entry => entry.key.startsWith(key));
      await Promise.allSettled(matching.map(entry => store.delete(entry.key)));
    }
  }
  await Promise.allSettled(individualDeletes.map(key => store.delete(key)));
}

export const config = {
  schedule: '0 */6 * * *'
};
