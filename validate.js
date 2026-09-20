#!/usr/bin/env node
/* Content + engine validator. Run: node validate.js [--seeds N] [--quiet]

   This is the gate the whole build leans on: templates are only worth writing
   once the renderer is provably producing sound items, so every check here
   runs against real renders rather than against the JSON alone. */
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = __dirname;

const rng = require('./js/core/rng.js');
const expr = require('./js/core/expr.js');
const engine = require('./js/core/engine.js');
const bankGen = require('./js/core/bank.js');
const passageGen = require('./js/core/passage.js');
const ao = require('./js/core/ao.js');
const bundler = require('./tools/bundle.js');
const data = require('./js/core/data.js');

const args = process.argv.slice(2);
const SEEDS = (() => { const i = args.indexOf('--seeds'); return i >= 0 ? parseInt(args[i + 1], 10) : 50; })();
const QUIET = args.includes('--quiet');

let failures = 0, warnings = 0, checks = 0;
// Collapse repeats: one broken template fails on every seed, and 50 identical
// lines bury the next real problem.
const seenMsgs = new Map();
const MAX_REPEATS = 3;
const dedupe = (section, msg, emit) => {
  const key = section + '|' + msg.replace(/\d+/g, '#');
  const n = (seenMsgs.get(key) || 0) + 1;
  seenMsgs.set(key, n);
  if (n <= MAX_REPEATS) emit();
  else if (n === MAX_REPEATS + 1) emit('  ...  [' + section + '] (further identical reports suppressed)');
};
const fail = (section, msg) => {
  failures++;
  dedupe(section, msg, (alt) => console.error(alt || ('  FAIL  [' + section + '] ' + msg)));
};
const warn = (section, msg) => {
  warnings++;
  if (!QUIET) dedupe(section, msg, (alt) => console.warn(alt || ('  warn  [' + section + '] ' + msg)));
};
const pass = (section, msg) => { checks++; if (!QUIET) console.log('  ok    [' + section + '] ' + msg); };
const head = (t) => { if (!QUIET) console.log('\n' + t); };

// ---------------------------------------------------------------- bundle
head('Bundle freshness');
{
  const expected = bundler.serialize(bundler.build());
  const dest = path.join(ROOT, 'data/bundle.js');
  const actual = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : '';
  if (actual !== expected) {
    fs.writeFileSync(dest, expected);
    warn('bundle', 'data/bundle.js was stale — regenerated. Commit the new bundle.');
  } else {
    pass('bundle', 'data/bundle.js matches the JSON sources');
  }
}

// ---------------------------------------------------------------- config
head('Config');
{
  const cfg = data.config;
  const items = cfg.subtests.reduce((a, s) => a + s.items, 0);
  const mins = cfg.subtests.reduce((a, s) => a + s.seconds, 0) / 60;
  items === 145 ? pass('config', 'full test is 145 items') : fail('config', 'full test is ' + items + ' items, expected 145');
  Math.abs(mins - cfg.total_minutes) < 0.5
    ? pass('config', 'subtest time limits sum to ' + mins + ' minutes')
    : fail('config', 'time limits sum to ' + mins + ' min but total_minutes says ' + cfg.total_minutes);
  const dx = Object.values(cfg.diagnostic.spread).reduce((a, b) => a + b, 0);
  dx === cfg.diagnostic.items ? pass('config', 'diagnostic spread sums to ' + dx)
    : fail('config', 'diagnostic spread sums to ' + dx + ', expected ' + cfg.diagnostic.items);
  cfg.subtests.forEach(s => {
    if (!cfg.topics[s.code]) fail('config', s.code + ' has no topic list');
    if (!Array.isArray(s.sources) || !s.sources.length) fail('config', s.code + ' has no sources list');
    (s.sources || []).forEach(src => {
      if (!['bank', 'template', 'passage', 'procedural'].includes(src)) fail('config', s.code + ' has unknown source "' + src + '"');
    });
  });
}

