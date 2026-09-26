import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import { publicLiveRecord, readLiveRecord } from './_writer-live.mjs';

export default async function handler(request) {
  const origin = normalizeOrigin(request.headers.get('origin'));
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    if (!isAllowedOrigin(origin)) return new Response(null, { status: 403, headers });
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept'
      }
    });
  }

  if (!isAllowedOrigin(origin)) {
    return Response.json({ ok: false, error: 'Origin not allowed' }, { status: 403, headers });
  }

  if (request.method !== 'GET') {
    return Response.json(
      { ok: false, error: 'Method not allowed' },
      { status: 405, headers: { ...headers, Allow: 'GET, OPTIONS' } }
    );
  }

  const record = await readLiveRecord();
  const live = publicLiveRecord(record);
  const responseHeaders = {
    ...headers,
    'Cache-Control': 'no-store, max-age=0',
    'ETag': `W/"live-${live.version}"`
  };

  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === responseHeaders.ETag) {
    return new Response(null, { status: 304, headers: responseHeaders });
  }

  return Response.json({ ok: true, live }, { status: 200, headers: responseHeaders });
}

export const config = {
  path: '/api/live-writer'
};
