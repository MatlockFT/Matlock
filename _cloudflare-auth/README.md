# Matlock Writer auth on Cloudflare

This Worker replaces the suspended Netlify authentication bridge. It reuses the existing, repository-scoped GitHub authorization and publishing handlers, backs private state and staged upload chunks with Cloudflare R2, and uses Cloudflare Queues for long-running video/audio uploads.

## One-time setup

1. In Cloudflare **Workers & Pages**, enable a `workers.dev` subdomain for the account if one has not been set up already. Cloudflare uses that account subdomain in the Worker URL.\n2. Create a Cloudflare API token scoped to this account. Use the **Edit Cloudflare Workers** template if available, then ensure it includes **Workers Scripts: Edit**, **Workers R2 Storage: Edit**, and **Queues: Edit**. The token must be able to create a Worker and its R2/Queue resources.
3. In GitHub, open **MatlockFT/Matlock → Settings → Secrets and variables → Actions**. Add repository secrets named `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Do not commit the token or paste it into chat.
4. Open the repository's **Actions → Deploy Writer auth to Cloudflare → Run workflow**, type `DEPLOY` into the confirmation field, and start it. The workflow creates the R2 bucket and two queues if missing, then deploys the Worker. The log and workflow summary show the actual `workers.dev` URL for your Cloudflare account.
5. Open `https://<the-worker-url>/__health` and verify it returns JSON with `"ok": true`.
6. Open `https://<the-worker-url>/setup/github-app` and create a *new* private GitHub App for the Worker. The old app configuration lived in Netlify Blobs and cannot be read from this repository. Use only the `MatlockFT/Matlock` repository when installing the app. The Worker stores the returned client credentials in its private R2 bucket.
7. After the Worker and GitHub App are ready, update the site's auth base from `https://mmamatlock-writer-auth.netlify.app` to the new `workers.dev` URL. Update the Writer, Broadcast Control, Live Notes preconnect, post live-writer endpoint, and fight-odds endpoint together. Do not switch these URLs before the Worker health endpoint and GitHub App setup both succeed.

## Storage and limits

- R2 stores OAuth configuration, revocable Writer sessions, Live Writer state, and temporary media chunks. Keys are namespaced by the original store name so auth, sessions, live state, and media cannot collide.
- A Queue consumer processes staged media and publishes the completed asset to a GitHub Release. A scheduled cleanup removes abandoned chunks and stale upload status records.
- Cloudflare's free allowances apply only while usage remains within the current free limits. Monitor Workers, Queues, and R2 usage in the Cloudflare dashboard.

## Local validation

Run `node --test _cloudflare-auth/test/*.test.mjs` for the R2 compatibility layer. The deploy workflow also runs a Wrangler dry-run bundle check before any authenticated deployment.
