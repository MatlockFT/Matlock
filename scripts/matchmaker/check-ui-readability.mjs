import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('matchmaker.html', 'utf8');
const css = fs.readFileSync('assets/matchmaker-ui-readability.css', 'utf8');
const js = fs.readFileSync('assets/matchmaker-simple.js', 'utf8');

assert(page.includes('/assets/matchmaker-ui-readability.css'), 'Matchmaker must load the readability override after its base styles.');
assert(css.includes('.mm-simple-match-copy strong'), 'Readability styles must explicitly protect opponent names.');
assert(/white-space:\s*normal/.test(css), 'Opponent names must be allowed to wrap.');
assert(/overflow-wrap:\s*break-word/.test(css), 'Long names may break only when a normal word boundary cannot fit.');
assert(!/overflow-wrap:\s*anywhere/.test(css), 'Opponent names must not be split into arbitrary letter chunks.');
assert(!/text-overflow:\s*ellipsis/.test(css), 'Readability overrides must never reintroduce ellipsis-truncated fighter names.');
assert(/\.mm-simple-match-copy\s*\{[^}]*grid-column:\s*3/s.test(css), 'Opponent copy must stay in the flexible third grid column even if a photo fails.');
assert(/\.mm-simple-opponent-slot\s*\{[^}]*grid-column:\s*2/s.test(css), 'Opponent photo space must remain structurally reserved.');
assert(/\.mm-simple-fighter-head\s*>\s*div\s*\{[^}]*grid-column:\s*2/s.test(css), 'Main fighter copy must remain in its text column.');
assert(js.includes('mm-simple-opponent-slot'), 'Opponent photos must render inside a persistent slot.');
assert(js.includes('mm-simple-fighter-slot'), 'Main fighter photos must render inside a persistent slot.');
assert(js.includes('onerror="this.hidden=true"'), 'Broken images must hide in place instead of deleting their grid cell.');
assert(!js.includes("outerHTML=''"), 'Broken images must never remove themselves from the Matchmaker grid.');
assert(css.includes('@media (max-width: 600px)'), 'Long-name handling must include the narrow mobile layout.');

console.log('Matchmaker UI readability: photo failures cannot collapse the text column, and full fighter names remain readable.');
