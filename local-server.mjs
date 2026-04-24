import http from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, '.data');
const PORT = Number(process.env.GAMEHUB_PORT || 8787);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/state') {
      return await handleState(req, res, url);
    }

    return await serveStatic(req, res, url);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'server_error', detail: String(err?.message || err) }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Gamehub local server listening on http://0.0.0.0:${PORT}`);
});

async function handleState(req, res, url) {
  if (req.method === 'GET') {
    const record = await readStateRecord();
    return json(res, 200, { user: 'shared', state: record?.state || null, revision: record?.revision || 0, updatedAt: record?.updatedAt || null });
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    if (!body || typeof body.state !== 'object') {
      return json(res, 400, { error: 'Expected { state }' });
    }
    const expectedRevision = Number(body.expectedRevision || 0);
    const result = await writeStateRecord(body.state, expectedRevision);
    if (!result.ok) {
      return json(res, 409, { error: 'revision_conflict', currentRevision: result.currentRevision, updatedAt: result.updatedAt });
    }
    return json(res, 200, { ok: true, revision: result.revision, updatedAt: result.updatedAt });
  }

  return json(res, 405, { error: 'Method not allowed' });
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    return json(res, 403, { error: 'forbidden' });
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      return streamFile(indexPath, res);
    }
    return streamFile(filePath, res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

function streamFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

async function readStateRecord() {
  try {
    const raw = await readFile(path.join(DATA_DIR, `shared-state.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeStateRecord(state, expectedRevision) {
  const current = await readStateRecord();
  const currentRevision = current?.revision || 0;
  if (current && expectedRevision && expectedRevision !== currentRevision) {
    return { ok: false, currentRevision, updatedAt: current.updatedAt || null };
  }
  const next = { revision: currentRevision + 1, updatedAt: new Date().toISOString(), state };
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, `shared-state.json`), JSON.stringify(next, null, 2), 'utf8');
  return { ok: true, revision: next.revision, updatedAt: next.updatedAt };
}

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : null); }
      catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}
