// Read-only local Writer with the real source bundle and styles. No account or publishing API.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
async function startWriterFixture() {
  const source = fs.readFileSync(path.join(root, 'write.html'), 'utf8');
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)[0];
  const assets = [...frontmatter.matchAll(/- (\/assets\/[^\s]+)/g)].map(match => match[1]);
  const styles = ['/assets/base.css', ...assets.filter(file => file.endsWith('.css')), '/assets/writer-shell.css'];
  const html = '<!doctype html><html class="writer-shell-root"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    styles.map(file => `<link rel="stylesheet" href="${file}">`).join('') + '</head><body class="writer-shell layout-writer"><main class="writer-shell-main" id="main-content">' +
    source.slice(frontmatter.length) + '</main>' + assets.filter(file => file.endsWith('.js')).map(file => `<script defer src="${file}"></script>`).join('') + '</body></html>';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    if (url.pathname === '/write/') { res.setHeader('Content-Type', 'text/html'); return res.end(html); }
    if (url.pathname === '/__tweet') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><body style="margin:0;background:#17202a;color:white;height:210px">Loaded tweet<script>window.mountToken=crypto.randomUUID();</script>');
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({ '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}
module.exports = { startWriterFixture };
