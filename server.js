import { mkdir, readFile, writeFile } from 'node:fs/promises';

const LOCAL_STATE_DIR = '/srv/gamehub/.data';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/state')) {
      if (request.method === 'GET') {
        const user = sanitizeUser(url.searchParams.get('user') || 'default');
        const state = await readState(env, user);
        return json({ user, state });
      }

      if (request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body || !body.user || typeof body.state !== 'object') {
          return json({ error: 'Expected { user, state }' }, 400);
        }
        const user = sanitizeUser(body.user);
        await writeState(env, user, body.state);
        return json({ ok: true, user });
      }

      return json({ error: 'Method not allowed' }, 405);
    }

    return env.ASSETS.fetch(request);
  }
};

async function readState(env, user) {
  if (env.GAMEHUB_STATE && typeof env.GAMEHUB_STATE.get === 'function' && !String(env.GAMEHUB_STATE).includes('REPLACE_WITH_REAL_KV_ID')) {
    const state = await env.GAMEHUB_STATE.get(`state:${user}`, 'text');
    return state ? JSON.parse(state) : null;
  }
  try {
    const path = `${LOCAL_STATE_DIR}/${user}.json`;
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeState(env, user, state) {
  if (env.GAMEHUB_STATE && typeof env.GAMEHUB_STATE.put === 'function' && !String(env.GAMEHUB_STATE).includes('REPLACE_WITH_REAL_KV_ID')) {
    await env.GAMEHUB_STATE.put(`state:${user}`, JSON.stringify(state));
    return;
  }
  await mkdir(LOCAL_STATE_DIR, { recursive: true });
  const path = `${LOCAL_STATE_DIR}/${user}.json`;
  await writeFile(path, JSON.stringify(state, null, 2), 'utf8');
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
