export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/state')) {
      if (!env.GAMEHUB_STATE) {
        return json({ error: 'KV binding GAMEHUB_STATE not configured' }, 500);
      }

      if (request.method === 'GET') {
        const user = url.searchParams.get('user') || 'default';
        const state = await env.GAMEHUB_STATE.get(`state:${user}`, 'text');
        return json({ user, state: state ? JSON.parse(state) : null });
      }

      if (request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body || !body.user || typeof body.state !== 'object') {
          return json({ error: 'Expected { user, state }' }, 400);
        }
        await env.GAMEHUB_STATE.put(`state:${body.user}`, JSON.stringify(body.state));
        return json({ ok: true });
      }

      return json({ error: 'Method not allowed' }, 405);
    }

    return env.ASSETS.fetch(request);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