// ------------------------------------------------------- template schema
head('Template schema');
{
  const REQUIRED = ['id', 'subtest', 'topic', 'difficulty', 'stem', 'distractors', 'solution_steps', 'recognition_cue', 'target_seconds', 'lesson'];
  const ids = new Set();
  data.templates.forEach(t => {
    const where = (t._file || '?') + ':' + (t.id || '<no id>');
    REQUIRED.forEach(k => { if (t[k] === undefined) fail('schema', where + ' missing "' + k + '"'); });
    if (t.answer === undefined && t.answer_text === undefined) fail('schema', where + ' needs "answer" or "answer_text"');
    // Every template must be independently checkable: a numeric answer needs a
    // second formula that reaches it another way; a symbolic answer needs an
    // identity that holds when probe values are substituted in.
    if (t.answer !== undefined && !t.verify) fail('schema', where + ' needs a "verify" expression that recomputes the answer a different way');
    if (t.answer_text !== undefined && !(t.identity && t.identity.lhs && t.identity.rhs)) {
      fail('schema', where + ' has a symbolic answer and needs an "identity" {lhs, rhs} to check it numerically');
    }
    if (ids.has(t.id)) fail('schema', 'duplicate template id "' + t.id + '"');
    ids.add(t.id);
    if (!(data.config.topics[t.subtest] || []).includes(t.topic)) {
      fail('schema', where + ' topic "' + t.topic + '" is not a declared ' + t.subtest + ' subtopic');
    }
    if (t.difficulty < 1 || t.difficulty > 4) fail('schema', where + ' difficulty ' + t.difficulty + ' outside 1-4');
    if ((t.distractors || []).length < 3) fail('schema', where + ' has ' + (t.distractors || []).length + ' distractors, needs 3+');
    if (!(t.skins && t.skins.length >= 4) && !t.no_skins) {
      fail('schema', where + ' has ' + ((t.skins || []).length) + ' context skins, needs 4+');
    }
    if ((t.solution_steps || []).length < 2) fail('schema', where + ' needs 2+ solution steps');
    // A skin word and a numeric parameter sharing a name means the number
    // silently replaces the word in the stem.
    const paramNames = new Set([].concat(Object.keys(t.params || {}), Object.keys(t.derived || {})));
    (t.skins || []).forEach(sk => Object.keys(sk).forEach(k => {
      if (paramNames.has(k)) fail('schema', where + ' skin key "' + k + '" collides with a parameter of the same name');
    }));
    Object.keys(t.derived || {}).forEach(k => {
      if ((t.params || {})[k] !== undefined) fail('schema', where + ' derived name "' + k + '" collides with a parameter');
    });
    if (t.figure && !require('./js/core/figures.js').kinds.includes(t.figure.kind)) {
      fail('schema', where + ' unknown figure kind "' + t.figure.kind + '"');
    }
    // every name an expression reads must be suppliable
    const known = new Set([].concat(Object.keys(t.params || {}), Object.keys(t.derived || {}), ['answer'],
      (t.skins || []).reduce((a, s) => a.concat(Object.keys(s)), [])));
    const probeNames = ['t'];
    probeNames.forEach(n => known.add(n));
    const srcs = [].concat(
      t.answer ? [t.answer] : [], t.verify ? [t.verify] : [],
      t.identity ? [t.identity.lhs, t.identity.rhs] : [],
      (t.constraints || []), (t.distractors || []).filter(d => d && d.expr).map(d => d.expr),
      Object.values(t.derived || {})
    );
    srcs.forEach(src => {
      let vars;
      try { vars = expr.variables(src); } catch (e) { return fail('schema', where + ' unparsable expression "' + src + '": ' + e.message); }
      vars.forEach(v => { if (!known.has(v)) fail('schema', where + ' expression "' + src + '" reads unknown name "' + v + '"'); });
    });
  });
  if (!failures) pass('schema', data.templates.length + ' templates pass schema checks');
}

