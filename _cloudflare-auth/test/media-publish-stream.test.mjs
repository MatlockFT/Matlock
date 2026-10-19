import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadAssetOnce } from '../functions/writer-media-process-background.mjs';
import { chunkKey } from '../functions/_writer-media.mjs';

// Simulate the production-only failure mode: the source bytes are delivered,
// but the local writable reports a close error after the final byte. The
// upstream HTTP client can still receive and confirm the complete asset.
class CloseErrorAfterFinalByteStream {
  constructor(expectedBytes) {
    const transform = new TransformStream();
    this.readable = transform.readable;
    const innerWriter = transform.writable.getWriter();
    let written = 0;

    this.writable = new WritableStream({
      async write(chunk) {
        await innerWriter.write(chunk);
        written += chunk.byteLength;
        if (written === expectedBytes) {
          await innerWriter.close();
          throw new Error('Network connection lost.');
        }
        if (written > expectedBytes) {
          throw new Error('Attempted to write more than the declared length.');
        }
      },
      async close() {
        await innerWriter.close();
      },
      async abort(reason) {
        await innerWriter.abort(reason).catch(() => {});
      }
    });
  }
}

test('a complete GitHub Release response wins over a local stream-close error', async () => {
  const previousFetch = globalThis.fetch;
  const previousFixedLengthStream = globalThis.FixedLengthStream;
  globalThis.FixedLengthStream = CloseErrorAfterFinalByteStream;

  const scope = '0123456789abcdef01234567';
  const uploadId = 'stream_regression_123456';
  const chunks = new Map([
    [chunkKey(scope, uploadId, 0), new Uint8Array([1, 2, 3, 4, 5, 6]).buffer]
  ]);
  const assetUrl = 'https://github.com/MatlockFT/Matlock/releases/download/writer-media-test/regression.mp4';

  globalThis.fetch = async (url, options = {}) => {
    assert.match(String(url), /^https:\/\/uploads\.github\.com\//);
    const reader = options.body.getReader();
    let totalBytes = 0;
    while (totalBytes < 6) {
      const { done, value } = await reader.read();
      assert.equal(done, false, 'body ended before declared Content-Length');
      totalBytes += value.byteLength;
    }
    assert.equal(totalBytes, 6);
    return new Response(JSON.stringify({
      id: 123,
      name: 'regression.mp4',
      size: totalBytes,
      state: 'uploaded',
      browser_download_url: assetUrl
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const result = await uploadAssetOnce(
      'test-token',
      {
        id: 456,
        upload_url: 'https://uploads.github.com/repos/MatlockFT/Matlock/releases/456/assets{?name,label}'
      },
      {
        async get(key) {
          const value = chunks.get(key);
          return value ? value.slice(0) : null;
        }
      },
      scope,
      uploadId,
      {
        assetName: 'regression.mp4',
        fileType: 'video/mp4',
        fileSize: 6,
        chunkCount: 1
      }
    );

    assert.equal(result.browser_download_url, assetUrl);
    assert.equal(result.size, 6);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousFixedLengthStream === undefined) delete globalThis.FixedLengthStream;
    else globalThis.FixedLengthStream = previousFixedLengthStream;
  }
});


test('R2 multipart uploader completes from staged chunks and returns a playable URL', async () => {
  const { uploadAssetToR2 } = await import('../functions/writer-media-process-background.mjs');
  const scope = '0123456789abcdef01234567';
  const uploadId = 'r2_stream_test_123456';
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6]);
  const uploadedParts = [];
  let aborted = false;
  let completed = false;
  const bucket = {
    async head() { return null; },
    async createMultipartUpload(key, options) {
      assert.equal(key, `videos/${uploadId}/clip.mp4`);
      assert.equal(options.httpMetadata.contentType, 'video/mp4');
      return {
        async uploadPart(partNumber, bytes) {
          const array = new Uint8Array(bytes);
          uploadedParts.push({ partNumber, bytes: array });
          return { partNumber, etag: `etag-${partNumber}` };
        },
        async complete(parts) {
          assert.equal(parts.length, 1);
          completed = true;
          return { size: uploadedParts.reduce((total, part) => total + part.bytes.byteLength, 0) };
        },
        async abort() { aborted = true; }
      };
    },
    async delete() {}
  };
  const store = {
    async streamChunks(_scope, _uploadId, count, startIndex) {
      assert.equal(count, 1);
      assert.equal(startIndex, 0);
      return new ReadableStream({ start(controller) { controller.enqueue(payload); controller.close(); } });
    }
  };
  const result = await uploadAssetToR2(
    bucket, store, scope, uploadId,
    { assetName: 'clip.mp4', fileType: 'video/mp4', fileSize: payload.byteLength, chunkCount: 1 },
    'https://mmamatlock-writer-auth.fighttalkmma.workers.dev'
  );
  assert.equal(completed, true);
  assert.equal(aborted, false);
  assert.equal(result.size, payload.byteLength);
  assert.equal(result.storage, 'cloudflare-r2');
  assert.equal(result.browser_download_url, `https://mmamatlock-writer-auth.fighttalkmma.workers.dev/media/${uploadId}/clip.mp4`);
});
