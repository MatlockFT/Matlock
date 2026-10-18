import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CHUNK_BYTES,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_CHUNKS,
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
