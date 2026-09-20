/* Bank record -> the rendered item shape the runner, report and lessons already
   consume. This adapter is the whole content-layer swap: nothing in js/app/
   changes because nothing there ever saw a template.

   What the bank cannot supply, it omits rather than invents. A generated item
   named the specific error behind every wrong option; a real exam question
   comes with one explanation and no per-option analysis. Every consumer of
   `error` and `recognition_cue` already guards for absence, so the review
   degrades to the explanation instead of fabricating a rationale. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'));
  } else {
    root.ASVAB = root.ASVAB || {};
    root.ASVAB.items = factory(root.ASVAB.data);
  }
})(typeof self !== 'undefined' ? self : this, function (data) {
  'use strict';

  var LETTERS = ['A', 'B', 'C', 'D', 'E'];

  // Auto and Shop share the Mechanical composite and pool into AS at scoring
  // time, so an ambiguous item inherits Auto's structural slot.
  function cfgFor(code) {
    return data.subtest(code) || data.subtest(code === 'AS' ? 'AI' : code) || null;
  }

  function targetSeconds(code) {
    var c = cfgFor(code);
    if (!c || !c.items) return 45;
    return Math.max(15, Math.round(c.seconds / c.items));
  }

  function compositesFor(code) {
    var c = cfgFor(code);
    return (c && c.composites) || [];
  }

  /* The lesson id is the subtest prefix plus the topic, which is how all 64
     lessons are named. AS has no prefix of its own, so it tries both sides. */
  function lessonFor(code, topic) {
    if (!topic) return null;
    var tries = code === 'AS' ? ['ai_' + topic, 'si_' + topic]
      : [code.toLowerCase() + '_' + topic];
    for (var i = 0; i < tries.length; i++) {
      if (data.lesson(tries[i])) return tries[i];
    }
    return null;
  }

  function figureHtml(rec) {
    if (!rec.figure) return null;
    // Width is capped in CSS; the source images are 96 DPI so upscaling them
    // only blurs. alt text says what it is, since the figure carries the
    // question and a screen reader would otherwise get nothing.
    return '<img class="qfig" src="' + rec.figure + '" alt="Figure for question ' +
      rec.source_number + '" loading="lazy">';
  }

  /* Options keep the order the source printed them in. The extracted bank's
     answer letters are already close to uniform (A 24.0, B 27.3, C 26.3,
     D 22.4 per cent), so shuffling buys no balance, and it would break both the
     explanations that name a letter and the Assembling Objects figures, which
     have A-D drawn into the image. */
  function buildOptions(rec) {
    var keys = Object.keys(rec.options || {}).sort();
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      out.push({
        key: k,
        text: String(rec.options[k]),
        isCorrect: k === rec.answer,
        error: null,
        svg: null
      });
    }
    return out;
  }

  function render(rec, seed) {
    if (!rec) return null;
    var options = buildOptions(rec);
    var correctIndex = -1;
    for (var i = 0; i < options.length; i++) if (options[i].isCorrect) correctIndex = i;
    if (correctIndex < 0) return null;

    var topic = (rec.topics && rec.topics[0]) || null;
    var isPC = rec.subtest === 'PC';
    var expl = (rec.explanation || '').trim();

    return {
      uid: rec.id + ':' + (seed || 0),
      source: 'pdf',
      template_id: rec.id,
      seed: seed || 0,
      subtest: rec.subtest,
      topic: topic,
      difficulty: rec.difficulty || 2,
      composites: compositesFor(rec.subtest),
      stem: isPC ? (rec.question || rec.stem) : rec.stem,
      figure: figureHtml(rec),
      options: options,
      correctKey: options[correctIndex].key,
      correctIndex: correctIndex,
      solution_steps: expl ? [expl] : [],
      recognition_cue: '',
      lesson: lessonFor(rec.subtest, topic),
      target_seconds: targetSeconds(rec.subtest),
      passage: isPC ? (rec.passage || null) : null,
      passage_title: null,
      passage_id: rec.passage_id || null,
      flags: rec.flags || [],
      source_number: rec.source_number
    };
  }

  return {
    render: render, lessonFor: lessonFor, targetSeconds: targetSeconds,
    compositesFor: compositesFor, LETTERS: LETTERS
  };
});
