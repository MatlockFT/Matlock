const DO_GLOBAL = "__MATLOCK_WRITER_MEDIA_STORAGE";

function storagePrefix(name) {
  return "matlock-store/" + encodeURIComponent(String(name || "default")) + "/";
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
  if (type === "arrayBuffer") return value;
  if (type === "blob") return new Blob([value]);
  const text = new TextDecoder().decode(value);
  if (type === "json") return JSON.parse(text);
  return text;
}

function parseMetadata(response) {
  try {
    const value = JSON.parse(response.headers.get("X-Store-Metadata") || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

async function responseError(response, fallback) {
  const body = await response.text().catch(() => "");
  let message = body;
  try {
    const parsed = JSON.parse(body);
    message = parsed.error || parsed.message || body;
  } catch {}
  return new Error(message || fallback || ("Media storage returned " + response.status + "."));
}

export function createDurableObjectMediaStore(options = {}) {
  const binding = globalThis[DO_GLOBAL];
  if (!binding) throw new Error("Cloudflare Durable Objects media storage is not available.");
  const name = options.name || "matlock-writer-media-staging";
  const physicalPrefix = storagePrefix(name);
  const stub = binding.get(binding.idFromName(name));

  async function send(path, params = {}, init = {}) {
    const url = new URL(path, "https://writer-media.internal");
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return stub.fetch(new Request(url, init));
  }

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
    } else if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) {
      body = await new Response(value).arrayBuffer();
    }

    const metadata = plainMetadata(writeOptions.metadata || {});
    let expiresAt = null;
    if (Number.isInteger(writeOptions.expirationTtl) && writeOptions.expirationTtl >= 60) {
      expiresAt = Date.now() + writeOptions.expirationTtl * 1000;
    }
    if (Number.isInteger(writeOptions.expiration) && writeOptions.expiration > 0) {
      expiresAt = writeOptions.expiration * 1000;
    }

    const headers = new Headers({
      "Content-Type": "application/octet-stream",
      "X-Store-Metadata": JSON.stringify(metadata)
    });
    if (expiresAt) headers.set("X-Store-Expires-At", String(expiresAt));
    const response = await send("/kv", {
      key: storageKey(physicalPrefix, key)
    }, {
      method: "PUT",
      headers,
      body
    });
    if (!response.ok) throw await responseError(response, "Could not stage media chunk.");
  }

  async function get(key, readOptions = {}) {
    const type = readOptions.type || "text";
    const response = await send("/kv", {
      key: storageKey(physicalPrefix, key)
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await responseError(response, "Could not read staged media.");
    return decodeValue(await response.arrayBuffer(), type);
  }

  async function getWithMetadata(key, readOptions = {}) {
    const type = readOptions.type || "text";
    const response = await send("/kv", {
      key: storageKey(physicalPrefix, key)
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await responseError(response, "Could not read staged media.");
    const bytes = await response.arrayBuffer();
    const metadata = parseMetadata(response);
    const createdAt = metadata.createdAt || "";
    return {
      data: decodeValue(bytes, type),
      metadata,
      etag: "",
      size: Number(response.headers.get("X-Store-Size")) || bytes.byteLength,
      uploaded: createdAt && Number.isFinite(Date.parse(createdAt)) ? new Date(createdAt) : null
    };
  }

  async function getMetadata(key) {
    const result = await list({ prefix: key, limit: 100 });
    const entry = (result.blobs || []).find(item => item.key === key);
    return entry ? {
      metadata: entry.metadata || {},
      etag: "",
      size: Number(entry.size) || 0,
      uploaded: entry.uploaded ? new Date(entry.uploaded) : null
    } : null;
  }

  async function remove(key) {
    const response = await send("/kv", {
      key: storageKey(physicalPrefix, key)
    }, { method: "DELETE" });
    if (!response.ok) throw await responseError(response, "Could not delete staged media.");
  }

  async function list(listOptions = {}) {
    const requestedPrefix = physicalPrefix + String(listOptions.prefix || "").replace(/^\/+/, "");
    const limit = Math.min(5000, Math.max(1, Number(listOptions.limit) || 5000));
    const response = await send("/list", {
      prefix: requestedPrefix,
      limit
    });
    if (!response.ok) throw await responseError(response, "Could not list staged media.");
    const data = await response.json();
    return {
      blobs: (data.blobs || []).map(entry => ({
        ...entry,
        key: String(entry.key || "").startsWith(physicalPrefix)
          ? String(entry.key).slice(physicalPrefix.length)
          : String(entry.key || "")
      })),
      directories: [],
      cursor: null,
      truncated: Boolean(data.truncated)
    };
  }

  async function deletePrefix(prefix) {
    const response = await send("/delete-prefix", {
      prefix: physicalPrefix + String(prefix || "").replace(/^\/+/, "")
    }, { method: "POST" });
    if (!response.ok) throw await responseError(response, "Could not clean up staged media.");
  }

  async function streamChunks(scope, uploadId, chunkCount, startIndex = 0) {
    const response = await send("/stream", {
      prefix: storageKey(physicalPrefix, "chunks/" + scope + "/" + uploadId + "/"),
      count: chunkCount,
      start: startIndex
    });
    if (!response.ok) throw await responseError(response, "Could not stream staged video.");
    if (!response.body) throw new Error("The staged video stream is empty.");
    return response.body;
  }

  return {
    set,
    setJSON: (key, value, writeOptions = {}) => set(key, JSON.stringify(value), writeOptions),
    get,
    getWithMetadata,
    getMetadata,
    delete: remove,
    list,
    deletePrefix,
    streamChunks
  };
}