// ------------------------------------------------ template render sweep
head('Template render sweep (' + SEEDS + ' seeds each)');
{
  const letterTally = { A: 0, B: 0, C: 0, D: 0 };
  let rendered = 0, lengthWarn = 0;
  const BANNED = [/all of the above/i, /none of the above/i, /both a and b/i];
  const DOUBLE_NEG = /\b(not|never|no)\b[^.?!]{0,60}\b(un|in|dis|non)[a-z]+\b/i;

  data.templates.forEach(t => {
    let ok = 0;
    for (let s = 0; s < SEEDS; s++) {
      const seed = rng.make(t.id + ':sweep:' + s).int(1, 999999);
      let item;
      try { item = engine.renderTemplate(t, seed, { keepScope: true }); }
      catch (e) { fail('render', t.id + ' seed ' + seed + ': ' + e.message); continue; }
      rendered++;

      // A symbolic answer is checked by substituting probe values into the
      // identity it claims. Several probes, so a coincidence at one value
      // cannot pass.
      if (t.identity) {
        let bad = null;
        for (const probe of [2, 3, 5, 7, 11]) {
          const sc = Object.assign({}, item.scope, { t: probe });
          let l, r;
          try { l = expr.evaluate(t.identity.lhs, sc); r = expr.evaluate(t.identity.rhs, sc); }
          catch (e) { bad = 'identity failed to evaluate at t=' + probe + ': ' + e.message; break; }
          if (Math.abs(l - r) > 1e-9) { bad = 'identity broken at t=' + probe + ': ' + l + ' != ' + r; break; }
        }
        if (bad) { fail('render', t.id + ' ' + bad); continue; }
      }
      // independent re-derivation of the answer
      if (t.verify && t.answer) {
        let a, v;
        try { a = expr.evaluate(t.answer, item.scope); v = expr.evaluate(t.verify, item.scope); }
        catch (e) { fail('render', t.id + ' verify failed to evaluate: ' + e.message); continue; }
        if (Math.abs(a - v) > 1e-9) {
          fail('render', t.id + ' seed ' + seed + ': answer (' + a + ') != verify (' + v + ') — the formula and its cross-check disagree');
          continue;
        }
      }
      // exactly one correct, four distinct options
      if (item.options.length !== 4) fail('render', t.id + ' produced ' + item.options.length + ' options');
      if (item.options.filter(o => o.isCorrect).length !== 1) fail('render', t.id + ' seed ' + seed + ' has ' + item.options.filter(o => o.isCorrect).length + ' correct options');
      const texts = item.options.map(o => o.text);
      // "(y + 4)(y + 5)" and "(y + 5)(y + 4)" are different strings but the
      // same expression. Compare each option's skeleton plus its multiset of
      // numbers, so a reordered duplicate cannot slip through.
      if (t.answer_text) {
        const shape = x => x.replace(/\d+/g, '#') + '|' + (x.match(/\d+/g) || []).map(Number).sort((a, b) => a - b).join(',');
        if (new Set(texts.map(shape)).size !== 4) {
          fail('quality', t.id + ' has options that are the same expression reordered: ' + JSON.stringify(texts));
        }
      }
      if (new Set(texts).size !== 4) fail('render', t.id + ' seed ' + seed + ' has duplicate options: ' + JSON.stringify(texts));
      letterTally[item.correctKey]++;

      // clean numbers
      if (t.answer && !t.answer_text) {
        const v = expr.evaluate(t.answer, item.scope);
        if (!engine.isClean(v, t.format || 'int')) fail('render', t.id + ' seed ' + seed + ' unclean answer ' + v + ' for format ' + (t.format || 'int'));
      }
      // no leftover interpolation, no banned phrasing, steps use real numbers
      // Option error strings are shown verbatim in the review, so they are
      // checked for leftover placeholders alongside the rest of the prose.
      const prose = [item.stem]
        .concat(item.solution_steps, [item.recognition_cue],
                item.options.map(o => o.error || ''))
        .join(' ');
      // A leftover placeholder is a lone identifier in braces or an unexpanded
      // "{=". Prose that legitimately contains braces, e.g. "{d, r, t}" written
      // as "{{d, r, t}}" in the source, is not a placeholder.
      const leftover = prose.match(/\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}|\{\s*[=~^]/);
      if (leftover) fail('render', t.id + ' has an uninterpolated placeholder: ' + leftover[0]);
      BANNED.forEach(re => { if (re.test(prose) || texts.some(x => re.test(x))) fail('quality', t.id + ' uses banned option phrasing (' + re + ')'); });
      if (DOUBLE_NEG.test(item.stem)) warn('quality', t.id + ' stem may contain a double negative: "' + item.stem.slice(0, 80) + '"');
      if (item.solution_steps.length && !/\d/.test(item.solution_steps.join(' '))) {
        fail('quality', t.id + ' solution steps contain no numbers — they are not using the actual render');
      }
      // option length balance
      if (!engine.lengthsBalanced(texts) && !t.answer_text) { lengthWarn++; }
      const correctText = item.options.find(o => o.isCorrect).text;
      const others = texts.filter(x => x !== correctText);
      if (correctText.length > Math.max.apply(null, others.map(x => x.length)) + 12) {
        fail('quality', t.id + ' seed ' + seed + ': correct option is conspicuously the longest');
      }
      // difficulty band must hold across the parameter space
      if (item.difficulty !== t.difficulty) fail('render', t.id + ' difficulty drifted');
      ok++;
    }
    if (ok === 0) fail('render', t.id + ' produced no valid renders at all');
  });

  if (lengthWarn) warn('quality', lengthWarn + ' renders had loosely balanced option lengths');
  pass('render', rendered + ' template renders verified');

  const total = Object.values(letterTally).reduce((a, b) => a + b, 0);
  if (total) {
    const report = Object.entries(letterTally).map(([k, v]) => k + ' ' + (100 * v / total).toFixed(1) + '%').join('  ');
    const worst = Math.max.apply(null, Object.values(letterTally)) / total;
    worst <= 0.30 ? pass('balance', 'answer position spread: ' + report)
      : fail('balance', 'answer position skewed beyond 30%: ' + report);
  }
}

