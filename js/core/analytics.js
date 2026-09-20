/* Post-exam analysis: topic heatmap, subtopic pattern detection, timing
   forensics and confidence cross-tabs.

   The guiding rule is that one miss is not a weakness. Every accuracy figure
   carries the sample it rests on, and ranking uses a Wilson lower bound so a
   topic answered once cannot outrank a topic answered twenty times. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else { root.ASVAB = root.ASVAB || {}; root.ASVAB.analytics = factory(root.ASVAB.data); }
})(typeof self !== 'undefined' ? self : this, function (data) {
  'use strict';

  var GUESS_SECONDS = 8;        // at or under this, the student did not work it
  var SINK_MULTIPLIER = 2.5;    // over this much of the item's target time

  /* Lower bound of the Wilson score interval. With 1 of 1 correct it returns
     about 0.21, not 1.0, which is exactly the caution we want before calling
     something a strength or a weakness. */
  function wilsonLower(correct, total, z) {
    if (!total) return 0;
    z = z || 1.96;
    var p = correct / total, n = total, z2 = z * z;
    var denom = 1 + z2 / n;
    var centre = p + z2 / (2 * n);
    var margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    return Math.max(0, (centre - margin) / denom);
  }

  function confidenceOfSample(n) {
    if (n >= 10) return { level: 'high', label: 'solid sample' };
    if (n >= 4) return { level: 'medium', label: 'limited sample' };
    return { level: 'low', label: 'too few to judge' };
  }

  /* rows: [{subtest, topic, correct, confidence, seconds, target_seconds}] */
  function heatmap(rows) {
    var cells = {};
    rows.forEach(function (r) {
      var key = r.subtest + '.' + r.topic;
      var c = cells[key] || (cells[key] = {
        subtest: r.subtest, topic: r.topic, key: key,
        total: 0, correct: 0, seconds: 0, guesses: 0, confidentWrong: 0
      });
      c.total++;
      if (r.correct) c.correct++;
      c.seconds += r.seconds || 0;
      if ((r.seconds || 0) <= GUESS_SECONDS) c.guesses++;
      if (!r.correct && r.confidence === 'sure') c.confidentWrong++;
    });

    return Object.keys(cells).map(function (k) {
      var c = cells[k];
      c.accuracy = c.correct / c.total;
      c.lower = wilsonLower(c.correct, c.total);
      c.upper = 1 - wilsonLower(c.total - c.correct, c.total);
      c.confidence = confidenceOfSample(c.total);
      c.avgSeconds = c.seconds / c.total;
      c.label = topicLabel(c.topic);
      c.subtestName = (data.subtest(c.subtest) || {}).name || c.subtest;
      return c;
    }).sort(function (a, b) { return a.subtest.localeCompare(b.subtest) || a.topic.localeCompare(b.topic); });
  }

  function topicLabel(topic) {
    return String(topic).replace(/_/g, ' ').replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }

  /* Weakest subtopics, ranked by the Wilson lower bound so small samples are
     not mistaken for weaknesses. `minTotal` keeps one-off misses out entirely. */
  function weakSpots(rows, opts) {
    opts = opts || {};
    var minTotal = opts.minTotal || 2;
    return heatmap(rows)
      .filter(function (c) { return c.total >= minTotal && c.accuracy < (opts.threshold || 0.75); })
      .sort(function (a, b) {
        if (a.lower !== b.lower) return a.lower - b.lower;
        return b.total - a.total;
      })
      .slice(0, opts.limit || 8);
  }

  function strongSpots(rows, opts) {
    opts = opts || {};
    return heatmap(rows)
      .filter(function (c) { return c.total >= (opts.minTotal || 3); })
      .sort(function (a, b) { return b.lower - a.lower; })
      .slice(0, opts.limit || 5);
  }

  /* Subtopic-level patterns, phrased with the actual counts: the report should
     say "missed 5 of 6 exponent-rule problems", not "weak in maths". */
  function patterns(rows) {
    var out = [];
    heatmap(rows).forEach(function (c) {
      var missed = c.total - c.correct;
      if (c.total >= 3 && c.accuracy <= 0.4) {
        out.push({
          kind: 'weakness', severity: missed * (1 - c.accuracy),
          subtest: c.subtest, topic: c.topic,
          text: 'Missed ' + missed + ' of ' + c.total + ' ' + c.label.toLowerCase() + ' questions in ' + c.subtestName + '.',
          cell: c
        });
      } else if (c.total >= 4 && c.accuracy >= 0.9) {
        out.push({
          kind: 'strength', severity: 0,
          subtest: c.subtest, topic: c.topic,
          text: 'Got ' + c.correct + ' of ' + c.total + ' ' + c.label.toLowerCase() + ' questions right in ' + c.subtestName + '.',
          cell: c
        });
      } else if (c.total === 2 && c.correct === 0) {
        out.push({
          kind: 'watch', severity: 0.5,
          subtest: c.subtest, topic: c.topic,
          text: 'Missed both ' + c.label.toLowerCase() + ' questions, but two is too few to be sure.',
          cell: c
        });
      }
    });
    return out.sort(function (a, b) { return b.severity - a.severity; });
  }

  /* Timing, reported separately from knowledge. A fast miss and a slow miss
     are different problems and need different fixes. */
  function timing(rows) {
    var timed = rows.filter(function (r) { return typeof r.seconds === 'number' && r.seconds > 0; });
    var guesses = [], sinks = [], worked = [];
    timed.forEach(function (r) {
      var target = r.target_seconds || 45;
      if (r.seconds <= GUESS_SECONDS) guesses.push(r);
      else if (r.seconds >= target * SINK_MULTIPLIER) sinks.push(r);
      else worked.push(r);
    });
    function acc(list) { return list.length ? list.filter(function (r) { return r.correct; }).length / list.length : null; }
    var totalSeconds = timed.reduce(function (a, r) { return a + r.seconds; }, 0);

    return {
      answered: timed.length,
      totalSeconds: totalSeconds,
      avgSeconds: timed.length ? totalSeconds / timed.length : 0,
      guesses: { count: guesses.length, accuracy: acc(guesses), items: guesses },
      sinks: { count: sinks.length, accuracy: acc(sinks), items: sinks,
               seconds: sinks.reduce(function (a, r) { return a + r.seconds; }, 0) },
      worked: { count: worked.length, accuracy: acc(worked) },
      // Knowledge accuracy excludes the questions that were never really attempted.
      knowledgeAccuracy: acc(worked.concat(sinks)),
      overallAccuracy: acc(timed)
    };
  }

  /* Confident-and-wrong is the most useful cell in this table: it marks the
     places where the student does not know that they do not know. */
  function confidenceBreakdown(rows) {
    var cells = {
      sure: { right: 0, wrong: 0 }, unsure: { right: 0, wrong: 0 }, guessed: { right: 0, wrong: 0 }
    };
    rows.forEach(function (r) {
      var c = cells[r.confidence] || cells.unsure;
      if (r.correct) c.right++; else c.wrong++;
    });
    var total = rows.length || 1;
    return {
      cells: cells,
      confidentWrong: cells.sure.wrong,
      confidentWrongPct: cells.sure.wrong / total,
      luckyGuesses: cells.guessed.right,
      // A well-calibrated student is nearly always right when they say "sure".
      calibration: (cells.sure.right + cells.sure.wrong)
        ? cells.sure.right / (cells.sure.right + cells.sure.wrong) : null
    };
  }

  // Score progression across attempts, for the history chart.
  function progression(attempts) {
    return attempts.filter(function (a) { return a.scores && a.scores.afqt; })
      .map(function (a) {
        return {
          id: a.id, date: a.date, mode: a.mode,
          afqt: a.scores.afqt.percentile, band: a.scores.afqt.band,
          composites: a.scores.composites,
          items: (a.per_item_results || []).length
        };
      });
  }

  // Everything the score report needs, in one call.
  function report(rows, attempts) {
    return {
      heatmap: heatmap(rows),
      weakSpots: weakSpots(rows),
      strongSpots: strongSpots(rows),
      patterns: patterns(rows),
      timing: timing(rows),
      confidence: confidenceBreakdown(rows),
      progression: progression(attempts || [])
    };
  }

  return {
    heatmap: heatmap, weakSpots: weakSpots, strongSpots: strongSpots,
    patterns: patterns, timing: timing, confidenceBreakdown: confidenceBreakdown,
    progression: progression, report: report, wilsonLower: wilsonLower,
    topicLabel: topicLabel, GUESS_SECONDS: GUESS_SECONDS, SINK_MULTIPLIER: SINK_MULTIPLIER
  };
});
