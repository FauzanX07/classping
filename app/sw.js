// Lets Class Ping on the web open with no connection (the saved posts are in
// IndexedDB; this keeps the page itself). Network first, so a new version of the
// site is always picked up when online. Only this site's own files are kept:
// requests to Google are never touched.
const CACHE = "classping-web-v9";       // bump with the ?v= on app.js; old copies are dropped when this changes

// The page and its files, kept at the first visit, so the very first reload after going offline works
// too. The ?v= numbers are the ones index.html and app.js ask for (they go up together with CACHE).
const SHELL = [
  "./", "manifest.webmanifest", "app.css?v=17", "app.js?v=18",
  "auth.js?v=16", "api.js?v=16", "store.js?v=16", "sort.js?v=16", "demo.js?v=16", "config.js?v=16",
  "../style.css?v=19", "../site.js?v=12", "../logo.png?v=5", "../logo-name.png?v=5", "../favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => { /* one missing file must not stop the update */ }))))
      .catch(() => { /* works without it */ })
      .then(() => self.skipWaiting()));
});

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
