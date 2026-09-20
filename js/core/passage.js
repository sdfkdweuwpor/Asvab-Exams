/* Paragraph Comprehension: original passages, each carrying more questions
   than any single test uses. Which ones appear rotates with the seed, so the
   same passage yields a different set on a later attempt. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rng.js'), require('./engine.js'));
  else { root.ASVAB = root.ASVAB || {}; root.ASVAB.passage = factory(root.ASVAB.rng, root.ASVAB.engine); }
})(typeof self !== 'undefined' ? self : this, function (rng, engine) {
  'use strict';
  var LETTERS = ['A', 'B', 'C', 'D'];

  function renderQuestion(psg, q, seed) {
    var uid = psg.id + '/' + q.id;
    var ds = (q.distractors || []).slice(0, 3);
    if (ds.length < 3) throw new Error(uid + ': needs 3 distractors, has ' + ds.length);

    var slot = engine.correctSlot(uid, seed);
    var options = new Array(4);
    options[slot] = { text: q.answer, isCorrect: true, error: null };
    var di = 0;
    for (var s = 0; s < 4; s++) {
      if (s === slot) continue;
      options[s] = { text: ds[di].text, isCorrect: false, error: ds[di].error || null };
      di++;
    }
    options.forEach(function (o, i) { o.key = LETTERS[i]; });

    return {
      uid: uid + ':' + seed,
      source: 'passage',
      template_id: uid,
      passage_id: psg.id,
      seed: seed,
      subtest: 'PC',
      topic: q.type,
      difficulty: q.difficulty || psg.difficulty || 2,
      composites: [],
      passage: psg.text,
      passage_title: psg.title || '',
      stem: q.prompt,
      figure: null,
      options: options,
      correctKey: LETTERS[slot],
      correctIndex: slot,
      solution_steps: q.explanation ? [q.explanation] : [],
      recognition_cue: q.recognition_cue || '',
      lesson: q.lesson || null,
      target_seconds: q.target_seconds || 65
    };
  }

  // Pick `count` questions, preferring one of each type before doubling up.
  function selectQuestions(psg, seed, count) {
    var r = rng.make(psg.id + ':' + seed + ':qsel');
    var byType = {};
    psg.questions.forEach(function (q) { (byType[q.type] = byType[q.type] || []).push(q); });
    var types = r.shuffle(Object.keys(byType));
    var picked = [], used = {};
    types.forEach(function (t) {
      var q = r.pick(byType[t]);
      if (!used[q.id]) { used[q.id] = true; picked.push(q); }
    });
    var rest = r.shuffle(psg.questions.filter(function (q) { return !used[q.id]; }));
    while (picked.length < count && rest.length) picked.push(rest.shift());
    return r.shuffle(picked).slice(0, count);
  }

  function render(psg, seed, count) {
    var n = Math.min(count || 3, psg.questions.length);
    return selectQuestions(psg, seed, n).map(function (q) { return renderQuestion(psg, q, seed); });
  }

  return { render: render, renderQuestion: renderQuestion, selectQuestions: selectQuestions };
});
