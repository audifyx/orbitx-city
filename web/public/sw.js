// OrbitX City service worker — app-shell cache, network-first API.
// RULE: bump CACHE on every push that changes the shell (game.js, index.html,
// CSS, icons) — otherwise phones keep serving the old bundle from this cache.
// v16 (2026-11-17): 5-act interactive splash flyover + full 3D building
// architectural details, roof textures, bus-route & unit test fixes; on top of
// v15 economy (Leaderboards panel, snap earned, startJob rollback) and v14.
const CACHE = "orbitx-city-v16";
const PRECACHE = [
  "/",
  "/index.html",
  "/game.js",
  "/style.css",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
  "/logo/logo-lockup.svg",
  "/logo/mark.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // API: never serve stale data — network only.
  if (url.pathname.startsWith("/api/")) return;
  // Cross-origin: leave alone.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // App shell: network first, fall back to the cached shell (offline).
    // Every navigation serves index.html (vercel rewrites /stats -> /index.html),
    // so caching the response as /index.html is correct for all routes.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Static assets: cache first, populate on miss.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
    )
  );
});
