/* Service worker: precache the shell so the app installs to a phone and keeps
   working with no connection.

   Bump CACHE whenever the shell changes. The fetch handler revalidates in the
   background so a missed bump self-heals after one load rather than pinning
   people to old files forever, but a bump still gets everyone current at once.

   The question chunks under data/questions.*.js are deliberately NOT precached.
   They are ~1.3MB in total and load on demand, so a first run does not pay for
   ten subtests to answer fifteen questions. The fetch handler caches each one
   the first time it is requested, which means a subtest works offline once it
   has been used once. Figures under assets/figures/ behave the same way.

   CACHE bumps whenever the shell or the content bundle changes; validate.js
   checks that PRECACHE still matches what is actually in the repository. */

var CACHE = 'asvab-practice-v4';

var PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './data/bundle.js',
  './data/questions.manifest.js',
  './js/core/rng.js',
  './js/core/data.js',
  './js/core/bankdata.js',
  './js/core/items.js',
  './js/core/variants.js',
  './js/core/scoring.js',
  './js/core/state.js',
  './js/core/exam.js',
  './js/core/analytics.js',
  './js/core/workon.js',
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
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./index.html', copy); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (r) {
          return r || caches.match('./');
        });
      })
    );
    return;
  }

  /* Stale-while-revalidate, not cache-first.

     Cache-first was here and it had a failure mode worth spelling out: the
     cache is only replaced when CACHE changes, CACHE only changes when this
     file changes, and this file does not change just because a stylesheet did.
     Ship an edited styles.css without touching sw.js and every returning
     visitor keeps the old one indefinitely -- which is exactly what happened,
     pairing a fresh index.html against a stale stylesheet.

     So: answer from cache immediately, which keeps the app instant and fully
     offline, and revalidate in the background so the next load is current. A
     change costs one stale load instead of never arriving. */
  e.respondWith(
    caches.match(req).then(function (hit) {
      var fresh = fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // Offline: the cached copy is the answer, and for a navigation-ish
        // request the shell is a better failure than nothing.
        return hit || caches.match('./index.html');
      });
      return hit || fresh;
    })
  );
});
