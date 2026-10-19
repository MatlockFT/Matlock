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
    [chunkKey(scope, uploadId, 0), new Uint8Array([1, 2, 3]).buffer],
    [chunkKey(scope, uploadId, 1), new Uint8Array([4, 5, 6]).buffer]
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
        chunkCount: 2
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
