import { getStore } from '@netlify/blobs';

const STORE_NAME = 'matlock-writer-live';
const CHANNEL_KEY = 'main';
const MAX_TITLE_LENGTH = 180;
const MAX_DESCRIPTION_LENGTH = 320;
const MAX_PATH_LENGTH = 320;
const MAX_HTML_BYTES = 1_500_000;
const MAX_TEXT_BYTES = 300_000;

function store() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

function cleanString(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function byteLength(value) {
  return Buffer.byteLength(String(value ?? ''), 'utf8');
}

function cleanPath(value, kind) {
  const path = cleanString(value, MAX_PATH_LENGTH);
  if (!path) return '';
  if (kind === 'public' && !path.startsWith('/')) throw new Error('Invalid public article path.');
  if (kind === 'source' && !path.startsWith('_posts/')) throw new Error('Invalid article source path.');
  return path;
}

function sameTarget(a, b) {
  if (!a || !b) return false;
  return Boolean(
    (a.sourcePath && b.sourcePath && a.sourcePath === b.sourcePath) ||
    (a.publicPath && b.publicPath && a.publicPath === b.publicPath)
  );
}

export function validateLivePayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid live writer payload.');

  const sourcePath = cleanPath(payload.sourcePath, 'source');
  const publicPath = cleanPath(payload.publicPath, 'public');
  if (!sourcePath || !publicPath) throw new Error('Live Writer needs both the article source path and public path.');

  const title = cleanString(payload.title, MAX_TITLE_LENGTH) || 'Live article';
  const description = cleanString(payload.description, MAX_DESCRIPTION_LENGTH);
  const html = String(payload.html ?? '');
  const text = String(payload.text ?? '');

  if (byteLength(html) > MAX_HTML_BYTES) throw new Error('Live preview is too large.');
  if (byteLength(text) > MAX_TEXT_BYTES) throw new Error('Live text is too large.');

  return {
    active: payload.active !== false,
    hold: Boolean(payload.hold),
    sourcePath,
    publicPath,
    title,
    description,
    html,
    text,
    publishedAt: payload.publishedAt || null
  };
}

export async function readLiveRecord() {
  try {
    return await store().get(CHANNEL_KEY, { type: 'json', consistency: 'strong' });
  } catch {
    return null;
  }
}

export async function writeLiveRecord(payload, { login = 'Matlock' } = {}) {
  const clean = validateLivePayload(payload);
  const previous = await readLiveRecord();
  const now = new Date().toISOString();
  const sameArticle = sameTarget(previous, clean);
  const active = Boolean(clean.active);
  const hold = !active && Boolean(clean.hold);

  const record = {
    channel: CHANNEL_KEY,
    active,
    hold,
    sourcePath: clean.sourcePath,
    publicPath: clean.publicPath,
    title: clean.title,
    description: clean.description,
    html: clean.html,
    text: clean.text,
    author: login || (sameArticle ? previous?.author : '') || 'Matlock',
    startedAt: sameArticle && previous?.startedAt ? previous.startedAt : now,
    updatedAt: now,
    endedAt: active ? null : now,
    publishedAt: clean.publishedAt || (sameArticle ? previous?.publishedAt : null) || null,
    version: Number(previous?.version || 0) + 1
  };

  await store().setJSON(CHANNEL_KEY, record);
  return record;
}

export function publicLiveRecord(record) {
  if (!record) {
    return {
      active: false,
      hold: false,
      sourcePath: '',
      publicPath: '',
      title: '',
      description: '',
      html: '',
      text: '',
      author: 'Matlock',
      startedAt: null,
      updatedAt: null,
      endedAt: null,
      publishedAt: null,
      version: 0
    };
  }

  return {
    active: Boolean(record.active),
    hold: Boolean(record.hold),
    sourcePath: cleanString(record.sourcePath, MAX_PATH_LENGTH),
    publicPath: cleanString(record.publicPath, MAX_PATH_LENGTH),
    title: cleanString(record.title, MAX_TITLE_LENGTH) || 'Live article',
    description: cleanString(record.description, MAX_DESCRIPTION_LENGTH),
    html: String(record.html || ''),
    text: String(record.text || ''),
    author: cleanString(record.author, 80) || 'Matlock',
    startedAt: record.startedAt || null,
    updatedAt: record.updatedAt || null,
    endedAt: record.endedAt || null,
    publishedAt: record.publishedAt || null,
    version: Number(record.version || 0)
  };
}
