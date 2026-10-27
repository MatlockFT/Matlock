const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { build } = require('esbuild');
const { Miniflare, Response } = require('miniflare');

// Execute the real handler, session lookup and KV adapter in workerd. Node
// fetch mocks accept options that Cloudflare rejects before making a request.
test('Worker runtime authorizes, caches and renews uploads without following redirects', async () => {
  const { outputFiles } = await build({
    stdin: {
      contents: `import handler from '../functions/writer-media-session.mjs';
        export default {fetch(request, env) {
          globalThis.__MATLOCK_WRITER_KV = env.WRITER_STORE;
          return handler(request);
        }};`,
      resolveDir: __dirname
    },
    bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['node:*']
  });
  let status = 200;
  const calls = [];
  const mf = new Miniflare({
    modules: true, script: outputFiles[0].text,
    // Pin the runtime contract to the installed Miniflare/workerd release.
    compatibilityDate: '2026-07-30', compatibilityFlags: ['nodejs_compat'],
    cf: false, kvNamespaces: ['WRITER_STORE'],
    outboundService: async request => {
      calls.push(request.url);
      assert.equal(request.url, 'https://mmamatlock-writer-auth.netlify.app/api/writer/media-session');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.get('authorization'), 'Bearer fixture_github_token');
      assert.equal(request.headers.get('origin'), null);
      if (status !== 200) return new Response('untrusted upstream body', { status, headers: { Location: 'https://unexpected.example/' } });
      return Response.json({ ok: true, sessionId: 'mwm_' + 'A'.repeat(48), expiresAt: Date.now() + 3500000 });
    }
  });
  try {
    const id = 'mws_runtime_fixture';
    const kv = await mf.getKVNamespace('WRITER_STORE');
    await kv.put('matlock-store/matlock-writer-sessions/' + createHash('sha256').update(id).digest('hex'), JSON.stringify({
      token: 'fixture_github_token', login: 'MatlockFT', repo: 'MatlockFT/Matlock',
      lastUsedAt: Date.now(), expiresAt: Date.now() + 3600000, sessionExpiresAt: Date.now() + 3600000
    }));
    const exchange = renew => mf.dispatchFetch('https://worker.test/api/writer/media-session', {
      method: 'POST', headers: { Origin: 'https://mmamatlock.com', 'X-Writer-Session': id, 'Content-Type': 'application/json' },
      body: JSON.stringify({ renew })
    });
    for (let i = 0; i < 2; i++) {
      const response = await exchange(false);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.sessionId, 'mwm_' + 'A'.repeat(48));
      assert.doesNotMatch(JSON.stringify(body), /fixture_github_token/);
    }
    assert.equal(calls.length, 1);
    assert.equal((await exchange(true)).status, 200);
    assert.equal(calls.length, 2);
    for (const [upstreamStatus, code] of [[302, 'MEDIA_AUTH_REDIRECT'], [403, 'MEDIA_AUTH_DENIED'], [503, 'MEDIA_SERVICE_RESPONSE']]) {
      status = upstreamStatus;
      const before = calls.length;
      const response = await exchange(true);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, code);
      assert.equal(calls.length, before + 1, 'redirects must not forward credentials');
    }
  } finally {
    await mf.dispose();
  }
});
