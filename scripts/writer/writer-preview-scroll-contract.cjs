#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const previewSource = read('_writer/01-preview.js');
const stateSource = read('_writer/02-state-library.js');
const previewCss = read('assets/writer-splitflow.css');
const browserSpec = read('scripts/writer/writer-preview-scroll-contract.spec.cjs');

const start = previewSource.indexOf('function patchPreviewContent(html) {');
const end = previewSource.indexOf('\n  function sourceMediaBlocks', start);
assert.ok(start >= 0 && end > start, 'Could not isolate patchPreviewContent() in _writer/01-preview.js');

const renderer = previewSource.slice(start, end);
assert.doesNotMatch(
  renderer,
  /scrollTop|scrollTo\s*\(|scrollIntoView\s*\(/,
  'Live preview rendering must not programmatically scroll the preview. Position restoration belongs to the explicit restore flow, not each render.'
);

assert.match(
  previewCss,
  /\.writer-splitflow \.writer-preview-pane,[\s\S]*?overflow-anchor:auto/,
  'The split preview must use native browser scroll anchoring.'
);
assert.doesNotMatch(
  previewCss,
  /\.writer-splitflow \.writer-preview-pane,[\s\S]*?overflow-anchor:none/,
  'Do not disable browser anchoring for the live preview.'
);

assert.match(stateSource, /function restoreWriterPosition\(\)/, 'Refresh position restoration must remain available.');
assert.match(browserSpec, /__writerPreviewScrollAssignments/, 'The deployed browser test must spy on explicit preview scrollTop writes.');
assert.match(browserSpec, /per-keystroke/, 'The deployed browser test must cover repeated typing.');

console.log('Writer preview scroll contract passed: no renderer-driven scroll writes, native anchoring enabled, position restoration retained.');
