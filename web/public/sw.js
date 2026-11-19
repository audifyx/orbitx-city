// OrbitX City service worker — app-shell cache, network-first API.
// RULE: bump CACHE on every push that changes the shell (game.js, index.html,
// CSS, icons) — otherwise phones keep serving the old bundle from this cache.
// v21 (2026-11-18): MEGA PUSH — building-entry doors, vehicle fixes, bus+train
// operator jobs, Home Workshop 2D editor, 25 ORBITX billboards, Arcade PvP
// pot games (Coin Flip + Dice Roll).
const CACHE = "orbitx-city-v26";
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
