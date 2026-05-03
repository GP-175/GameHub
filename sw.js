/* ============================================================
 * GameHub – Service Worker
 * Caches the app shell + all games so they work offline once
 * the kid has visited at least once. Bump CACHE_VERSION when
 * you change any asset so browsers pick up the new copy.
 * ========================================================== */
const CACHE_VERSION = 'gamehub-v19';
const CORE_ASSETS = [
  './',
  './index.html',
  './parent.html',
  './manifest.webmanifest',
  './assets/styles.css',
  './assets/hub.js',
  './assets/icon.svg',
  './games/color-match.html',
  './games/shape-sorter.html',
  './games/animal-friends.html',
  './games/counting-adventure.html',
  './games/spelling-bee.html',
  './games/letter-hunt.html',
  './games/science-sorter.html',
  './games/world-explorer.html',
  './games/space-adventure.html',
  './games/gem-quest.html',
  './games/jaxx-quest.html',
  './games/jaxx-world.html',
  './games/gp-hoot.html',
  './games/cube-crash.html',
  './games/snake.html',
];

// ── Install: pre-cache the app shell ──────────────────────────
// Some hosts redirect /foo.html → /foo.
// cache.add() refuses redirected responses, so we fetch manually with
// `redirect: follow` and store the final response under the original URL.
// We also store it under the redirected URL so either path hits the cache.
async function cacheOne(cache, url) {
  try {
    const resp = await fetch(url, { redirect: 'follow', cache: 'reload' });
    if (!resp || !resp.ok) throw new Error('bad status ' + (resp && resp.status));
    // Rebuild the Response so the `redirected` flag is cleared. Browsers
    // refuse to use a redirected cached response for navigation requests
    // (whose redirect mode is "manual"), which would fail with ERR_FAILED.
    const body = await resp.blob();
    const clean = new Response(body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: resp.headers,
    });
    await cache.put(url, clean.clone());
    // Also cache under the final URL in case links ever use the canonical form.
    const absUrl = new URL(url, self.location).href;
    if (resp.redirected && resp.url && resp.url !== absUrl) {
      await cache.put(resp.url, clean.clone());
    }
  } catch (err) {
    console.warn('[SW] skip', url, err);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(CORE_ASSETS.map((url) => cacheOne(cache, url)))
    )
  );
  self.skipWaiting();
});

// ── Activate: clear old caches ────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first for same-origin GETs, network for the rest ──
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isDynamicRoute =
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/') ||
    url.pathname.startsWith('/uploads/');

  // GP-hoot APIs, sockets, and uploaded files are dynamic. Never satisfy them
  // from the app-shell cache, otherwise quiz CRUD screens can show stale data.
  if (sameOrigin && isDynamicRoute) {
    event.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }

  if (sameOrigin) {
    event.respondWith((async () => {
      const isNavigation = req.mode === 'navigate' || req.destination === 'document';
      const isHtmlLike = req.headers.get('accept')?.includes('text/html');

      if (isNavigation || isHtmlLike) {
        try {
          const resp = await fetch(req, { cache: 'no-store' });
          if (resp && resp.ok && !resp.redirected) {
            const copy = resp.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return resp;
        } catch (e) {
          let cached = await caches.match(req);
          if (cached) return cached;
          const alt = url.pathname.endsWith('.html')
            ? url.pathname.slice(0, -5)
            : url.pathname + '.html';
          cached = await caches.match(alt);
          if (cached) return cached;
          return caches.match('./index.html');
        }
      }

      let cached = await caches.match(req);
      if (cached) return cached;

      const alt = url.pathname.endsWith('.html')
        ? url.pathname.slice(0, -5)
        : url.pathname + '.html';
      cached = await caches.match(alt);
      if (cached) return cached;

      try {
        const resp = await fetch(req);
        if (resp && resp.ok && !resp.redirected) {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return resp;
      } catch (e) {
        return caches.match('./index.html');
      }
    })());
    return;
  }

  // Cross-origin (e.g., Three.js CDN, Google Fonts) — network-first, cache on success
  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp && resp.ok && !resp.redirected) {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return resp;
      })
      .catch(() => caches.match(req))
  );
});
