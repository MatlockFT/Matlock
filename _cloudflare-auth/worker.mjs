import { isAllowedOrigin, normalizeOrigin } from './functions/_github-auth.mjs';
import githubAppManifestCallback from './functions/github-app-manifest-callback.mjs';
import githubAppManifestStart from './functions/github-app-manifest-start.mjs';
import githubAuthCallback from './functions/github-auth-callback.mjs';
import githubAuthHealth from './functions/github-auth-health.mjs';
import githubAuthStart from './functions/github-auth-start.mjs';
import liveWriterPublic from './functions/live-writer.mjs';
import writerArticleMediaLibrary from './functions/writer-article-media-library.mjs';
import writerFighter from './functions/writer-fighter.mjs';
import writerGitHub from './functions/writer-github.mjs';
import writerLive from './functions/writer-live.mjs';
import writerMediaChunk from './functions/writer-media-chunk.mjs';
import writerMediaAbort from './functions/writer-media-abort.mjs';
import writerMediaFinalize from './functions/writer-media-finalize.mjs';
import writerMediaLibrary from './functions/writer-media-library.mjs';
import writerMediaStatus from './functions/writer-media-status.mjs';
import writerSession from './functions/writer-session.mjs';
import fightOdds from './functions/fight-odds.mjs';
import mediaProcess from './functions/writer-media-process-background.mjs';
import mediaCleanup from './functions/writer-media-cleanup.mjs';
import { WriterMediaStorage } from './functions/_writer-media-storage-do.mjs';
import { getWriterSession } from './functions/_writer-session.mjs';
import {
  mediaStore,
  setStatus,
  statusKey,
  uploadScope,
  validUploadId,
  validateMediaMetadata
} from './functions/_writer-media.mjs';

const KV_GLOBAL = '__MATLOCK_WRITER_KV';
const MEDIA_STORAGE_GLOBAL = '__MATLOCK_WRITER_MEDIA_STORAGE';

const routeHandlers = new Map([
  ['/setup/github-app', githubAppManifestStart],
  ['/setup/github-app/callback', githubAppManifestCallback],
  ['/auth/github/health', githubAuthHealth],
  ['/auth/github/start', githubAuthStart],
  ['/auth/github/callback', githubAuthCallback],
  ['/api/live-writer', liveWriterPublic],
  ['/api/writer/article-media-library', writerArticleMediaLibrary],
  ['/api/writer/fighter', writerFighter],
  ['/api/writer/github', writerGitHub],
  ['/api/writer/live', writerLive],
  ['/api/writer/media-chunk', writerMediaChunk],
  ['/api/writer/media-abort', writerMediaAbort],
  ['/api/writer/media-finalize', writerMediaFinalize],
  ['/api/writer/media-library', writerMediaLibrary],
  ['/api/writer/media-status', writerMediaStatus],
  ['/api/writer/session', writerSession],
  ['/api/fight-odds', fightOdds]
]);

function activateStorage(env) {
  if (!env?.WRITER_STORE) throw new Error('The WRITER_STORE KV binding is missing.');
  if (!env?.WRITER_MEDIA_STORAGE) throw new Error('The WRITER_MEDIA_STORAGE Durable Object binding is missing.');
  // Keep sessions/authentication in KV; stage large media in SQLite-backed Durable Objects.
  globalThis[KV_GLOBAL] = env.WRITER_STORE;
  globalThis[MEDIA_STORAGE_GLOBAL] = env.WRITER_MEDIA_STORAGE;
}

function safeResponse(response) {
  if (!(response instanceof Response)) return new Response(null, { status: 204 });
  const headers = new Headers(response.headers);
  if (!headers.has('X-Content-Type-Options')) headers.set('X-Content-Type-Options', 'nosniff');
  if (!headers.has('Referrer-Policy')) headers.set('Referrer-Policy', 'no-referrer');
  if (!headers.has('X-Frame-Options')) headers.set('X-Frame-Options', 'DENY');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function jsonError(error, status = 500, request = null) {
  const origin = normalizeOrigin(request?.headers.get('origin'));
  const cors = isAllowedOrigin(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' }
    : {};
  return Response.json(
    { ok: false, error: String(error?.message || error || 'Cloudflare Writer service error.') },
    {
      status,
      headers: {
        ...cors,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      }
    }
  );
}

function serviceIndex() {
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Matlock Writer Auth</title><style>body{margin:0;background:#080808;color:#eee;font:16px/1.5 system-ui;min-height:100vh;display:grid;place-items:center}.card{max-width:38rem;padding:2rem;border:1px solid #333;background:#111;border-radius:12px}a{color:#eee}p{color:#aaa}</style><main class="card"><h1>Matlock Writer Auth</h1><p>Authentication and publishing service is online.</p><p><a href="/auth/github/health">Check sign-in status</a></p></main></html>',
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
      }
    }
  );
}

