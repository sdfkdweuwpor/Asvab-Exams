/* Builds the item lists for every mode: diagnostic, full simulation, single
   subtest practice, targeted drills and the spaced-repetition review.

   Every item now comes from the fixed bank extracted from the source PDF, so
   selection is about WHICH real question to show rather than what to generate.
   Two consequences shape everything below: the pool is finite, so an exam must
   never repeat an item and should prefer ones the student has not seen; and a
   question is the same every time, so difficulty targeting matters more than it
   did when a template could be reseeded.

   The public surface is unchanged -- js/app/ calls exactly the same functions
   with the same arguments as it did against the generated content. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./rng.js'),
      require('./bankdata.js'), require('./items.js'), require('./state.js'));
  } else {
    root.ASVAB = root.ASVAB || {};
    root.ASVAB.exam = factory(root.ASVAB.data, root.ASVAB.rng,
      root.ASVAB.bankdata, root.ASVAB.items, root.ASVAB.state);
  }
})(typeof self !== 'undefined' ? self : this, function (data, rng, bankdata, items, state) {
  'use strict';

  // Items the keyword split could not call Auto or Shop. The CAT scores those
  // as separate subtests, so an ambiguous item is only honest in P&P mode.
  function drawable(code, opts) {
    var list = bankdata.forSubtest(code) || [];
    if (code === 'AS' && !(opts && opts.allowAmbiguous)) return [];
    return list;
  }

  function topicOf(rec) { return (rec.topics && rec.topics[0]) || 'general'; }

  /* Difficulty target for a subtest, 1-5, from the student's recent accuracy.
     Defaults to 3 -- the middle of the band -- with no history. */
  function difficultyTarget(code) {
    if (!state) return 3;
    var rows = state.seenList().filter(function (r) { return r.subtest === code; });
    if (rows.length < 5) return 3;
    var recent = rows.slice(-40);
    var acc = recent.filter(function (r) { return r.correct; }).length / recent.length;
    if (acc >= 0.85) return 5;
    if (acc >= 0.7) return 4;
    if (acc >= 0.45) return 3;
    if (acc >= 0.25) return 2;
    return 1;
  }

  /* Rank candidates: unseen first, then least-seen, then closest to the
     difficulty target, then a seeded jitter so equal candidates rotate.
     Items the student looks to be recognising rather than solving sink to the
     bottom without being removed -- the pool is too small to discard from. */
  function rankCandidates(list, target, r) {
    return list.map(function (c, i) {
      var seen = state ? state.timesSeen(c.id) : 0;
      var memo = state && state.isLikelyMemorized ? state.isLikelyMemorized(c.id) : false;
      return {
        item: c,
        memo: memo ? 1 : 0,
        seen: seen,
        gap: Math.abs((c.difficulty || 3) - target),
        jitter: rng.make(c.id + ':' + r.int(1, 1e6)).next()
      };
    }).sort(function (a, b) {
      if (a.memo !== b.memo) return a.memo - b.memo;
      if (a.seen !== b.seen) return a.seen - b.seen;
      if (a.gap !== b.gap) return a.gap - b.gap;
      return a.jitter - b.jitter;
    }).map(function (x) { return x.item; });
  }

  // Take `n` while spreading across topics before doubling up on one.
  function spreadByTopic(ranked, n) {
    var byTopic = {}, order = [];
    ranked.forEach(function (c) {
      var t = topicOf(c);
      if (!byTopic[t]) { byTopic[t] = []; order.push(t); }
      byTopic[t].push(c);
    });
    var out = [], round = 0;
    while (out.length < n) {
      var added = false;
      for (var i = 0; i < order.length && out.length < n; i++) {
        var bucket = byTopic[order[i]];
        if (bucket.length > round) { out.push(bucket[round]); added = true; }
      }
      if (!added) break;
      round++;
    }
    return out;
  }

  /* One subtest's worth of items. `used` carries ids already drawn elsewhere in
     this exam, which is what keeps a question from appearing twice in a sitting
     now that the pool is finite. */
  function buildSection(code, n, r, filters, used) {
    filters = filters || {};
    used = used || {};
    var pool = drawable(code, filters).filter(function (rec) {
      if (used[rec.id]) return false;
      if (filters.topics && filters.topics.length) {
        var ts = rec.topics || [];
        for (var i = 0; i < ts.length; i++) if (filters.topics.indexOf(ts[i]) >= 0) return true;
        return false;
      }
      return true;
    });
    if (!pool.length) return [];

    var ranked = rankCandidates(pool, filters.difficulty || difficultyTarget(code), r);
    var chosen = spreadByTopic(ranked, n);

    var out = [];
    for (var i = 0; i < chosen.length && out.length < n; i++) {
      var it = items.render(chosen[i], 0);
      if (!it) continue;
      used[chosen[i].id] = true;
      out.push(it);
    }
    return out;
  }

  // Paragraph Comprehension reads better when a passage's questions sit
  // together, so the student reads it once rather than three times.
  function groupByPassage(list) {
    var order = [], byId = {};
    list.forEach(function (it) {
      var key = it.passage_id || it.template_id;
      if (!byId[key]) { byId[key] = []; order.push(key); }
      byId[key].push(it);
    });
    var out = [];
    order.forEach(function (k) { out = out.concat(byId[k]); });
    return out;
  }

  function sectionItems(code, n, r, filters, used) {
    var list = buildSection(code, n, r, filters, used);
    return code === 'PC' ? groupByPassage(list) : list;
  }

  // ---------------- modes ----------------

  function orderedSubtests() {
    return data.subtests.slice().sort(function (a, b) { return a.order - b.order; });
  }

  function fullSimulation(seed) {
    var r = rng.make('sim:' + (seed || Date.now()));
    var used = {};
    var sections = orderedSubtests().map(function (s) {
      return {
        code: s.code, name: s.name, seconds: s.seconds,
        items: sectionItems(s.code, s.items, r, null, used)
      };
    });
    return {
      mode: 'simulation', created: new Date().toISOString(),
      sections: sections,
      totalItems: sections.reduce(function (a, s) { return a + s.items.length; }, 0),
      totalSeconds: sections.reduce(function (a, s) { return a + s.seconds; }, 0)
    };
  }

  function diagnostic(seed) {
    var r = rng.make('diag:' + (seed || Date.now()));
    var spread = data.config.diagnostic.spread;
    var used = {}, list = [];
    orderedSubtests().forEach(function (s) {
      list = list.concat(sectionItems(s.code, spread[s.code] || 0, r, null, used));
    });
    return {
      mode: 'diagnostic', created: new Date().toISOString(),
      sections: [{ code: 'MIX', name: 'Placement Test', seconds: data.config.diagnostic.seconds, items: list }],
      totalItems: list.length, totalSeconds: data.config.diagnostic.seconds
    };
  }

  function practice(code, n, seed) {
    var r = rng.make('prac:' + code + ':' + (seed || Date.now()));
    var cfg = data.subtest(code) || { name: code, items: 15 };
    var list = sectionItems(code, n || cfg.items, r, { allowAmbiguous: code === 'AS' }, {});
    return {
      mode: 'practice', created: new Date().toISOString(), subtest: code,
      sections: [{ code: code, name: cfg.name, seconds: null, items: list }],
      totalItems: list.length, totalSeconds: null
    };
  }

  /* A drill aimed at the subtopics the student is weakest in. `weakSpots` is
     [{subtest, topic}] from the analytics module. */
  function drill(weakSpots, n, seed) {
    var r = rng.make('drill:' + (seed || Date.now()));
    n = n || data.config.drill.items;
    if (!weakSpots || !weakSpots.length) return practice('AR', n, seed);

    var perSpot = Math.max(1, Math.floor(n / weakSpots.length));
    var used = {}, list = [];
    weakSpots.forEach(function (w) {
      if (list.length >= n) return;
      list = list.concat(buildSection(w.subtest, Math.min(perSpot, n - list.length), r,
        { topics: [w.topic] }, used));
    });
    // Short? Widen to the whole of the weakest subtest.
    var guard = 0;
    while (list.length < n && guard++ < 6) {
      var more = buildSection(weakSpots[0].subtest, n - list.length, r, null, used);
      if (!more.length) break;
      list = list.concat(more);
    }
    return {
      mode: 'drill', created: new Date().toISOString(),
      focus: weakSpots.slice(0, 4),
      sections: [{ code: 'DRILL', name: 'Targeted Drill', seconds: null, items: list.slice(0, n) }],
      totalItems: Math.min(list.length, n), totalSeconds: null
    };
  }

  /* Items due for spaced repetition. A fixed bank brings back the SAME question
     rather than the same concept with new numbers, so review leans on the
     memorisation signal to tell recall apart from recognition. */
  function review(seed) {
    var r = rng.make('review:' + (seed || Date.now()));
    var due = state ? state.dueReviews() : [];
    var list = [];
    due.forEach(function (q) {
      var it = renderAt(q, 0);
      if (it) list.push(it);
    });
    return {
      mode: 'review', created: new Date().toISOString(),
      sections: [{ code: 'REVIEW', name: 'Spaced Review', seconds: null, items: list }],
      totalItems: list.length, totalSeconds: null
    };
  }

  /* A session persists as a short list of refs and rebuilds from the bank, so a
     refresh returns to the same question without holding whole items -- the
     figures alone would be megabytes in localStorage. */
  function rehydrate(ref) { return renderAt(ref, ref.seed || 0); }

  function itemRef(item) {
    return {
      source: item.source, template_id: item.template_id, seed: item.seed || 0,
      subtest: item.subtest, topic: item.topic,
      passage_id: item.passage_id || null, target_seconds: item.target_seconds
    };
  }

  function renderAt(ref, seed) {
    if (!ref || !ref.template_id) return null;
    // A ref written by the previous generated content layer names a template
    // that no longer exists. It resolves to null, and every caller already
    // guards, so old history degrades rather than throwing.
    try {
      return items.render(bankdata.byId(ref.template_id), seed || 0);
    } catch (e) { return null; }
  }

  function renderOne(ref) { return renderAt(ref, 0); }

  // Practice items for a lesson, drawn from its own subtopic.
  function lessonPractice(lesson, n, seed) {
    var r = rng.make('lesson:' + lesson.id + ':' + (seed || Date.now()));
    return buildSection(lesson.subtest, n || 3, r,
      { topics: [lesson.topic], allowAmbiguous: true }, {});
  }

  // How many unseen items a subtest still holds, for the pool-health warnings.
  function poolHealth(code) {
    var list = drawable(code, { allowAmbiguous: true });
    var unseen = 0;
    for (var i = 0; i < list.length; i++) {
      if (!state || state.timesSeen(list[i].id) === 0) unseen++;
    }
    var cfg = data.subtest(code);
    var per = (cfg && cfg.items) || 15;
    return { code: code, total: list.length, unseen: unseen, perExam: per,
             examsLeft: Math.floor(unseen / Math.max(per, 1)) };
  }

  return {
    fullSimulation: fullSimulation, diagnostic: diagnostic, practice: practice,
    drill: drill, review: review, renderOne: renderOne, rehydrate: rehydrate,
    itemRef: itemRef, lessonPractice: lessonPractice,
    buildSection: sectionItems, difficultyTarget: difficultyTarget,
    poolHealth: poolHealth
  };
});
