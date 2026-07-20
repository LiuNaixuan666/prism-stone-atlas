const CACHE_PREFIX = "prism-atlas-";
const CACHE = `${CACHE_PREFIX}v4`;
const CORE = ["/", "/data/prism-stones.json", "/manifest.webmanifest", "/prism-icon.png"];

async function cacheOne(cache, request) {
  try {
    const response = await fetch(request, { cache: "reload" });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return null;
  }
}

async function cacheCssDependencies(cache, response, baseUrl) {
  try {
    const css = await response.clone().text();
    const urls = Array.from(css.matchAll(/url\(["']?([^"')]+)["']?\)/g), (match) => match[1]);
    await Promise.allSettled(urls.map((value) => {
      const url = new URL(value, baseUrl);
      return url.origin === self.location.origin ? cacheOne(cache, url.href) : null;
    }));
  } catch { /* the stylesheet itself is still cached */ }
}

async function cacheDocumentAssets(cache, response, baseUrl) {
  try {
    const document = await response.clone().text();
    const urls = Array.from(document.matchAll(/(?:src|href)=["']([^"']+)["']/g), (match) => match[1]);
    await Promise.allSettled(urls.map(async (value) => {
      const url = new URL(value, baseUrl);
      const isAppAsset = url.pathname.startsWith("/assets/") || CORE.includes(url.pathname);
      if (url.origin !== self.location.origin || !isAppAsset) return;
      const asset = await cacheOne(cache, url.href);
      if (asset?.ok && url.pathname.endsWith(".css")) await cacheCssDependencies(cache, asset, url.href);
    }));
  } catch { /* the document and core data remain available */ }
}

async function refreshShell() {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(CORE.map(async (path) => {
    const response = await cacheOne(cache, path);
    if (path === "/" && response?.ok) await cacheDocumentAssets(cache, response, self.location.origin);
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(refreshShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Authentication and cloud backup must never fall back to cached page data.
  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await Promise.all([
            cache.put("/", response.clone()),
            cacheDocumentAssets(cache, response, event.request.url),
          ]);
        }
        return response;
      } catch {
        return (await caches.match("/")) || Response.error();
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(event.request, response.clone());
    }
    return response;
  })());
});
