/* =========================================================
   Service Worker — Diario Escolar de Voz (PWA offline)
   Estrategia: Cache First con actualización en segundo plano
   ========================================================= */

const CACHE = "ded-pwa-v2";

const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./exporters.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

// Instalar: precachear el shell de la app
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(
        ASSETS.map((url) =>
          fetch(url, { cache: "reload" })
            .then((res) => (res.ok ? cache.put(url, res) : null))
            .catch(() => null)
        )
      )
    )
  );
  self.skipWaiting();
});

// Activar: limpiar caches viejos
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

// Fetch: cache primero, red como respaldo (y actualización silenciosa)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // Navegaciones: red primero, si falla la app cacheada
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() =>
          caches.match("./index.html").then((r) => r || caches.match("./"))
        )
    );
    return;
  }

  // Resto: cache primero
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // Actualizar en segundo plano
        fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
          })
          .catch(() => null);
        return cached;
      }
      return fetch(req)
        .then((res) => {
          if (res && res.ok && new URL(res.url).origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
