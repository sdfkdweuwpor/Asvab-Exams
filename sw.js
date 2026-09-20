/* Service worker: precache everything so the app installs to a phone and keeps
   working with no connection. There is no backend, so once these files are
   cached the app is complete offline -- questions are generated on device.

   CACHE bumps whenever the shell or the content bundle changes; validate.js
   checks that PRECACHE still matches what is actually in the repository. */

var CACHE = 'asvab-practice-v1';

var PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './data/bundle.js',
  './js/core/rng.js',
  './js/core/expr.js',
  './js/core/figures.js',
  './js/core/engine.js',
  './js/core/data.js',
  './js/core/bank.js',
  './js/core/passage.js',
  './js/core/ao.js',
  './js/core/scoring.js',
  './js/core/state.js',
  './js/core/exam.js',
  './js/core/analytics.js',
  './js/app/dom.js',
  './js/app/runner.js',
  './js/app/report.js',
  './js/app/lessons.js',
  './js/app/app.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // addAll fails the whole install if one entry 404s, so entries are added
      // individually: a missing optional icon must not leave the app uncached.
      .then(function (c) {
        return Promise.all(PRECACHE.map(function (url) {
          return c.add(new Request(url, { cache: 'reload' })).catch(function () { });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* Navigations fall back to the cached shell, so deep links such as
     index.html#/lessons still open offline. */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match('./index.html').then(function (r) {
          return r || caches.match('./');
        });
      })
    );
    return;
  }

  // Cache first: these assets are versioned by the cache name, never by URL.
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html');
      });
    })
  );
});
