/* Sliding In 4 — offline shell.
   Network-first for navigations and code so deploys are never pinned to a stale cache;
   cache-first only for content-stable assets. Bump CACHE_NAME on every release. */
var CACHE_NAME = 'sliding-in-4-v3';
var APP_SHELL = ['./', './index.html', './lesson-data.js', './app-runtime.js',
                 './manifest.webmanifest', './icon-192.png', './icon-512.png',
                 './mapping-data.json', './sliding-in-image-map.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE_NAME).then(function (c) { return c.addAll(APP_SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; })
      .map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;   // never intercept cross-origin
  var isCode = /\.(js|mjs|css|html|webmanifest|json|png)$/i.test(url.pathname);

  if (e.request.mode === 'navigate' || isCode) {
    e.respondWith(
      fetch(e.request).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(e.request).then(function (c) { return c || caches.match('./index.html'); });
      })
    );
    return;
  }

  e.respondWith(caches.match(e.request).then(function (cached) {
    return cached || fetch(e.request);
  }));
});
