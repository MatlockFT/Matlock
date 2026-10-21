#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const previewSource = read('_writer/01-preview.js');
const bootstrapSource = read('_writer/06-bootstrap.js');
const stateSource = read('_writer/02-state-library.js');
const previewCss = read('assets/writer-splitflow.css');
const browserSpec = read('scripts/writer/writer-preview-scroll-contract.spec.cjs');

const start = previewSource.indexOf('function patchPreviewContent(html) {');
const end = previewSource.indexOf('\n  function sourceMediaBlocks', start);
assert.ok(start >= 0 && end > start, 'Could not isolate patchPreviewContent() in _writer/01-preview.js');

const renderer = previewSource.slice(start, end);
assert.doesNotMatch(renderer, /scrollTop|scrollTo\s*\(|scrollIntoView\s*\(/,
  'Preview patching must not programmatically move the scroll position.');
assert.match(renderer, /writerPreviewIdentity\(node\)/,
  'The reconciler must preserve actual content nodes, not only their positions.');
assert.match(renderer, /const reserved = new Map\(\)/,
  'Reserve unchanged article blocks before patching edited blocks.');
assert.match(previewSource, /if \(expandedBody !== renderedPreviewBody\)/,
  'Skip DOM and media hydration when article content has not changed.');
assert.match(bootstrapSource, /writerBodyPreviewIdleMs = 650/,
  'Typing should not repaint the preview on every keystroke.');
assert.match(bootstrapSource, /schedulePreview\(el === bodyEditor \? writerBodyPreviewIdleMs : 75\)/,
  'Keep body typing debounced independently of quick metadata updates.');
assert.match(previewCss, /overflow-anchor:auto/,
  'Leave native scroll anchoring enabled.');
assert.match(previewCss, /scrollbar-gutter:stable/,
  'Reserve gutter width to avoid layout jumps at the scroll threshold.');
assert.match(stateSource, /function restoreWriterPosition\(\)/,
  'Keep refresh position restoration available.');
assert.match(browserSpec, /visual anchor drift/,
  'Browser test must measure actual geometry, not just explicit scroll writes.');
assert.match(browserSpec, /typing idle/,
  'Browser test must catch regressions to per-keystroke rendering.');
console.log('Writer stability contract passed: idle rendering, content identity, steady gutter and measured viewport stability.');
