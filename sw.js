// App-Shell-Cache fürs schnelle/offline Öffnen der UI. Network-first: bei Code-Updates (neuer
// Push) soll die frische Version ankommen, ohne dass die Cache-Versionsnummer manuell hochgezählt
// werden muss -- der Cache ist nur ein Fallback für offline/langsames Netz.
// Drive-API-Aufrufe (cross-origin) werden bewusst nicht angefasst -- Daten müssen live sein.
const CACHE = "handybridge-v2";
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
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
