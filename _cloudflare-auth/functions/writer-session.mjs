import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import { deleteWriterSession, getWriterSession } from './_writer-session.mjs';

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
        'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, X-Writer-Session'
      }
    });
  }

  if (!isAllowedOrigin(origin)) {
    return Response.json({ ok: false, error: 'Origin not allowed' }, { status: 403, headers });
  }

  const id = sessionId(request);
  if (request.method === 'DELETE') {
    await deleteWriterSession(id);
    return Response.json({ ok: true }, { status: 200, headers });
  }

  if (request.method !== 'GET') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET, DELETE, OPTIONS' } });
  }

  const session = await getWriterSession(id);
  if (!session) {
    return Response.json({ ok: false, error: 'Session expired' }, { status: 401, headers });
  }

  return Response.json({
    ok: true,
    login: session.login,
    repo: session.repo,
    expiresAt: session.sessionExpiresAt || null
  }, { status: 200, headers });
}

export const config = {
  path: '/api/writer/session'
};
