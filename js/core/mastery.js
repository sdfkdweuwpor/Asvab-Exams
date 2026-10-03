/* Word Knowledge mastery -- the rules behind "got it / missed it".

   A word is mastered once it is answered right twice in a row. Twice rather
   than once, because a four-option question is guessed right a quarter of the
   time and twice running by luck only one time in sixteen. A miss resets the
   run and the word comes back: a few cards later in the same round, and first
   in line next round.

   Pure functions over a plain {id: record} map, so validate.js can run them
   under Node. Records are compact, like the seen table:
     s  current run of right answers
     n  times answered
     c  times right
     m  times missed
     l  when last answered (ISO) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.ASVAB = root.ASVAB || {}; root.ASVAB.mastery = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MASTER_AT = 2;   // right this many times in a row
  var REASK_GAP = 3;   // a missed word returns after this many other cards
  var REASK_MAX = 2;   // ...and at most this many extra times in one round

  function status(rec) {
    if (!rec || !rec.n) return 'new';
    if (rec.s >= MASTER_AT) return 'mastered';
    return rec.s > 0 ? 'learning' : 'missed';
  }

  // A new record; the old one is never mutated, so "I guessed" can undo.
  function apply(rec, gotIt, when) {
    var r = {
      s: (rec && rec.s) || 0, n: (rec && rec.n) || 0,
      c: (rec && rec.c) || 0, m: (rec && rec.m) || 0, l: null
    };
    r.n++;
    if (gotIt) { r.s++; r.c++; } else { r.s = 0; r.m++; }
    r.l = when || new Date().toISOString();
    return r;
  }

  function summary(ids, records) {
    var out = { total: ids.length, 'new': 0, missed: 0, learning: 0, mastered: 0 };
    ids.forEach(function (id) { out[status(records[id])]++; });
    return out;
  }

  /* Missed words first, then half-learned ones, then words never seen, so a
     round always opens on what most needs doing. Each group is shuffled --
     source order would put the same words first every time. Mastered words
     appear only in a review round. n of 0 means everything that qualifies. */
  function pickRound(ids, records, n, rng, opts) {
    opts = opts || {};
    var groups = { missed: [], learning: [], 'new': [], mastered: [] };
    ids.forEach(function (id) { groups[status(records[id])].push(id); });
    var order = opts.review ? ['mastered'] : ['missed', 'learning', 'new'];
    var out = [];
    order.forEach(function (g) { out = out.concat(rng.shuffle(groups[g])); });
    return n ? out.slice(0, n) : out;
  }

  // Where a card missed at `pos` goes back into a queue of `length`.
  function reaskAt(pos, length) { return Math.min(pos + 1 + REASK_GAP, length); }

  return {
    MASTER_AT: MASTER_AT, REASK_GAP: REASK_GAP, REASK_MAX: REASK_MAX,
    status: status, apply: apply, summary: summary,
    pickRound: pickRound, reaskAt: reaskAt
  };
});
