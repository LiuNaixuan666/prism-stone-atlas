const CACHE_PREFIX = "prism-atlas-";
const CACHE = `${CACHE_PREFIX}v5`;
const SCOPE_URL = new URL("./", self.registration.scope);
const APP_ROOT = SCOPE_URL.toString();
const ASSET_PATH = new URL("assets/", SCOPE_URL).pathname;
const API_PATH = new URL("api/", SCOPE_URL).pathname;
const CORE = ["", "data/prism-stones.json", "manifest.webmanifest", "prism-icon.png"].map((path) => new URL(path, SCOPE_URL).toString());
const CORE_PATHS = new Set(CORE.map((value) => new URL(value).pathname));

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
      return url.origin === self.location.origin && url.pathname.startsWith(SCOPE_URL.pathname) ? cacheOne(cache, url.href) : null;
    }));
  } catch { /* the stylesheet itself is still cached */ }
}

async function cacheDocumentAssets(cache, response, baseUrl) {
  try {
    const document = await response.clone().text();
    const urls = Array.from(document.matchAll(/(?:src|href)=["']([^"']+)["']/g), (match) => match[1]);
    await Promise.allSettled(urls.map(async (value) => {
      const url = new URL(value, baseUrl);
      const isAppAsset = url.pathname.startsWith(ASSET_PATH) || CORE_PATHS.has(url.pathname);
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
    if (path === APP_ROOT && response?.ok) await cacheDocumentAssets(cache, response, APP_ROOT);
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

  if (url.origin === self.location.origin && url.pathname.startsWith(API_PATH)) return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await Promise.all([
            cache.put(APP_ROOT, response.clone()),
            cacheDocumentAssets(cache, response, event.request.url),
          ]);
        }
        return response;
      } catch {
        return (await caches.match(APP_ROOT)) || Response.error();
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE_URL.pathname)) return;
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
