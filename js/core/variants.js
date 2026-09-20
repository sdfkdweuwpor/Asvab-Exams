/* Number-swapped variants of bank questions, for DRILL PRACTICE ONLY.

   The reasoning, because it constrains everything here: a fixed bank means a
   student eventually recognises a question rather than solving it. For an
   arithmetic item that is easy to fix -- change the numbers and the reasoning
   has to be redone -- and for a missed item that is genuinely useful practice.

   But a generated item is not a real exam question, so:
     - variants NEVER appear in an exam, only in drills, and only if the
       student opts in;
     - a variant is only produced when the stem is mechanically solvable with
       certainty. Anything this module cannot re-solve exactly is left alone
       rather than guessed at, because a variant with a wrong answer teaches
       an error, which is the failure the whole bank pipeline exists to avoid.

   The recognisers below are deliberately narrow. Low coverage is the correct
   trade: a variant that is wrong is far worse than no variant. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rng.js'));
  else { root.ASVAB = root.ASVAB || {}; root.ASVAB.variants = factory(root.ASVAB.rng); }
})(typeof self !== 'undefined' ? self : this, function (rng) {
  'use strict';

  var LETTERS = ['A', 'B', 'C', 'D'];

  function money(v) {
    var neg = v < 0, a = Math.abs(v);
    var whole = Math.abs(a - Math.round(a)) < 1e-9;
    var s = whole ? String(Math.round(a)) : a.toFixed(2);
    s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '−' : '') + '$' + s;
  }
  function plain(v) {
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return String(Math.round(v * 100) / 100);
  }

  /* Each recogniser returns null, or {resample(r) -> {stem, value, fmt}}.
     `rebuild` puts the new numbers back into the original wording, so the
     variant reads like the question it came from rather than like a template. */
  var RECOGNISERS = [

    // "12 miles ... $3.50 per mile" -> quantity x rate
    function unitCost(stem) {
      var re = /(\d+(?:\.\d+)?)(\s*(?:miles|items|units|pounds|hours|gallons|feet|yards|square feet))\b([^.]{0,60}?\$\s*)(\d+(?:\.\d+)?)(\s*(?:per|a|each)\b)/i;
      var m = stem.match(re);
      if (!m) return null;
      // A second price in the stem means tiered pricing, which this cannot redo.
      if ((stem.match(/\$\s*\d/g) || []).length > 1) return null;
      if (/\bfirst\b|\bover\b|\bthen\b|\badditional\b/i.test(stem)) return null;
      return {
        resample: function (r) {
          var qty = r.int(3, 40);
          var cents = r.pick([25, 50, 75, 0]);
          var rate = r.int(2, 12) + cents / 100;
          var out = stem.replace(re, function (_, a, b, c, dd, e) {
            return plain(qty) + b + c + (cents ? rate.toFixed(2) : String(Math.round(rate))) + e;
          });
          return { stem: out, value: qty * rate, fmt: money };
        }
      };
    },

    // "What is 15% of 80?"
    function percentOf(stem) {
      var re = /(\d+(?:\.\d+)?)(\s*%\s+of\s+\$?)(\d+(?:\.\d+)?)/i;
      var m = stem.match(re);
      if (!m) return null;
      if ((stem.match(/%/g) || []).length > 1) return null;
      var dollars = /\$/.test(m[2]);
      return {
        resample: function (r) {
          var p = r.pick([5, 10, 12, 15, 20, 25, 30, 40, 60, 75]);
          var base = r.int(4, 60) * 5;
          var out = stem.replace(re, function (_, a, b, c) { return p + b + base; });
          return { stem: out, value: p / 100 * base, fmt: dollars ? money : plain };
        }
      };
    },

    // "A 12-foot x 16-foot room" -> area
    function rectArea(stem) {
      if (!/how many square|\barea\b/i.test(stem)) return null;
      if (/\$|\bcost\b|\bcharges?\b|\bprice\b/i.test(stem)) return null;
      var re = /(\d+(?:\.\d+)?)(\s*-?\s*(?:foot|feet|yard|inch|meter)\s*[x×*]\s*)(\d+(?:\.\d+)?)/i;
      if (!re.test(stem)) return null;
      return {
        resample: function (r) {
          var w = r.int(4, 30), h = r.int(4, 30);
          var out = stem.replace(re, function (_, a, b, c) { return w + b + h; });
          return { stem: out, value: w * h, fmt: plain };
        }
      };
    }
  ];

  function recognise(stem) {
    for (var i = 0; i < RECOGNISERS.length; i++) {
      var got = RECOGNISERS[i](stem || '');
      if (got) { got.kind = RECOGNISERS[i].name; return got; }
    }
    return null;
  }

  function canVary(rec) {
    if (!rec || (rec.subtest !== 'AR' && rec.subtest !== 'MK')) return false;
    return !!recognise(rec.stem);
  }

  /* Distractors come from the mistakes these questions actually invite: the
     two numbers added instead of multiplied, the rate dropped, an order of
     magnitude slipped. Each is checked to be distinct and positive. */
  function distractorsFor(value, r) {
    var cands = [value * 2, value / 2, value * 10, value / 10,
                 value + 10, Math.max(1, value - 10), value * 1.5];
    var out = [], seen = { };
    seen[value.toFixed(2)] = true;
    var order = r.shuffle(cands);
    for (var i = 0; i < order.length && out.length < 3; i++) {
      var v = order[i];
      if (!isFinite(v) || v <= 0) continue;
      var k = v.toFixed(2);
      if (seen[k]) continue;
      seen[k] = true;
      out.push(v);
    }
    return out;
  }

  /* Build one variant of a bank record. Returns null if the item is not one
     this module can re-solve, which is the common case and is fine. */
  function make(rec, seed) {
    if (!canVary(rec)) return null;
    var spec = recognise(rec.stem);
    var r = rng.make((rec.id || 'v') + ':var:' + seed);

    for (var attempt = 0; attempt < 24; attempt++) {
      var got;
      try { got = spec.resample(r); } catch (e) { continue; }
      if (!got || !isFinite(got.value) || got.value <= 0) continue;
      // Keep the arithmetic clean: a variant answering $41.9375 is not practice.
      var cents = Math.round(got.value * 100) / 100;
      if (Math.abs(cents - got.value) > 1e-9) continue;

      var ds = distractorsFor(got.value, r);
      if (ds.length < 3) continue;

      var texts = [got.fmt(got.value)].concat(ds.map(got.fmt));
      var uniq = {};
      var dup = false;
      texts.forEach(function (t) { if (uniq[t]) dup = true; uniq[t] = true; });
      if (dup) continue;

      var slot = rng.hashString((rec.id || 'v') + '#' + seed + '#slot') % 4;
      var options = new Array(4);
      options[slot] = { key: null, text: texts[0], isCorrect: true, error: null, svg: null };
      var di = 0;
      for (var s = 0; s < 4; s++) {
        if (s === slot) continue;
        options[s] = { key: null, text: texts[di + 1], isCorrect: false, error: null, svg: null };
        di++;
      }
      options.forEach(function (o, i) { o.key = LETTERS[i]; });

      return {
        uid: rec.id + ':v' + seed,
        source: 'variant',
        template_id: rec.id,          // the real item it practises
        variantOf: rec.id,
        seed: seed,
        subtest: rec.subtest,
        topic: (rec.topics || [])[0] || null,
        difficulty: rec.difficulty || 3,
        composites: [],
        stem: got.stem,
        figure: null,
        options: options,
        correctKey: LETTERS[slot],
        correctIndex: slot,
        solution_steps: ['Same method as the question you missed, with different numbers.'],
        recognition_cue: '',
        lesson: null,
        target_seconds: 60,
        isVariant: true
      };
    }
    return null;
  }

  return { make: make, canVary: canVary, recognise: recognise };
});
