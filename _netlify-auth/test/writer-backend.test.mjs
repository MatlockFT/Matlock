import test from 'node:test';
import assert from 'node:assert/strict';

import { allowedPath, validateWriteBody } from '../netlify/functions/writer-github.mjs';
import {
  ACTIVE_UPLOAD_TTL_MS,
  COMPLETE_STATUS_TTL_MS,
  isStaleStatus,
  parseStatusKey,
  sanitizeAssetName,
  validateVideoMetadata
} from '../netlify/functions/_writer-media.mjs';

test('Writer GitHub proxy only allows scoped article and upload paths', () => {
  assert.equal(allowedPath('/contents/_posts?ref=main', 'GET'), true);
  assert.equal(allowedPath('/contents/_posts/2026-09-24-test.md?ref=main', 'GET'), true);
  assert.equal(allowedPath('/contents/_posts/2026-09-24-test.md', 'PUT'), true);
  assert.equal(allowedPath('/contents/assets/uploads/example.webp', 'PUT'), true);
  assert.equal(allowedPath('/repos/MatlockFT/Matlock/actions', 'GET'), false);
  assert.equal(allowedPath('/contents/_config.yml', 'PUT'), false);
  assert.equal(allowedPath('/contents/_posts/../../_config.yml', 'PUT'), false);
});

test('Writer write validation rejects branch escapes and oversized articles', () => {
  assert.doesNotThrow(() => validateWriteBody('/contents/_posts/2026-09-24-test.md', {
    branch: 'main',
    message: 'Update test',
    content: 'SGVsbG8='
  }));

  assert.throws(() => validateWriteBody('/contents/_posts/2026-09-24-test.md', {
    branch: 'other',
    message: 'Update test',
    content: 'SGVsbG8='
  }), /main branch/);

  assert.throws(() => validateWriteBody('/contents/_posts/2026-09-24-test.md', {
    branch: 'main',
    message: 'Update test',
    content: 'A'.repeat(3 * 1024 * 1024)
  }), /Article file is too large/);
});

test('Video metadata validation enforces extension, MIME, size and chunk count', () => {
  const valid = validateVideoMetadata({
    assetName: 'Fight Clip.mp4',
    fileSize: 30 * 1024 * 1024,
    fileType: 'video/mp4',
    chunkCount: 9
  });
  assert.equal(valid.assetName, 'Fight-Clip.mp4');
  assert.equal(valid.ext, 'mp4');
  assert.equal(valid.chunkCount, 9);

  assert.throws(() => validateVideoMetadata({
    assetName: 'clip.exe',
    fileSize: 1024,
    fileType: 'video/mp4',
    chunkCount: 1
  }), /MP4, WebM or M4V/);

  assert.throws(() => validateVideoMetadata({
    assetName: 'clip.webm',
    fileSize: 1024,
    fileType: 'video/mp4',
    chunkCount: 1
  }), /MIME type/);

  assert.throws(() => validateVideoMetadata({
    assetName: 'clip.mp4',
    fileSize: 20 * 1024 * 1024,
    fileType: 'video/mp4',
    chunkCount: 1
  }), /chunk count is too small/);
});

test('Media status cleanup parsing and TTLs are deterministic', () => {
  assert.deepEqual(
    parseStatusKey('status/0123456789abcdef01234567/upload_1234567890'),
    { scope: '0123456789abcdef01234567', uploadId: 'upload_1234567890' }
  );
  assert.equal(parseStatusKey('status/not-valid'), null);

  const now = Date.now();
  assert.equal(isStaleStatus({
    state: 'uploading',
    updatedAt: new Date(now - ACTIVE_UPLOAD_TTL_MS - 1).toISOString()
  }, now), true);
  assert.equal(isStaleStatus({
    state: 'complete',
    updatedAt: new Date(now - COMPLETE_STATUS_TTL_MS + 1000).toISOString()
  }, now), false);
});

test('Asset names are reduced to release-safe characters', () => {
  assert.equal(sanitizeAssetName('  weird / fight clip (1).mp4  '), 'weird-fight-clip-1-.mp4');
});
