import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const applyOnly = args.has('--apply-only');
const currentWindow = args.has('--current-window');
const skipTapologyFetch = args.has('--skip-tapology-fetch');
const refresh = args.has('--refresh');

function run(label, script, extra = []) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(process.execPath, [script, ...extra], {
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
}

run('Restore verified event posters from canonical registry', 'scripts/history/sync-on-this-day-poster-registry.mjs', ['--restore']);

if (!applyOnly) {
  if (currentWindow) {
    run('Resolve current-window Tapology posters', 'scripts/history/resolve-current-on-this-day-tapology-posters.mjs');
  } else if (skipTapologyFetch) {
    run('Restore Tapology provenance without network discovery', 'scripts/history/resolve-on-this-day-tapology-posters.mjs', ['--apply-only']);
  } else {
    run('Resolve exact Tapology event posters', 'scripts/history/resolve-on-this-day-tapology-posters.mjs', refresh ? ['--refresh'] : []);
  }

  run('Reject mismatched or legacy-unbound Tapology posters', 'scripts/history/sanitize-on-this-day-tapology-posters.mjs');
  run('Recover exact Wikipedia/Wikimedia event posters', 'scripts/history/resolve-on-this-day-event-posters.mjs');
  run('Recover official Pancrase poster/key art', 'scripts/history/enrich-on-this-day-pancrase-images.mjs');
  run('Apply official and manually verified event overrides', 'scripts/history/apply-on-this-day-image-source-overrides.mjs', ['--events-only']);
  run('Apply deterministic poster fallbacks', 'scripts/history/apply-on-this-day-current-poster-fallbacks.mjs');
}

run('Finalize event image provenance', 'scripts/history/finalize-on-this-day-image-metadata.mjs');
run('Capture verified poster assignments in canonical registry', 'scripts/history/sync-on-this-day-poster-registry.mjs', ['--capture']);
run('Prune stale poster registry records', 'scripts/history/prune-on-this-day-poster-registry.mjs');
run('Validate canonical poster registry', 'scripts/history/check-on-this-day-poster-registry.mjs');

console.log('\nEvent-poster pipeline complete: registry/cache → Tapology → Wikipedia/Wikimedia → official/archive/manual fallback → generated UI fallback.');
