// Public, read-only streaming gateway for Writer videos stored in GitHub Releases.
// GitHub's release-download response is intended for file downloads, not HTML5
// inline playback. Proxying the byte-range response lets mobile WebKit stream it.
const REPO = "MatlockFT/Matlock";
const RELEASE_PATH = /^\/media\/releases\/(writer-media-20\d{2}-(?:0[1-9]|1[0-2]))\/([a-z0-9][a-z0-9._-]{0,199}\.mp4)$/i;
const RANGE = /^bytes=(?:\d+-\d*|-\d+)$/;

const cors = {
  "Access-Control-Allow-Origin": "https://mmamatlock.com",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, If-Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges"
};

export default async function mediaGateway(request) {
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { ...cors, Allow: "GET, HEAD, OPTIONS" } });
  }

  const path = new URL(request.url).pathname;
  const match = RELEASE_PATH.exec(path);
  if (!match) return new Response("Not found", { status: 404, headers: cors });

  const range = request.headers.get("Range");
  if (range && !RANGE.test(range)) {
    return new Response("Invalid byte range", {
      status: 416,
      headers: { ...cors, "Accept-Ranges": "bytes" }
    });
  }

  const url = `https://github.com/${REPO}/releases/download/${match[1]}/${match[2]}`;
  const upstreamHeaders = new Headers({ Accept: "video/mp4, application/octet-stream" });
  if (range) upstreamHeaders.set("Range", range);
  if (range && request.headers.has("If-Range")) {
    upstreamHeaders.set("If-Range", request.headers.get("If-Range"));
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: upstreamHeaders,
      redirect: "follow",
      signal: request.signal
    });
  } catch {
    return new Response("Video origin unavailable", {
      status: 502,
      headers: { ...cors, "Cache-Control": "no-store" }
    });
  }

  if (response.status === 416) {
    const headers = new Headers({ ...cors, "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
    if (response.headers.has("Content-Range")) headers.set("Content-Range", response.headers.get("Content-Range"));
    return new Response(null, { status: 416, headers });
  }
  const upstreamType = (response.headers.get("Content-Type") || "").toLowerCase();
  if (!response.ok || (range && response.status !== 206) ||
      (upstreamType && !/^(video\/|application\/octet-stream)/.test(upstreamType))) {
    return new Response("Video origin did not return a playable byte range", {
      status: 502,
      headers: { ...cors, "Cache-Control": "no-store" }
    });
  }

  const headers = new Headers({
    ...cors,
    "Content-Type": "video/mp4",
    "Content-Disposition": "inline",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff"
  });
  for (const key of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) {
    if (response.headers.has(key)) headers.set(key, response.headers.get(key));
  }
  return new Response(method === "HEAD" ? null : response.body, {
    status: response.status,
    headers
  });
}

export const config = { path: "/media/releases/*" };