// ---------------------------------------------------------- duplicate stems
head('Duplicate stems');
{
  const seen = new Map();
  const add = (key, where) => {
    const k = key.replace(/\s+/g, ' ').trim().toLowerCase();
    if (seen.has(k)) fail('dupes', 'duplicate stem between ' + seen.get(k) + ' and ' + where + ': "' + key.slice(0, 70) + '"');
    else seen.set(k, where);
  };
  data.templates.forEach(t => add(t.stem, t.id));
  Object.values(data.banks).forEach(b => b.entries.forEach(e => add((e.sentence || '') + ' ' + e.prompt, e.id)));
  data.passages.forEach(p => p.questions.forEach(q => add(p.id + ' ' + q.prompt, p.id + '/' + q.id)));
  if (!QUIET) pass('dupes', seen.size + ' distinct stems across templates, banks and passages');
}

// ------------------------------------------------------------- bank checks
head('Curated banks');
{
  Object.values(data.banks).forEach(b => {
    const byCat = {};
    b.entries.forEach(e => { (byCat[e.category] = byCat[e.category] || []).push(e); });
    b.entries.forEach(e => {
      const where = b.subtest + '/' + e.id;
      ['id', 'subtest', 'topic', 'prompt', 'answer', 'category', 'explanation', 'recognition_cue', 'lesson'].forEach(k => {
        if (!e[k]) fail('bank', where + ' missing "' + k + '"');
      });
      if (!(data.config.topics[e.subtest] || []).includes(e.topic)) fail('bank', where + ' topic "' + e.topic + '" not a declared ' + e.subtest + ' subtopic');
      const pool = bankGen.candidatePool(e, b.entries);
      if (pool.length < 3) fail('bank', where + ' category "' + e.category + '" yields only ' + pool.length + ' distractors (needs 3+)');
    });
    // render sweep
    let n = 0;
    b.entries.forEach(e => {
      for (let s = 0; s < 6; s++) {
        let item;
        try { item = bankGen.render(e, b.entries, s * 97 + 1); }
        catch (err) { fail('bank', e.id + ': ' + err.message); continue; }
        const texts = item.options.map(o => o.text);
        if (new Set(texts.map(x => x.toLowerCase())).size !== 4) fail('bank', e.id + ' seed ' + s + ' duplicate options: ' + JSON.stringify(texts));
        if (item.options.filter(o => o.isCorrect).length !== 1) fail('bank', e.id + ' has ' + item.options.filter(o => o.isCorrect).length + ' correct options');
        const correct = item.options.find(o => o.isCorrect).text;
        const others = texts.filter(x => x !== correct);
        // "lessen" vs "lessened": same stem, so both would be defensible.
        for (let i = 0; i < texts.length; i++) {
          for (let j = i + 1; j < texts.length; j++) {
            const a = texts[i].toLowerCase().replace(/[^a-z ]/g, '');
            const bb = texts[j].toLowerCase().replace(/[^a-z ]/g, '');
            const short = a.length < bb.length ? a : bb, long = a.length < bb.length ? bb : a;
            if (short.length >= 4 && long.startsWith(short) && long.length - short.length <= 3) {
              fail('bank', e.id + ' offers two options with the same stem: "' + texts[i] + '" and "' + texts[j] + '"');
            }
          }
        }
        if (correct.length > Math.max.apply(null, others.map(x => x.length)) + 14) {
          fail('bank', e.id + ' seed ' + s + ': correct option far longer than the rest ("' + correct + '")');
        }
        n++;
      }
    });
    pass('bank', b.subtest + ': ' + b.entries.length + ' entries, ' + n + ' renders, ' + Object.keys(byCat).length + ' distractor categories');
  });
}

