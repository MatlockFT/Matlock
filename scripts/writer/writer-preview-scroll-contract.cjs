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
const shellCss = read('assets/writer-shell.css');
const browserSpec = read('scripts/writer/writer-preview-scroll-contract.spec.cjs');

const start = previewSource.indexOf('function patchPreviewContent(html) {');
const end = previewSource.indexOf('\n  function sourceMediaBlocks', start);
assert.ok(start >= 0 && end > start, 'Could not isolate patchPreviewContent() in _writer/01-preview.js');

const renderer = previewSource.slice(start, end);
assert.doesNotMatch(renderer, /scrollTop|scrollTo\s*\(|scrollIntoView\s*\(/,
  'Preview patching must not programmatically move the scroll position.');
assert.match(renderer, /const identity = previousSignatures\[index\]/,
  'The reconciler must preserve existing nodes using canonical signatures, not their positions.');
assert.match(renderer, /const reserved = new Map\(\)/,
  'Reserve unchanged article blocks before patching edited blocks.');
assert.match(previewSource, /if \(expandedBody !== renderedPreviewBody\)/,
  'Skip DOM and media hydration when article content has not changed.');
assert.match(bootstrapSource, /window\.requestAnimationFrame\(\(\) => \{/,
  'Render text on the next paint instead of waiting for typing to stop.');
assert.doesNotMatch(bootstrapSource, /writerBodyPreviewIdleMs|setTimeout\(updatePreview/,
  'Never reintroduce typing debounce.');
assert.match(previewSource, /function writerPreviewSameTextStructure\(/,
  'Fast typing path must preserve inline formatting.');
assert.match(previewSource, /if \(!textOnly\) \{/,
  'Do not run media hydration on plain-text edits.');
assert.match(previewCss, /overflow-anchor:auto/,
  'Leave native scroll anchoring enabled.');
assert.match(previewCss, /scrollbar-gutter:stable/,
  'Reserve gutter width to avoid layout jumps at the scroll threshold.');
assert.match(shellCss, /\.writer-shell \.writer-workspace\[data-view-mode="split"\] \.writer-preview-pane\s*\{\s*position:relative;\s*top:auto;\s*max-height:none;/,
  'Desktop split preview must override the legacy sticky/max-height rule.');
assert.match(stateSource, /function restoreWriterPosition\(\)/,
  'Keep refresh position restoration available.');
assert.match(browserSpec, /visual anchor drift/,
  'Browser test must measure actual geometry, not just explicit scroll writes.');
assert.match(browserSpec, /immediate preview/,
  'Browser test must catch typing delays or DOM reconstruction.');
console.log('Writer stability contract passed: frame-synchronous text updates, stable DOM and anchored preview.');
