import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import { getWriterSession } from './_writer-session.mjs';
import { publicLiveRecord, readLiveRecord, writeLiveRecord } from './_writer-live.mjs';

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
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, Content-Type, X-Writer-Session'
      }
    });
  }

  if (!isAllowedOrigin(origin)) {
    return Response.json({ ok: false, error: 'Origin not allowed' }, { status: 403, headers });
  }

  const session = await getWriterSession(sessionId(request));
  if (!session) {
    return Response.json({ ok: false, error: 'Writer session expired. Sign in again.' }, { status: 401, headers });
  }

  if (request.method === 'GET') {
    const record = await readLiveRecord();
    return Response.json({ ok: true, live: publicLiveRecord(record) }, { status: 200, headers });
  }

  if (request.method === 'PUT') {
    const body = await request.json().catch(() => null);
    try {
      const record = await writeLiveRecord(body, { login: session.login || 'Matlock' });
      return Response.json({ ok: true, live: publicLiveRecord(record) }, { status: 200, headers });
    } catch (error) {
      return Response.json({ ok: false, error: error.message || 'Could not update Live Writer.' }, { status: 400, headers });
    }
  }

  return Response.json(
    { ok: false, error: 'Method not allowed' },
    { status: 405, headers: { ...headers, Allow: 'GET, PUT, OPTIONS' } }
  );
}

export const config = {
  path: '/api/writer/live'
};
