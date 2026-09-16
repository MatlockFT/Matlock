import {
  COOKIE_NAME,
  REPO_ID,
  callbackUrl,
  decodeSession,
  getAppConfig,
  isAllowedOrigin,
  parseCookies,
  popupResponse,
  securityHeaders,
  stateSecret,
  verifyGitHubToken
} from './_github-auth.mjs';
import { createWriterSession } from './_writer-session.mjs';

export default async function handler(request) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: securityHeaders({ Allow: 'GET' }) });
  }

  const appConfig = await getAppConfig();
  if (!appConfig?.clientId || !appConfig?.clientSecret) {
    return popupResponse({
      origin: 'https://mmamatlock.com',
      payload: { ok: false, error: 'The Writer GitHub App has not been configured yet.' },
      status: 503
    });
  }

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code') || '';
  const returnedState = requestUrl.searchParams.get('state') || '';
  const githubError = requestUrl.searchParams.get('error') || '';
  const cookies = parseCookies(request);
  const session = decodeSession(cookies[COOKIE_NAME] || '', stateSecret(appConfig));

  if (!session || !isAllowedOrigin(session.origin)) {
    return popupResponse({
      origin: session?.origin || 'https://mmamatlock.com',
      payload: { ok: false, error: 'The GitHub sign-in session expired or could not be verified.' },
      status: 400
    });
  }

  if (Date.now() - Number(session.createdAt || 0) > 10 * 60 * 1000) {
    return popupResponse({
      origin: session.origin,
      payload: { ok: false, error: 'The GitHub sign-in session expired. Please try again.' },
      status: 400
    });
  }

  if (githubError) {
    return popupResponse({
      origin: session.origin,
      payload: { ok: false, error: `GitHub authorization was not completed: ${githubError}.` },
      status: 400
    });
  }

  if (!code || !returnedState || returnedState !== session.state) {
    return popupResponse({
      origin: session.origin,
      payload: { ok: false, error: 'GitHub returned an invalid authorization response.' },
      status: 400
    });
  }

  try {
    const redirectUri = callbackUrl(request);
    if (redirectUri !== session.redirectUri) throw new Error('OAuth callback URL changed during sign-in.');

    const form = new URLSearchParams({
      client_id: appConfig.clientId,
      client_secret: appConfig.clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: session.verifier,
      repository_id: String(session.repositoryId || REPO_ID)
    });

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'MMA-Matlock-Writer-Auth'
      },
      body: form,
      cache: 'no-store'
    });

    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'GitHub did not issue an access token.');
    }

    const verified = await verifyGitHubToken(tokenData.access_token);
    const writerSessionId = await createWriterSession({
      token: tokenData.access_token,
      login: verified.login,
      repo: verified.repo,
      expiresIn: tokenData.expires_in || null,
      refreshToken: tokenData.refresh_token || '',
      refreshTokenExpiresIn: tokenData.refresh_token_expires_in || null
    });

    return popupResponse({
      origin: session.origin,
      payload: {
        ok: true,
        sessionId: writerSessionId,
        login: verified.login,
        repo: verified.repo
      }
    });
  } catch (error) {
    return popupResponse({
      origin: session.origin,
      payload: { ok: false, error: error?.message || 'GitHub sign-in failed.' },
      status: 400
    });
  }
}

export const config = {
  path: '/auth/github/callback'
};
