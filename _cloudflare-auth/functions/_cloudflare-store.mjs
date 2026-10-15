/**
 * Minimal Netlify Blobs compatibility layer backed by Workers KV.
 * The Worker sets globalThis.__MATLOCK_WRITER_KV for each request.
 *
 * KV Free-plan quotas are hard limits: operations fail after a quota is
 * exhausted rather than being billed as overages. This adapter intentionally
 * does not provision or bind R2.
 */
const KV_GLOBAL = "__MATLOCK_WRITER_KV";

function currentKV() {
  const kv = globalThis[KV_GLOBAL];
  if (!kv) throw new Error("Cloudflare Workers KV is not available in this request.");
  return kv;
}

function storagePrefix(name) {
  return `matlock-store/${encodeURIComponent(String(name || "default"))}/`;
}

function storageKey(prefix, key) {
  return prefix + String(key || "").replace(/^\/+/, "");
}

function plainMetadata(value = {}) {
  const out = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item === undefined || item === null) continue;
    out[key] = typeof item === "string" ? item : String(item);
  }
  return out;
}

function decodeValue(value, type = "text") {
  if (value === null || value === undefined) return null;
  if (type === "blob") return new Blob([value]);
  if (type === "json") {
    if (typeof value === "string") return JSON.parse(value);
    return JSON.parse(new TextDecoder().decode(value));
  }
  return value;
}

function resultMetadata(metadata = {}) {
  const createdAt = metadata?.createdAt || "";
  return {
    metadata: metadata || {},
    etag: "",
    size: Number(metadata?.chunkSize || metadata?.size) || 0,
    uploaded: createdAt && Number.isFinite(Date.parse(createdAt)) ? new Date(createdAt) : null
  };
}

export function getStore(options = {}) {
  const kv = currentKV();
  const prefix = storagePrefix(options.name);
  const keyFor = key => storageKey(prefix, key);

  async function set(key, value, writeOptions = {}) {
    if (value === undefined) throw new Error("Cannot store an undefined value.");
    let body = value;

    if (value && typeof value === "object"
      && !(value instanceof ArrayBuffer)
      && !ArrayBuffer.isView(value)
      && !(typeof Blob !== "undefined" && value instanceof Blob)
      && !(typeof ReadableStream !== "undefined" && value instanceof ReadableStream)) {
      body = JSON.stringify(value);
    } else if (ArrayBuffer.isView(value)) {
      body = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    } else if (typeof Blob !== "undefined" && value instanceof Blob) {
      body = await value.arrayBuffer();
    }

    const putOptions = {};
    const metadata = plainMetadata(writeOptions.metadata || {});
    if (Object.keys(metadata).length) putOptions.metadata = metadata;
    if (Number.isInteger(writeOptions.expirationTtl) && writeOptions.expirationTtl >= 60) {
      putOptions.expirationTtl = writeOptions.expirationTtl;
    }
    if (Number.isInteger(writeOptions.expiration) && writeOptions.expiration > 0) {
      putOptions.expiration = writeOptions.expiration;
    }
    return kv.put(keyFor(key), body, putOptions);
  }

  async function setJSON(key, value, writeOptions = {}) {
    return set(key, JSON.stringify(value), writeOptions);
  }

  async function get(key, readOptions = {}) {
    const type = readOptions.type || "text";
    const value = await kv.get(keyFor(key), { type });
    return decodeValue(value, type);
  }

  async function getWithMetadata(key, readOptions = {}) {
    const type = readOptions.type || "text";
    const result = await kv.getWithMetadata(keyFor(key), { type });
    if (!result || result.value === null || result.value === undefined) return null;
    return {
      data: decodeValue(result.value, type),
      ...resultMetadata(result.metadata || {})
    };
  }

  async function getMetadata(key) {
    // Listing returns key metadata without downloading the stored value.
    const fullKey = keyFor(key);
    const result = await kv.list({ prefix: fullKey, limit: 100 });
    const entry = (result.keys || []).find(item => item.name === fullKey);
    return entry ? resultMetadata(entry.metadata || {}) : null;
  }

  async function remove(key) {
    return kv.delete(keyFor(key));
  }

  async function list(listOptions = {}) {
    const requestedPrefix = prefix + String(listOptions.prefix || "").replace(/^\/+/, "");
    const result = await kv.list({
      prefix: requestedPrefix,
      ...(listOptions.cursor ? { cursor: listOptions.cursor } : {}),
      limit: Math.min(1000, Math.max(1, Number(listOptions.limit) || 1000))
    });
    const keys = result.keys || [];
    return {
      blobs: keys.map(entry => ({
        key: String(entry.name || "").startsWith(prefix) ? String(entry.name).slice(prefix.length) : String(entry.name || ""),
        etag: "",
        size: Number(entry.metadata?.chunkSize || entry.metadata?.size) || 0,
        uploaded: entry.metadata?.createdAt && Number.isFinite(Date.parse(entry.metadata.createdAt))
          ? new Date(entry.metadata.createdAt) : null,
        metadata: entry.metadata || {}
      })),
      directories: [],
      cursor: result.list_complete === false ? (result.cursor || null) : null,
      truncated: result.list_complete === false
    };
  }

  return { get, set, setJSON, getWithMetadata, getMetadata, delete: remove, list };
}
