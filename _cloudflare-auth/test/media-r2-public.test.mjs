import assert from 'node:assert/strict';
import test from 'node:test';
import { servePublicVideo } from '../worker.mjs';

test('public R2 video endpoint supports byte ranges for seeking', async () => {
  const bytes = new Uint8Array([3, 4, 5, 6]);
  const bucket = {
    async get(key, options) {
      assert.equal(key, 'videos/r2_stream_test_123456/clip.mp4');
      assert.equal(options.range.get('Range'), 'bytes=3-6');
      return {
        size: 10, range: { offset: 3, length: 4 }, httpEtag: '"test-etag"',
        httpMetadata: { contentType: 'video/mp4' },
        writeHttpMetadata(headers) { headers.set('Content-Type', 'video/mp4'); },
        body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } })
      };
    },
    async head() { return null; }
  };
  const req = new Request('https://mmamatlock-writer-auth.fighttalkmma.workers.dev/media/r2_stream_test_123456/clip.mp4', { headers: { Range: 'bytes=3-6' } });
  const res = await servePublicVideo(req, { WRITER_VIDEO_BUCKET: bucket });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('Content-Range'), 'bytes 3-6/10');
  assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
});

test('public R2 video endpoint supports HEAD', async () => {
  const bucket = {
    async head(key) {
      assert.equal(key, 'videos/r2_stream_test_123456/clip.mp4');
      return {
        size: 10, httpEtag: '"test-etag"', httpMetadata: { contentType: 'video/mp4' },
        writeHttpMetadata(headers) { headers.set('Content-Type', 'video/mp4'); }
      };
    },
    async get() { throw new Error('HEAD must not read object data'); }
  };
  const req = new Request('https://mmamatlock-writer-auth.fighttalkmma.workers.dev/media/r2_stream_test_123456/clip.mp4', { method: 'HEAD' });
  const res = await servePublicVideo(req, { WRITER_VIDEO_BUCKET: bucket });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Length'), '10');
  assert.equal(await res.text(), '');
});
