# Matlock Writer auth and video staging on Cloudflare Free

The Cloudflare Worker remains the Writer's authentication and publishing bridge. GitHub sessions and small auth records stay in the existing Workers KV namespace. Large temporary video uploads use a SQLite-backed Durable Object, then stream into the existing GitHub Releases library. This setup does not use R2 and does not change the live website or authentication URLs.

## Free-plan setup

1. The repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` must be set. The token must allow Worker deployment, Workers KV, Queues, and Durable Objects (including creation of the SQLite class migration). Never commit or paste the token.
2. The existing KV namespace `matlock-writer-sessions` continues to hold authentication and session data. Its ID is configured in `wrangler.toml`.
3. The deployment workflow creates the media queues if missing and Wrangler applies the `WriterMediaStorage` SQLite Durable Object migration. No R2 bucket is created or enabled.
4. Open the workflow summary's Worker URL and verify `/__health` returns JSON with `"ok": true`, `"storage": "kv"`, and `"media_storage": "durable-objects-sqlite"`.
5. The existing GitHub App setup and OAuth flow remain the same. Existing Netlify configuration files are retained for reference, but media staging for the deployed Cloudflare Worker no longer depends on Netlify.

## Upload behavior and Free-plan safeguards

- The Writer still uses drag-and-drop directly into an article. Each video is temporarily staged in SQLite-backed Durable Objects, streamed to a monthly GitHub Release, and cleaned up after the release asset is created.
- The supported upload size remains strictly below 2 GiB, matching GitHub Release asset limits. Staging chunks are 1,800,000 bytes each to stay below Durable Objects' 2 MB maximum SQLite row size.
- Workers Free includes up to 5 GB of SQLite-backed Durable Objects storage across the account, with a 10 GB maximum for a single Durable Object. A single near-2-GiB upload uses roughly 2.15 GB of temporary data plus small metadata. The allowance is shared with any other SQLite-backed Durable Objects on the account, so leave adequate headroom.
- SQLite-backed Durable Objects on Workers Free include daily row-operation allowances. A single upload under 2 GiB uses roughly 1,200 chunk writes, about the same number of chunk reads for validation and streaming, and a batched cleanup. That is well within the documented daily row-write allowance during ordinary use.
- Keep the account on Workers Free. This configuration does not enable a paid Workers plan or R2. If Free-plan limits are exhausted, affected operations can fail; do not upgrade or enable paid storage as an automatic workaround.
- Temporary chunks expire after 24 hours via Durable Object alarms. The existing scheduled cleanup remains a secondary safety net.
- Published video URLs in GitHub Releases are permanent dependencies and must not be deleted casually. The storage migration does not move or delete existing assets.
- Workers KV is still eventually consistent; it is retained for authentication/session records, not the large video payloads.

## Local validation

Run `node --test _cloudflare-auth/test/*.test.mjs` for the compatibility and upload-limit tests. The deploy workflow runs syntax checks, tests, and a Wrangler dry-run bundle check before its authenticated deployment.
