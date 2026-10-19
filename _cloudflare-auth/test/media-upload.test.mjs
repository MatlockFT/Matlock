import assert from 'node:assert/strict';
import test from 'node:test';
import writerMediaFinalize from '../functions/writer-media-finalize.mjs';
import writerMediaChunk from '../functions/writer-media-chunk.mjs';
import { createWriterSession } from '../functions/_writer-session.mjs';
import { getStore } from '../functions/_cloudflare-store.mjs';
import {
  MEDIA_STORE_NAME,
  chunkKey,
  uploadScope,
  MAX_CHUNK_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_CHUNKS,
  cleanupAbandonedUploads,
  statusKey,
  validateMediaMetadata
} from '../functions/_writer-media.mjs';

class MemoryKVNamespace {
  constructor() { this.entries = new Map(); }

  async put(key, value, options = {}) {
    let bytes;
    if (typeof value === 'string') bytes = new TextEncoder().encode(value);
    else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
    else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    else if (value instanceof Blob) bytes = new Uint8Array(await value.arrayBuffer());
    else throw new TypeError('Memory KV received an unsupported value type');
    this.entries.set(key, { bytes: new Uint8Array(bytes), metadata: { ...(options.metadata || {}) } });
  }

  async get(key, options = {}) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const bytes = new Uint8Array(entry.bytes);
    const type = options.type || 'text';
    if (type === 'arrayBuffer') return bytes.slice().buffer;
    if (type === 'json') return JSON.parse(new TextDecoder().decode(bytes));
    return new TextDecoder().decode(bytes);
  }

  async getWithMetadata(key, options = {}) {
    const entry = this.entries.get(key);
    if (!entry) return { value: null, metadata: null };
    return { value: await this.get(key, options), metadata: { ...entry.metadata } };
  }

  async delete(key) { this.entries.delete(key); }

  async list({ prefix = '', limit = 1000 } = {}) {
    const keys = [...this.entries.keys()].filter(key => key.startsWith(prefix)).sort().slice(0, limit);
    return {
      keys: keys.map(name => ({ name, metadata: { ...(this.entries.get(name)?.metadata || {}) } })),
      list_complete: true
    };
  }
}


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
  const orphanId = 'orphaned_upload_123456';
  const now = Date.now();
  const twoHoursAgo = new Date(now - 3 * 60 * 60 * 1000).toISOString();
  const recent = new Date(now - 60 * 1000).toISOString();
  const deletedPrefixes = [];
  const deletedStatuses = [];
  const statuses = new Map([
    [failedId, { state: 'error', chunkCount: 2 }],
    [staleId, { state: 'uploading', chunkCount: 2, updatedAt: twoHoursAgo }],
    [freshId, { state: 'queued', chunkCount: 2, updatedAt: recent }],
    [orphanId, null],
    [currentId, null]
  ]);
  const blobs = [
    { key: `chunks/${scope}/${failedId}/00000`, metadata: { createdAt: recent, chunkCount: '2' } },
    { key: `chunks/${scope}/${staleId}/00000`, metadata: { createdAt: twoHoursAgo, chunkCount: '2' } },
    { key: `chunks/${scope}/${freshId}/00000`, metadata: { createdAt: recent, chunkCount: '2' } },
    { key: `chunks/${scope}/${orphanId}/00000`, metadata: { createdAt: recent, chunkCount: '2' } },
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

  assert.equal(cleaned, 3);
  assert.deepEqual(deletedPrefixes, [
    `chunks/${scope}/${failedId}/`,
    `chunks/${scope}/${staleId}/`,
    `chunks/${scope}/${orphanId}/`
  ]);
  assert.deepEqual(deletedStatuses, [
    `status/${scope}/${failedId}`,
    `status/${scope}/${staleId}`,
    `status/${scope}/${orphanId}`
  ]);
});


test('video finalizer accepts Worker bindings for direct queue publishing', () => {
  assert.equal(writerMediaFinalize.length, 2);
});


test('retryable publishing failures can requeue without restaging the video', async () => {
  const kv = new MemoryKVNamespace();
  globalThis.__MATLOCK_WRITER_KV = kv;
  delete globalThis.__MATLOCK_WRITER_MEDIA_STORAGE;

  try {
    const sessionId = await createWriterSession({ token: 'test-token', login: 'MatlockFT' });
    const scope = uploadScope(sessionId);
    const uploadId = 'retry_release_upload_12345';
    const store = getStore({ name: MEDIA_STORE_NAME });
    await store.setJSON(statusKey(scope, uploadId), {
      state: 'error',
      retryable: true,
      chunkCount: 1,
      fileSize: 4,
      fileType: 'video/mp4',
      assetName: 'retry-video.mp4',
      error: 'Network connection lost.'
    });

    const queued = [];
    const response = await writerMediaFinalize(
      new Request('https://writer.test/api/writer/media-finalize', {
        method: 'POST',
        headers: {
          origin: 'https://mmamatlock.com',
          'X-Writer-Session': sessionId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          uploadId,
          chunkCount: 1,
          fileSize: 4,
          fileType: 'video/mp4',
          assetName: 'retry-video.mp4'
        })
      }),
      { WRITER_MEDIA_QUEUE: { async send(job) { queued.push(job); } } }
    );

    const body = await response.json();
    const status = await store.get(statusKey(scope, uploadId), { type: 'json' });
    assert.equal(response.status, 202);
    assert.equal(body.state, 'queued');
    assert.equal(queued.length, 1);
    assert.equal(queued[0].body.uploadId, uploadId);
    assert.equal(status.state, 'queued');
    assert.equal(status.retryable, undefined);
  } finally {
    delete globalThis.__MATLOCK_WRITER_KV;
    delete globalThis.__MATLOCK_WRITER_MEDIA_STORAGE;
  }
});


test('GET chunk confirmation recognizes a chunk whose upload response was lost', async () => {
  const kv = new MemoryKVNamespace();
  globalThis.__MATLOCK_WRITER_KV = kv;
  try {
    const sessionId = await createWriterSession({ token: 'test-token', login: 'MatlockFT' });
    const scope = uploadScope(sessionId);
    const uploadId = 'upload_confirmed_chunk_12345';
    const store = getStore({ name: MEDIA_STORE_NAME });
    await store.set(chunkKey(scope, uploadId, 7), new Uint8Array([1, 2, 3, 4]).buffer, {
      metadata: { chunkIndex: 7, chunkSize: 4, createdAt: new Date().toISOString() },
      expirationTtl: 86400
    });

    const response = await writerMediaChunk(new Request(
      `https://writer.test/api/writer/media-chunk?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=7`,
      {
        method: 'GET',
        headers: {
          origin: 'https://mmamatlock.com',
          'X-Writer-Session': sessionId
        }
      }
    ));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(result.found, true);
    assert.equal(result.chunkIndex, 7);
    assert.equal(result.chunkSize, 4);
  } finally {
    delete globalThis.__MATLOCK_WRITER_KV;
    delete globalThis.__MATLOCK_WRITER_MEDIA_STORAGE;
  }
});
