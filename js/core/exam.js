/* Builds the item lists for every mode: diagnostic, full simulation, single
   subtest practice, targeted drills and the spaced-repetition review.

   Selection leans on the `seen` table so repeat sittings draw fresh content,
   and on per-subtest difficulty targets so a student who is struggling is not
   handed the hardest items in the bank. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./rng.js'), require('./engine.js'),
      require('./bank.js'), require('./passage.js'), require('./ao.js'), require('./state.js'));
  } else {
    root.ASVAB = root.ASVAB || {};
    root.ASVAB.exam = factory(root.ASVAB.data, root.ASVAB.rng, root.ASVAB.engine,
      root.ASVAB.bank, root.ASVAB.passage, root.ASVAB.ao, root.ASVAB.state);
  }
})(typeof self !== 'undefined' ? self : this, function (data, rng, engine, bankGen, passageGen, ao, state) {
  'use strict';

  function freshSeed(templateId, used, r) {
    for (var i = 0; i < 40; i++) {
      var s = r.int(1, 9999999);
      if (!used[s]) { used[s] = true; return s; }
    }
    return r.int(1, 9999999);
  }

  /* Rank candidates: least-seen first, then closest to the difficulty target,
     then a seeded jitter so equal candidates rotate between sittings. */
  function rankCandidates(list, target, r, keyOf) {
    return list.map(function (c, i) {
      var seen = state ? state.timesSeen(keyOf(c)) : 0;
      return {
        item: c, seen: seen,
        gap: Math.abs((c.difficulty || 2) - target),
        jitter: rng.make(keyOf(c) + ':' + r.int(1, 1e6)).next()
      };
    }).sort(function (a, b) {
      if (a.seen !== b.seen) return a.seen - b.seen;
      if (a.gap !== b.gap) return a.gap - b.gap;
      return a.jitter - b.jitter;
    }).map(function (x) { return x.item; });
  }

  // Take `n` items while spreading them across topics before doubling up.
  function spreadByTopic(ranked, n, topicOf) {
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

  /* Difficulty target for a subtest, 1-4, from the student's recent accuracy.
     Defaults to 2 with no history, which is the middle of the band. */
  function difficultyTarget(code) {
    if (!state) return 2;
    var rows = state.seenList().filter(function (r) { return r.subtest === code; });
    if (rows.length < 5) return 2;
    var recent = rows.slice(-40);
    var acc = recent.filter(function (r) { return r.correct; }).length / recent.length;
    if (acc >= 0.85) return 4;
    if (acc >= 0.7) return 3;
    if (acc >= 0.45) return 2;
    return 1;
  }

  function buildTemplateItems(code, n, r, topicFilter) {
    var pool = data.templatesFor(code).filter(function (t) {
      return !topicFilter || topicFilter.indexOf(t.topic) >= 0;
    });
    if (!pool.length) return [];
    var target = difficultyTarget(code);
    var ranked = rankCandidates(pool, target, r, function (t) { return t.id; });
    var chosen = spreadByTopic(ranked, n, function (t) { return t.topic; });
    // If the subtest has fewer templates than items, cycle -- different seeds
    // still give genuinely different questions.
    var out = [];
    for (var i = 0; i < n; i++) {
      var tpl = chosen[i % Math.max(chosen.length, 1)] || ranked[i % ranked.length];
      var used = state ? state.seedsUsed(tpl.id) : {};
      try { out.push(engine.renderTemplate(tpl, freshSeed(tpl.id, used, r))); }
      catch (e) { /* a template that cannot render is skipped, never shown broken */ }
    }
    return out;
  }

  function buildBankItems(code, n, r, topicFilter) {
    var b = data.banks[code];
    if (!b || !b.entries.length) return [];
    var pool = b.entries.filter(function (e) {
      return !topicFilter || topicFilter.indexOf(e.topic) >= 0;
    });
    if (!pool.length) return [];
    var target = difficultyTarget(code);
    var ranked = rankCandidates(pool, target, r, function (e) { return e.id; });
    var chosen = spreadByTopic(ranked, n, function (e) { return e.topic; });
    var out = [];
    for (var i = 0; i < n && i < chosen.length; i++) {
      var e = chosen[i];
      var used = state ? state.seedsUsed(e.id) : {};
      try { out.push(bankGen.render(e, b.entries, freshSeed(e.id, used, r))); } catch (err) { }
    }
    return out;
  }

  function buildPassageItems(n, r, typeFilter) {
    var ranked = rankCandidates(data.passages, difficultyTarget('PC'), r, function (p) { return p.id; });
    var out = [];
    for (var i = 0; i < ranked.length && out.length < n; i++) {
      var p = ranked[i];
      var want = Math.min(n - out.length, 3);
      var items;
      try { items = passageGen.render(p, r.int(1, 9999999), want); } catch (e) { continue; }
      if (typeFilter) items = items.filter(function (it) { return typeFilter.indexOf(it.topic) >= 0; });
      out = out.concat(items.slice(0, n - out.length));
    }
    return out;
  }

  function buildAOItems(n, r) {
    var out = [];
    for (var i = 0; i < n; i++) {
      // alternate the two problem kinds so a section always shows both
      out.push(ao.render(r.int(1, 9999999), i % 2 === 0 ? 'connection' : 'assembly'));
    }
    return out;
  }

  // One subtest's worth of items, drawing from whichever sources it declares.
  function buildSection(code, n, r, filters) {
    filters = filters || {};
    var cfg = data.subtest(code);
    if (!cfg) return [];
    var sources = cfg.sources || [];
    var items = [];

    if (sources.indexOf('procedural') >= 0) items = items.concat(buildAOItems(n, r));
    if (sources.indexOf('passage') >= 0) items = items.concat(buildPassageItems(n - items.length, r, filters.topics));

    // A subtest with both templates and a bank splits the count between them
    // in proportion to how much content each side holds.
    var hasT = sources.indexOf('template') >= 0, hasB = sources.indexOf('bank') >= 0;
    if (hasT && hasB) {
      var tN = data.templatesFor(code).length;
      var bN = ((data.banks[code] || {}).entries || []).length;
      var remaining = n - items.length;
      var fromT = Math.max(1, Math.round(remaining * (tN / Math.max(1, tN + bN))));
      items = items.concat(buildTemplateItems(code, fromT, r, filters.topics));
      items = items.concat(buildBankItems(code, n - items.length, r, filters.topics));
    } else if (hasT) {
      items = items.concat(buildTemplateItems(code, n - items.length, r, filters.topics));
    } else if (hasB) {
      items = items.concat(buildBankItems(code, n - items.length, r, filters.topics));
    }

    // Top up from any source if a filter left the section short.
    if (items.length < n && !filters.topics) {
      if (hasT) items = items.concat(buildTemplateItems(code, n - items.length, r));
      if (items.length < n && hasB) items = items.concat(buildBankItems(code, n - items.length, r));
    }
    return r.shuffle(items).slice(0, n);
  }

  // ---------------- modes ----------------

  function fullSimulation(seed) {
    var r = rng.make('sim:' + (seed || Date.now()));
    var sections = data.subtests.slice().sort(function (a, b) { return a.order - b.order; })
      .map(function (s) {
        return { code: s.code, name: s.name, seconds: s.seconds, items: buildSection(s.code, s.items, r) };
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
    var items = [];
    data.subtests.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (s) {
      items = items.concat(buildSection(s.code, spread[s.code] || 0, r));
    });
    return {
      mode: 'diagnostic', created: new Date().toISOString(),
      sections: [{ code: 'MIX', name: 'Placement Test', seconds: data.config.diagnostic.seconds, items: items }],
      totalItems: items.length, totalSeconds: data.config.diagnostic.seconds
    };
  }

  function practice(code, n, seed) {
    var r = rng.make('prac:' + code + ':' + (seed || Date.now()));
    var cfg = data.subtest(code);
    var items = buildSection(code, n || cfg.items, r);
    return {
      mode: 'practice', created: new Date().toISOString(), subtest: code,
      sections: [{ code: code, name: cfg.name, seconds: null, items: items }],
      totalItems: items.length, totalSeconds: null
    };
  }

  /* A drill aimed at the subtopics the student is weakest in. `weakSpots` is
     [{subtest, topic}] from the analytics module. */
  function drill(weakSpots, n, seed) {
    var r = rng.make('drill:' + (seed || Date.now()));
    n = n || data.config.drill.items;
    if (!weakSpots || !weakSpots.length) return practice('AR', n, seed);

    var perSpot = Math.max(1, Math.floor(n / weakSpots.length));
    var items = [];
    weakSpots.forEach(function (w) {
      if (items.length >= n) return;
      items = items.concat(buildSection(w.subtest, Math.min(perSpot, n - items.length), r, { topics: [w.topic] }));
    });
    // Short? Widen to the whole of the weakest subtest.
    var guard = 0;
    while (items.length < n && guard++ < 6) {
      var more = buildSection(weakSpots[0].subtest, n - items.length, r);
      if (!more.length) break;
      items = items.concat(more);
    }
    return {
      mode: 'drill', created: new Date().toISOString(),
      focus: weakSpots.slice(0, 4),
      sections: [{ code: 'DRILL', name: 'Targeted Drill', seconds: null, items: r.shuffle(items).slice(0, n) }],
      totalItems: Math.min(items.length, n), totalSeconds: null
    };
  }

  /* Items due for spaced repetition. Each is re-rendered with a NEW seed, so
     the concept comes back with different numbers rather than as a memory test. */
  function review(seed) {
    var r = rng.make('review:' + (seed || Date.now()));
    var due = state ? state.dueReviews() : [];
    var items = [];
    due.forEach(function (q) {
      var it = renderOne(q, r);
      if (it) items.push(it);
    });
    return {
      mode: 'review', created: new Date().toISOString(),
      sections: [{ code: 'REVIEW', name: 'Spaced Review', seconds: null, items: items }],
      totalItems: items.length, totalSeconds: null
    };
  }

  /* Re-render a stored reference with its ORIGINAL seed. Rendering is
     deterministic, so a session can be persisted as a short list of refs and
     rebuilt byte-identically after a refresh, rather than storing whole items
     (AO figures alone would be megabytes). */
  function rehydrate(ref) { return renderAt(ref, ref.seed); }

  function itemRef(item) {
    return {
      source: item.source, template_id: item.template_id, seed: item.seed,
      subtest: item.subtest, topic: item.topic,
      passage_id: item.passage_id || null, target_seconds: item.target_seconds
    };
  }

  // Re-render any item reference with a fresh seed.
  function renderOne(ref, r) {
    r = r || rng.make('one:' + Date.now());
    return renderAt(ref, r.int(1, 9999999));
  }

  function renderAt(ref, seed) {
    try {
      if (ref.source === 'template') {
        var tpl = data.template(ref.template_id);
        return tpl ? engine.renderTemplate(tpl, seed) : null;
      }
      if (ref.source === 'procedural') {
        return ao.render(seed, ref.template_id === 'AO_connection' ? 'connection' : 'assembly');
      }
      if (ref.source === 'passage') {
        var pid = ref.passage_id || String(ref.template_id).split('/')[0];
        var qid = String(ref.template_id).split('/')[1];
        var psg = data.passages.filter(function (p) { return p.id === pid; })[0];
        if (!psg) return null;
        var q = psg.questions.filter(function (x) { return x.id === qid; })[0] || psg.questions[0];
        return passageGen.renderQuestion(psg, q, seed);
      }
      // bank
      var b = data.banks[ref.subtest];
      if (!b) return null;
      var e = b.entries.filter(function (x) { return x.id === ref.template_id; })[0];
      return e ? bankGen.render(e, b.entries, seed) : null;
    } catch (err) { return null; }
  }

  // Three practice items for a lesson, drawn live from its own subtopic.
  function lessonPractice(lesson, n, seed) {
    var r = rng.make('lesson:' + lesson.id + ':' + (seed || Date.now()));
    return buildSection(lesson.subtest, n || 3, r, { topics: [lesson.topic] });
  }

  return {
    fullSimulation: fullSimulation, diagnostic: diagnostic, practice: practice,
    drill: drill, review: review, renderOne: renderOne, rehydrate: rehydrate,
    itemRef: itemRef, lessonPractice: lessonPractice,
    buildSection: buildSection, difficultyTarget: difficultyTarget
  };
});
