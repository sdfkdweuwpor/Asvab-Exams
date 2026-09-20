#!/usr/bin/env node
/* Content validator. Run: node validate.js [--quiet]

   This is the gate the build leans on. With a fixed bank the risk moved: a
   generator could only produce a broken item, but a fixed bank can carry a
   WRONG ANSWER KEY, which teaches the wrong thing to every user of the app,
   permanently. So the checks here run against the extracted bank, the exam
   profiles built from it, and the scoring applied to them, rather than against
   JSON alone. scripts/validate_bank.py covers the extraction itself. */
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = __dirname;

const rng = require('./js/core/rng.js');
const bundler = require('./tools/bundle.js');
const data = require('./js/core/data.js');

const args = process.argv.slice(2);
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
  /* Exam shape now comes from config/exam_formats.json. What remains here is
     per-subtest metadata -- names, order, composite membership, topic lists --
     plus the default pacing that target_seconds and pool health are derived
     from, so the check is internal consistency rather than a fixed total. */
  const items = cfg.subtests.reduce((a, s) => a + s.items, 0);
  const mins = cfg.subtests.reduce((a, s) => a + s.seconds, 0) / 60;
  Math.abs(mins - cfg.total_minutes) < 0.5
    ? pass('config', items + ' items over ' + mins + ' minutes, matching total_minutes')
    : fail('config', 'time limits sum to ' + mins + ' min but total_minutes says ' + cfg.total_minutes);
  const dx = Object.values(cfg.diagnostic.spread).reduce((a, b) => a + b, 0);
  dx === cfg.diagnostic.items ? pass('config', 'diagnostic spread sums to ' + dx)
    : fail('config', 'diagnostic spread sums to ' + dx + ', expected ' + cfg.diagnostic.items);
  cfg.subtests.forEach(s => {
    if (!cfg.topics[s.code]) fail('config', s.code + ' has no topic list');
    if (!s.name || !s.order) fail('config', s.code + ' is missing a name or an order');
    if (!s.items || !s.seconds) fail('config', s.code + ' is missing its default item count or budget');
  });
  const orders = cfg.subtests.map(s => s.order).sort((a, b) => a - b);
  orders.every((o, i) => o === i + 1)
    ? pass('config', 'subtest order is 1..' + orders.length + ' with no gaps')
    : fail('config', 'subtest order has gaps or duplicates: ' + orders.join(','));
}

// ------------------------------------------------------------ topic coverage
head('Subtopic coverage');
{
  const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/taxonomy.json'), 'utf8'));
  let empty = 0, thin = 0, total = 0;
  Object.entries(taxonomy.subtests).forEach(([code, entry]) => {
    Object.entries(entry.topics).forEach(([topic, t]) => {
      total++;
      if (!t.questions) { empty++; warn('coverage', code + '.' + topic + ' has no questions in the bank'); }
      else if (t.questions < 8) thin++;
    });
  });
  const gaps = Object.values(taxonomy.subtests).reduce((a, e) => a + (e.gaps || []).length, 0);
  pass('coverage', total + ' declared subtopics: ' + empty + ' with no questions, ' +
       thin + ' with fewer than 8, ' + gaps + ' uncovered areas recorded in taxonomy.json');
}

