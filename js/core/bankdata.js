/* Access to the extracted question bank.

   The bank ships as one chunk per subtest (data/questions.<CODE>.js), each a
   plain script that assigns into ASVAB_BANK. Chunks are .js rather than .json
   because index.html has to work when it is double-clicked, and browsers block
   fetch() on file:// URLs -- the same reason data/bundle.js is a script tag.

   Chunks load on demand: a Word Knowledge drill should not pull the 174KB of
   Paragraph Comprehension with it. ensure() is the gate, and everything that
   starts or resumes a session goes through it. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(null);
  } else {
    root.ASVAB = root.ASVAB || {};
    root.ASVAB.bankdata = factory(root);
  }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var NODE = !root;
  var MANIFEST = null;
  var index = {};        // id -> record, across every loaded chunk
  var pending = {};      // code -> [callbacks] while a chunk is in flight

  function store() {
    if (NODE) {
      root = root || {};
      return root.ASVAB_BANK || (root.ASVAB_BANK = {});
    }
    return root.ASVAB_BANK || (root.ASVAB_BANK = {});
  }

  function manifest() {
    if (MANIFEST) return MANIFEST;
    if (NODE) {
      MANIFEST = require('../../data/questions.manifest.json');
    } else {
      MANIFEST = root.ASVAB_BANK_MANIFEST || { subtests: {} };
    }
    return MANIFEST;
  }

  function codes() { return Object.keys(manifest().subtests || {}); }

  function indexChunk(code) {
    var list = store()[code] || [];
    for (var i = 0; i < list.length; i++) index[list[i].id] = list[i];
    return list;
  }

  function isLoaded(code) { return !!store()[code]; }

  function forSubtest(code) {
    if (!isLoaded(code)) return [];
    if (!forSubtest._done) forSubtest._done = {};
    if (!forSubtest._done[code]) { indexChunk(code); forSubtest._done[code] = true; }
    return store()[code] || [];
  }

  function byId(id) {
    if (index[id]) return index[id];
    // An id carries its subtest, so a miss can load exactly the one chunk that
    // could hold it rather than all ten.
    var code = String(id).split('-')[0];
    if (isLoaded(code)) { forSubtest(code); return index[id] || null; }
    return null;
  }

  /* Load whatever is missing, then call back. Synchronous under Node, and
     already-loaded chunks call back on the same tick in the browser too, so a
     caller never has to care which. */
  function ensure(wanted, cb) {
    cb = cb || function () { };
    var list = (wanted && wanted.length ? wanted : codes())
      .filter(function (c, i, a) { return a.indexOf(c) === i; });

    if (NODE) {
      list.forEach(function (code) {
        if (isLoaded(code)) return;
        try {
          var mod = require('../../data/questions.' + code + '.js');
          var s = store();
          if (mod && mod.ASVAB_BANK && mod.ASVAB_BANK[code]) s[code] = mod.ASVAB_BANK[code];
        } catch (e) { /* a subtest with no chunk simply has no items */ }
        forSubtest(code);
      });
      cb();
      return;
    }

    var missing = list.filter(function (c) { return !isLoaded(c); });
    if (!missing.length) { list.forEach(forSubtest); cb(); return; }

    var left = missing.length;
    var done = function () {
      if (--left > 0) return;
      list.forEach(forSubtest);
      cb();
    };

    missing.forEach(function (code) {
      if (pending[code]) { pending[code].push(done); return; }
      pending[code] = [done];
      var s = document.createElement('script');
      // Same build stamp the page was served with, so a lazily loaded chunk
      // cannot come back from an older cache than the code reading it.
      var stamp = (root.ASVAB_BUILD ? '?v=' + root.ASVAB_BUILD : '');
      s.src = 'data/questions.' + code + '.js' + stamp;
      s.async = true;
      var finish = function () {
        var waiting = pending[code] || [];
        delete pending[code];
        waiting.forEach(function (fn) { fn(); });
      };
      s.onload = finish;
      // A chunk that fails to load must not hang the session: the subtest ends
      // up empty and buildSection simply returns fewer items.
      s.onerror = finish;
      document.head.appendChild(s);
    });
  }

  function counts() {
    var out = {};
    var subs = manifest().subtests || {};
    Object.keys(subs).forEach(function (c) { out[c] = subs[c].count; });
    return out;
  }

  function total() {
    return Object.keys(counts()).reduce(function (a, c) { return a + counts()[c]; }, 0);
  }

  return {
    ensure: ensure, byId: byId, forSubtest: forSubtest, isLoaded: isLoaded,
    codes: codes, counts: counts, total: total, manifest: manifest
  };
});