// --------------------------------------------------------------- passages
head('PC passages');
{
  const TYPES = data.config.topics.PC;
  data.passages.forEach(p => {
    const where = p.id;
    if (!p.text || p.text.split(/\s+/).length < 60) fail('pc', where + ' passage is too short (' + (p.text || '').split(/\s+/).length + ' words)');
    if (p.text && p.text.split(/\s+/).length > 260) warn('pc', where + ' passage is long (' + p.text.split(/\s+/).length + ' words)');
    if (!p.questions || p.questions.length < 4) fail('pc', where + ' has ' + ((p.questions || []).length) + ' questions, needs 4+ so selection can rotate');
    const types = new Set((p.questions || []).map(q => q.type));
    if (types.size < 3) fail('pc', where + ' covers only ' + types.size + ' question types, needs 3+');
    (p.questions || []).forEach(q => {
      const w = where + '/' + q.id;
      if (!TYPES.includes(q.type)) fail('pc', w + ' unknown question type "' + q.type + '"');
      ['prompt', 'answer', 'explanation', 'recognition_cue', 'lesson'].forEach(k => { if (!q[k]) fail('pc', w + ' missing "' + k + '"'); });
      if ((q.distractors || []).length < 3) fail('pc', w + ' needs 3 distractors');
      const texts = [q.answer].concat((q.distractors || []).map(d => d.text));
      if (new Set(texts.map(x => String(x).toLowerCase())).size !== texts.length) fail('pc', w + ' has duplicate options');
      (q.distractors || []).forEach(d => { if (!d.error) fail('pc', w + ' distractor "' + String(d.text).slice(0, 30) + '" has no named error pattern'); });
      const lens = texts.map(x => String(x).length);
      if (Math.max.apply(null, lens) > Math.min.apply(null, lens) * 2.2 + 8) {
        fail('pc', w + ' option lengths vary too much: ' + JSON.stringify(lens));
      }
      if (String(q.answer).length > Math.max.apply(null, (q.distractors || []).map(d => String(d.text).length)) + 14) {
        fail('pc', w + ' correct option is conspicuously the longest');
      }
    });
    // rotation actually rotates
    const a = passageGen.render(p, 1, 3).map(i => i.template_id).join(',');
    const b = passageGen.render(p, 2, 3).map(i => i.template_id).join(',');
    const c = passageGen.render(p, 7, 3).map(i => i.template_id).join(',');
    if (a === b && b === c) warn('pc', where + ' returns the same question set for seeds 1, 2 and 7');
  });
  const totalQ = data.passages.reduce((a, p) => a + (p.questions || []).length, 0);
  pass('pc', data.passages.length + ' passages, ' + totalQ + ' questions');
}

// ------------------------------------------------------------ topic coverage
head('Subtopic coverage');
{
  const covered = new Map();
  const mark = (code, topic) => {
    const k = code + '.' + topic;
    covered.set(k, (covered.get(k) || 0) + 1);
  };
  data.templates.forEach(t => mark(t.subtest, t.topic));
  Object.values(data.banks).forEach(b => b.entries.forEach(e => mark(e.subtest, e.topic)));
  data.passages.forEach(p => p.questions.forEach(q => mark('PC', q.type)));
  mark('AO', 'connection_problems'); mark('AO', 'shape_assembly');   // procedural

  let missing = 0;
  Object.entries(data.config.topics).forEach(([code, topics]) => {
    topics.forEach(topic => {
      const n = covered.get(code + '.' + topic) || 0;
      if (n === 0) { fail('coverage', code + '.' + topic + ' has no template or bank entry'); missing++; }
    });
  });
  if (!missing) pass('coverage', 'all ' + covered.size + ' declared subtopics have content');
}

// --------------------------------------------------------------- lessons
head('Lessons');
{
  const lessonIds = new Set(data.lessons.map(l => l.id));
  const referenced = new Set();
  const checkLink = (id, where) => {
    if (!id) return;
    referenced.add(id);
    if (!lessonIds.has(id)) fail('lessons', where + ' links to missing lesson "' + id + '"');
  };
  data.templates.forEach(t => checkLink(t.lesson, t.id));
  Object.values(data.banks).forEach(b => b.entries.forEach(e => checkLink(e.lesson, e.id)));
  data.passages.forEach(p => p.questions.forEach(q => checkLink(q.lesson, p.id + '/' + q.id)));
  ['ao_connection_problems', 'ao_shape_assembly'].forEach(id => checkLink(id, 'AO generator'));

  data.lessons.forEach(l => {
    const where = 'lesson ' + l.id;
    ['id', 'subtest', 'topic', 'title', 'concept', 'trap'].forEach(k => { if (!l[k]) fail('lessons', where + ' missing "' + k + '"'); });
    if ((l.examples || []).length < 2) fail('lessons', where + ' needs 2 worked examples, has ' + ((l.examples || []).length));
    (l.examples || []).forEach((ex, i) => {
      if (!ex.problem || !ex.steps || !ex.steps.length) fail('lessons', where + ' example ' + (i + 1) + ' needs a problem and steps');
    });
    if (!(data.config.topics[l.subtest] || []).includes(l.topic)) fail('lessons', where + ' topic "' + l.topic + '" not a declared ' + l.subtest + ' subtopic');
    // a lesson must be reachable from at least one item
    if (!referenced.has(l.id)) fail('lessons', where + ' is orphaned — no item links to it');
  });
  const uncovered = [...lessonIds].filter(id => !referenced.has(id));
  if (!uncovered.length) pass('lessons', data.lessons.length + ' lessons, all linked and all links resolve');
}

