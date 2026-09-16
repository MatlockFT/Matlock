import {
  REPO_ID,
  callbackUrl,
  encodeSession,
  isAllowedOrigin,
  pkceChallenge,
  randomToken,
  securityHeaders,
  sessionCookie
} from './_github-auth.mjs';

export default async function handler(request) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: securityHeaders({ Allow: 'GET' }) });
  }

  const url = new URL(request.url);
  const writerOrigin = url.searchParams.get('origin') || '';
  if (!isAllowedOrigin(writerOrigin)) {
    return new Response('Writer origin is not allowed.', { status: 403, headers: securityHeaders() });
  }

  const clientId = process.env.GITHUB_CLIENT_ID || '';
  if (!clientId) {
    return new Response('GitHub App client ID is not configured.', { status: 503, headers: securityHeaders() });
  }

  const state = randomToken(32);
  const verifier = randomToken(48);
  const redirectUri = callbackUrl(request);
  const session = encodeSession({
    state,
    verifier,
    origin: new URL(writerOrigin).origin,
    redirectUri,
    repositoryId: REPO_ID,
    createdAt: Date.now()
  });

  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', pkceChallenge(verifier));
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('prompt', 'select_account');

  return new Response(null, {
    status: 302,
    headers: securityHeaders({
      Location: authorize.toString(),
      'Set-Cookie': sessionCookie(session)
    })
  });
}

export const config = {
  path: '/auth/github/start'
};
