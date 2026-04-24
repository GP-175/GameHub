import { mkdir, readFile, writeFile } from 'node:fs/promises';

const LOCAL_STATE_DIR = '/srv/gamehub/.data';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/state')) {
      if (request.method === 'GET') {
        const user = sanitizeUser(url.searchParams.get('user') || 'default');
        const record = await readStateRecord(env, user);
        return json({ user, state: record?.state || null, revision: record?.revision || 0, updatedAt: record?.updatedAt || null });
      }

      if (request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body || !body.user || typeof body.state !== 'object') {
          return json({ error: 'Expected { user, state }' }, 400);
        }
        const user = sanitizeUser(body.user);
        const expectedRevision = Number(body.expectedRevision || 0);
        const result = await writeStateRecord(env, user, body.state, expectedRevision);
        if (!result.ok) {
          return json({ error: 'revision_conflict', currentRevision: result.currentRevision, updatedAt: result.updatedAt }, 409);
        }
        return json({ ok: true, user, revision: result.revision, updatedAt: result.updatedAt });
      }

      return json({ error: 'Method not allowed' }, 405);
    }

    return env.ASSETS.fetch(request);
  }
};

async function readStateRecord(env, user) {
  if (env.GAMEHUB_STATE && typeof env.GAMEHUB_STATE.get === 'function' && !String(env.GAMEHUB_STATE).includes('REPLACE_WITH_REAL_KV_ID')) {
    const raw = await env.GAMEHUB_STATE.get(`state:${user}`, 'text');
    return raw ? JSON.parse(raw) : null;
  }
  try {
    const path = `${LOCAL_STATE_DIR}/${user}.json`;
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeStateRecord(env, user, state, expectedRevision) {
  const current = await readStateRecord(env, user);
  const currentRevision = current?.revision || 0;
  if (current && expectedRevision && expectedRevision !== currentRevision) {
    return { ok: false, currentRevision, updatedAt: current.updatedAt || null };
  }
  const next = {
    revision: currentRevision + 1,
    updatedAt: new Date().toISOString(),
    state,
  };
  if (env.GAMEHUB_STATE && typeof env.GAMEHUB_STATE.put === 'function' && !String(env.GAMEHUB_STATE).includes('REPLACE_WITH_REAL_KV_ID')) {
    await env.GAMEHUB_STATE.put(`state:${user}`, JSON.stringify(next));
    return { ok: true, revision: next.revision, updatedAt: next.updatedAt };
  }
  await mkdir(LOCAL_STATE_DIR, { recursive: true });
  const path = `${LOCAL_STATE_DIR}/${user}.json`;
  await writeFile(path, JSON.stringify(next, null, 2), 'utf8');
  return { ok: true, revision: next.revision, updatedAt: next.updatedAt };
}

function sanitizeUser(user) {
  return String(user || 'default').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'default';
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