// -------------------------------------------------------- AO generator
head('Assembling Objects generator');
{
  const letters = { A: 0, B: 0, C: 0, D: 0 };
  const kinds = {};
  for (let s = 0; s < 200; s++) {
    let item;
    try { item = ao.render(s); } catch (e) { fail('ao', 'seed ' + s + ': ' + e.message); continue; }
    letters[item.correctKey]++;
    kinds[item.topic] = (kinds[item.topic] || 0) + 1;
    if (item.options.length !== 4) fail('ao', 'seed ' + s + ' has ' + item.options.length + ' options');
    if (item.options.filter(o => o.isCorrect).length !== 1) fail('ao', 'seed ' + s + ' correct-option count wrong');
    const svgs = item.options.map(o => o.svg);
    if (new Set(svgs).size !== 4) fail('ao', 'seed ' + s + ' has visually identical options');
    if (!/^<svg/.test(item.figure || '')) fail('ao', 'seed ' + s + ' has no stem figure');
    item.options.filter(o => !o.isCorrect).forEach(o => { if (!o.error) fail('ao', 'seed ' + s + ' distractor has no named error'); });
  }
  if (!kinds.connection_problems || !kinds.shape_assembly) fail('ao', 'generator did not produce both problem kinds: ' + JSON.stringify(kinds));
  const tot = Object.values(letters).reduce((a, b) => a + b, 0);
  const worst = Math.max.apply(null, Object.values(letters)) / tot;
  worst <= 0.30 ? pass('ao', '200 items, both kinds, answer spread ' + Object.entries(letters).map(([k, v]) => k + ' ' + (100 * v / tot).toFixed(0) + '%').join(' '))
    : fail('ao', 'answer position skewed: ' + JSON.stringify(letters));
}

// ------------------------------------------------------------- app shell
head('App shell');
{
  // Every script index.html loads must exist, and the service worker must
  // precache exactly the files that are actually in the repository.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  scripts.forEach(src => {
    if (!fs.existsSync(path.join(ROOT, src))) fail('shell', 'index.html loads missing script ' + src);
  });
  const links = [...html.matchAll(/(?:href|src)="((?!https?:|#)[^"]+)"/g)].map(m => m[1]);
  links.forEach(href => {
    if (!fs.existsSync(path.join(ROOT, href))) fail('shell', 'index.html references missing file ' + href);
  });

  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const pre = [...sw.matchAll(/'\.\/([^']*)'/g)].map(m => m[1]).filter(x => x !== '');
  pre.forEach(f => {
    if (!fs.existsSync(path.join(ROOT, f))) fail('shell', 'sw.js precaches missing file ' + f);
  });
  // The reverse direction matters more: a script added to index.html but not to
  // the precache list silently breaks offline use.
  scripts.concat(['styles.css', 'manifest.json']).forEach(f => {
    if (!pre.includes(f)) fail('shell', f + ' is loaded by the app but not precached by sw.js — it would break offline');
  });

  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  ['name', 'short_name', 'start_url', 'display', 'icons'].forEach(k => {
    if (!man[k]) fail('shell', 'manifest.json missing "' + k + '"');
  });
  man.icons.forEach(ic => {
    if (!fs.existsSync(path.join(ROOT, ic.src))) fail('shell', 'manifest icon missing: ' + ic.src);
  });
  if (!man.icons.some(i => (i.purpose || '').includes('maskable'))) {
    fail('shell', 'manifest.json has no maskable icon — installed icons will be letterboxed');
  }
  if (!failures) pass('shell', scripts.length + ' scripts, ' + pre.length + ' precached files and ' + man.icons.length + ' icons all resolve');
}

// -------------------------------------------------- lesson practice supply
head('Lesson practice');
{
  // Every lesson offers three practice items drawn live from its own subtopic,
  // so each lesson's topic must actually have content behind it.
  let thin = 0;
  data.lessons.forEach(l => {
    let supply = data.templatesFor(l.subtest).filter(t => t.topic === l.topic).length;
    supply += (((data.banks[l.subtest] || {}).entries) || []).filter(e => e.topic === l.topic).length;
    if (l.subtest === 'PC') supply += data.passages.reduce((a, p) => a + p.questions.filter(q => q.type === l.topic).length, 0);
    if (l.subtest === 'AO') supply = Infinity;
    if (supply === 0) fail('lessons', 'lesson ' + l.id + ' has no items for its topic, so its practice block would be empty');
    else if (supply < 3) thin++;
  });
  if (thin) warn('lessons', thin + ' lesson(s) draw practice from fewer than 3 distinct items (templates still reseed, so questions differ)');
  pass('lessons', 'every lesson has practice content for its subtopic');
}

