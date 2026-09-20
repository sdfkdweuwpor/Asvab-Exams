/* Seeded, deterministic PRNG + sampling helpers.
   Same (template_id, seed) must render the same item forever, in any runtime. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.ASVAB = root.ASVAB || {}; root.ASVAB.rng = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // FNV-1a over a string -> 32-bit unsigned. Used to turn ids into seed material.
  function hashString(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32 -- small, fast, good enough distribution for item generation.
  function make(seed) {
    var a = (typeof seed === 'string' ? hashString(seed) : (seed >>> 0)) || 0x9e3779b9;
    function next() {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    var r = {
      next: next,
      // integer in [min, max] inclusive
      int: function (min, max) { return min + Math.floor(next() * (max - min + 1)); },
      // integer in [min, max] on a step grid, inclusive of min
      step: function (min, max, step) {
        var n = Math.floor((max - min) / step);
        return min + r.int(0, n) * step;
      },
      pick: function (arr) { return arr[r.int(0, arr.length - 1)]; },
      bool: function (p) { return next() < (p === undefined ? 0.5 : p); },
      shuffle: function (arr) {
        var a2 = arr.slice();
        for (var i = a2.length - 1; i > 0; i--) {
          var j = r.int(0, i);
          var t = a2[i]; a2[i] = a2[j]; a2[j] = t;
        }
        return a2;
      },
      // n distinct members of arr, order randomized
      sample: function (arr, n) { return r.shuffle(arr).slice(0, n); }
    };
    return r;
  }

  return { make: make, hashString: hashString };
});
