import assert from 'node:assert/strict';
import test from 'node:test';
import { WriterMediaStorage } from '../functions/_writer-media-storage-do.mjs';

class MemorySql {
  constructor() {
    this.rows = new Map();
  }

  exec(query, ...args) {
    if (/^\s*CREATE TABLE|^\s*CREATE INDEX/i.test(query)) {
      return { toArray: () => [] };
    }
    if (/INSERT INTO matlock_writer_media/i.test(query)) {
      const [key, value, metadata, expires_at] = args;
      const bytes = value instanceof ArrayBuffer
        ? value.slice(0)
        : ArrayBuffer.isView(value)
          ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
          : new Uint8Array(value).buffer;
      this.rows.set(key, { key, value: bytes, metadata, expires_at, size: bytes.byteLength });
      return { toArray: () => [] };
    }
    if (/SELECT value, expires_at FROM matlock_writer_media WHERE key = \?/i.test(query)) {
      const row = this.rows.get(args[0]);
      return { toArray: () => row ? [{ ...row, value: row.value.slice(0) }] : [] };
    }
    if (/DELETE FROM matlock_writer_media WHERE key = \?/i.test(query)) {
      this.rows.delete(args[0]);
      return { toArray: () => [] };
    }
    throw new Error('Unexpected SQL in test: ' + query);
  }
}

function createStorage() {
  const sql = new MemorySql();
  const instance = new WriterMediaStorage({
    storage: {
      sql,
      async getAlarm() { return null; },
      async setAlarm() {}
    }
  });
  return { sql, instance };
}

function putChunk(sql, key, bytes, expires_at = null) {
  const copy = new Uint8Array(bytes).slice();
  sql.rows.set(key, {
    key,
    value: copy.buffer,
    metadata: '{}',
    expires_at,
    size: copy.byteLength
  });
}

test('Durable Object stream returns a complete bounded binary segment', async () => {
  const { sql, instance } = createStorage();
  putChunk(sql, 'chunks/demo/00000', [1, 2, 3]);
  putChunk(sql, 'chunks/demo/00001', [4, 5]);
  const response = await instance.fetch(new Request(
    'https://writer-media.internal/stream?prefix=chunks%2Fdemo%2F&count=2&start=0'
  ));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(response.headers.get('x-store-size'), '5');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4, 5]);
});

test('Durable Object stream reports the exact missing chunk instead of a broken stream', async () => {
  const { sql, instance } = createStorage();
  putChunk(sql, 'chunks/demo/00000', [1, 2, 3]);
  const response = await instance.fetch(new Request(
    'https://writer-media.internal/stream?prefix=chunks%2Fdemo%2F&count=2&start=0'
  ));

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'Missing or expired staged video chunk 2.'
  });
});

test('Durable Object stream caps each response at eight staging chunks', async () => {
  const { instance } = createStorage();
  const response = await instance.fetch(new Request(
    'https://writer-media.internal/stream?prefix=chunks%2Fdemo%2F&count=9&start=0'
  ));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Invalid staged-media stream parameters/);
});
