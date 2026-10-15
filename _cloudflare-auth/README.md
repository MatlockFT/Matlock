# Matlock Writer auth on Cloudflare Free

This Worker migrates the Writer authentication and publishing bridge away from Netlify without enabling R2, adding a paid Cloudflare subscription, or changing the live site's URLs. It uses the existing Workers KV namespace and Cloudflare Queues on the Workers Free plan.

## Free-plan setup

1. The repository secret `CLOUDFLARE_API_TOKEN` must authorize Workers Scripts, Workers KV and Queues on this account. The repository secret `CLOUDFLARE_ACCOUNT_ID` identifies the account. Never commit or paste the token.
2. The Worker uses the existing KV namespace `matlock-writer-sessions`. Its namespace ID is configured in `wrangler.toml`.
3. The deployment workflow creates the media queues if missing and deploys the Worker. It does not create an R2 bucket or activate an R2 subscription.
4. Open the workflow summary's Worker URL and verify `/__health` returns JSON with `"ok": true` and `"storage":"kv"`.
5. Open `/setup/github-app` on that Worker and create a new private GitHub App for Writer. The prior GitHub App configuration existed in Netlify Blobs and cannot be imported from repository code. Install it only for `MatlockFT/Matlock`.
6. Do not switch the live site's auth, broadcast, or media endpoint URLs until Worker health, GitHub App setup, OAuth sign-in and article save/delete tests have passed.

## Free-plan safeguards and trade-offs

- The Workers KV Free plan includes up to 1 GB stored data, 100,000 reads/day, and 1,000 writes, deletes and list requests/day. Exceeding a Free-plan KV allowance causes further operations to fail; it does not convert those operations into paid overages. See [Cloudflare KV pricing](https://developers.cloudflare.com/kv/platform/pricing/).
- Workers Queues is included on the Workers Free plan up to its daily allowance. Keep the account on Workers Free; do not upgrade to Workers Paid or enable R2. If free limits are reached, an affected operation should fail rather than incur usage-based billing.
- Staged media chunks expire after 24 hours and the upload API caps an individual staged file at 512 MiB. This cap is necessary because KV storage is limited to 1 GB on the Free plan. The migration does not provide R2-sized staging for uploads up to 2 GB.
- KV is eventually consistent, unlike R2. Validate sign-in and article write/delete flows before changing the live site's endpoint. If KV's consistency or quota limits prove unsuitable, stop rather than enabling a paid storage service.
- Existing Netlify deployment and live-site URLs remain unchanged until a deliberate cutover.

## Local validation

Run `node --test _cloudflare-auth/test/*.test.mjs` for the KV compatibility layer. The deploy workflow runs syntax checks, tests and a Wrangler dry-run bundle check before its authenticated deployment.
