import { REPO_FULL_NAME, corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';

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

  if (request.method !== 'GET') {
    return Response.json({ ok: false, message: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET, OPTIONS' } });
  }

  if (origin && !isAllowedOrigin(origin)) {
    return Response.json({ ok: false, message: 'Origin not allowed' }, { status: 403, headers });
  }

  const configured = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
  return Response.json({
    ok: true,
    configured,
    repo: REPO_FULL_NAME,
    auth: 'github-app-oauth-pkce'
  }, { status: configured ? 200 : 503, headers });
}

export const config = {
  path: '/auth/github/health'
};
