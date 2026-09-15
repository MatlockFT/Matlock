import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('matchmaker.html', 'utf8');
const css = fs.readFileSync('assets/matchmaker-ui-readability.css', 'utf8');

assert(page.includes('/assets/matchmaker-ui-readability.css'), 'Matchmaker must load the readability override after its base styles.');
assert(css.includes('.mm-simple-match-copy strong'), 'Readability styles must explicitly protect opponent names.');
assert(/white-space:\s*normal/.test(css), 'Opponent names must be allowed to wrap.');
assert(/overflow-wrap:\s*anywhere/.test(css), 'Very long fighter names must remain visible instead of overflowing the card.');
assert(!/text-overflow:\s*ellipsis/.test(css), 'Readability overrides must never reintroduce ellipsis-truncated fighter names.');
assert(css.includes('@media (max-width: 600px)'), 'Long-name handling must include the narrow mobile layout.');

console.log('Matchmaker UI readability: full fighter names remain visible.');
