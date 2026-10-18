import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CHUNK_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_CHUNKS,
  cleanupAbandonedUploads,
  validateMediaMetadata
} from '../functions/_writer-media.mjs';

test('large drag-and-drop videos fit the Durable Objects staging chunk limits', () => {
  assert.equal(MAX_CHUNK_BYTES, 1_800_000);
  const size = MAX_VIDEO_BYTES - 1;
  const count = Math.ceil(size / MAX_CHUNK_BYTES);

  assert.ok(count <= MAX_VIDEO_CHUNKS, 'a video just below 2 GiB must fit the chunk-count limit');
  const meta = validateMediaMetadata({
    assetName: 'large-video.mp4',
    fileSize: size,
    fileType: 'video/mp4',
    chunkCount: count
  });

  assert.equal(meta.fileSize, size);
  assert.equal(meta.chunkCount, count);
});

test('video uploads retain the GitHub Release size ceiling', () => {
  assert.throws(() => validateMediaMetadata({
    assetName: 'too-large.mp4',
    fileSize: MAX_VIDEO_BYTES,
    fileType: 'video/mp4',
    chunkCount: MAX_VIDEO_CHUNKS
  }), /2 GiB GitHub Release upload limit/);
});


test('abandoned and failed upload chunks are cleaned before a new upload proceeds', async () => {
  const scope = 'a'.repeat(24);
  const currentId = 'current_upload_123456';
  const failedId = 'failed_upload_123456';
  const staleId = 'stale_upload_123456';
  const freshId = 'fresh_upload_123456';
  const now = Date.now();
  const twoHoursAgo = new Date(now - 3 * 60 * 60 * 1000).toISOString();
  const recent = new Date(now - 60 * 1000).toISOString();
  const deletedPrefixes = [];
  const deletedStatuses = [];
  const statuses = new Map([
    [failedId, { state: 'error', chunkCount: 2 }],
    [staleId, null],
    [freshId, { state: 'queued', chunkCount: 2 }],
    [currentId, null]
  ]);
  const blobs = [
    { key: `chunks/${scope}/${failedId}/00000`, metadata: { createdAt: recent, chunkCount: '2' } },
    { key: `chunks/${scope}/${staleId}/00000`, metadata: { createdAt: twoHoursAgo, chunkCount: '2' } },
    { key: `chunks/${scope}/${freshId}/00000`, metadata: { createdAt: recent, chunkCount: '2' } },
    { key: `chunks/${scope}/${currentId}/00000`, metadata: { createdAt: twoHoursAgo, chunkCount: '2' } }
  ];
  const store = {
    async list() { return { blobs }; },
    async get(key) {
      const match = String(key).match(new RegExp('^status/' + scope + '/(.+)$'));
      return match ? statuses.get(match[1]) || null : null;
    },
    async deletePrefix(prefix) { deletedPrefixes.push(prefix); },
    async delete(key) { deletedStatuses.push(key); }
  };

  const cleaned = await cleanupAbandonedUploads(store, scope, currentId, now);

  assert.equal(cleaned, 2);
  assert.deepEqual(deletedPrefixes, [
    `chunks/${scope}/${failedId}/`,
    `chunks/${scope}/${staleId}/`
  ]);
  assert.deepEqual(deletedStatuses, [
    `status/${scope}/${failedId}`,
    `status/${scope}/${staleId}`
  ]);
});
