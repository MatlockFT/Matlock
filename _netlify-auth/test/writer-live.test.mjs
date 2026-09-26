import test from 'node:test';
import assert from 'node:assert/strict';

import { publicLiveRecord, validateLivePayload } from '../netlify/functions/_writer-live.mjs';

test('live writer payload keeps rendered preview and trims title', () => {
  const result = validateLivePayload({
    title: '  UFC live notes  ',
    html: '<p>Round one</p>',
    text: 'Round one'
  });

  assert.equal(result.title, 'UFC live notes');
  assert.equal(result.html, '<p>Round one</p>');
  assert.equal(result.text, 'Round one');
});

test('public live record exposes a stable offline default', () => {
  assert.deepEqual(publicLiveRecord(null), {
    active: false,
    title: 'Live notes',
    html: '',
    text: '',
    author: 'Matlock',
    startedAt: null,
    updatedAt: null,
    endedAt: null,
    version: 0
  });
});

test('public live record preserves active session metadata', () => {
  const result = publicLiveRecord({
    active: true,
    title: 'Fight night',
    html: '<p>Live</p>',
    text: 'Live',
    author: 'MatlockFT',
    startedAt: '2026-09-26T20:00:00.000Z',
    updatedAt: '2026-09-26T20:00:01.000Z',
    endedAt: null,
    version: 7
  });

  assert.equal(result.active, true);
  assert.equal(result.title, 'Fight night');
  assert.equal(result.version, 7);
  assert.equal(result.author, 'MatlockFT');
});
