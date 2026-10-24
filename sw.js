// sw.js — Duo Lab offline support.
// Shell (hub, shared/, icons) = cache-first with background refresh.
// Apps (apps/*) = network-first with cache fallback, so experiments stay fresh but still open offline.
// All URLs are resolved against the registration scope, so the site works under a subpath (e.g. /duo/).

const VERSION = 'v1-__BUILD__'; // __BUILD__ is stamped with the commit SHA at deploy time
const SHELL_CACHE = `duo-lab-shell-${VERSION}`;
const APPS_CACHE = `duo-lab-apps-${VERSION}`;
const FONT_CACHE = 'duo-lab-fonts-v1';

const scope = new URL(self.registration.scope);
const at = p => new URL(p, scope).href;

const SHELL = [
  './', 'index.html', 'hub.css', 'hub.js', 'manifest.webmanifest', 'og.png',
  'shared/fold.js', 'shared/kit.js', 'shared/duo.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
].map(at);
const APPS = ['booth', 'sealed', 'hockey', 'liquid'].map(a => at(`apps/${a}/`));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map(u => shell.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    const apps = await caches.open(APPS_CACHE);
    await Promise.all(APPS.map(u => apps.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, APPS_CACHE, FONT_CACHE]);
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('duo-lab-') && !keep.has(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

const isFont = url => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (isFont(url)) { event.respondWith(cacheFirst(req, FONT_CACHE)); return; }
  if (url.origin !== scope.origin || !url.href.startsWith(scope.href)) return;

  const rel = url.pathname.slice(scope.pathname.length);
  if (rel.startsWith('apps/')) { event.respondWith(networkFirst(req, APPS_CACHE)); return; }
  event.respondWith(cacheFirst(req, SHELL_CACHE, true));
});

async function cacheFirst(req, cacheName, revalidate = false) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
  const refresh = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  });
  if (hit) {
    if (revalidate) refresh.catch(() => {});
    return hit;
  }
  try { return await refresh; }
  catch (e) {
    if (req.mode === 'navigate') return (await cache.match(at('./'))) || Response.error();
    throw e;
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const hub = await caches.match(at('./'));
      if (hub) return hub;
    }
    throw e;
  }
}
