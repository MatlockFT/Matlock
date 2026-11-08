import assert from 'node:assert/strict';
import test from 'node:test';
import mediaGateway, { config } from '../netlify/edge-functions/media-releases.js';

const filename = 'ufc-vegas-124-live-results-scoring-video-20261107-220233-668.mp4';
const url = `https://mmamatlock-writer-auth.netlify.app/media/releases/writer-media-2026-11/${filename}`;

test('streaming gateway is bound to the narrow releases path', () => {
  assert.equal(config.path, '/media/releases/*');
});

test('preserves mobile Safari byte-range responses as inline video', async () => {
  const previous = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async (target, options) => {
    fetched += 1;
    assert.equal(target, `https://github.com/MatlockFT/Matlock/releases/download/writer-media-2026-11/${filename}`);
    assert.equal(options.headers.get('Range'), 'bytes=0-3');
    return new Response(new Uint8Array([0, 0, 0, 24]), {
      status: 206,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Range': 'bytes 0-3/10000',
        'Content-Length': '4'
      }
    });
  };
  try {
    const response = await mediaGateway(new Request(url, { headers: { Range: 'bytes=0-3' } }));
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Type'), 'video/mp4');
    assert.equal(response.headers.get('Content-Range'), 'bytes 0-3/10000');
    assert.equal(response.headers.get('Content-Disposition'), 'inline');
    assert.equal(response.headers.get('Content-Length'), '4');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 0, 0, 24]);
    assert.equal(fetched, 1);
  } finally {
    globalThis.fetch = previous;
  }
});

test('rejects unknown release paths and unsafe ranges without fetching', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('must not fetch'); };
  try {
    const badPath = await mediaGateway(new Request('https://mmamatlock-writer-auth.netlify.app/media/releases/writer-media-2026-11/not-a-video.exe'));
    assert.equal(badPath.status, 404);
    const badRange = await mediaGateway(new Request(url, { headers: { Range: 'bytes=0-1,3-4' } }));
    assert.equal(badRange.status, 416);
  } finally {
    globalThis.fetch = previous;
  }
});

test('rejects upstream responses that ignore Safari range requests', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response('not partial', { status: 200, headers: { 'Content-Type': 'video/mp4' } });
  try {
    const response = await mediaGateway(new Request(url, { headers: { Range: 'bytes=0-1' } }));
    assert.equal(response.status, 502);
  } finally {
    globalThis.fetch = previous;
  }
});
