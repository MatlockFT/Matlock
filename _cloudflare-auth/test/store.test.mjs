import assert from 'node:assert/strict';
import test from 'node:test';
import { getStore } from '../functions/_cloudflare-store.mjs';

class FakeKVNamespace {
  constructor() { this.entries = new Map(); }

  async put(key, value, options = {}) {
    let bytes;
    if (typeof value === 'string') bytes = new TextEncoder().encode(value);
    else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
    else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    else if (value instanceof Blob) bytes = new Uint8Array(await value.arrayBuffer());
    else if (value instanceof ReadableStream) bytes = new Uint8Array(await new Response(value).arrayBuffer());
    else throw new TypeError('Fake KV got an unsupported value type');

    this.entries.set(key, {
      bytes: new Uint8Array(bytes),
      metadata: { ...(options.metadata || {}) },
      expirationTtl: options.expirationTtl || null
    });
  }

  async get(key, options = {}) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const type = options.type || 'text';
    const bytes = new Uint8Array(entry.bytes);
    if (type === 'arrayBuffer') return bytes.slice().buffer;
    if (type === 'stream') return new Response(bytes).body;
    if (type === 'json') return JSON.parse(new TextDecoder().decode(bytes));
    if (type === 'blob') return new Blob([bytes]);
    return new TextDecoder().decode(bytes);
  }

  async getWithMetadata(key, options = {}) {
    const entry = this.entries.get(key);
    if (!entry) return { value: null, metadata: null };
    return {
      value: await this.get(key, options),
      metadata: { ...entry.metadata }
    };
  }

  async delete(key) {
    this.entries.delete(key);
  }

  async list({ prefix = '', limit = 1000, cursor = '' } = {}) {
    const keys = [...this.entries.keys()].filter(key => key.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) || 0 : 0;
    const selected = keys.slice(start, start + limit);
    const next = start + limit;
    const listComplete = next >= keys.length;
    return {
      keys: selected.map(name => ({
        name,
        metadata: { ...this.entries.get(name).metadata }
      })),
      list_complete: listComplete,
      cursor: listComplete ? undefined : String(next)
    };
  }
}

test('KV-backed store keeps logical stores namespaced and round-trips JSON', async () => {
  const kv = new FakeKVNamespace();
  globalThis.__MATLOCK_WRITER_KV = kv;
  try {
    const auth = getStore({ name: 'auth-store' });
    const sessions = getStore({ name: 'session-store' });
    await auth.setJSON('github-app', { clientId: 'public-id', clientSecret: 'secret-value' }, {
      metadata: { createdAt: '2026-10-15T00:00:00.000Z' }
    });
    assert.deepEqual(await auth.get('github-app', { type: 'json' }), {
      clientId: 'public-id',
      clientSecret: 'secret-value'
    });
    assert.equal(await sessions.get('github-app', { type: 'json' }), null);
    assert.equal((await auth.getMetadata('github-app')).metadata.createdAt, '2026-10-15T00:00:00.000Z');
  } finally {
    delete globalThis.__MATLOCK_WRITER_KV;
  }
});

test('KV-backed store preserves binary chunks, metadata, TTL and list prefixes', async () => {
  const kv = new FakeKVNamespace();
  globalThis.__MATLOCK_WRITER_KV = kv;
  try {
    const store = getStore({ name: 'media-store' });
    const source = new Uint8Array([0, 1, 127, 128, 255]);
    await store.set('chunks/scope/upload/00000', source.buffer, {
      metadata: { chunkSize: 5, createdAt: '2026-10-15T00:00:00.000Z' },
      expirationTtl: 86400
    });
    const restored = new Uint8Array(await store.get('chunks/scope/upload/00000', { type: 'arrayBuffer' }));
    assert.deepEqual([...restored], [...source]);
    const listed = await store.list({ prefix: 'chunks/' });
    assert.equal(listed.blobs.length, 1);
    assert.equal(listed.blobs[0].key, 'chunks/scope/upload/00000');
    assert.equal(listed.blobs[0].metadata.chunkSize, '5');
    assert.equal((await store.getWithMetadata('chunks/scope/upload/00000', { type: 'arrayBuffer' })).metadata.createdAt, '2026-10-15T00:00:00.000Z');
    assert.equal(kv.entries.values().next().value.expirationTtl, 86400);
  } finally {
    delete globalThis.__MATLOCK_WRITER_KV;
  }
});
