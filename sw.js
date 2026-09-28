// App-Shell-Cache fürs Offline-Öffnen der UI. Drive-API-Aufrufe (cross-origin) werden bewusst
// NICHT gecacht -- Daten müssen live sein, nur die statische Oberfläche soll sofort laden.
const CACHE = "handybridge-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "config.js", "manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // Drive/GIS-Requests unangetastet lassen
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
