/* ============================================================
 * GameHub – Service Worker
 * Caches the app shell + all games so they work offline once
 * the kid has visited at least once. Bump CACHE_VERSION when
 * you change any asset so browsers pick up the new copy.
 * ========================================================== */
const CACHE_VERSION = 'gamehub-v2';
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
];

// ── Install: pre-cache the app shell ──────────────────────────
// Some hosts (e.g. Cloudflare Pages/Workers) redirect /foo.html → /foo.
// cache.add() refuses redirected responses, so we fetch manually with
// `redirect: follow` and store the final response under the original URL.
// We also store it under the redirected URL so either path hits the cache.
async function cacheOne(cache, url) {
  try {
    const resp = await fetch(url, { redirect: 'follow', cache: 'reload' });
    if (!resp || !resp.ok) throw new Error('bad status ' + (resp && resp.status));
    // The response's `.redirected` flag tells us if we went through a redirect.
    // Cache under the requested URL (what the browser will ask for).
    await cache.put(url, resp.clone());
    // Also cache under the final URL in case links ever use the canonical form.
    if (resp.redirected && resp.url) {
      await cache.put(resp.url, resp.clone());
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

  if (sameOrigin) {
    // Cache-first with a couple of tolerant fallbacks
    event.respondWith((async () => {
      // 1. Try exact URL match
      let cached = await caches.match(req);
      if (cached) return cached;

      // 2. Try alternate form (strip or add .html) — helps when hosts
      //    redirect /foo.html → /foo but SW was asked for the other form.
      const alt = url.pathname.endsWith('.html')
        ? url.pathname.slice(0, -5)
        : url.pathname + '.html';
      cached = await caches.match(alt);
      if (cached) return cached;

      // 3. Go to the network and opportunistically cache the response
      try {
        const resp = await fetch(req);
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return resp;
      } catch (e) {
        // 4. Offline and nothing cached — fall back to the landing page
        return caches.match('./index.html');
      }
    })());
    return;
  }

  // Cross-origin (e.g., Three.js CDN, Google Fonts) — network-first, cache on success
  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return resp;
      })
      .catch(() => caches.match(req))
  );
});
