import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(fileURLToPath(new URL('../dist/', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webm': 'video/webm' };
const port = Number(process.env.PORT || 4173);

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/api/market/candles') {
    const product = url.searchParams.get('product');
    const granularity = Number(url.searchParams.get('granularity'));
    if (!['BTC-USD', 'ETH-USD', 'SOL-USD'].includes(product ?? '') || ![60, 300, 3600, 86400].includes(granularity)) {
      response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Unsupported market or interval' }));
      return;
    }
    try {
      const upstream = await fetch(`https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles?granularity=${granularity}`, {
        headers: { accept: 'application/json', 'user-agent': 'Market-Ritual-Local/1.0' },
      });
      const body = await upstream.text();
      response.writeHead(upstream.ok ? 200 : 502, { 'content-type': 'application/json', 'cache-control': 'public, max-age=20' }).end(body);
    } catch {
      response.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Upstream market feed unavailable' }));
    }
    return;
  }
  let file = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
  try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); }
  catch { file = join(root, 'index.html'); }
  response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Market Ritual → http://127.0.0.1:${port}`));
