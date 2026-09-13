'use strict';
// Small, loopback-only preview server. No installation or build is required.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.argv[2] || 61053);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port from 1024 to 65535.');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.svg':'image/svg+xml','.ttf':'font/ttf','.pdf':'application/pdf','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8','.json':'application/json; charset=utf-8'};
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET','HEAD'].includes(request.method)) {response.writeHead(405); response.end(); return;}
  let file;
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.includes('\\') || pathname.split('/').some(segment => segment.startsWith('.'))) throw new Error('Invalid path.');
    file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) throw new Error('Not found.');
  } catch (_) {response.writeHead(404); response.end('Not found'); return;}
  response.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream'});
  if (request.method === 'HEAD') response.end();
  else fs.createReadStream(file).on('error', () => response.destroy()).pipe(response);
});
server.on('error', error => {console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Reuse the open preview, or run npm start -- 8767.` : error.message); process.exitCode = 1;});
server.listen(port, '127.0.0.1', () => console.log(`Local preview: http://127.0.0.1:${port}/\nPress Ctrl+C to stop. This does not publish the website.`));
