self.addEventListener("install", (e) => {
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  self.clients.claim();
});
// Simple network-first handler for navigation requests
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/")));
  }
});
