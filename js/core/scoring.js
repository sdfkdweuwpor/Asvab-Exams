/* Scoring: raw counts -> standard scores -> VE, an AFQT percentile ESTIMATE,
   its category, and the line-score composites.

   Honesty note, and it matters: the real ASVAB conversion tables are not
   published. Everything below is a documented approximation built on the
   published STRUCTURE of the test (standard scores with mean 50 and standard
   deviation 10, VE derived from WK and PC, AFQT = 2VE + AR + MK). It is useful
   for tracking progress and comparing subtests against each other. It is not a
   prediction of an official score, and the UI labels it an estimate everywhere
   it appears.

   The numbers themselves live in config/scoring.json and config/composites.json
   so a branch or a cut score can change without touching this file. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else { root.ASVAB = root.ASVAB || {}; root.ASVAB.scoring = factory(root.ASVAB.data); }
})(typeof self !== 'undefined' ? self : this, function (data) {
  'use strict';

  function cfg() { return data.scoringConfig || {}; }
  function ss() { return cfg().standard_score || { min: 20, max: 80, mean: 50, sd: 10 }; }

  // Abramowitz & Stegun 26.2.17 normal CDF; plenty accurate for a percentile.
  function normalCdf(z) {
    var s = z < 0 ? -1 : 1;
    z = Math.abs(z) / Math.SQRT2;
    var t = 1 / (1 + 0.3275911 * z);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return 0.5 * (1 + s * y);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function standardScore(correct, total) {
    if (!total) return null;
    var b = ss();
    return clamp(Math.round(b.min + (b.max - b.min) * (correct / total)), b.min, b.max);
  }

  /* VE is a derived verbal score, not a plain sum. WK and PC are pooled with
     published-format weights into a single proportion, which is then read off
     a table and interpolated between rows. */
  function verbalScore(wk, pc) {
    var v = cfg().ve;
    if (!v) return null;
    var wkT = (wk && wk.total) || 0, pcT = (pc && pc.total) || 0;
    if (!wkT && !pcT) return null;
    var wkP = wkT ? wk.correct / wkT : null;
    var pcP = pcT ? pc.correct / pcT : null;
    // If only one side was administered it carries the whole score rather than
    // being averaged against a zero that was never asked.
    var raw;
    if (wkP === null) raw = pcP;
    else if (pcP === null) raw = wkP;
    else raw = v.weights.WK * wkP + v.weights.PC * pcP;

    var table = v.table;
    for (var i = 0; i < table.length - 1; i++) {
      var a = table[i], b = table[i + 1];
      if (raw >= a.raw && raw <= b.raw) {
        var span = b.raw - a.raw;
        var t = span ? (raw - a.raw) / span : 0;
        return Math.round(a.ve + t * (b.ve - a.ve));
      }
    }
    return table[table.length - 1].ve;
  }

  function afqtPercentile(afqtRaw) {
    var a = cfg().afqt || { sd: 37 };
    var mean = 4 * ss().mean;
    return clamp(Math.round(normalCdf((afqtRaw - mean) / a.sd) * 100), 1, 99);
  }

  function afqtCategory(pct) {
    var list = (cfg().afqt || {}).categories || [];
    for (var i = 0; i < list.length; i++) {
      if (pct >= list[i].min && pct <= list[i].max) return list[i];
    }
    return null;
  }

  /* Branch minimums, split by diploma and GED because the two differ sharply
     and showing one number would mislead whoever it does not apply to. */
  function branchEligibility(pct, credential) {
    var bm = cfg().branch_minimums || { branches: [] };
    var key = credential === 'ged' ? 'ged' : 'diploma';
    return bm.branches.map(function (b) {
      return {
        code: b.code, name: b.name, need: b[key], credential: key,
        diploma: b.diploma, ged: b.ged,
        meets: pct !== null && pct !== undefined && pct >= b[key],
        gap: pct === null || pct === undefined ? null : Math.max(0, b[key] - pct)
      };
    });
  }

  function score(tallies, historyN, opts) {
    opts = opts || {};
    var out = {};
    data.subtests.forEach(function (s) {
      var t = tallies[s.code];
      out[s.code] = t && t.total ? standardScore(t.correct, t.total) : null;
    });

    var wk = tallies.WK || { correct: 0, total: 0 }, pc = tallies.PC || { correct: 0, total: 0 };
    var ve = verbalScore(wk, pc);

    // AS is Auto and Shop pooled, as the composite formulas expect. Ambiguous
    // AS items count toward the pool too, which is the only place they appear.
    var ai = tallies.AI || { correct: 0, total: 0 },
        si = tallies.SI || { correct: 0, total: 0 },
        amb = tallies.AS || { correct: 0, total: 0 };
    var asTotal = ai.total + si.total + amb.total;
    var as = asTotal ? standardScore(ai.correct + si.correct + amb.correct, asTotal) : null;

    var terms = {};
    data.subtests.forEach(function (s) { terms[s.code] = out[s.code]; });
    terms.VE = ve;
    terms.AS = as;

    function have(list) {
      for (var i = 0; i < list.length; i++) {
        if (terms[list[i]] === null || terms[list[i]] === undefined) return false;
      }
      return true;
    }

    var afqt = null;
    if (have(['VE', 'AR', 'MK'])) {
      var raw = 2 * ve + out.AR + out.MK;
      var veTotal = wk.total + pc.total;
      var afqtItems = veTotal + (tallies.AR || {}).total + (tallies.MK || {}).total;
      var afqtCorrect = wk.correct + pc.correct + (tallies.AR || {}).correct + (tallies.MK || {}).correct;
      var pct = afqtPercentile(raw);
      afqt = {
        raw: raw,
        percentile: pct,
        category: afqtCategory(pct),
        band: confidenceBand(afqtCorrect, afqtItems, historyN || afqtItems),
        sample: historyN || afqtItems,
        estimate: true,
        basis: 'Percent correct mapped onto the 20-80 standard-score band, VE read ' +
               'from a weighted WK/PC table, then 2VE + AR + MK placed on a normal ' +
               'curve. The official conversion tables are not public.'
      };
    }

    // Composites, read from config so a branch can be added without code.
    var groups = (data.compositeGroups || []).map(function (g) {
      return {
        id: g.id, branch: g.branch, label: g.label, note: g.note || '',
        composites: g.composites.map(function (c) { return build(c); })
      };
    });

    function build(c) {
      if (!have(c.terms)) {
        return { code: c.code, label: c.label, formula: c.formula, available: false };
      }
      var vals = c.terms.map(function (t) { return terms[t]; });
      var value = vals.reduce(function (a, b) { return a + b; }, 0);
      var mean = vals.length * ss().mean;
      var sd = ss().sd * Math.sqrt(vals.length) * 1.5;   // correlated terms widen the spread
      var z = (value - mean) / sd;
      return {
        code: c.code, label: c.label, formula: c.formula, available: true,
        value: value, mean: mean, max: vals.length * ss().max,
        z: z, strength: strengthLabel(z),
        fraction: clamp((value - vals.length * ss().min) / (vals.length * (ss().max - ss().min)), 0, 1)
      };
    }

    // The Air Force group keeps its old shape, so existing reports keep working.
    var mage = {};
    var afGroup = groups.filter(function (g) { return g.id === 'mage'; })[0];
    if (afGroup) afGroup.composites.forEach(function (c) { mage[c.code] = c; });
    var ranked = Object.keys(mage).filter(function (k) { return mage[k].available; })
      .sort(function (a, b) { return mage[b].z - mage[a].z; });
    ranked.forEach(function (k, i) { mage[k].rank = i + 1; });

    return {
      standard: out, ve: ve, as: as, afqt: afqt,
      composites: mage, compositeGroups: groups,
      eligibility: afqt ? branchEligibility(afqt.percentile, opts.credential) : null,
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
     shrinks with sample size, so 40 questions gives a wide band and 400 a
     narrow one. */
  function confidenceBand(correct, total, sampleN) {
    var n = Math.max(sampleN || total, 1);
    var p = total ? correct / total : 0.5;
    var se = Math.sqrt(Math.max(p * (1 - p), 0.01) / n);
    function pctAt(prop) {
      var b = ss();
      var s = clamp(b.min + (b.max - b.min) * clamp(prop, 0, 1), b.min, b.max);
      return afqtPercentile(4 * s);
    }
    var hi = pctAt(p + 1.96 * se), lo = pctAt(p - 1.96 * se);
    return Math.max(1, Math.round((hi - lo) / 2));
  }

  function tally(results) {
    var out = {};
    results.forEach(function (r) {
      if (!r.subtest) return;
      var t = out[r.subtest] = out[r.subtest] || { correct: 0, total: 0 };
      t.total++;
      if (r.correct) t.correct++;
    });
    return out;
  }

  return {
    score: score, tally: tally, standardScore: standardScore,
    verbalScore: verbalScore, afqtPercentile: afqtPercentile,
    afqtCategory: afqtCategory, branchEligibility: branchEligibility,
    confidenceBand: confidenceBand, normalCdf: normalCdf,
    get SS_MIN() { return ss().min; }, get SS_MAX() { return ss().max; }
  };
});
