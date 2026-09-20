/* Scoring: raw counts -> standard scores -> VE, an AFQT percentile ESTIMATE,
   and the four Air Force MAGE composites.

   Honesty note, and it matters: the real ASVAB conversion tables are not
   published. Everything below is a documented approximation built on the
   published STRUCTURE of the test (standard scores with mean 50 and standard
   deviation 10, VE derived from WK+PC, AFQT = 2VE + AR + MK). It is useful for
   tracking progress and comparing subtests against each other. It is not a
   prediction of an official score, and the UI labels it as an estimate
   everywhere it appears. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else { root.ASVAB = root.ASVAB || {}; root.ASVAB.scoring = factory(root.ASVAB.data); }
})(typeof self !== 'undefined' ? self : this, function (data) {
  'use strict';

  var SS_MIN = 20, SS_MAX = 80, SS_MEAN = 50;

  // Abramowitz & Stegun 26.2.17 normal CDF; plenty accurate for a percentile.
  function normalCdf(z) {
    var s = z < 0 ? -1 : 1;
    z = Math.abs(z) / Math.SQRT2;
    var t = 1 / (1 + 0.3275911 * z);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return 0.5 * (1 + s * y);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Percent correct -> standard score. Linear across the 20-80 band, so half
  // right lands on the mean of 50. Deliberately simple: an invented S-curve
  // would look more sophisticated without being any better justified.
  function standardScore(correct, total) {
    if (!total) return null;
    return clamp(Math.round(SS_MIN + (SS_MAX - SS_MIN) * (correct / total)), SS_MIN, SS_MAX);
  }

  // AFQT composite spread. The four terms are correlated, so the composite's
  // spread is wider than independent terms would give; 37 is a working value.
  var AFQT_MEAN = 4 * SS_MEAN;   // 2*VE + AR + MK with every term at the mean
  var AFQT_SD = 37;

  function afqtPercentile(afqtRaw) {
    return clamp(Math.round(normalCdf((afqtRaw - AFQT_MEAN) / AFQT_SD) * 100), 1, 99);
  }

  /* results: [{subtest, correct}] style tallies keyed by subtest code:
       { GS:{correct,total}, AR:{...}, ... }
     history_n: how many AFQT-relevant items the student has answered in total,
     across every session. Widens or narrows the confidence band. */
  function score(tallies, historyN) {
    var ss = {};
    data.subtests.forEach(function (s) {
      var t = tallies[s.code];
      ss[s.code] = t && t.total ? standardScore(t.correct, t.total) : null;
    });

    // VE comes from WK and PC pooled, not from averaging two standard scores.
    var wk = tallies.WK || { correct: 0, total: 0 }, pc = tallies.PC || { correct: 0, total: 0 };
    var veTotal = wk.total + pc.total;
    var ve = veTotal ? standardScore(wk.correct + pc.correct, veTotal) : null;

    // AS is Auto and Shop pooled into one score, as the MAGE formula expects.
    var ai = tallies.AI || { correct: 0, total: 0 }, si = tallies.SI || { correct: 0, total: 0 };
    var asTotal = ai.total + si.total;
    var as = asTotal ? standardScore(ai.correct + si.correct, asTotal) : null;

    function need(vals) {
      for (var i = 0; i < vals.length; i++) if (vals[i] === null || vals[i] === undefined) return false;
      return true;
    }

    var afqt = null;
    if (need([ve, ss.AR, ss.MK])) {
      var raw = 2 * ve + ss.AR + ss.MK;
      var afqtItems = veTotal + (tallies.AR || {}).total + (tallies.MK || {}).total;
      var afqtCorrect = wk.correct + pc.correct + (tallies.AR || {}).correct + (tallies.MK || {}).correct;
      afqt = {
        raw: raw,
        percentile: afqtPercentile(raw),
        band: confidenceBand(afqtCorrect, afqtItems, historyN || afqtItems),
        sample: historyN || afqtItems,
        estimate: true,
        basis: 'Percent correct mapped linearly onto the 20-80 standard-score band ' +
               '(half right = 50), then 2VE + AR + MK placed on a normal curve. ' +
               'The official conversion tables are not public.'
      };
    }

    // Each composite: terms, its all-average value, and how far it sits from it.
    var composites = {
      M: build('M', [ss.AR, ve, ve, ss.MC, as], need([ss.AR, ve, ss.MC, as])),
      A: build('A', [ve, ss.MK], need([ve, ss.MK])),
      G: build('G', [ve, ss.AR], need([ve, ss.AR])),
      E: build('E', [ss.AR, ss.MK, ss.EI, ss.GS], need([ss.AR, ss.MK, ss.EI, ss.GS]))
    };

    function build(code, terms, ok) {
      if (!ok) return { code: code, available: false, label: data.config.composites[code].label, formula: data.config.composites[code].formula };
      var value = terms.reduce(function (a, b) { return a + b; }, 0);
      var mean = terms.length * SS_MEAN;
      var sd = 10 * Math.sqrt(terms.length) * 1.5;   // correlated terms widen the spread
      var z = (value - mean) / sd;
      return {
        code: code, available: true,
        label: data.config.composites[code].label,
        formula: data.config.composites[code].formula,
        value: value, mean: mean, max: terms.length * SS_MAX,
        z: z, strength: strengthLabel(z),
        // 0..1, for drawing a bar
        fraction: clamp((value - terms.length * SS_MIN) / (terms.length * (SS_MAX - SS_MIN)), 0, 1)
      };
    }

    var ranked = Object.keys(composites)
      .filter(function (k) { return composites[k].available; })
      .sort(function (a, b) { return composites[b].z - composites[a].z; });
    ranked.forEach(function (k, i) { composites[k].rank = i + 1; });

    return {
      standard: ss, ve: ve, as: as, afqt: afqt, composites: composites,
      strongest: ranked[0] || null, weakest: ranked[ranked.length - 1] || null
    };
  }

  function strengthLabel(z) {
    if (z >= 1.0) return 'well above average';
    if (z >= 0.35) return 'above average';
    if (z > -0.35) return 'around average';
    if (z > -1.0) return 'below average';
    return 'well below average';
  }

  /* Confidence band on the AFQT percentile. The standard error of a proportion
     shrinks with sample size, so a student who has answered 40 questions gets a
     wide band and one who has answered 400 gets a narrow one. */
  function confidenceBand(correct, total, sampleN) {
    var n = Math.max(sampleN || total, 1);
    var p = total ? correct / total : 0.5;
    var se = Math.sqrt(Math.max(p * (1 - p), 0.01) / n);
    // Move all four terms together by +/- 1.96 SE and see where the percentile lands.
    function pctAt(prop) {
      var s = clamp(SS_MIN + (SS_MAX - SS_MIN) * clamp(prop, 0, 1), SS_MIN, SS_MAX);
      return afqtPercentile(4 * s);
    }
    var hi = pctAt(p + 1.96 * se), lo = pctAt(p - 1.96 * se);
    return Math.max(1, Math.round((hi - lo) / 2));
  }

  // Tally helper: per_item_results -> {CODE:{correct,total}}
  function tally(results) {
    var out = {};
    results.forEach(function (r) {
      var t = out[r.subtest] = out[r.subtest] || { correct: 0, total: 0 };
      t.total++;
      if (r.correct) t.correct++;
    });
    return out;
  }

  return {
    score: score, tally: tally, standardScore: standardScore,
    afqtPercentile: afqtPercentile, confidenceBand: confidenceBand,
    normalCdf: normalCdf, SS_MIN: SS_MIN, SS_MAX: SS_MAX
  };
});
