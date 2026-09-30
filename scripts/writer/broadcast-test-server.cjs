// Local-only fixture server. It never contacts GitHub or publishes media.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

function wav(seconds = 2) {
  const samples = Math.round(8000 * seconds), data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / 8000) * 1000), 44 + i * 2);
  return data;
}

function initialState(origin) {
  const channel = {
    revision: 'test', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    program: [{ id: 'headline-1', type: 'headline', title: 'LOCAL TEST CHANNEL', body: 'A safe preview — no live uploads or changes.', duration: 6 }],
    music: [], ticker: ['LOCAL TEST PREVIEW', 'CONTINUOUS LOOP'],
    audio: { master: 0.5, video: 0.8, music: 0.6, videoMusic: 'duck', duckLevel: 0.18, duckAttack: 0.1, duckRelease: 0.2, crossfade: 0.5 }
  };
  return { version: 1, draft: structuredClone(channel), live: structuredClone(channel) };
}

async function startServer(port = 0) {
  let origin, state, revision = 1;
  const media = new Map(), assets = [], uploads = new Map();
  const controls = { failSaves: false, saveDelay: 0, chunkFailures: 0, writes: 0 };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    function json(data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
    if (url.pathname === '/api/writer/session') return json({ ok: true, login: 'Local preview' });
    if (url.pathname === '/api/writer/github') {
      if (req.method === 'GET') return json({ sha: String(revision), content: Buffer.from(JSON.stringify(state)).toString('base64') });
      if (controls.saveDelay) await new Promise(r => setTimeout(r, controls.saveDelay));
      if (controls.failSaves) return json({ message: 'Simulated save conflict' }, 409);
      state = JSON.parse(Buffer.from(JSON.parse(body).content, 'base64'));
      controls.writes++; revision++;
      return json({ content: { sha: String(revision) } });
    }
    if (url.pathname === '/api/writer/media-library') return json({ assets, mediaKinds: ['video', 'audio'] });
    if (url.pathname === '/api/writer/media-chunk') {
      if (controls.chunkFailures-- > 0) return json({ error: 'Temporary test failure' }, 503);
      const id = req.headers['x-upload-id'];
      if (!uploads.has(id)) uploads.set(id, { chunks: [], name: req.headers['x-asset-name'], type: req.headers['x-file-type'] });
      uploads.get(id).chunks[Number(req.headers['x-chunk-index'])] = body;
      return json({ ok: true });
    }
    if (url.pathname === '/api/writer/media-finalize') {
      const { uploadId } = JSON.parse(body), entry = uploads.get(uploadId);
      const data = Buffer.concat(entry.chunks);
      const mediaPath = '/fixtures/' + entry.name;
      media.set(mediaPath, { data, type: entry.type });
      entry.url = origin + mediaPath;
      entry.id = assets.length + 1;
      assets.push({ id: entry.id, name: entry.name, url: entry.url, size: data.length, contentType: entry.type, createdAt: new Date().toISOString() });
      return json({ ok: true }, 202);
    }
    if (url.pathname === '/api/writer/media-status') {
      const entry = uploads.get(url.searchParams.get('uploadId'));
      return json({ state: 'complete', url: entry.url, assetId: entry.id });
    }
    if (/\/assets\/(?:uploads|data)\/broadcast.json$/.test(url.pathname)) return json(state);
    let file = url.pathname === '/broadcast/control/' ? 'broadcast-control.html' : url.pathname === '/broadcast/' ? 'broadcast.html' : url.pathname.slice(1);
    if (url.pathname === '/fixtures/tone.wav' || url.pathname === '/fixtures/other.wav') media.set(url.pathname, { data: wav(), type: 'audio/wav' });
    if (media.has(url.pathname)) {
      const { data, type } = media.get(url.pathname);
      const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      if (range) {
        const start = Number(range[1]), end = Math.min(Number(range[2]) || data.length - 1, data.length - 1);
        res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
        return res.end(data.subarray(start, end + 1));
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Accept-Ranges': 'bytes' }); return res.end(data);
    }
    const resolved = path.resolve(root, file);
    if (!resolved.startsWith(root + path.sep) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) { res.writeHead(404); return res.end(); }
    let data = fs.readFileSync(resolved);
    const ext = path.extname(file);
    if (ext === '.html') {
      data = Buffer.from(data.toString().replace(/^---[\s\S]*?---\s*/, '').replace(/{{\s*'([^']+)'\s*\|\s*relative_url\s*}}/g, '$1')
        .replace('https://mmamatlock-writer-auth.netlify.app', origin)
        .replace('</head>', `<script>localStorage.setItem('matlock-writer:server-session','local-test-session');</script></head>`));
    }
    if (file === 'assets/broadcast.js') data = Buffer.from(data.toString().replaceAll('https://raw.githubusercontent.com/MatlockFT/Matlock/main', origin));
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[ext] || 'application/octet-stream' }); res.end(data);
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  state = initialState(origin);
  return { origin, server, controls, assets, media, get state() { return state; }, set state(value) { state = value; }, close: () => new Promise(resolve => server.close(resolve)) };
}

module.exports = { startServer, wav };
if (require.main === module) startServer(Number(process.env.PORT) || 4190).then(({ origin }) => console.log(origin + '/broadcast/control/'));
