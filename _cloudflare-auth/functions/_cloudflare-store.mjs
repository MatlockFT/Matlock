/**
 * Minimal Netlify Blobs compatibility layer backed by Cloudflare R2.
 * The Worker sets globalThis.__MATLOCK_WRITER_R2_BUCKET for each request.
 */
const BUCKET_GLOBAL = '__MATLOCK_WRITER_R2_BUCKET';

function currentBucket() {
  const bucket = globalThis[BUCKET_GLOBAL];
  if (!bucket) throw new Error('Cloudflare R2 storage is not available in this request.');
  return bucket;
}

function storagePrefix(name) {
  return `matlock-store/${encodeURIComponent(String(name || 'default'))}/`;
}

function storageKey(prefix, key) {
  return prefix + String(key || '').replace(/^\/+/, '');
}

function plainMetadata(value = {}) {
  const out = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item === undefined || item === null) continue;
    out[key] = typeof item === 'string' ? item : String(item);
  }
  return out;
}

async function readData(object, type = 'text') {
  if (type === 'stream') return object.body;
  if (type === 'arrayBuffer') return object.arrayBuffer();
  if (type === 'blob') return new Blob([await object.arrayBuffer()]);
  if (type === 'json') return object.json();
  return object.text();
}

function metadataResult(object) {
  if (!object) return null;
  return {
    metadata: object.customMetadata || {},
    etag: object.etag || '',
    size: Number(object.size) || 0,
    uploaded: object.uploaded || null
  };
}

export function getStore(options = {}) {
  const bucket = currentBucket();
  const prefix = storagePrefix(options.name);
  const keyFor = key => storageKey(prefix, key);

  async function set(key, value, writeOptions = {}) {
    let body = value;
    if (value === undefined) throw new Error('Cannot store an undefined value.');
    if (value && typeof value === 'object'
      && !(value instanceof ArrayBuffer)
      && !ArrayBuffer.isView(value)
      && !(typeof Blob !== 'undefined' && value instanceof Blob)
      && !(typeof ReadableStream !== 'undefined' && value instanceof ReadableStream)) {
      body = JSON.stringify(value);
    }
    const options = {
      customMetadata: plainMetadata(writeOptions.metadata || {})
    };
    if (writeOptions.contentType || writeOptions.type) {
      options.httpMetadata = {
        contentType: String(writeOptions.contentType || writeOptions.type)
      };
    }
    return bucket.put(keyFor(key), body, options);
  }

  async function setJSON(key, value, writeOptions = {}) {
    const options = { ...writeOptions, contentType: 'application/json' };
    return set(key, JSON.stringify(value), options);
  }

  async function get(key, readOptions = {}) {
    const object = await bucket.get(keyFor(key));
    if (!object) return null;
    return readData(object, readOptions.type || 'text');
  }

  async function getWithMetadata(key, readOptions = {}) {
    const object = await bucket.get(keyFor(key));
    if (!object) return null;
    return {
      data: await readData(object, readOptions.type || 'text'),
      ...metadataResult(object)
    };
  }

  async function getMetadata(key) {
    return metadataResult(await bucket.head(keyFor(key)));
  }

  async function remove(key) {
    return bucket.delete(keyFor(key));
  }

  async function list(listOptions = {}) {
    const requestedPrefix = prefix + String(listOptions.prefix || '').replace(/^\/+/, '');
    const result = await bucket.list({
      prefix: requestedPrefix,
      ...(listOptions.cursor ? { cursor: listOptions.cursor } : {}),
      limit: Math.min(1000, Math.max(1, Number(listOptions.limit) || 1000))
    });
    const blobs = (result.objects || []).map(object => ({
      key: String(object.key || '').startsWith(prefix) ? String(object.key).slice(prefix.length) : String(object.key || ''),
      etag: object.etag || '',
      size: Number(object.size) || 0,
      uploaded: object.uploaded || null,
      metadata: object.customMetadata || {}
    }));
    return {
      blobs,
      directories: [],
      cursor: result.truncated ? (result.cursor || null) : null,
      truncated: Boolean(result.truncated)
    };
  }

  return { get, set, setJSON, getWithMetadata, getMetadata, delete: remove, list };
}
