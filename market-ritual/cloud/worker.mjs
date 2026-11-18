const json = (value, init = {}) => Response.json(value, { ...init, headers: { 'cache-control': 'no-store', ...(init.headers || {}) } });

function userId(request) {
  return request.headers.get('oai-authenticated-user-id');
}

function requireUser(request) {
  const id = userId(request);
  if (!id) throw new Response('Sign in required', { status: 401 });
  return id;
}

function slug() {
  const words = ['oracle', 'margin', 'specter', 'ritual', 'liquidity', 'signal'];
  const data = new Uint32Array(2);
  crypto.getRandomValues(data);
  return `${words[data[0] % words.length]}-${(data[1] % 1_000_000).toString().padStart(6, '0')}`;
}

async function assetForOwner(env, id, owner) {
  return env.DB.prepare('SELECT * FROM assets WHERE id = ? AND owner_id = ?').bind(id, owner).first();
}

async function handleApi(request, env, url) {
  const path = url.pathname.split('/').filter(Boolean);
  if (url.pathname === '/api/market/candles' && request.method === 'GET') {
    const product = url.searchParams.get('product');
    const granularity = Number(url.searchParams.get('granularity'));
    const products = new Set(['BTC-USD', 'ETH-USD', 'SOL-USD']);
    const granularities = new Set([60, 300, 3600, 86400]);
    if (!product || !products.has(product) || !granularities.has(granularity)) {
      return json({ error: 'Unsupported market or interval' }, { status: 400 });
    }
    const endpoint = `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}/candles?granularity=${granularity}`;
    const response = await fetch(endpoint, { headers: { accept: 'application/json', 'user-agent': 'Market-Ritual/1.0' } });
    if (!response.ok) return json({ error: 'Upstream market feed unavailable' }, { status: 502 });
    const body = await response.json();
    return json(body, { headers: { 'cache-control': 'public, max-age=20, stale-while-revalidate=40' } });
  }
  if (url.pathname === '/api/studio/capability') {
    const owner = userId(request);
    return json({ available: true, authenticated: Boolean(owner), user: request.headers.get('oai-authenticated-user-email') || undefined });
  }

  if (url.pathname === '/api/assets' && request.method === 'POST') {
    const owner = requireUser(request);
    const body = await request.json();
    if (!body.id || !body.name || !body.kind || !body.format || !Number.isFinite(body.size)) return json({ error: 'Invalid asset metadata' }, { status: 400 });
    const objectKey = `users/${owner}/assets/${body.id}/original.${body.format}`;
    const upload = await env.BUCKET.createMultipartUpload(objectKey, { httpMetadata: { contentType: body.mime || 'application/octet-stream' } });
    await env.DB.prepare('INSERT INTO assets (id, owner_id, name, kind, format, mime, size, object_key, upload_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(body.id, owner, body.name.slice(0, 240), body.kind, body.format, body.mime || 'application/octet-stream', body.size, objectKey, upload.uploadId, 'uploading', Date.now()).run();
    return json({ uploadId: upload.uploadId });
  }

  if (path[0] === 'api' && path[1] === 'assets' && path[3] === 'parts' && request.method === 'PUT') {
    const owner = requireUser(request);
    const asset = await assetForOwner(env, path[2], owner);
    if (!asset || asset.upload_id !== url.searchParams.get('upload')) return json({ error: 'Upload session not found' }, { status: 404 });
    const partNumber = Number(path[4]);
    if (!Number.isInteger(partNumber) || partNumber < 1) return json({ error: 'Invalid part number' }, { status: 400 });
    const upload = env.BUCKET.resumeMultipartUpload(asset.object_key, asset.upload_id);
    const part = await upload.uploadPart(partNumber, request.body);
    return new Response(null, { status: 204, headers: { etag: part.etag } });
  }

  if (path[0] === 'api' && path[1] === 'assets' && path[3] === 'complete' && request.method === 'POST') {
    const owner = requireUser(request);
    const asset = await assetForOwner(env, path[2], owner);
    if (!asset) return json({ error: 'Asset not found' }, { status: 404 });
    const body = await request.json();
    if (body.uploadId !== asset.upload_id || !Array.isArray(body.parts)) return json({ error: 'Invalid completion payload' }, { status: 400 });
    const upload = env.BUCKET.resumeMultipartUpload(asset.object_key, asset.upload_id);
    await upload.complete(body.parts);
    await env.DB.prepare("UPDATE assets SET status = 'ready', upload_id = NULL WHERE id = ? AND owner_id = ?").bind(asset.id, owner).run();
    return json({ id: asset.id, status: 'ready' });
  }

  if (path[0] === 'api' && path[1] === 'assets' && path.length === 3 && request.method === 'DELETE') {
    const owner = requireUser(request);
    const asset = await assetForOwner(env, path[2], owner);
    if (!asset) return new Response(null, { status: 404 });
    await env.BUCKET.delete(asset.object_key);
    await env.DB.prepare('DELETE FROM assets WHERE id = ? AND owner_id = ?').bind(asset.id, owner).run();
    return new Response(null, { status: 204 });
  }

  if (url.pathname === '/api/scenes/publish' && request.method === 'POST') {
    const owner = requireUser(request);
    const scene = await request.json();
    const assetIds = Array.from(new Set((scene.layers || []).map((layer) => layer.assetId).filter(Boolean)));
    if (assetIds.length) {
      const placeholders = assetIds.map(() => '?').join(',');
      const rows = await env.DB.prepare(`SELECT id FROM assets WHERE owner_id = ? AND status = 'ready' AND id IN (${placeholders})`).bind(owner, ...assetIds).all();
      if (rows.results.length !== assetIds.length) return json({ error: 'Every published asset must be synced first' }, { status: 409 });
    }
    const id = crypto.randomUUID();
    const publicSlug = slug();
    await env.DB.prepare('INSERT INTO publications (id, slug, owner_id, scene_json, asset_ids_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, publicSlug, owner, JSON.stringify(scene), JSON.stringify(assetIds), Date.now()).run();
    return json({ id, slug: publicSlug, url: `/scene/${publicSlug}` });
  }

  if (path[0] === 'api' && path[1] === 'scenes' && path[2] && request.method === 'GET') {
    const publication = await env.DB.prepare('SELECT slug, scene_json, created_at FROM publications WHERE slug = ?').bind(path[2]).first();
    if (!publication) return json({ error: 'Scene not found' }, { status: 404 });
    return json({ slug: publication.slug, scene: JSON.parse(publication.scene_json), publishedAt: publication.created_at }, { headers: { 'cache-control': 'public, max-age=60' } });
  }

  if (path[0] === 'media' && path[1] === 'published' && path[2] && path[3] && request.method === 'GET') {
    const publication = await env.DB.prepare('SELECT asset_ids_json FROM publications WHERE slug = ?').bind(path[2]).first();
    if (!publication || !JSON.parse(publication.asset_ids_json).includes(path[3])) return new Response('Not found', { status: 404 });
    const asset = await env.DB.prepare("SELECT object_key, mime, size FROM assets WHERE id = ? AND status = 'ready'").bind(path[3]).first();
    if (!asset) return new Response('Not found', { status: 404 });
    const rangeHeader = request.headers.get('range');
    const range = rangeHeader?.match(/bytes=(\d+)-(\d*)/);
    const object = await env.BUCKET.get(asset.object_key, range ? { range: { offset: Number(range[1]), length: range[2] ? Number(range[2]) - Number(range[1]) + 1 : undefined } } : undefined);
    if (!object) return new Response('Not found', { status: 404 });
    const headers = new Headers({ 'content-type': asset.mime, 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=31536000, immutable' });
    object.writeHttpMetadata?.(headers);
    if (range) headers.set('content-range', `bytes ${range[1]}-${Number(range[1]) + object.size - 1}/${asset.size}`);
    return new Response(object.body, { status: range ? 206 : 200, headers });
  }

  return json({ error: 'Not found' }, { status: 404 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/published/')) return await handleApi(request, env, url);
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Static asset binding is not configured.', { status: 503 });
    } catch (reason) {
      if (reason instanceof Response) return reason;
      console.error(reason);
      return json({ error: 'Server error' }, { status: 500 });
    }
  },
};
