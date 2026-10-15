const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && (pathname === "/" || pathname === "/health")) {
      return Response.json({
        service: "matlock-writer-auth",
        status: "ok",
        stage: "migration-bootstrap",
        kvBindingConfigured: Boolean(env.WRITER_SESSIONS)
      }, { headers: JSON_HEADERS });
    }

    return Response.json({
      error: "Writer routes have not been migrated yet."
    }, { status: 501, headers: JSON_HEADERS });
  }
};
