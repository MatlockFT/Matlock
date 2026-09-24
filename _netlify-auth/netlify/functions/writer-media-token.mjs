import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import { getWriterSession } from './_writer-session.mjs';

function sessionId(request) {
  return request.headers.get('x-writer-session') || '';
}

export default async function handler(request) {
  const origin = normalizeOrigin(request.headers.get('origin'));
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    if (!isAllowedOrigin(origin)) return new Response(null, { status: 403, headers });
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, Content-Type, X-Writer-Session'
      }
    });
  }

  if (!isAllowedOrigin(origin)) {
    return Response.json({ ok: false, error: 'Origin not allowed' }, { status: 403, headers });
  }

  if (request.method !== 'POST') {
    return Response.json(
      { ok: false, error: 'Method not allowed' },
      { status: 405, headers: { ...headers, Allow: 'POST, OPTIONS' } }
    );
  }

  const session = await getWriterSession(sessionId(request));
  if (!session) {
    return Response.json({ ok: false, error: 'Session expired' }, { status: 401, headers });
  }

  return Response.json({
    ok: true,
    token: session.token,
    repo: session.repo,
    expiresAt: session.expiresAt || null
  }, { status: 200, headers });
}

export const config = {
  path: '/api/writer/media-token'
};
