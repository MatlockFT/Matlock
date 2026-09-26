import { getStore } from '@netlify/blobs';

const STORE_NAME = 'matlock-writer-live';
const CHANNEL_KEY = 'main';
const MAX_TITLE_LENGTH = 180;
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

export function validateLivePayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid live writer payload.');

  const title = cleanString(payload.title, MAX_TITLE_LENGTH) || 'Live notes';
  const html = String(payload.html ?? '');
  const text = String(payload.text ?? '');

  if (byteLength(html) > MAX_HTML_BYTES) throw new Error('Live preview is too large.');
  if (byteLength(text) > MAX_TEXT_BYTES) throw new Error('Live text is too large.');

  return { title, html, text };
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
  const record = {
    channel: CHANNEL_KEY,
    active: true,
    title: clean.title,
    html: clean.html,
    text: clean.text,
    author: login || previous?.author || 'Matlock',
    startedAt: previous?.active && previous?.startedAt ? previous.startedAt : now,
    updatedAt: now,
    endedAt: null,
    version: Number(previous?.version || 0) + 1
  };

  await store().setJSON(CHANNEL_KEY, record);
  return record;
}

export async function endLiveRecord({ login = 'Matlock' } = {}) {
  const previous = await readLiveRecord();
  const now = new Date().toISOString();
  const record = {
    channel: CHANNEL_KEY,
    active: false,
    title: previous?.title || 'Live notes',
    html: previous?.html || '',
    text: previous?.text || '',
    author: login || previous?.author || 'Matlock',
    startedAt: previous?.startedAt || null,
    updatedAt: now,
    endedAt: now,
    version: Number(previous?.version || 0) + 1
  };

  await store().setJSON(CHANNEL_KEY, record);
  return record;
}

export function publicLiveRecord(record) {
  if (!record) {
    return {
      active: false,
      title: 'Live notes',
      html: '',
      text: '',
      author: 'Matlock',
      startedAt: null,
      updatedAt: null,
      endedAt: null,
      version: 0
    };
  }

  return {
    active: Boolean(record.active),
    title: cleanString(record.title, MAX_TITLE_LENGTH) || 'Live notes',
    html: String(record.html || ''),
    text: String(record.text || ''),
    author: cleanString(record.author, 80) || 'Matlock',
    startedAt: record.startedAt || null,
    updatedAt: record.updatedAt || null,
    endedAt: record.endedAt || null,
    version: Number(record.version || 0)
  };
}
