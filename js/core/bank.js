/* Curated-bank item generator (WK, GS, AI, SI).
   Facts can't be parameterised, so the bank stores the fact and the four
   options are assembled at render time from semantically near-miss answers
   drawn from the same category -- length-matched so the correct option never
   stands out as the longest or most detailed. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rng.js'), require('./engine.js'));
  else { root.ASVAB = root.ASVAB || {}; root.ASVAB.bank = factory(root.ASVAB.rng, root.ASVAB.engine); }
})(typeof self !== 'undefined' ? self : this, function (rng, engine) {
  'use strict';

  var LETTERS = ['A', 'B', 'C', 'D'];

  function norm(s) { return String(s).trim().toLowerCase(); }

  // Everything in the same category that is not this entry's answer and not
  // listed as an accepted equivalent of it.
  function candidatePool(entry, allEntries) {
    var banned = {};
    banned[norm(entry.answer)] = true;
    (entry.exclude || []).forEach(function (x) { banned[norm(x)] = true; });

    var pool = [], seen = {};
    function push(text, curated) {
      var n = norm(text);
      if (banned[n] || seen[n]) return;
      seen[n] = true;
      pool.push({ text: String(text), curated: !!curated });
    }
    (entry.near_misses || []).forEach(function (t) { push(t, true); });
    for (var i = 0; i < allEntries.length; i++) {
      var e = allEntries[i];
      if (e.id === entry.id) continue;
      if (e.category !== entry.category) continue;
      push(e.answer, false);
      (e.near_misses || []).forEach(function (t) { push(t, false); });
    }
    return pool;
  }

  function buildOptions(entry, allEntries, seed) {
    var r = rng.make(entry.id + ':' + seed + ':opts');
    var pool = candidatePool(entry, allEntries);
    var target = String(entry.answer).length;

    // Prefer curated near-misses, then closest in length to the answer. Ties
    // are broken by the seeded rng so repeat encounters vary.
    var keyed = pool.map(function (p, i) {
      return { p: p, lenGap: Math.abs(p.text.length - target), jitter: rng.make(entry.id + ':' + seed + ':' + i).next() };
    });
    keyed.sort(function (a, b) {
      if (a.p.curated !== b.p.curated) return a.p.curated ? -1 : 1;
      if (a.lenGap !== b.lenGap) return a.lenGap - b.lenGap;
      return a.jitter - b.jitter;
    });

    // Curated near-misses are the hand-checked hard distractors, so at least
    // two of them are always used when they exist. The remaining slot rotates
    // through category mates, which keeps repeat encounters from being
    // identical without letting an unvetted option take over the item.
    var curated = keyed.filter(function (k) { return k.p.curated; });
    var rest = keyed.filter(function (k) { return !k.p.curated; });
    var chosen = [];
    if (curated.length) {
      chosen = r.shuffle(curated).slice(0, Math.min(curated.length, 2)).map(function (k) { return k.p.text; });
    }
    var windowSize = Math.min(rest.length, Math.max(3, 6));
    var filler = r.shuffle(rest.slice(0, windowSize)).map(function (k) { return k.p.text; });
    var pool2 = r.shuffle(curated.map(function (k) { return k.p.text; }).filter(function (t) { return chosen.indexOf(t) < 0; }));
    while (chosen.length < 3 && filler.length) chosen.push(filler.shift());
    while (chosen.length < 3 && pool2.length) chosen.push(pool2.shift());
    if (chosen.length < 3) return null;
    return r.shuffle(chosen);
  }

  function render(entry, allEntries, seed, opts) {
    opts = opts || {};
    var distractors = buildOptions(entry, allEntries, seed);
    if (!distractors) throw new Error('bank entry "' + entry.id + '": fewer than 3 usable distractors in category "' + entry.category + '"');

    var texts = [String(entry.answer)].concat(distractors);
    var slot = engine.correctSlot(entry.id, seed);
    var options = new Array(4);
    options[slot] = { text: texts[0], isCorrect: true, error: null };
    var di = 0;
    for (var s = 0; s < 4; s++) {
      if (s === slot) continue;
      var t = texts[di + 1];
      options[s] = {
        text: t,
        isCorrect: false,
        error: (entry.why_wrong && entry.why_wrong[t]) || 'a plausible member of the same category, but not what the question asks for'
      };
      di++;
    }
    options.forEach(function (o, i) { o.key = LETTERS[i]; });

    var stem = entry.prompt;
    if (entry.sentence) stem = entry.sentence + '\n\n' + entry.prompt;

    return {
      uid: entry.id + ':' + seed,
      source: 'bank',
      template_id: entry.id,
      seed: seed,
      subtest: entry.subtest,
      topic: entry.topic,
      difficulty: entry.difficulty || 2,
      composites: entry.composites || [],
      stem: stem,
      figure: null,
      options: options,
      correctKey: LETTERS[slot],
      correctIndex: slot,
      solution_steps: entry.explanation ? [entry.explanation] : [],
      recognition_cue: entry.recognition_cue || '',
      lesson: entry.lesson || null,
      target_seconds: entry.target_seconds || 25
    };
  }

  return { render: render, candidatePool: candidatePool };
});
