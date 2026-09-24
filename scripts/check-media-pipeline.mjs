import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { articleMediaIdentity, isTrackedVideoPath, responsiveOutputPlan } from './media-paths.mjs';

const failures = [];

function trackedFiles() {
  const raw = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return raw.split('\0').filter(Boolean);
}

function fail(message) {
  failures.push(message);
}

// Pure-path behavior: legacy public output remains untouched, while new article
// sources receive an article-owned generated namespace.
assert.deepEqual(
  responsiveOutputPlan('/assets/uploads/articles/2026/09/example-article/cover.png'),
  {
    mode: 'article',
    relativeDirectory: 'assets/generated/posts/2026/09/example-article',
    publicDirectory: '/assets/generated/posts/2026/09/example-article',
    stem: 'cover',
    identity: {
      year: '2026',
      month: '09',
      slug: 'example-article',
      filename: 'cover.png'
    }
  }
);

const legacy = responsiveOutputPlan('/assets/uploads/Steveson.png');
assert.equal(legacy.mode, 'legacy');
assert.equal(legacy.relativeDirectory, 'assets/generated/posts');
assert.equal(legacy.publicDirectory, '/assets/generated/posts');
assert.equal(legacy.stem, 'uploads-steveson');

const files = trackedFiles();

for (const file of files) {
  if (file.startsWith('assets/') && isTrackedVideoPath(file)) {
    fail(`${file}: video files must stay out of Git history and use the Writer GitHub Release pipeline.`);
  }

  if (file.startsWith('assets/uploads/articles/')) {
    const identity = articleMediaIdentity('/' + file);
    if (!identity) {
      fail(`${file}: article media must follow assets/uploads/articles/YYYY/MM/article-slug/filename.`);
    }
  }

  if (file.startsWith('assets/generated/posts/')) {
    const remainder = file.slice('assets/generated/posts/'.length);
    if (remainder.includes('/')) {
      if (!/^\d{4}\/\d{2}\/[a-z0-9][a-z0-9-]*\/[^/]+\.webp$/i.test(remainder)) {
        fail(`${file}: nested responsive output must follow assets/generated/posts/YYYY/MM/article-slug/file.webp.`);
      }
    }
  }
}

const writer = await fs.readFile('assets/writer.js', 'utf8');
if (!writer.includes("assets/uploads/articles/")) {
  fail('assets/writer.js: new Writer images are not routed to the article upload hierarchy.');
}

const optimizer = await fs.readFile('scripts/optimize-post-images.mjs', 'utf8');
if (!optimizer.includes("responsiveOutputPlan")) {
  fail('scripts/optimize-post-images.mjs: responsive image generation is not using the media path planner.');
}

const mediaBackend = await fs.readFile('_netlify-auth/netlify/functions/writer-media-process-background.mjs', 'utf8');
if (!mediaBackend.includes('writer-media-') || !mediaBackend.includes('/releases')) {
  fail('Writer video backend no longer appears to publish into monthly GitHub Releases.');
}

if (failures.length) {
  console.error('Media pipeline failures:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('Media pipeline OK: source images, generated variants, and videos are separated.');
