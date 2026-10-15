import assert from 'node:assert/strict';
import test from 'node:test';
import { getStore } from '../functions/_cloudflare-store.mjs';

class FakeR2Bucket {
  constructor() { this.entries = new Map(); }

  async put(key, value, options = {}) {
    let bytes;
    if (typeof value === 'string') bytes = new TextEncoder().encode(value);
    else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
    else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    else if (value instanceof Blob) bytes = new Uint8Array(await value.arrayBuffer());
    else if (value instanceof ReadableStream) bytes = new Uint8Array(await new Response(value).arrayBuffer());
    else throw new TypeError('Fake R2 got an unsupported value type');
    this.entries.set(key, {
      bytes: new Uint8Array(bytes),
      customMetadata: { ...(options.customMetadata || {}) },
      etag: `etag-${this.entries.size + 1}`,
      uploaded: new Date()
    });
    return { key };
  }

  async get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const bytes = new Uint8Array(entry.bytes);
    return {
      key, size: bytes.byteLength, etag: entry.etag,
      customMetadata: { ...entry.customMetadata }, uploaded: entry.uploaded,
      body: new Response(bytes).body,
      async arrayBuffer() { return bytes.slice().buffer; },
      async text() { return new TextDecoder().decode(bytes); },
      async json() { return JSON.parse(new TextDecoder().decode(bytes)); }
    };
  }

  async head(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    return {
      key, size: entry.bytes.byteLength, etag: entry.etag,
      customMetadata: { ...entry.customMetadata }, uploaded: entry.uploaded
    };
  }

  async delete(key) { this.entries.delete(key); }

  async list({ prefix = '', limit = 1000, cursor = '' } = {}) {
    const keys = [...this.entries.keys()].filter(key => key.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) || 0 : 0;
    const selected = keys.slice(start, start + limit);
    const truncated = start + limit < keys.length;
    return {
      objects: selected.map(key => {
        const entry = this.entries.get(key);
        return {
          key, size: entry.bytes.byteLength, etag: entry.etag,
          customMetadata: { ...entry.customMetadata }, uploaded: entry.uploaded
        };
      }),
      truncated,
      cursor: truncated ? String(start + limit) : undefined
    };
  }
}

test('R2-backed store keeps stores namespaced and round-trips JSON', async () => {
  const bucket = new FakeR2Bucket();
  globalThis.__MATLOCK_WRITER_R2_BUCKET = bucket;
  try {
    const auth = getStore({ name: 'auth-store' });
    const sessions = getStore({ name: 'session-store' });
    await auth.setJSON('github-app', { clientId: 'public-id', clientSecret: 'secret-value' }, { metadata: { createdAt: '2026-10-15T00:00:00.000Z' } });
    assert.deepEqual(await auth.get('github-app', { type: 'json' }), { clientId: 'public-id', clientSecret: 'secret-value' });
    assert.equal(await sessions.get('github-app', { type: 'json' }), null);
    assert.equal((await auth.getMetadata('github-app')).metadata.createdAt, '2026-10-15T00:00:00.000Z');
  } finally {
    delete globalThis.__MATLOCK_WRITER_R2_BUCKET;
  }
});

test('R2-backed store preserves binary chunk bytes and lists metadata', async () => {
  const bucket = new FakeR2Bucket();
  globalThis.__MATLOCK_WRITER_R2_BUCKET = bucket;
  try {
    const store = getStore({ name: 'media-store' });
    const source = new Uint8Array([0, 1, 127, 128, 255]);
    await store.set('chunks/scope/upload/00000', source.buffer, { metadata: { chunkSize: 5, createdAt: '2026-10-15T00:00:00.000Z' } });
    const restored = new Uint8Array(await store.get('chunks/scope/upload/00000', { type: 'arrayBuffer' }));
    assert.deepEqual([...restored], [...source]);
    const listed = await store.list({ prefix: 'chunks/' });
    assert.equal(listed.blobs.length, 1);
    assert.equal(listed.blobs[0].key, 'chunks/scope/upload/00000');
    assert.equal(listed.blobs[0].metadata.chunkSize, '5');
    assert.equal((await store.getWithMetadata('chunks/scope/upload/00000', { type: 'arrayBuffer' })).metadata.createdAt, '2026-10-15T00:00:00.000Z');
  } finally {
    delete globalThis.__MATLOCK_WRITER_R2_BUCKET;
  }
});
