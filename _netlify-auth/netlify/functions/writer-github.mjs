import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import { githubRepoFetch } from './_github-client.mjs';
import { getWriterSession } from './_writer-session.mjs';

function sessionId(request) {
  return request.headers.get('x-writer-session') || '';
}

function normalizeApiPath(value) {
  let path = String(value || '');
  try { path = decodeURIComponent(path); } catch {}
  return path;
}

export function allowedPath(path, method) {
  const value = String(path || '');
  if (method === 'GET') {
    if (value === '') return true;
    if (/^\/contents\/_posts(?:\?ref=main)?$/.test(value)) return true;
    if (/^\/contents\/_posts\/[A-Za-z0-9._~!$&'()+,;=@%\/-]+\.md(?:\?ref=(?:main|[0-9a-f]{40}))?$/.test(value)) return true;
    if (/^\/contents\/assets\/uploads\/[A-Za-z0-9._~!    if (/^\/contents\/assets\/uploads\/[A-Za-z0-9._~!$&'()+,;=@%\/-]+(?:\?ref=main)?$/.test(value)) return true;'()+,;=@%\/-]+(?:\?ref=main)?$/.test(value)) return true;
    if (/^\/contents\/assets\/data\/broadcast-control\.json(?:\?ref=main)?$/.test(value)) return true;
    if (/^\/commits\?path=_posts\/[A-Za-z0-9._~!$&'()+,;=@%\/-]+\.md&per_page=(?:[1-9]|1\d|20)$/.test(value)) return true;
    return false;
  }
  if (method === 'PUT') {
    if (/^\/contents\/_posts\/[A-Za-z0-9._~!$&'()+,;=@%\/-]+\.md$/.test(value)) return true;
    if (/^\/contents\/assets\/uploads\/[A-Za-z0-9._~!    if (/^\/contents\/assets\/uploads\/[A-Za-z0-9._~!$&'()+,;=@%\/-]+$/.test(value)) return true;'()+,;=@%\/-]+$/.test(value)) return true;
    if (value === '/contents/assets/data/broadcast-control.json') return true;
  }
  return false;
}

function contentPathFromApiPath(path) {
  const match = String(path || '').match(/^\/contents\/(.*?)(?:\?.*)?$/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

export function validateWriteBody(apiPath, body) {
  if (!body || typeof body !== 'object') throw new Error('Invalid request body.');
  if (body.branch && body.branch !== 'main') throw new Error('Writer can only update the main branch.');
  if (!body.message || typeof body.message !== 'string' || body.message.length > 180) throw new Error('Invalid commit message.');
  if (!body.content || typeof body.content !== 'string') throw new Error('Missing file content.');
  const bytes = Math.ceil(body.content.length * 0.75);
  const repoPath = contentPathFromApiPath(apiPath);
  const isUpload = repoPath.startsWith('assets/uploads/');
  const limit = isUpload ? 6 * 1024 * 1024 : 2 * 1024 * 1024;
  if (bytes > limit) throw new Error(isUpload ? 'Uploaded image is too large after optimization.' : 'Article file is too large.');
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
    return Response.json({ message: 'Origin not allowed' }, { status: 403, headers });
  }

  const rawApiPath = new URL(request.url).searchParams.get('path') || '';
  const apiPath = normalizeApiPath(rawApiPath);
  if (!allowedPath(apiPath, request.method)) {
    return Response.json({ message: 'Writer is not allowed to access that GitHub resource.' }, { status: 403, headers });
  }

  const session = await getWriterSession(sessionId(request));
  if (!session) {
    return Response.json({ message: 'Writer session expired. Sign in again.' }, { status: 401, headers });
  }

  let bodyText = undefined;
  if (request.method === 'PUT') {
    const body = await request.json().catch(() => null);
    try { validateWriteBody(apiPath, body); } catch (error) {
      return Response.json({ message: error.message }, { status: 400, headers });
    }
    bodyText = JSON.stringify({ ...body, branch: 'main' });
  }

  const response = await githubRepoFetch(session.token, apiPath, {
    method: request.method,
    body: bodyText
  });

  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: {
      ...headers,
      'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8'
    }
  });
}

export const config = {
  path: '/api/writer/github'
};
