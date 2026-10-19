import assert from 'node:assert/strict';
import test from 'node:test';
import { WriterMediaStorage } from '../functions/_writer-media-storage-do.mjs';

class StreamTestSql {
  constructor() {
    this.rows = new Map();
  }

  exec(statement, ...params) {
    if (statement.startsWith('CREATE TABLE') || statement.startsWith('CREATE INDEX')) {
      return { toArray: () => [] };
    }
    if (statement.startsWith('SELECT value, expires_at FROM matlock_writer_media WHERE key = ?')) {
      const row = this.rows.get(params[0]);
      return { toArray: () => row ? [{ value: row.value, expires_at: row.expires_at }] : [] };
    }
    throw new Error('Unexpected SQL in stream test: ' + statement);
  }
}

test('Durable Object staged-media stream can restart from an exact chunk offset', async () => {
  const sql = new StreamTestSql();
  const storage = {
    sql,
    async getAlarm() { return null; },
    async setAlarm() {}
  };
  const media = new WriterMediaStorage({ storage });
  const prefix = 'chunks/test-scope/test-upload/';

  for (let index = 0; index < 5; index += 1) {
    sql.rows.set(prefix + String(index).padStart(5, '0'), {
      value: new Uint8Array([index + 1]),
      expires_at: null
    });
  }

  const response = await media.fetch(new Request(
    'https://writer-media.internal/stream?prefix=' + encodeURIComponent(prefix) + '&count=2&start=1'
  ));
  const bytes = new Uint8Array(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.deepEqual([...bytes], [2, 3]);
});

test('Durable Object staged-media stream rejects chunk ranges beyond the upload limit', async () => {
  const sql = new StreamTestSql();
  const media = new WriterMediaStorage({
    storage: { sql, async getAlarm() { return null; }, async setAlarm() {} }
  });

  const response = await media.fetch(new Request(
    'https://writer-media.internal/stream?prefix=chunks%2Fscope%2Fupload%2F&count=1200&start=1'
  ));

  assert.equal(response.status, 400);
});
