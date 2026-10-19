const TABLE = "matlock_writer_media";
const MAX_VALUE_BYTES = 1_800_000;

function jsonError(message, status = 400) {
  return Response.json({ ok: false, error: String(message || "Storage error") }, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function bytesFromValue(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value || 0);
}

function safeMetadata(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export class WriterMediaStorage {
  constructor(ctx) {
    this.ctx = ctx;
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS matlock_writer_media (key TEXT PRIMARY KEY, value BLOB NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', expires_at INTEGER)"
    );
    this.sql.exec(
      "CREATE INDEX IF NOT EXISTS matlock_writer_media_expiry_idx ON matlock_writer_media (expires_at)"
    );
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/kv") return await this.handleKeyValue(request, url);
      if (url.pathname === "/list" && request.method === "GET") return this.handleList(url);
      if (url.pathname === "/delete-prefix" && request.method === "POST") return this.handleDeletePrefix(url);
      if (url.pathname === "/stream" && request.method === "GET") return this.handleStream(url);
      if (url.pathname === "/health" && request.method === "GET") {
        return Response.json({ ok: true, storage: "durable-objects-sqlite" }, {
          headers: { "Cache-Control": "no-store" }
        });
      }
      return jsonError("Unknown media-storage operation.", 404);
    } catch (error) {
      return jsonError(error?.message || error || "Media storage operation failed.", 500);
    }
  }

  async handleKeyValue(request, url) {
    const key = String(url.searchParams.get("key") || "");
    if (!key || key.length > 4096) return jsonError("Invalid storage key.");

    if (request.method === "GET") {
      const rows = this.sql.exec(
        "SELECT value, metadata, expires_at, length(value) AS size FROM matlock_writer_media WHERE key = ?",
        key
      ).toArray();
      const row = rows[0];
      if (!row) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

      const expiresAt = Number(row.expires_at);
      if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now()) {
        this.sql.exec("DELETE FROM matlock_writer_media WHERE key = ?", key);
        return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
      }

      return new Response(bytesFromValue(row.value), {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Store-Metadata": JSON.stringify(safeMetadata(row.metadata)),
          "X-Store-Size": String(Number(row.size) || 0)
        }
      });
    }

    if (request.method === "DELETE") {
      this.sql.exec("DELETE FROM matlock_writer_media WHERE key = ?", key);
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }

    if (request.method !== "PUT") return jsonError("Method not allowed.", 405);

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > MAX_VALUE_BYTES) {
      return jsonError("A staged chunk exceeds the 1.8 MB storage-row limit.", 413);
    }

    const metadata = safeMetadata(request.headers.get("X-Store-Metadata"));
    const requestedExpiry = Number(request.headers.get("X-Store-Expires-At"));
    const expiresAt = Number.isFinite(requestedExpiry) && requestedExpiry > 0
      ? Math.trunc(requestedExpiry)
      : null;

    this.sql.exec(
      "INSERT INTO matlock_writer_media (key, value, metadata, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, metadata = excluded.metadata, expires_at = excluded.expires_at",
      key,
      bytes,
      JSON.stringify(metadata),
      expiresAt
    );

    if (expiresAt) {
      const currentAlarm = await this.ctx.storage.getAlarm();
      if (!currentAlarm || expiresAt < currentAlarm) {
        await this.ctx.storage.setAlarm(expiresAt);
      }
    }

    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }

  handleList(url) {
    const prefix = String(url.searchParams.get("prefix") || "");
    const requestedLimit = Number(url.searchParams.get("limit") || 5000);
    const limit = Math.min(5000, Math.max(1, Number.isInteger(requestedLimit) ? requestedLimit : 5000));
    const rows = this.sql.exec(
      "SELECT key, metadata, length(value) AS size FROM matlock_writer_media WHERE substr(key, 1, length(?)) = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY key LIMIT ?",
      prefix,
      prefix,
      Date.now(),
      limit
    ).toArray();

    const blobs = rows.map(row => {
      const metadata = safeMetadata(row.metadata);
      const createdAt = metadata.createdAt || "";
      return {
        key: String(row.key),
        metadata,
        size: Number(row.size) || 0,
        uploaded: createdAt && Number.isFinite(Date.parse(createdAt)) ? new Date(createdAt).toISOString() : null
      };
    });

    return Response.json({ blobs, directories: [], cursor: null, truncated: false }, {
      headers: { "Cache-Control": "no-store" }
    });
  }

  handleDeletePrefix(url) {
    const prefix = String(url.searchParams.get("prefix") || "");
    if (!prefix || prefix.length > 4096) return jsonError("Invalid storage prefix.");
    this.sql.exec(
      "DELETE FROM matlock_writer_media WHERE substr(key, 1, length(?)) = ?",
      prefix,
      prefix
    );
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }

  handleStream(url) {
    const prefix = String(url.searchParams.get("prefix") || "");
    const count = Number(url.searchParams.get("count"));
    const startIndex = Number(url.searchParams.get("start") || 0);
    if (
      !prefix || prefix.length > 4096
      || !Number.isInteger(count) || count < 1 || count > 1200
      || !Number.isInteger(startIndex) || startIndex < 0
      || startIndex + count > 1200
    ) {
      return jsonError("Invalid staged-media stream parameters.");
    }

    let index = startIndex;
    const endIndex = startIndex + count;
    const sql = this.sql;
    const stream = new ReadableStream({
      async pull(controller) {
        if (index >= endIndex) {
          controller.close();
          return;
        }

        const key = prefix + String(index).padStart(5, "0");
        try {
          const rows = sql.exec(
            "SELECT value, expires_at FROM matlock_writer_media WHERE key = ?",
            key
          ).toArray();
          const row = rows[0];
          const expiresAt = Number(row?.expires_at);
          if (!row || (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now())) {
            controller.error(new Error("Missing or expired staged video chunk " + (index + 1) + " of " + count + "."));
            return;
          }
          controller.enqueue(bytesFromValue(row.value));
          index += 1;
        } catch (error) {
          controller.error(error);
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store"
      }
    });
  }

  async alarm() {
    const now = Date.now();
    this.sql.exec(
      "DELETE FROM matlock_writer_media WHERE expires_at IS NOT NULL AND expires_at <= ?",
      now
    );
    const rows = this.sql.exec(
      "SELECT MIN(expires_at) AS next_expiry FROM matlock_writer_media WHERE expires_at IS NOT NULL"
    ).toArray();
    const nextExpiry = Number(rows[0]?.next_expiry);
    if (Number.isFinite(nextExpiry) && nextExpiry > 0) {
      await this.ctx.storage.setAlarm(Math.max(nextExpiry, now + 1000));
    }
  }
}
