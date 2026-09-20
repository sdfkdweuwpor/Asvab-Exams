/* Post-exam review: score report, per-question breakdown, topic analysis and a
   printable miss sheet. This is the part of the app that is supposed to teach,
   so every missed question carries its worked solution, the named error behind
   each wrong option, and a route into the relevant lesson. */
(function (root) {
  'use strict';
  var A = root.ASVAB;
  var d = A.dom, el = d.el;

  function rowsFor(attempt) {
    return (attempt.per_item_results || []).map(function (r) {
      return {
        subtest: r.subtest, topic: r.topic, correct: r.correct,
        confidence: r.confidence, seconds: r.seconds, target_seconds: r.target_seconds
      };
    });
  }

  // ---------------- score report ----------------

  function scoreReport(attemptId) {
    var att = A.state.attempt(attemptId);
    if (!att) return el('p', { class: 'muted' }, 'That attempt could not be found.');
    var sc = att.scores || {};
    var box = el('div');

    var correct = (att.per_item_results || []).filter(function (r) { return r.correct; }).length;
    var total = (att.per_item_results || []).length;

    if (sc.afqt) {
      d.append(box, el('div', { class: 'card score-hero' }, [
        el('div', { class: 'muted small', text: 'AFQT score — ESTIMATE' }),
        el('div', { class: 'big', text: String(sc.afqt.percentile) }),
        el('div', { class: 'band' }, '±' + sc.afqt.band + ', based on ' + sc.afqt.sample + ' questions answered'),
        el('div', { class: 'estimate-note' },
          'This is an estimate, not a predicted official score. ' + sc.afqt.basis)
      ]));
    } else {
      d.append(box, el('div', { class: 'card score-hero' }, [
        el('div', { class: 'big', text: correct + '/' + total }),
        el('div', { class: 'band', text: d.pct(total ? correct / total : 0) + ' correct' }),
        el('p', { class: 'muted small', style: 'margin-bottom:0' },
          'An AFQT estimate needs Word Knowledge, Paragraph Comprehension, Arithmetic Reasoning and Mathematics Knowledge. Take a full simulation to get one.')
      ]));
    }

    d.append(box, el('div', { class: 'card' }, [
      el('div', { class: 'row between' }, [
        el('strong', 'This attempt'),
        el('span', { class: 'muted small', text: d.fmtDate(att.date) })
      ]),
      el('div', { class: 'row', style: 'margin-top:8px' }, [
        el('span', { class: 'chip', text: att.mode }),
        el('span', { class: 'chip', text: correct + '/' + total + ' correct' }),
        el('span', { class: 'chip', text: d.fmtDuration(att.durationSec || 0) }),
        att.catRules ? el('span', { class: 'chip', text: 'CAT rules' }) : null
      ])
    ]));

    if (sc.composites) d.append(box, compositesCard(sc));
    d.append(box, progressCard());

    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'Work on it'),
      el('a', { class: 'btn block', href: '#/review/' + attemptId }, 'Review every question'),
      el('a', { class: 'btn ghost block', href: '#/analysis/' + attemptId }, 'Topic and timing analysis'),
      el('button', {
        class: 'btn ghost block', type: 'button',
        onclick: function () { A.app.startDrillFrom(attemptId); }
      }, 'Build a 15-question drill on my weak spots'),
      el('a', { class: 'btn ghost block', href: '#/misssheet/' + attemptId }, 'Printable miss sheet')
    ]));

    return box;
  }

  function compositesCard(sc) {
    var card = el('div', { class: 'card' }, [
      el('strong', 'Air Force line scores (MAGE)'),
      el('p', { class: 'muted small', style: 'margin:4px 0 10px' },
        'Estimates built from the same approximation as the AFQT figure.')
    ]);

    ['M', 'A', 'G', 'E'].forEach(function (code) {
      var c = sc.composites[code];
      if (!c || !c.available) {
        d.append(card, el('div', { class: 'tight', style: 'padding:8px 0' }, [
          el('div', { class: 'row between' }, [
            el('span', { text: c ? c.label : code }),
            el('span', { class: 'muted small', text: 'not enough subtests' })
          ]),
          el('div', { class: 'tiny muted', text: c ? c.formula : '' })
        ]));
        return;
      }
      // Status encoding: the bar carries a number and a word beside it, never
      // colour on its own.
      var tone = c.z >= 0.35 ? 'good' : (c.z <= -0.35 ? 'bad' : '');
      d.append(card, el('div', { style: 'padding:9px 0; border-bottom:1px solid var(--line)' }, [
        el('div', { class: 'row between' }, [
          el('span', [el('strong', c.label), c.rank === 1 ? el('span', { class: 'chip', style: 'margin-left:8px', text: 'strongest' }) : null]),
          el('span', { style: 'font-variant-numeric:tabular-nums;font-weight:650', text: String(c.value) })
        ]),
        el('div', { class: 'meter ' + tone }, el('span', { style: 'width:' + Math.round(c.fraction * 100) + '%' })),
        el('div', { class: 'row between tiny muted' }, [
          el('span', { text: c.strength }),
          el('span', { text: c.formula })
        ])
      ]));
    });

    d.append(card, el('p', { class: 'banner info', style: 'margin-top:12px;margin-bottom:0' },
      'Job qualification depends on line scores that change over time and vary by contract. ' +
      'This app deliberately does not list cut scores — take your real scores to a recruiter.'));
    return card;
  }

  /* Single-series line chart: AFQT estimate across attempts, with the
     confidence band drawn as an area behind it. One series means no legend --
     the heading names it. Only the first and last points are labelled, so the
     chart is not a wall of numbers, and tapping any point captions it. */
  function progressCard() {
    var prog = A.analytics.progression(A.state.attempts());
    if (prog.length < 2) {
      return el('div', { class: 'card' }, [
        el('strong', 'Progress'),
        el('p', { class: 'muted small', style: 'margin-bottom:0' },
          prog.length ? 'One scored attempt so far. Take another full test to start the trend line.'
                      : 'No scored attempts yet.')
      ]);
    }

    var W = 320, H = 170, padL = 30, padR = 14, padT = 14, padB = 26;
    var iw = W - padL - padR, ih = H - padT - padB;
    var x = function (i) { return padL + (prog.length === 1 ? iw / 2 : (i / (prog.length - 1)) * iw); };
    var y = function (v) { return padT + ih - (Math.max(0, Math.min(100, v)) / 100) * ih; };

    var line = prog.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.afqt).toFixed(1); }).join(' ');
    var top = prog.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.afqt + p.band).toFixed(1); }).join(' ');
    var bot = prog.slice().reverse().map(function (p, i) {
      var j = prog.length - 1 - i;
      return 'L' + x(j).toFixed(1) + ' ' + y(p.afqt - p.band).toFixed(1);
    }).join(' ');

    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" ' +
      'aria-label="AFQT estimate across ' + prog.length + ' attempts, from ' + prog[0].afqt +
      ' to ' + prog[prog.length - 1].afqt + '">';
    // recessive gridlines
    [0, 25, 50, 75, 100].forEach(function (v) {
      svg += '<line class="axis" x1="' + padL + '" y1="' + y(v).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y(v).toFixed(1) + '"/>';
      svg += '<text x="' + (padL - 5) + '" y="' + (y(v) + 3.5).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    });
    svg += '<path class="band" d="' + top + ' ' + bot + ' Z"/>';
    svg += '<path class="line" d="' + line + '" stroke-linecap="round" stroke-linejoin="round"/>';
    prog.forEach(function (p, i) {
      svg += '<circle class="pt" cx="' + x(i).toFixed(1) + '" cy="' + y(p.afqt).toFixed(1) + '" r="4.5"/>';
      // generous invisible hit target for touch
      svg += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.afqt).toFixed(1) + '" r="14" fill="transparent" ' +
             'data-i="' + i + '" style="cursor:pointer"><title>' + d.escapeHtml(d.fmtDate(p.date)) +
             ': ' + p.afqt + ' ±' + p.band + '</title></circle>';
    });
    // selective direct labels: first and last only
    [0, prog.length - 1].forEach(function (i, n) {
      if (n === 1 && prog.length === 1) return;
      var p = prog[i];
      svg += '<text x="' + x(i).toFixed(1) + '" y="' + (y(p.afqt) - 10).toFixed(1) + '" text-anchor="' +
        (i === 0 ? 'start' : 'end') + '" style="font-weight:700">' + p.afqt + '</text>';
    });
    svg += '</svg>';

    var caption = el('p', { class: 'muted small', style: 'margin:2px 0 0', 'aria-live': 'polite' },
      'First ' + prog[0].afqt + ' → latest ' + prog[prog.length - 1].afqt +
      '. Shaded area is the confidence band.');

    var wrap = el('div', { class: 'card' }, [
      el('strong', 'AFQT estimate over time'),
      el('div', { html: svg, style: 'margin-top:8px' }),
      caption
    ]);

    wrap.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-i]') : null;
      if (!t) return;
      var p = prog[+t.getAttribute('data-i')];
      caption.textContent = d.fmtDate(p.date) + ' · ' + p.mode + ' · estimate ' +
        p.afqt + ' ±' + p.band + ' from ' + p.items + ' questions.';
    });

    // A table view so the trend is available without reading the chart.
    var table = el('table', { class: 'data' }, [
      el('thead', null, el('tr', null, [
        el('th', 'Date'), el('th', 'Mode'), el('th', { class: 'num' }, 'Estimate')
      ])),
      el('tbody', null, prog.slice().reverse().map(function (p) {
        return el('tr', null, [
          el('td', d.fmtDate(p.date)), el('td', p.mode),
          el('td', { class: 'num' }, p.afqt + ' ±' + p.band)
        ]);
      }))
    ]);
    d.append(wrap, el('details', { class: 'foldout', style: 'margin-top:10px' }, [
      el('summary', 'Show as a table'), el('div', null, table)
    ]));
    return wrap;
  }

  // ---------------- per-question review ----------------

  function reviewView(attemptId, opts) {
    opts = opts || {};
    var att = A.state.attempt(attemptId);
    if (!att) return el('p', { class: 'muted' }, 'That attempt could not be found.');
    var results = att.per_item_results || [];
    var missed = results.filter(function (r) { return !r.correct; });
    var box = el('div');

    if (!opts.print) {
      d.append(box, el('div', { class: 'card tight row between' }, [
        el('span', [el('strong', missed.length + ' missed'), el('span', { class: 'muted' }, ' of ' + results.length)]),
        el('a', { class: 'btn ghost small', href: '#/misssheet/' + attemptId }, 'Print')
      ]));
    }
    if (!missed.length) {
      d.append(box, el('p', { class: 'banner good' }, 'Nothing missed in this attempt.'));
      return box;
    }

    // An attempt taken before the bank replaced the generated content names
    // items that no longer exist. Its scores are still real and still shown --
    // only the question text is gone, and saying so beats an empty page.
    if (att.contentGeneration === 1) {
      d.append(box, el('p', { class: 'banner info' },
        'This attempt was taken with the previous question set. Your score and ' +
        'topic breakdown are kept, but the questions themselves are no longer ' +
        'available to review.'));
      d.append(box, el('div', { class: 'card tight' }, [
        el('strong', 'Topics missed'),
        el('div', { class: 'row', style: 'margin-top:6px' },
          missed.map(function (r) {
            return el('span', { class: 'chip', text: A.analytics.topicLabel(r.topic || '?') });
          }))
      ]));
      return box;
    }

    var shown = 0;
    missed.forEach(function (r, n) {
      var item = A.exam.rehydrate(r);
      if (!item) return;
      shown++;
      d.append(box, missedItem(item, r, n + 1, opts));
    });
    if (!shown) {
      d.append(box, el('p', { class: 'banner info' },
        'These questions could not be loaded. If you are offline, the subtest ' +
        'they belong to may not be cached on this device yet.'));
    }
    return box;
  }

  function missedItem(item, r, n, opts) {
    var chosen = (r.optIndex !== null && r.optIndex !== undefined) ? item.options[r.optIndex] : null;
    var correct = item.options.filter(function (o) { return o.isCorrect; })[0];

    var node = el('div', { class: 'card review-item' }, [
      el('div', { class: 'qmeta' }, [
        el('span', { class: 'chip', text: '#' + n }),
        el('span', { class: 'chip', text: item.subtest }),
        el('span', { class: 'chip', text: A.analytics.topicLabel(item.topic) }),
        r.confidence === 'sure' ? el('span', { class: 'chip flagged', text: 'you were sure' }) : null,
        !r.answered ? el('span', { class: 'chip flagged', text: 'not answered' }) : null,
        r.seconds && r.seconds <= A.analytics.GUESS_SECONDS ? el('span', { class: 'chip flagged', text: r.seconds + 's — likely a guess' }) : null
      ]),
      item.passage ? el('div', { class: 'passage' }, [
        item.passage_title ? el('h4', { text: item.passage_title }) : null, item.passage
      ]) : null,
      el('p', { class: 'stem', html: d.richText(item.stem), style: 'font-size:1rem' }),
      item.figure ? el('div', { html: item.figure }) : null,
      el('div', { class: 'answer-line' }, [
        chosen ? el('span', { class: 'tag yours' }, 'You: ' + chosen.key) : el('span', { class: 'tag yours' }, 'No answer'),
        el('span', { class: 'tag right' }, 'Correct: ' + correct.key)
      ]),
      optionsRecap(item, r)
    ]);

    if (item.solution_steps && item.solution_steps.length) {
      d.append(node, el('div', null, [
        el('h3', { style: 'margin:12px 0 4px', text: 'Worked solution' }),
        el('ol', { class: 'steps' }, item.solution_steps.map(function (s) { return el('li', { text: s }); }))
      ]));
    }
    if (item.recognition_cue) {
      d.append(node, el('div', { class: 'cue' }, [
        el('strong', 'Spotting this type next time'), item.recognition_cue
      ]));
    }
    var lesson = item.lesson && A.data.lesson(item.lesson);
    if (lesson && !opts.print) {
      d.append(node, el('a', { class: 'btn ghost small', style: 'margin-top:10px', href: '#/lesson/' + lesson.id },
        'Lesson: ' + lesson.title));
    } else if (lesson) {
      d.append(node, el('p', { class: 'tiny muted', style: 'margin-top:8px', text: 'Lesson: ' + lesson.title }));
    }
    return node;
  }

  // Every wrong option, with the error pattern the template named for it.
  function optionsRecap(item, r) {
    var list = el('div', { style: 'margin-top:6px' });
    item.options.forEach(function (o) {
      if (o.isCorrect) {
        d.append(list, el('p', { class: 'why', html: '<b>' + o.key + ' (correct):</b> ' + (o.svg ? 'the figure shown above' : d.escapeHtml(o.text)) }));
      } else {
        var label = o.svg ? 'that figure' : '“' + o.text + '”';
        d.append(list, el('p', { class: 'why muted', html: '<b>' + o.key + ':</b> ' + d.escapeHtml(label) +
          (o.error ? ' — ' + d.escapeHtml(o.error) + '.' : '') }));
      }
    });
    return list;
  }

  // ---------------- analysis ----------------

  function analysisView(attemptId) {
    var att = A.state.attempt(attemptId);
    if (!att) return el('p', { class: 'muted' }, 'That attempt could not be found.');
    var rows = rowsFor(att);
    var rep = A.analytics.report(rows, A.state.attempts());
    var box = el('div');

    // ---- patterns ----
    var pats = rep.patterns.slice(0, 8);
    var pcard = el('div', { class: 'card' }, [el('strong', 'What the pattern says')]);
    if (!pats.length) {
      d.append(pcard, el('p', { class: 'muted small', style: 'margin-bottom:0' },
        'Not enough questions in one subtopic to call a pattern yet.'));
    } else {
      pats.forEach(function (p) {
        var tone = p.kind === 'weakness' ? 'bad' : (p.kind === 'strength' ? 'good' : 'warn');
        d.append(pcard, el('p', { class: 'banner ' + (tone === 'bad' ? 'warn' : tone === 'good' ? 'good' : 'info'), style: 'margin-bottom:8px' },
          p.text + (p.kind === 'watch' ? '' : '')));
      });
    }
    d.append(box, pcard);

    // ---- timing forensics, reported separately from knowledge ----
    var t = rep.timing;
    var tcard = el('div', { class: 'card' }, [
      el('strong', 'Pacing'),
      el('p', { class: 'muted small', style: 'margin:4px 0 10px' },
        'Pacing and knowledge are different problems. These are separated so one does not hide the other.')
    ]);
    d.append(tcard, el('table', { class: 'data' }, [
      el('tbody', null, [
        trow('Average per question', d.fmtDuration(t.avgSeconds)),
        trow('Answered under ' + A.analytics.GUESS_SECONDS + 's (not really attempted)',
             t.guesses.count + (t.guesses.accuracy !== null ? ' · ' + d.pct(t.guesses.accuracy) + ' right' : '')),
        trow('Time sinks (over ' + A.analytics.SINK_MULTIPLIER + '× target)',
             t.sinks.count + (t.sinks.count ? ' · ' + d.fmtDuration(t.sinks.seconds) + ' spent' : '')),
        trow('Accuracy on questions you actually worked',
             t.knowledgeAccuracy !== null ? d.pct(t.knowledgeAccuracy) : '—'),
        trow('Accuracy overall', t.overallAccuracy !== null ? d.pct(t.overallAccuracy) : '—')
      ])
    ]));
    if (t.guesses.count > 2 && t.knowledgeAccuracy !== null && t.overallAccuracy !== null &&
        t.knowledgeAccuracy - t.overallAccuracy > 0.06) {
      d.append(tcard, el('p', { class: 'banner warn', style: 'margin:10px 0 0' },
        'You know more than the score shows. ' + t.guesses.count + ' questions were answered in under ' +
        A.analytics.GUESS_SECONDS + ' seconds; on the ones you worked properly you were right ' +
        d.pct(t.knowledgeAccuracy) + ' of the time. That is a pacing problem, not a knowledge gap.'));
    }
    d.append(box, tcard);

    // ---- confidence ----
    var c = rep.confidence;
    var ccard = el('div', { class: 'card' }, [
      el('strong', 'Confidence check'),
      el('p', { class: 'muted small', style: 'margin:4px 0 10px' },
        'Being wrong while sure is the most useful thing on this page: it marks what you did not know you did not know.')
    ]);
    d.append(ccard, el('table', { class: 'data' }, [
      el('thead', null, el('tr', null, [el('th', ''), el('th', { class: 'num' }, 'Right'), el('th', { class: 'num' }, 'Wrong')])),
      el('tbody', null, ['sure', 'unsure', 'guessed'].map(function (k) {
        return el('tr', null, [
          el('td', k.charAt(0).toUpperCase() + k.slice(1)),
          el('td', { class: 'num' }, String(c.cells[k].right)),
          el('td', { class: 'num', style: k === 'sure' && c.cells[k].wrong ? 'color:var(--bad);font-weight:650' : '' },
            String(c.cells[k].wrong))
        ]);
      }))
    ]));
    if (c.confidentWrong) {
      d.append(ccard, el('p', { class: 'banner warn', style: 'margin:10px 0 0' },
        c.confidentWrong + ' question' + (c.confidentWrong === 1 ? '' : 's') +
        ' you marked "sure" came out wrong. Those are the ones to read first in the review.'));
    }
    d.append(box, ccard);

    // ---- heatmap ----
    d.append(box, heatmapCard(rep.heatmap));
    return box;
  }

  function trow(label, value) {
    return el('tr', null, [el('td', label), el('td', { class: 'num' }, value)]);
  }

  /* Topic heatmap. Every row carries the accuracy number and a plain-language
     sample-size label, so nothing is communicated by colour alone, and a single
     miss shows as "too few to judge" rather than as a red weakness. */
  function heatmapCard(cells) {
    var card = el('div', { class: 'card' }, [
      el('strong', 'Topic heatmap'),
      el('p', { class: 'muted small', style: 'margin:4px 0 10px' },
        'The dot shows how much the figure can be trusted. One miss is not a weakness.')
    ]);
    var bySub = {};
    cells.forEach(function (c) { (bySub[c.subtest] = bySub[c.subtest] || []).push(c); });

    Object.keys(bySub).forEach(function (code) {
      d.append(card, el('h3', { style: 'margin:14px 0 2px', text: (A.data.subtest(code) || {}).name || code }));
      var heat = el('div', { class: 'heat' });
      bySub[code].sort(function (a, b) { return a.lower - b.lower; }).forEach(function (c) {
        d.append(heat, el('div', { class: 'heat-row' }, [
          el('div', null, [
            el('div', { class: 'heat-name' }, [
              el('span', { class: 'dot ' + c.confidence.level, title: c.confidence.label }),
              c.label
            ]),
            el('div', { class: 'heat-n', text: c.correct + ' of ' + c.total + ' · ' + c.confidence.label })
          ]),
          el('div', { class: 'heat-bar' },
            el('span', { style: 'width:' + Math.round(c.accuracy * 100) + '%;background:' + d.accuracyColor(c.lower, c.confidence.level) })),
          el('div', { class: 'heat-pct', style: c.confidence.level === 'low' ? 'color:var(--ink-soft);font-weight:500' : '', text: d.pct(c.accuracy) })
        ]));
      });
      d.append(card, heat);
    });

    d.append(card, el('div', { class: 'legend' }, [
      el('span', [el('span', { class: 'dot high' }), 'solid sample (10+)']),
      el('span', [el('span', { class: 'dot medium' }), 'limited (4–9)']),
      el('span', [el('span', { class: 'dot low' }), 'too few to judge (1–3)'])
    ]));
    return card;
  }

  // ---------------- printable miss sheet ----------------

  function missSheet(attemptId) {
    var att = A.state.attempt(attemptId);
    if (!att) return el('p', { class: 'muted' }, 'That attempt could not be found.');
    var missed = (att.per_item_results || []).filter(function (r) { return !r.correct; });
    var box = el('div');

    d.append(box, el('div', { class: 'card noprint row between' }, [
      el('span', { class: 'small muted' }, missed.length + ' missed questions, with explanations.'),
      el('button', { class: 'btn small', type: 'button', onclick: function () { window.print(); } }, 'Print')
    ]));
    d.append(box, el('h2', { text: 'ASVAB practice — missed questions' }));
    d.append(box, el('p', { class: 'muted small' },
      d.fmtDate(att.date) + ' · ' + att.mode + ' · ' + missed.length + ' of ' +
      (att.per_item_results || []).length + ' missed'));
    d.append(box, reviewView(attemptId, { print: true }));
    return box;
  }

  A.report = {
    scoreReport: scoreReport, reviewView: reviewView, analysisView: analysisView,
    missSheet: missSheet, progressCard: progressCard, heatmapCard: heatmapCard
  };
})(typeof self !== 'undefined' ? self : this);
