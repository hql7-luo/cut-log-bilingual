// Cache only the public application shell. User records stay in browser storage.
const CACHE = "cut-log-shell-v1";
const isAsset = (url) => url.origin === self.location.origin && url.pathname.startsWith("/_next/static/");

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(["/", "/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith("cut-log-shell-") && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener("message", (event) => {
  if (event.data?.type !== "precache" || !Array.isArray(event.data.urls)) return;
  const assets = event.data.urls.slice(0, 100).filter((value) => {
    try { return isAsset(new URL(value)); } catch { return false; }
  });
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.allSettled(assets.map((url) => cache.add(url)))));
});
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isAsset(url)) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }));
  } else if (request.mode === "navigate" && url.origin === self.location.origin && url.pathname === "/") {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      try {
        const response = await fetch(request);
        if (response.ok && !url.search) await cache.put("/", response.clone());
        return response;
      } catch {
        return (await cache.match("/")) ?? new Response("打开网页一次后即可离线使用。", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    }));
  }
});
