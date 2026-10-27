# Writer video uploads

The article Writer uses Cloudflare for GitHub sign-in, article saving, and authorizing video-upload sessions. Only article video uploads use Netlify. Broadcast Control and existing Cloudflare/R2 video URLs keep their current routes.

## Upload flow

1. A signed-in Writer requests `/api/writer/media-session` on the Cloudflare auth service.
2. Cloudflare sends its current GitHub credential directly to the fixed Netlify service over HTTPS. Netlify independently checks the allowed GitHub owner and write access to `MatlockFT/Matlock`.
3. Netlify issues a one-hour `mwm_` upload-only session. The browser receives this opaque ID; GitHub credentials stay on the servers. A `mwm_` ID cannot authorize the article GitHub proxy.
4. The browser sends 3,500,000-byte parts directly to Netlify Blobs staging. Lost responses are confirmed through the authenticated GET chunk endpoint. Expired upload authorization is renewed without expiring the Cloudflare sign-in or changing the staged upload's scope.
5. A Netlify background function streams staged parts into a GitHub Release asset, checks its size, and returns the public video URL. The video is inserted into the draft; article publication still requires the normal Save/Publish action through Cloudflare.
6. Successful jobs delete staging data. Failed jobs retain parts for a manual retry; scheduled cleanup removes abandoned parts after 24 hours and expired media credentials after a renewal grace period.

No paid plan, auto-recharge, new storage bucket, or PC service is enabled by this change. Netlify's existing monthly allowance still applies. An unavailable upload service stops video uploading and leaves article saving connected.

## Deployment and rollback

Netlify's existing Git integration for `mmamatlock-writer-auth` uses `_netlify-auth` as its base and deploys backend changes automatically. Its content-change check skips commits that only update the main website. `.github/workflows/deploy-writer-auth-once.yml` is a manual CLI fallback requiring `NETLIFY_AUTH_TOKEN`; it is not the normal deployment path.

Cloudflare deploys through the existing `deploy-writer-cloudflare.yml` workflow. The deployment does not provision or require R2: the running Worker had no R2 binding, and article videos now use Netlify. Optional R2 serving code remains available for deployments that explicitly bind an existing bucket; other Cloudflare media keeps the GitHub Release path. The static Writer deploys through GitHub Pages. Confirm all three releases before reporting that the change is live:

- Netlify: GET `/api/writer/media-session` returns `service: netlify-video-uploads`.
- Cloudflare: GET `/__health` includes `article_video_uploads: netlify`; unauthenticated POST `/api/writer/media-session` with the site Origin returns 401.
- Writer: `/write/` has the Netlify `data-media-base` while `data-auth-base` stays Cloudflare, and the generated Writer bundle matches the committed source.

To restore the previous article-video route, remove `data-media-base` from the Writer app in `write.html` and deploy the static site. The default then uses the auth host and the earlier 1,800,000-byte Cloudflare chunks. Do not delete existing media assets or storage resources during rollback. This update creates or deletes no bucket.

## Limits and validation

Files must be smaller than 2 GiB and use MP4, WebM, or M4V. The ceiling is a validation limit, not a guarantee that any size or codec will finish within provider quotas or execution limits. MP4 is recommended. Chunking keeps binary requests below Netlify function payload limits; streaming avoids loading a whole large file into function memory.

Tests include a 200 MiB browser transport case with mocked external services, interrupted-part confirmation, upload-session renewal, and article saving after an upload-service failure. Backend tests exercise the authorization exchange, scope isolation, exact 200 MiB streaming, and incomplete staging. These do not consume a real user's Netlify allowance or publish a real test video.
