// Lets Class Ping on the web open with no connection (the saved posts are in
// IndexedDB; this keeps the page itself). Network first, so a new version of the
// site is always picked up when online. Only this site's own files are kept:
// requests to Google are never touched.
const CACHE = "classping-web-v8";       // bump with the ?v= on app.js; old copies are dropped when this changes

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
    fetch(request, { cache: "no-cache" })       // never a stale file from the browser's own cache
      .then((reply) => {
        // Only whole, same-site answers are kept (a partial 206 cannot be cached and used to throw).
        if (reply.ok && reply.status === 200 && reply.type === "basic") {
          const copy = reply.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => { /* a full disk is not a reason to fail the page */ });
        }
        return reply;
      })
      .catch(() => caches.match(request).then((hit) => hit || (request.mode === "navigate" ? caches.match("./") : Response.error()))));
});
