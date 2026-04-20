/* ============================================================
 * GameHub – Service Worker
 * Caches the app shell + all games so they work offline once
 * the kid has visited at least once. Bump CACHE_VERSION when
 * you change any asset so browsers pick up the new copy.
 * ========================================================== */
const CACHE_VERSION = 'gamehub-v1';
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
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Use addAll with individual fallbacks so one 404 doesn't kill install
      Promise.all(
        CORE_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] skip', url, err))
        )
      )
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
    // Cache-first with network fallback
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((resp) => {
            // Opportunistically cache successful same-origin GETs
            if (resp && resp.ok) {
              const copy = resp.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
            }
            return resp;
          })
          .catch(() => caches.match('./index.html')); // offline fallback
      })
    );
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
