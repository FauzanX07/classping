// Lets Class Ping on the web open with no connection (the saved posts are in
// IndexedDB; this keeps the page itself). Network first, so a new version of the
// site is always picked up when online. Only this site's own files are kept:
// requests to Google are never touched.
const CACHE = "classping-web-v1";

self.addEventListener("install", (event) => { self.skipWaiting(); });

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((reply) => {
        if (reply.ok) { const copy = reply.clone(); caches.open(CACHE).then((c) => c.put(request, copy)); }
        return reply;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("./"))));
});