// --------------------------------------------------------------- lessons
head('Lessons');
{
  const lessonIds = new Set(data.lessons.map(l => l.id));
  /* A lesson counts as exercised when some bank question carries its topic.
     With a fixed bank that is a report rather than a gate: the source contains
     no author-purpose and no root/prefix/suffix questions at all, and both
     lessons are still worth keeping for the Lessons tab. */
  const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/taxonomy.json'), 'utf8'));
  const referenced = new Set();
  Object.values(taxonomy.subtests).forEach(entry => {
    Object.values(entry.topics).forEach(t => {
      if (t.questions > 0 && t.lesson) referenced.add(t.lesson);
    });
  });

  data.lessons.forEach(l => {
    const where = 'lesson ' + l.id;
    ['id', 'subtest', 'topic', 'title', 'concept', 'trap'].forEach(k => {
      if (!l[k]) fail('lessons', where + ' missing "' + k + '"');
    });
    if ((l.examples || []).length < 2) fail('lessons', where + ' needs 2 worked examples, has ' + ((l.examples || []).length));
    (l.examples || []).forEach((ex, i) => {
      if (!ex.problem || !ex.steps || !ex.steps.length) fail('lessons', where + ' example ' + (i + 1) + ' needs a problem and steps');
    });
    if (!(data.config.topics[l.subtest] || []).includes(l.topic)) {
      fail('lessons', where + ' topic "' + l.topic + '" is not a declared ' + l.subtest + ' subtopic');
    }
    if (l.id !== l.subtest.toLowerCase() + '_' + l.topic) {
      fail('lessons', where + ' breaks the id convention <subtest>_<topic>, which is how items resolve their lesson');
    }
  });
  const uncovered = [...lessonIds].filter(id => !referenced.has(id));
  pass('lessons', data.lessons.length + ' lessons pass schema and id-convention checks');
  if (uncovered.length) {
    warn('lessons', uncovered.length + ' lesson(s) have no questions behind them (' +
      uncovered.join(', ') + ') — the source contains none, so they are reachable only from the Lessons tab');
  }
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

// ------------------------------------------------------------ exam formats
head('Exam format profiles');
{
  const bankdata = require('./js/core/bankdata.js');
  bankdata.ensure(null, () => { });
  const exam = require('./js/core/exam.js');
  const formats = data.formats;

  if (!data.profile(formats.default)) fail('formats', 'default profile "' + formats.default + '" does not exist');
  else pass('formats', 'default profile is ' + formats.default);

  formats.profiles.forEach(p => {
    const items = p.sections.reduce((a, s) => a + s.items, 0);
    const mins = p.sections.reduce((a, s) => a + s.minutes, 0);
    if (items !== p.total_items) fail('formats', p.id + ' sections sum to ' + items + ' items but total_items says ' + p.total_items);
    if (mins !== p.total_minutes) fail('formats', p.id + ' sections sum to ' + mins + ' minutes but total_minutes says ' + p.total_minutes);
    if (!p.source) fail('formats', p.id + ' has no source field');
    if (!p.note) fail('formats', p.id + ' has no note field');

    // Every pool a section draws from must exist in the bank.
    p.sections.forEach(sec => {
      data.poolsFor(sec).forEach(code => {
        if (!bankdata.codes().includes(code)) fail('formats', p.id + '/' + sec.code + ' draws from unknown pool "' + code + '"');
      });
    });

    // Part 9: the profile must build to exactly its configured shape.
    const ex = exam.buildExam(p.id, 999);
    if (!ex) return fail('formats', p.id + ' failed to build');
    if (ex.sections.length !== p.sections.length) {
      fail('formats', p.id + ' built ' + ex.sections.length + ' sections, expected ' + p.sections.length);
    }
    ex.sections.forEach((sec, i) => {
      const want = p.sections[i];
      if (sec.code !== want.code) fail('formats', p.id + ' section ' + i + ' is ' + sec.code + ', expected ' + want.code);
      if (sec.seconds !== want.minutes * 60) fail('formats', p.id + '/' + sec.code + ' budget is ' + sec.seconds + 's, expected ' + want.minutes * 60);
      if (sec.n !== want.items) fail('formats', p.id + '/' + sec.code + ' plans ' + sec.n + ' items, expected ' + want.items);
      // A fixed profile fills up front; an adaptive one draws as it goes.
      if (!p.adaptive && sec.items.length !== want.items) {
        fail('formats', p.id + '/' + sec.code + ' prebuilt ' + sec.items.length + ' items, expected ' + want.items);
      }
      if (sec.poolIds.length < want.items) {
        fail('formats', p.id + '/' + sec.code + ' pool holds ' + sec.poolIds.length + ' for ' + want.items + ' items');
      }
    });
    pass('formats', p.id + ': ' + p.total_items + ' items, ' + p.total_minutes + ' min, ' + p.sections.length + ' sections');
  });

  // An adaptive section drawn to completion must fill exactly, never repeat,
  // and must move with the student rather than ignoring them.
  {
    const ex = exam.buildExam('cat_135', 4242);
    const sec = ex.sections[1];                       // Arithmetic Reasoning
    const plan = { code: sec.code, n: sec.n, poolIds: sec.poolIds, administered: [] };
    const used = {}, drawn = [];
    const r = rng.make('adaptive-test');
    let results = [];
    for (let i = 0; i < sec.n; i++) {
      const it = exam.drawAdaptive(plan, results, used, r);
      if (!it) break;
      drawn.push(it);
      results.push({ correct: true });               // answer everything right
    }
    drawn.length === sec.n ? pass('formats', 'adaptive AR section draws its full ' + sec.n + ' items')
      : fail('formats', 'adaptive AR drew ' + drawn.length + ' of ' + sec.n);
    const ids = drawn.map(i => i.template_id);
    new Set(ids).size === ids.length ? pass('formats', 'adaptive draw never repeats an item')
      : fail('formats', 'adaptive draw repeated an item');

    // All-correct should climb; all-wrong should fall.
    const up = exam.abilityFrom(new Array(10).fill({ correct: true }));
    const down = exam.abilityFrom(new Array(10).fill({ correct: false }));
    (up === 5 && down === 1) ? pass('formats', 'ability estimate climbs to ' + up + ' on all-correct and falls to ' + down + ' on all-wrong')
      : fail('formats', 'ability estimate did not track performance: up=' + up + ' down=' + down);

    const hard = drawn.slice(-5).reduce((a, i) => a + i.difficulty, 0) / 5;
    const easy = drawn.slice(0, 5).reduce((a, i) => a + i.difficulty, 0) / 5;
    hard >= easy ? pass('formats', 'answering correctly moves the draw harder (' + easy.toFixed(1) + ' -> ' + hard.toFixed(1) + ')')
      : warn('formats', 'difficulty did not rise with correct answers: ' + easy.toFixed(1) + ' -> ' + hard.toFixed(1));
  }

  // Two sittings of the same profile must differ, or the randomisation window
  // is not doing its job.
  {
    const a = exam.buildExam('pp_225', 1).sections[0].items.map(i => i.template_id).join(',');
    const b = exam.buildExam('pp_225', 2).sections[0].items.map(i => i.template_id).join(',');
    a !== b ? pass('formats', 'two sittings of the same profile draw different questions')
      : warn('formats', 'two sittings drew an identical first section');
  }

  // The P&P Auto & Shop section is the only place ambiguous items belong.
  {
    const pp = exam.buildExam('pp_225', 77);
    const as = pp.sections.find(s => s.code === 'AS');
    const codes = new Set(as.items.map(i => i.subtest));
    codes.has('AI') || codes.has('SI')
      ? pass('formats', 'P&P Auto & Shop pools ' + [...codes].sort().join('+'))
      : fail('formats', 'P&P Auto & Shop drew from ' + [...codes].join(','));
  }
}

// ------------------------------------------------------- scoring invariants
head('Scoring invariants');
{
  const scoring = require('./js/core/scoring.js');
  const codes = ['GS', 'AR', 'WK', 'PC', 'MK', 'EI', 'AI', 'SI', 'MC', 'AO'];
  const mk = (correctFrac) => {
    const t = {};
    codes.forEach(c => { t[c] = { correct: Math.round(15 * correctFrac), total: 15 }; });
    return t;
  };

  const perfect = scoring.score(mk(1), 600);
  const zero = scoring.score(mk(0), 600);
  perfect.afqt && perfect.afqt.percentile >= 93
    ? pass('scoring', 'all-correct reaches AFQT ' + perfect.afqt.percentile + ' (category I is 93-99)')
    : fail('scoring', 'all-correct gives AFQT ' + (perfect.afqt && perfect.afqt.percentile) + ', expected 93+');
  zero.afqt && zero.afqt.percentile <= 9
    ? pass('scoring', 'all-incorrect reaches AFQT ' + zero.afqt.percentile + ' (category V is 1-9)')
    : fail('scoring', 'all-incorrect gives AFQT ' + (zero.afqt && zero.afqt.percentile) + ', expected 9 or less');

  // Part 9: AFQT must not depend on the order questions were answered in.
  const rows = [];
  codes.forEach(c => {
    for (let i = 0; i < 15; i++) rows.push({ subtest: c, correct: i % 3 !== 0 });
  });
  const shuffled = rows.slice().sort(() => Math.random() - 0.5);
  const a = scoring.score(scoring.tally(rows), 600);
  const b = scoring.score(scoring.tally(shuffled), 600);
  a.afqt.percentile === b.afqt.percentile && a.afqt.raw === b.afqt.raw
    ? pass('scoring', 'AFQT is invariant to question order (' + a.afqt.percentile + ')')
    : fail('scoring', 'AFQT changed with order: ' + a.afqt.percentile + ' vs ' + b.afqt.percentile);

  // Monotonic: more correct must never score lower.
  let mono = true, last = -1;
  for (let f = 0; f <= 1.0001; f += 0.1) {
    const p = scoring.score(mk(f), 600).afqt.percentile;
    if (p < last) mono = false;
    last = p;
  }
  mono ? pass('scoring', 'AFQT rises monotonically with the number correct')
    : fail('scoring', 'AFQT fell as the number correct rose');
}

// ------------------------------------------------- repeat across sittings
head('Repetition across sittings');
{
  const bankdata = require('./js/core/bankdata.js');
  bankdata.ensure(null, () => { });
  const exam = require('./js/core/exam.js');

  // Two consecutive P&P sittings are fixed draws, so overlap is measurable
  // directly. The pool is far larger than one sitting, so it should be small.
  const a = exam.buildExam('pp_225', 101);
  const b = exam.buildExam('pp_225', 202);
  const ids = ex => { const o = []; ex.sections.forEach(s => s.items.forEach(i => o.push(i.template_id))); return o; };
  const A2 = new Set(ids(a)), B2 = ids(b);
  const overlap = B2.filter(id => A2.has(id)).length;
  const pct = 100 * overlap / B2.length;

  // 225 of 1884 per sitting: some overlap is arithmetic, not a bug. What
  // matters is that it is nowhere near a repeat of the same exam.
  pct < 40 ? pass('repeat', 'consecutive sittings share ' + overlap + ' of ' + B2.length + ' questions (' + pct.toFixed(0) + '%)')
    : fail('repeat', 'consecutive sittings share ' + pct.toFixed(0) + '% of their questions');

  // Within one sitting, nothing may repeat at all.
  const within = ids(a);
  new Set(within).size === within.length
    ? pass('repeat', 'no repeat within a 225-question sitting')
    : fail('repeat', 'a question repeated inside one sitting');
}

// ----------------------------------------------------------- work-on ranking
head('Work On ranking');
{
  const bankdata = require('./js/core/bankdata.js');
  bankdata.ensure(null, () => { });
  const workon = require('./js/core/workon.js');

  // A fixed history, so the ranking can be checked for determinism.
  const day = n => new Date(Date.UTC(2026, 0, 20 - n)).toISOString();
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push({ subtest: 'AR', topic: 'rate_time_distance', correct: i < 6, seconds: 50, date: day(3) });
  for (let i = 0; i < 14; i++) rows.push({ subtest: 'MK', topic: 'linear_equations', correct: i < 11, seconds: 60, date: day(5) });
  for (let i = 0; i < 16; i++) rows.push({ subtest: 'WK', topic: 'synonyms_isolation', correct: i < 15, seconds: 20, date: day(1) });
  for (let i = 0; i < 16; i++) rows.push({ subtest: 'WK', topic: 'synonyms_isolation', correct: i < 15, seconds: 20, date: day(6) });
  for (let i = 0; i < 2; i++) rows.push({ subtest: 'PC', topic: 'inference', correct: false, seconds: 80, date: day(1) });

  // Part 9: deterministic given a fixed response history.
  const a = workon.workOn(rows, { limit: 8 }).map(c => c.key + ':' + c.rank.toFixed(6)).join('|');
  const b = workon.workOn(rows.slice(), { limit: 8 }).map(c => c.key + ':' + c.rank.toFixed(6)).join('|');
  a === b ? pass('workon', 'ranking is deterministic for a fixed history')
    : fail('workon', 'ranking changed between identical runs');

  /* The prior is the whole point: on raw accuracy 0-of-2 reads as 0% and would
     outrank 6-of-20 at 30% as the worse topic, which is nonsense on two
     answers. The prior pulls the tiny sample toward the middle so it cannot. */
  const small = workon.posterior(0, 2).mean;
  const large = workon.posterior(6, 20).mean;
  small >= large
    ? pass('workon', 'the prior lifts 0-of-2 to ' + (small * 100).toFixed(0) +
           '%, at or above 6-of-20 at ' + (large * 100).toFixed(0) + '%, so two answers cannot outrank twenty')
    : fail('workon', 'the prior left 0-of-2 (' + (small * 100).toFixed(0) +
           '%) below 6-of-20 (' + (large * 100).toFixed(0) + '%)');

  // And the damping must be much stronger on the small sample than the large.
  const pullSmall = Math.abs(small - 0.0);
  const pullLarge = Math.abs(large - 0.30);
  pullSmall > pullLarge * 3
    ? pass('workon', 'the prior moves a 2-answer topic ' + (pullSmall * 100).toFixed(0) +
           ' points but a 20-answer topic only ' + (pullLarge * 100).toFixed(0))
    : fail('workon', 'the prior damped both samples about equally');

  // Confidence band must shrink as evidence accumulates.
  const wide = workon.posterior(1, 2), narrow = workon.posterior(20, 40);
  (wide.hi - wide.lo) > (narrow.hi - narrow.lo)
    ? pass('workon', 'confidence band narrows with sample size')
    : fail('workon', 'confidence band did not narrow');

  // Mastery gate: 85% over 12+ questions spanning 2+ sessions.
  const all = workon.analyse(rows);
  const wkCell = all.filter(c => c.key === 'WK.synonyms_isolation')[0];
  wkCell && wkCell.mastered
    ? pass('workon', 'mastery gate passes 30/32 across ' + wkCell.sessions + ' sessions')
    : fail('workon', 'mastery gate did not pass a clearly mastered topic');

  const oneSession = rows.filter(r => r.topic !== 'synonyms_isolation')
    .concat(new Array(20).fill(0).map(() => ({ subtest: 'WK', topic: 'words_in_context', correct: true, seconds: 20, date: day(1) })));
  const single = workon.analyse(oneSession).filter(c => c.key === 'WK.words_in_context')[0];
  single && !single.mastered
    ? pass('workon', '20/20 in a single session does not count as mastered')
    : fail('workon', 'mastery gate ignored the two-session requirement');

  // Every ranked topic must reach a lesson or be explicitly lesson-less.
  let bad = 0;
  all.forEach(c => { if (c.lesson && !data.lesson(c.lesson)) bad++; });
  bad === 0 ? pass('workon', 'every ranked topic resolves to a real lesson')
    : fail('workon', bad + ' ranked topic(s) point at a missing lesson');

  // Leverage must be zero outside the AFQT subtests and positive inside.
  const arCell = all.filter(c => c.subtest === 'AR')[0];
  arCell && arCell.leverage > 0 ? pass('workon', 'a weak AFQT topic carries leverage (+' + Math.round(arCell.leverage) + ')')
    : fail('workon', 'a weak AR topic scored no leverage');
}

// ---------------------------------------------------------------- summary
console.log('\n' + '-'.repeat(64));
console.log(failures === 0
  ? 'PASS — ' + checks + ' checks clean' + (warnings ? ', ' + warnings + ' warning(s)' : '')
  : 'FAIL — ' + failures + ' problem(s), ' + warnings + ' warning(s)');
process.exit(failures ? 1 : 0);