async function enqueueMediaProcess(request, env) {
  const sessionId = request.headers.get('x-writer-session') || '';
  const session = await getWriterSession(sessionId);
  if (!session) return jsonError('Writer session expired. Sign in again.', 401, request);
  if (!env.WRITER_MEDIA_QUEUE) return jsonError('Media processing queue is not configured.', 503, request);

  const body = await request.json().catch(() => null);
  const uploadId = validUploadId(body?.uploadId);
  if (!uploadId) return jsonError('Invalid upload ID.', 400, request);

  let meta;
  try {
    meta = validateMediaMetadata({
      assetName: body?.assetName,
      fileSize: body?.fileSize,
      fileType: body?.fileType,
      chunkCount: body?.chunkCount
    });
  } catch (error) {
    return jsonError(error, 400, request);
  }

  try {
    const scope = uploadScope(sessionId);
    const store = mediaStore();
    const current = await store.get(statusKey(scope, uploadId), { type: 'json' });
    if (current?.state === 'complete' && current?.url) {
      return Response.json({ ok: true, uploadId, state: 'complete', url: current.url }, { status: 200 });
    }

    await setStatus(store, scope, uploadId, {
      state: 'queued',
      chunkCount: meta.chunkCount,
      fileSize: meta.fileSize,
      fileType: meta.fileType,
      assetName: meta.assetName
    });

    await env.WRITER_MEDIA_QUEUE.send({
      sessionId,
      body: { uploadId, ...meta }
    });
    return Response.json({ ok: true, uploadId, state: 'queued' }, { status: 202 });
  } catch (error) {
    return jsonError(error, 502, request);
  }
}

async function consumeMediaQueue(batch, env) {
  activateStorage(env);
  for (const message of batch.messages) {
    const job = message.body || {};
    try {
      const session = await getWriterSession(job.sessionId || '');
      const uploadId = validUploadId(job.body?.uploadId);
      if (!session || !uploadId) {
        if (job.sessionId && uploadId) {
          await setStatus(
            mediaStore(),
            uploadScope(job.sessionId),
            uploadId,
            { state: 'error', error: 'Writer session expired before media processing could start.' }
          );
        }
        message.ack();
        continue;
      }

      const request = new Request('https://queue.internal/api/writer/media-process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Writer-Session': job.sessionId
        },
        body: JSON.stringify(job.body || {})
      });
      const response = await mediaProcess(request);
      if (response instanceof Response && response.status >= 500) {
        message.retry();
      } else {
        message.ack();
      }
    } catch (error) {
      console.error('Writer media queue item failed:', error?.message || error);
      message.retry();
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      activateStorage(env);
      const url = new URL(request.url);
      if (url.pathname === '/') return serviceIndex();
      if (url.pathname === '/__health') {
        return Response.json({ ok: true, service: 'matlock-writer-auth', storage: 'kv', media_storage: 'durable-objects-sqlite', queue: Boolean(env.WRITER_MEDIA_QUEUE) }, {
          headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
        });
      }
      if (url.pathname === '/api/writer/media-process') {
        return safeResponse(await enqueueMediaProcess(request, env));
      }

      const handler = routeHandlers.get(url.pathname);
      if (!handler) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

      return safeResponse(await handler(request, env));
    } catch (error) {
      console.error('Matlock Writer Worker request failed:', error?.message || error);
      return jsonError(error, 500, request);
    }
  },

  async queue(batch, env, ctx) {
    try {
      await consumeMediaQueue(batch, env);
    } catch (error) {
      console.error('Matlock Writer media queue failed:', error?.message || error);
      for (const message of batch.messages) message.retry();
    }
  },

  scheduled(controller, env, ctx) {
    try {
      activateStorage(env);
      ctx.waitUntil(mediaCleanup().catch(error => {
        console.error('Matlock Writer media cleanup failed:', error?.message || error);
      }));
    } catch (error) {
      console.error('Matlock Writer media cleanup could not start:', error?.message || error);
    }
  }
};


export { WriterMediaStorage };
