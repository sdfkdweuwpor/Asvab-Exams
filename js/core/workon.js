/* The "Work On" ranking.

   Ranking weak topics by raw accuracy is the obvious thing and it is wrong: it
   puts a topic you got 1 of 2 wrong above one you got 8 of 20 wrong, and it
   treats a topic worth 15 questions on the exam the same as one worth two.

   So topics are ranked by estimated score LEVERAGE -- how many AFQT points
   bringing this topic to 85% would actually be worth -- which combines how
   wrong you are, how confident we are that you are wrong, and how much the
   exam cares. Pace is tracked separately, because a topic you get right but
   too slowly fails under real time pressure while looking fine on accuracy,
   and nothing else surfaces it.

   Everything here is deterministic given a fixed response history: there is no
   randomness, and ties break on topic id. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./data.js'), require('./scoring.js'), require('./bankdata.js'));
  } else {
    root.ASVAB = root.ASVAB || {};
    root.ASVAB.workon = factory(root.ASVAB.data, root.ASVAB.scoring, root.ASVAB.bankdata);
  }
})(typeof self !== 'undefined' ? self : this, function (data, scoring, bankdata) {
  'use strict';

  var AFQT_SUBTESTS = { AR: 1, MK: 1, WK: 1, PC: 1 };
  var TARGET = 0.85;              // the level a topic is being brought up to
  var MASTERY_MIN_Q = 12;         // and the gate it has to clear to count as done
  var MASTERY_MIN_SESSIONS = 2;
  var PACE_MULTIPLE = 1.5;        // over this much of your own median is "slow"
  var STALE_DAYS = 21;            // untouched this long and the estimate decays

  /* Beta(2,2) prior. Weak enough not to swamp real evidence, strong enough that
     one miss out of two does not read as a 50% topic. */
  var PRIOR_A = 2, PRIOR_B = 2;

  function posterior(correct, total) {
    var a = PRIOR_A + correct, b = PRIOR_B + (total - correct);
    var mean = a / (a + b);
    var varr = (a * b) / ((a + b) * (a + b) * (a + b + 1));
    var sd = Math.sqrt(varr);
    return { mean: mean, sd: sd, lo: Math.max(0, mean - 1.96 * sd), hi: Math.min(1, mean + 1.96 * sd) };
  }

  function daysSince(iso) {
    if (!iso) return null;
    return (Date.now() - new Date(iso).getTime()) / 86400000;
  }

  /* How many questions a topic is worth on the current exam format: the
     subtest's item count, times the topic's share of that subtest's bank. */
  function examWeight(profile, subtest, topicShare) {
    if (!profile) return 0;
    var n = 0;
    profile.sections.forEach(function (sec) {
      var pools = data.poolsFor(sec);
      if (pools.indexOf(subtest) >= 0) n += sec.items / pools.length;
    });
    return n * topicShare;
  }

  /* Estimated AFQT percentile gain from bringing one topic to the target.

     The chain is: more correct answers in a subtest -> a higher standard score
     for it -> a higher AFQT raw -> a higher percentile. Word Knowledge and
     Paragraph Comprehension go through VE, and VE is doubled in the formula,
     which is why a verbal topic is usually worth more than an equally weak
     maths one. */
  function leverage(subtest, accuracy, weightItems, baseline) {
    if (!AFQT_SUBTESTS[subtest]) return 0;
    if (accuracy >= TARGET || !weightItems) return 0;

    var gain = TARGET - accuracy;
    var b = { min: scoring.SS_MIN, max: scoring.SS_MAX };
    var sectionItems = sectionItemsFor(baseline.profile, subtest);
    if (!sectionItems) return 0;

    // standard-score points the subtest would gain
    var ssDelta = (b.max - b.min) * (gain * weightItems / sectionItems);

    var rawDelta;
    if (subtest === 'WK' || subtest === 'PC') {
      var w = ((data.scoringConfig.ve || {}).weights || {})[subtest] || 0.5;
      rawDelta = 2 * ssDelta * w;          // VE is doubled in 2VE + AR + MK
    } else {
      rawDelta = ssDelta;
    }

    var before = baseline.afqtRaw;
    var after = before + rawDelta;
    return Math.max(0, scoring.afqtPercentile(after) - scoring.afqtPercentile(before));
  }

  function sectionItemsFor(profile, subtest) {
    if (!profile) return 0;
    var n = 0;
    profile.sections.forEach(function (sec) {
      var pools = data.poolsFor(sec);
      if (pools.indexOf(subtest) >= 0) n += sec.items / pools.length;
    });
    return n;
  }

  /* rows: expanded seen rows, newest last.
     Returns one entry per topic actually attempted. */
  function analyse(rows, opts) {
    opts = opts || {};
    var profile = opts.profile || data.profile(data.defaultProfileId);

    // Per-subtest median answering time, for the pace signal. It is the
    // student's own median, not a fixed target: "slow" means slow for you.
    var bySubTimes = {};
    rows.forEach(function (r) {
      if (!r.seconds || !r.subtest) return;
      (bySubTimes[r.subtest] = bySubTimes[r.subtest] || []).push(r.seconds);
    });
    var median = {};
    Object.keys(bySubTimes).forEach(function (k) {
      var a = bySubTimes[k].sort(function (x, y) { return x - y; });
      median[k] = a[Math.floor(a.length / 2)];
    });

    // Topic share of each subtest's bank, for exam weight.
    var bankByTopic = {}, bankBySub = {};
    bankdata.codes().forEach(function (code) {
      bankdata.forSubtest(code).forEach(function (rec) {
        bankBySub[code] = (bankBySub[code] || 0) + 1;
        var t = (rec.topics || [])[0];
        if (t) bankByTopic[code + '.' + t] = (bankByTopic[code + '.' + t] || 0) + 1;
      });
    });

    var cells = {};
    rows.forEach(function (r) {
      if (!r.subtest || !r.topic) return;
      var k = r.subtest + '.' + r.topic;
      var c = cells[k] || (cells[k] = {
        key: k, subtest: r.subtest, topic: r.topic,
        total: 0, correct: 0, seconds: 0, timed: 0, slow: 0,
        dates: {}, recent: [], lastSeen: null
      });
      c.total++;
      if (r.correct) c.correct++;
      if (r.seconds) { c.seconds += r.seconds; c.timed++; }
      var med = median[r.subtest];
      if (r.correct && r.seconds && med && r.seconds > med * PACE_MULTIPLE) c.slow++;
      if (r.date) { c.dates[String(r.date).slice(0, 10)] = true; c.lastSeen = r.date; }
      c.recent.push(r.correct ? 1 : 0);
    });

    // Baseline AFQT, so leverage is measured from where the student actually is.
    var tallies = {};
    rows.forEach(function (r) {
      if (!r.subtest) return;
      var t = tallies[r.subtest] = tallies[r.subtest] || { correct: 0, total: 0 };
      t.total++;
      if (r.correct) t.correct++;
    });
    var base = scoring.score(tallies, rows.length);
    var baseline = {
      profile: profile,
      afqtRaw: base.afqt ? base.afqt.raw : 4 * 50,
      afqtPct: base.afqt ? base.afqt.percentile : null
    };

    return Object.keys(cells).map(function (k) {
      var c = cells[k];
      var post = posterior(c.correct, c.total);
      var sessions = Object.keys(c.dates).length;
      var share = bankBySub[c.subtest] ? (bankByTopic[k] || 0) / bankBySub[c.subtest] : 0;
      var weight = examWeight(profile, c.subtest, share);
      var lev = leverage(c.subtest, post.mean, weight, baseline);

      // Trend over the last three sittings' worth of answers.
      var recent = c.recent.slice(-Math.max(6, Math.ceil(c.total / 2)));
      var older = c.recent.slice(0, c.recent.length - recent.length);
      var recentAcc = recent.length ? recent.reduce(function (a, b) { return a + b; }, 0) / recent.length : null;
      var olderAcc = older.length ? older.reduce(function (a, b) { return a + b; }, 0) / older.length : null;
      var trend = (recentAcc !== null && olderAcc !== null) ? recentAcc - olderAcc : null;

      var stale = daysSince(c.lastSeen);
      // Untouched for weeks, the estimate is less trustworthy, so the topic is
      // nudged back up the list rather than being taken on faith.
      var decay = (stale !== null && stale > STALE_DAYS)
        ? Math.min(1.25, 1 + (stale - STALE_DAYS) / 60) : 1;

      var avgSeconds = c.timed ? c.seconds / c.timed : null;
      var med = median[c.subtest] || null;
      var paceRatio = (avgSeconds && med) ? avgSeconds / med : null;
      var paceProblem = c.total >= 4 && c.slow >= Math.max(2, Math.round(c.total * 0.3));

      var mastered = post.mean >= TARGET && c.total >= MASTERY_MIN_Q && sessions >= MASTERY_MIN_SESSIONS;

      return {
        key: k, subtest: c.subtest, topic: c.topic,
        label: String(c.topic).replace(/_/g, ' ').replace(/\b\w/g, function (m) { return m.toUpperCase(); }),
        subtestName: (data.subtest(c.subtest) || {}).name || c.subtest,
        total: c.total, correct: c.correct, sessions: sessions,
        accuracy: c.total ? c.correct / c.total : 0,
        mastery: post.mean, lo: post.lo, hi: post.hi,
        band: Math.round((post.hi - post.lo) * 50),   // +/- percentage points
        examWeight: weight, share: share,
        leverage: lev,
        trend: trend,
        avgSeconds: avgSeconds, medianSeconds: med, paceRatio: paceRatio,
        slowCount: c.slow, paceProblem: paceProblem,
        daysSince: stale, decay: decay,
        mastered: mastered,
        lesson: lessonFor(c.subtest, c.topic),
        // Leverage drives the order; pace adds a push, because a topic that is
        // accurate but slow still costs questions on a timed section.
        rank: lev * decay + (paceProblem ? 0.75 : 0)
      };
    }).sort(function (a, b) {
      if (b.rank !== a.rank) return b.rank - a.rank;
      if (a.mastery !== b.mastery) return a.mastery - b.mastery;
      return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
    });
  }

  function lessonFor(sub, topic) {
    var tries = sub === 'AS' ? ['ai_' + topic, 'si_' + topic] : [sub.toLowerCase() + '_' + topic];
    for (var i = 0; i < tries.length; i++) if (data.lesson(tries[i])) return tries[i];
    return null;
  }

  /* One plain-language sentence naming what is actually wrong. Accuracy and
     pace are different problems needing different fixes, so they are never
     blurred into "weak in maths". */
  function diagnose(c) {
    var pct = Math.round(c.mastery * 100);
    var missed = c.total - c.correct;

    // Pace is its own diagnosis, because it is a different problem with a
    // different fix: the student knows this material and is losing it to time.
    if (c.paceProblem && c.mastery >= 0.7) {
      var avg = Math.round(c.avgSeconds);
      var mm = Math.floor(avg / 60), ss = avg % 60;
      var clock = mm ? mm + ':' + (ss < 10 ? '0' : '') + ss : avg + 's';
      var cost = Math.max(1, Math.round(c.examWeight * Math.min(1, (c.paceRatio - 1) / c.paceRatio)));
      return 'You are getting ' + c.label.toLowerCase() + ' questions right but averaging ' +
        clock + ' each, about ' + c.paceRatio.toFixed(1) + '\u00d7 your usual pace in ' +
        c.subtestName + '. That costs you roughly ' + cost +
        ' question' + (cost === 1 ? '' : 's') + ' on a real section.';
    }

    if (c.total < 4) {
      return 'Only ' + c.total + ' question' + (c.total === 1 ? '' : 's') + ' so far, which is ' +
        'too few to judge. Drill it to find out whether this is a real gap.';
    }

    // Lead with what actually happened, in counts rather than percentages --
    // "missed 14 of 20" is a fact, "33% mastery" is a model output.
    var lead = 'Missed ' + missed + ' of ' + c.total + ' ' + c.label.toLowerCase() +
      ' question' + (c.total === 1 ? '' : 's') + ' in ' + c.subtestName + '.';

    // Then at most one thing that changes what to do about it.
    if (c.trend !== null && c.trend >= 0.2) {
      return lead + ' You are improving though — recent answers are going better than ' +
        'earlier ones, so keep drilling.';
    }
    if (c.trend !== null && c.trend <= -0.2) {
      return lead + ' Recent answers are going worse than earlier ones, so read the ' +
        'lesson again before drilling harder.';
    }
    if (c.daysSince !== null && c.daysSince > STALE_DAYS) {
      return lead + ' You have not touched it in ' + Math.round(c.daysSince) +
        ' days, so confirm it is still where you left it.';
    }
    if (c.paceProblem) {
      return lead + ' You are also slower than usual on them, at about ' +
        c.paceRatio.toFixed(1) + '\u00d7 your ' + c.subtestName + ' pace.';
    }
    if (pct >= 70) {
      return lead + ' Close to solid — a short drill should finish it off.';
    }
    return lead;
  }

  /* The ranked list, with the mastered topics filtered out. */
  function workOn(rows, opts) {
    opts = opts || {};
    var all = analyse(rows, opts);
    var list = all.filter(function (c) {
      if (c.mastered) return false;
      if (c.total < (opts.minTotal || 2)) return false;
      return c.rank > 0 || c.mastery < TARGET;
    });
    list.forEach(function (c) { c.diagnosis = diagnose(c); });
    return list.slice(0, opts.limit || 8);
  }

  function mastered(rows, opts) {
    return analyse(rows, opts).filter(function (c) { return c.mastered; });
  }

  return {
    analyse: analyse, workOn: workOn, mastered: mastered, diagnose: diagnose,
    posterior: posterior, leverage: leverage,
    TARGET: TARGET, MASTERY_MIN_Q: MASTERY_MIN_Q,
    MASTERY_MIN_SESSIONS: MASTERY_MIN_SESSIONS, PACE_MULTIPLE: PACE_MULTIPLE
  };
});