// ------------------------------------------------------ depth for a full test
head('Content depth');
{
  data.config.subtests.forEach(s => {
    let supply = 0; const units = [];
    if (s.sources.includes('template')) { supply += data.templatesFor(s.code).length; units.push('templates'); }
    if (s.sources.includes('bank')) { supply += ((data.banks[s.code] || {}).entries || []).length; units.push('bank entries'); }
    if (s.sources.includes('passage')) { supply += data.passages.reduce((a, p) => a + p.questions.length, 0); units.push('passage questions'); }
    if (s.sources.includes('procedural')) { supply = Infinity; units.push('procedural'); }
    const unit = units.join(' + ');
    // A template renders endlessly many distinct items from different seeds, so
    // the bar is only that a single sitting need not reuse one twice. Fixed
    // bank entries and passage questions need real surplus for variety across
    // repeated attempts.
    const templateOnly = s.sources.length === 1 && s.sources[0] === 'template';
    const need = templateOnly ? s.items : Math.ceil(s.items * 1.5);
    if (supply < s.items) fail('depth', s.code + ' has only ' + supply + ' ' + unit + ' for a ' + s.items + '-item subtest');
    else if (supply !== Infinity && supply < need) warn('depth', s.code + ' has ' + supply + ' ' + unit + ' for ' + s.items + ' items — repeated tests will reuse content');
    else if (supply !== Infinity) pass('depth', s.code + ': ' + supply + ' ' + unit + ' for ' + s.items + ' items');
  });
}

// ------------------------------------------------------------ question bank
head('Question bank');
{
  const bankdata = require('./js/core/bankdata.js');
  const itemsMod = require('./js/core/items.js');
  bankdata.ensure(null, () => { });

  const manifest = bankdata.manifest();
  const all = [];
  bankdata.codes().forEach(code => bankdata.forSubtest(code).forEach(r => all.push(r)));

  all.length === manifest.total
    ? pass('bank', all.length + ' questions across ' + bankdata.codes().length + ' subtests')
    : fail('bank', 'loaded ' + all.length + ' questions but the manifest says ' + manifest.total);

  // Part 9: every question needs a topic, a valid key and 2+ options.
  let noTopic = 0, badKey = 0, fewOpts = 0, noLesson = 0;
  const lessonIds = new Set(data.lessons.map(l => l.id));
  all.forEach(r => {
    if (!r.topics || !r.topics.length) { noTopic++; fail('bank', r.id + ' has no topic tag'); }
    const opts = r.options || {};
    if (Object.keys(opts).length < 2) { fewOpts++; fail('bank', r.id + ' has fewer than 2 options'); }
    if (!r.answer || !(r.answer in opts)) { badKey++; fail('bank', r.id + ' answer "' + r.answer + '" is not one of its options'); }
    const lid = itemsMod.lessonFor(r.subtest, (r.topics || [])[0]);
    if (lid && !lessonIds.has(lid)) { noLesson++; fail('bank', r.id + ' maps to missing lesson "' + lid + '"'); }
  });
  if (!noTopic && !badKey && !fewOpts && !noLesson) {
    pass('bank', 'every question has a topic, a valid key, 2+ options and a resolvable lesson');
  }

  // Every topic carrying questions must reach a lesson, or be a declared gap.
  const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/taxonomy.json'), 'utf8'));
  let unresolved = 0;
  Object.entries(taxonomy.subtests).forEach(([sub, entry]) => {
    Object.entries(entry.topics).forEach(([topic, t]) => {
      if (t.questions > 0 && !t.lesson) {
        unresolved++;
        fail('bank', sub + '.' + topic + ' has ' + t.questions + ' questions but no lesson');
      }
    });
  });
  if (!unresolved) pass('bank', 'every topic with questions resolves to a lesson');

  // The adapter has to produce the shape js/app/ consumes.
  let rendered = 0;
  all.forEach(r => {
    const it = itemsMod.render(r, 0);
    if (!it) { fail('bank', r.id + ' failed to render'); return; }
    rendered++;
    if (!it.stem) fail('bank', r.id + ' rendered with an empty stem');
    if (it.options.filter(o => o.isCorrect).length !== 1) {
      fail('bank', r.id + ' rendered with ' + it.options.filter(o => o.isCorrect).length + ' correct options');
    }
    if (it.options[it.correctIndex].key !== it.correctKey) fail('bank', r.id + ' correctKey and correctIndex disagree');
    if (it.subtest === 'PC' && !it.passage) fail('bank', r.id + ' is a PC item with no passage');
  });
  pass('bank', rendered + ' items render into the runtime shape');

  // Figures referenced must exist on disk.
  let missingFigs = 0;
  all.forEach(r => {
    if (r.figure && !fs.existsSync(path.join(ROOT, r.figure))) {
      missingFigs++; fail('bank', r.id + ' references missing figure ' + r.figure);
    }
  });
  if (!missingFigs) pass('bank', all.filter(r => r.figure).length + ' figures all present on disk');
}

