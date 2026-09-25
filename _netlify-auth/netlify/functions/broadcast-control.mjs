import { getStore } from '@netlify/blobs';
import { corsHeaders, isAllowedOrigin, normalizeOrigin } from './_github-auth.mjs';
import { getWriterSession } from './_writer-session.mjs';

const STORE_NAME = 'matlock-broadcast-control';
const STORE_KEY = 'live';
const MAX_BYTES = 64 * 1024;

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

function validNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid broadcast control payload.');
  if (Number(config.version) !== 1) throw new Error('Unsupported broadcast control version.');
  const rundown = Array.isArray(config.rundown) ? config.rundown : [];
  if (!rundown.length || rundown.length > 30 || rundown.some(item => !['news','video','event'].includes(item))) {
    throw new Error('Invalid rundown.');
  }
  if (!validNumber(config?.timing?.newsSeconds, 5, 300)) throw new Error('Invalid news duration.');
  if (!validNumber(config?.timing?.eventSeconds, 5, 300)) throw new Error('Invalid event duration.');
  if (!validNumber(config?.timing?.transitionMs, 0, 5000)) throw new Error('Invalid transition duration.');
  if (!validNumber(config?.video?.volume, 0, 100)) throw new Error('Invalid video volume.');
  if (!validNumber(config?.audio?.musicVolume, 0, 100)) throw new Error('Invalid music volume.');
  if (!validNumber(config?.audio?.duckVolume, 0, 100)) throw new Error('Invalid ducked music volume.');
  const customNews = config?.sources?.customNewsFeeds || [];
  const customVideo = config?.sources?.customVideoChannels || [];
  if (!Array.isArray(customNews) || customNews.length > 20) throw new Error('Too many custom news feeds.');
  if (!Array.isArray(customVideo) || customVideo.length > 20) throw new Error('Too many custom video channels.');
  for (const source of customNews) {
    const name = String(source?.name || '').trim();
    let url = null;
    try { url = new URL(String(source?.feedUrl || '')); } catch {}
    if (!name || name.length > 80 || !url || url.protocol !== 'https:') throw new Error('Invalid custom news feed.');
  }
  for (const channel of customVideo) {
    const name = String(channel?.name || '').trim();
    const handle = String(channel?.handle || '').trim();
    if (!name || name.length > 80 || !/^@[A-Za-z0-9._-]+$/.test(handle)) throw new Error('Invalid custom YouTube channel.');
  }
}

function json(data, status, headers) {
  return Response.json(data, {
    status,
    headers: { ...headers, 'Cache-Control': 'no-store, max-age=0' }
  });
}

export default async function handler(request) {
  const origin = normalizeOrigin(request.headers.get('origin'));
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    if (origin && !isAllowedOrigin(origin)) return new Response(null, { status: 403, headers });
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Accept, Content-Type, X-Writer-Session'
      }
    });
  }

  if (request.method === 'GET') {
    if (origin && !isAllowedOrigin(origin)) return json({ message: 'Origin not allowed' }, 403, headers);
    const current = await store().get(STORE_KEY, { type: 'json', consistency: 'strong' }).catch(() => null);
    if (!current) return json({ message: 'No live broadcast control has been saved yet.' }, 404, headers);
    return json(current, 200, headers);
  }

  if (request.method !== 'PUT') return json({ message: 'Method not allowed' }, 405, headers);
  if (!isAllowedOrigin(origin)) return json({ message: 'Origin not allowed' }, 403, headers);

  const sessionId = request.headers.get('x-writer-session') || '';
  const session = await getWriterSession(sessionId);
  if (!session) return json({ message: 'Broadcast control session expired. Sign in again.' }, 401, headers);

  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return json({ message: 'Broadcast control payload is too large.' }, 413, headers);

  let config = null;
  try { config = JSON.parse(text); } catch {}
  try { validateConfig(config); }
  catch (error) { return json({ message: error.message }, 400, headers); }

  config.revision = Date.now();
  config.updatedAt = new Date().toISOString();
  config.updatedBy = session.login || 'GitHub';
  await store().setJSON(STORE_KEY, config);

  return json({ ok: true, config }, 200, headers);
}

export const config = {
  path: '/api/broadcast/control'
};
