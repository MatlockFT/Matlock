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
  const requestedPath = new URL(request.url).searchParams.get('path') || '';

  const responseHeaders = {
    ...headers,
    'Cache-Control': 'no-store, max-age=0, must-revalidate',
    'ETag': `W/"live-${live.version}"`
  };

  if (requestedPath && live.publicPath && requestedPath !== live.publicPath) {
    return Response.json({
      ok: true,
      live: {
        active: false,
        hold: false,
        sourcePath: '',
        publicPath: requestedPath,
        title: '',
        description: '',
        html: '',
        text: '',
        author: 'Matlock',
        startedAt: null,
        updatedAt: null,
        endedAt: null,
        publishedAt: null,
        version: live.version
      }
    }, { status: 200, headers: responseHeaders });
  }

  return Response.json({ ok: true, live }, { status: 200, headers: responseHeaders });
}

export const config = {
  path: '/api/live-writer'
};