// --------------------------------------------------------- exam construction
head('Exam construction');
{
  const bankdata = require('./js/core/bankdata.js');
  bankdata.ensure(null, () => { });
  const exam = require('./js/core/exam.js');

  const sim = exam.fullSimulation(12345);
  const want = data.config.subtests.reduce((a, s) => a + s.items, 0);
  sim.totalItems === want
    ? pass('exam', 'full simulation builds ' + want + ' items')
    : fail('exam', 'full simulation built ' + sim.totalItems + ' items, config asks for ' + want);

  // official subtest order
  const order = sim.sections.map(s => s.code).join(',');
  const expected = data.config.subtests.slice().sort((a, b) => a.order - b.order).map(s => s.code).join(',');
  order === expected ? pass('exam', 'sections run in configured order: ' + order)
    : fail('exam', 'section order is ' + order + ', expected ' + expected);

  // per-section budgets
  data.config.subtests.forEach(cfg => {
    const sec = sim.sections.find(s => s.code === cfg.code);
    if (!sec) return fail('exam', cfg.code + ' section missing from the simulation');
    if (sec.items.length !== cfg.items) fail('exam', cfg.code + ' built ' + sec.items.length + ' items, config asks ' + cfg.items);
    if (sec.seconds !== cfg.seconds) fail('exam', cfg.code + ' has ' + sec.seconds + 's, config says ' + cfg.seconds);
  });

  // Part 9: no repeat within an exam.
  const ids = [];
  sim.sections.forEach(s => s.items.forEach(i => ids.push(i.template_id)));
  new Set(ids).size === ids.length
    ? pass('exam', 'no question repeats within a sitting (' + ids.length + ' distinct)')
    : fail('exam', 'a question repeated within one exam: ' + (ids.length - new Set(ids).size) + ' duplicate(s)');

  // Ambiguous Auto/Shop items are P&P only and must not reach a CAT sitting.
  const leaked = ids.filter(id => String(id).startsWith('AS-'));
  leaked.length === 0 ? pass('exam', 'ambiguous Auto/Shop items stay out of a CAT sitting')
    : fail('exam', leaked.length + ' ambiguous AS item(s) reached the simulation');

  // refs must round-trip: item -> ref -> item
  let round = 0;
  sim.sections[0].items.forEach(it => {
    const back = exam.rehydrate(exam.itemRef(it));
    if (!back) return fail('exam', it.template_id + ' did not survive the ref round-trip');
    if (back.stem !== it.stem || back.correctKey !== it.correctKey) {
      fail('exam', it.template_id + ' changed across a ref round-trip');
    }
    round++;
  });
  pass('exam', round + ' items round-trip through itemRef/rehydrate unchanged');

  // A ref from the retired generated layer must degrade, not throw.
  const old = exam.rehydrate({ source: 'template', template_id: 'ar_rate_01', seed: 7 });
  old === null ? pass('exam', 'a stale pre-migration ref resolves to null instead of throwing')
    : fail('exam', 'a stale ref unexpectedly resolved');

  const diag = exam.diagnostic(9);
  const dwant = Object.values(data.config.diagnostic.spread).reduce((a, b) => a + b, 0);
  diag.totalItems === dwant ? pass('exam', 'diagnostic builds ' + dwant + ' items')
    : fail('exam', 'diagnostic built ' + diag.totalItems + ', expected ' + dwant);
}

// ---------------------------------------------------------------- summary
console.log('\n' + '-'.repeat(64));
console.log(failures === 0
  ? 'PASS — ' + checks + ' checks clean' + (warnings ? ', ' + warnings + ' warning(s)' : '')
  : 'FAIL — ' + failures + ' problem(s), ' + warnings + ' warning(s)');
process.exit(failures ? 1 : 0);
