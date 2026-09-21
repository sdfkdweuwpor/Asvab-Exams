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

  /* The headline: where you are, against where you want to be and where you
     were last time. Everything is labelled an estimate, because the official
     conversion tables are not published and pretending otherwise would be the
     most damaging thing this app could do. */
  function afqtHeadline(att) {
    var sc = att.scores || {};
    var box = el('div', { class: 'card stack' });
    if (!sc.afqt) {
      d.append(box, el('p', { class: 'muted' },
        'Not enough of the AFQT subtests were answered to estimate a score.'));
      return box;
    }
    var st = A.state.settings();
    var target = st.targetAfqt || null;
    var credential = st.credential || 'diploma';

    var prev = null;
    var hist = A.state.attempts().filter(function (a) {
      return a.scores && a.scores.afqt && a.id !== att.id &&
             new Date(a.date) < new Date(att.date);
    });
    if (hist.length) prev = hist[hist.length - 1].scores.afqt.percentile;

    var pct = sc.afqt.percentile;
    var delta = prev === null ? null : pct - prev;

    d.append(box, el('div', { class: 'row between' }, [
      el('span', [
        el('div', { class: 'afqt-num', text: String(pct) }),
        el('div', { class: 'tiny muted', text: 'AFQT estimate \u00b1' + sc.afqt.band })
      ]),
      el('span', { style: 'text-align:right' }, [
        sc.afqt.category ? el('div', { style: 'font-weight:600', text: sc.afqt.category.label }) : null,
        delta === null
          ? el('div', { class: 'tiny muted', text: 'first scored attempt' })
          : el('div', { class: 'tiny', style: 'color:' + (delta >= 0 ? 'var(--good)' : 'var(--bad)') },
              (delta >= 0 ? '+' : '') + delta + ' vs last attempt'),
        target ? el('div', { class: 'tiny muted', text: 'target ' + target }) : null
      ])
    ]));

    if (target) {
      var gap = target - pct;
      d.append(box, el('p', { class: 'small', style: 'margin:0' },
        gap <= 0
          ? 'You are at or above your target of ' + target + '.'
          : 'You are ' + gap + ' point' + (gap === 1 ? '' : 's') + ' below your target of ' + target + '.'));
    }

    if (sc.eligibility) {
      var wrap = el('div', { class: 'row', style: 'margin-top:4px' });
      sc.eligibility.forEach(function (b) {
        d.append(wrap, el('span', {
          class: 'chip' + (b.meets ? ' good' : ''),
          title: b.name + ': ' + b.diploma + ' with a diploma, ' + b.ged + ' with a GED'
        }, b.name + ' ' + b.need + (b.meets ? ' \u2713' : ' \u2212' + b.gap)));
      });
      d.append(box, wrap);
      d.append(box, el('p', { class: 'tiny muted', style: 'margin:0' },
        'Minimums shown for ' + (credential === 'ged' ? 'a GED' : 'a high-school diploma') +
        '. GED minimums are much higher — Air Force is 65 rather than 36. ' +
        'Change this in Settings.'));
    }

    d.append(box, el('p', { class: 'tiny muted', style: 'margin:0' },
      'An estimate, not a prediction. ' + sc.afqt.basis));
    return box;
  }

  /* One Work On card: what the topic is, how sure we are, what fixing it is
     worth, one plain sentence about what is actually wrong, and three ways to
     act on it. */
  function workOnCard(c) {
    var card = el('div', { class: 'card stack workon' });
    d.append(card, el('div', { class: 'row between' }, [
      el('strong', c.label),
      c.leverage >= 1
        ? el('span', { class: 'chip lev', text: '+' + Math.round(c.leverage) + ' est. AFQT pts' })
        : (c.paceProblem ? el('span', { class: 'chip', text: 'pace' }) : null)
    ]));
    d.append(card, el('div', { class: 'tiny muted' },
      c.subtestName + ' \u00b7 ' + c.correct + '/' + c.total + ' over ' +
      c.sessions + ' session' + (c.sessions === 1 ? '' : 's')));

    var pct = Math.round(c.mastery * 100);
    var bar = el('div', { class: 'mbar' });
    d.append(bar, el('div', { class: 'mbar-fill', style: 'width:' + pct + '%' }));
    d.append(bar, el('div', {
      class: 'mbar-band',
      style: 'left:' + Math.round(c.lo * 100) + '%;width:' + Math.round((c.hi - c.lo) * 100) + '%'
    }));
    d.append(card, bar);
    d.append(card, el('div', { class: 'tiny muted', text: pct + '% mastery \u00b1' + c.band + ' points' }));
    d.append(card, el('p', { class: 'small', style: 'margin:6px 0 0', text: c.diagnosis }));

    var actions = el('div', { class: 'row', style: 'margin-top:8px' });
    d.append(actions, el('button', {
      class: 'btn small', type: 'button',
      onclick: function () { A.app.drillTopic(c.subtest, c.topic, 10); }
    }, 'Drill 10'));
    if (c.lesson && A.data.lesson(c.lesson)) {
      d.append(actions, el('a', { class: 'btn ghost small', href: '#/lesson/' + c.lesson }, 'Open lesson'));
    }
    d.append(actions, el('a', {
      class: 'btn ghost small',
      href: '#/review/' + (A.state.attempts().length ? A.state.attempts()[A.state.attempts().length - 1].id : '') +
            '?topic=' + c.topic
    }, 'Review missed'));
    d.append(card, actions);
    return card;
  }

  function workOnList(limit) {
    var rows = A.state.seenList();
    if (rows.length < 10) return null;
    var list = A.workon.workOn(rows, {
      limit: limit || 5,
      profile: A.data.profile(A.state.settings().profileId || A.data.defaultProfileId)
    });
    if (!list.length) return null;
    var box = el('div');
    d.append(box, el('div', { class: 'row between', style: 'margin:18px 0 8px' }, [
      el('h2', { style: 'margin:0' }, 'Work on'),
      el('span', { class: 'tiny muted' }, 'ranked by estimated score gain')
    ]));
    list.forEach(function (c) { d.append(box, workOnCard(c)); });
    return box;
  }

  function scoreReport(attemptId) {
    var att = A.state.attempt(attemptId);
    if (!att) return el('p', { class: 'muted' }, 'That attempt could not be found.');
    var sc = att.scores || {};
    var box = el('div');

    var correct = (att.per_item_results || []).filter(function (r) { return r.correct; }).length;
    var total = (att.per_item_results || []).length;

    /* Order matters here: the headline score against the target and the last
       attempt, then how each subtest went, then what to do about it, and only
       then the question-by-question review. A results page that opens with 145
       rows of questions buries the one number the student came for. */
    if (sc.afqt) {
      d.append(box, afqtHeadline(att));
    } else {
      d.append(box, el('div', { class: 'card score-hero' }, [
        el('div', { class: 'big', text: correct + '/' + total }),
        el('div', { class: 'band', text: d.pct(total ? correct / total : 0) + ' correct' }),
        el('p', { class: 'muted small', style: 'margin-bottom:0' },
          'An AFQT estimate needs Word Knowledge, Paragraph Comprehension, Arithmetic ' +
          'Reasoning and Mathematics Knowledge. Take a full simulation or the AFQT-only ' +
          'exam to get one.')
      ]));
    }

    d.append(box, el('div', { class: 'card' }, [
      el('div', { class: 'row between' }, [
        el('strong', 'This attempt'),
        el('span', { class: 'muted small', text: d.fmtDate(att.date) })
      ]),
      el('div', { class: 'row', style: 'margin-top:8px' }, [
        el('span', { class: 'chip', text: att.mode }),
        att.profileName ? el('span', { class: 'chip', text: att.profileName }) : null,
        el('span', { class: 'chip', text: correct + '/' + total + ' correct' }),
        el('span', { class: 'chip', text: d.fmtDuration(att.durationSec || 0) }),
        att.catRules ? el('span', { class: 'chip', text: 'answers locked' }) : null
      ]),
      att.profileName ? el('p', { class: 'tiny muted', style: 'margin:6px 0 0' },
        'Scored against the ' + att.profileName + ' format. Published CAT numbers differ ' +
        'between sources — the format is recorded so results stay comparable.') : null
    ]));

    d.append(box, subtestBars(att));

    var wo = workOnList(5);
    if (wo) d.append(box, wo);

    if (sc.composites) d.append(box, compositesCard(sc));
    d.append(box, progressCard());

    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'Everything else'),
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

  /* How each subtest went, as a bar per subtest. Unreached questions are drawn
     separately from wrong ones: running out of time and not knowing the answer
     are different problems. */
  function subtestBars(att) {
    var rows = att.per_item_results || [];
    var by = {};
    rows.forEach(function (r) {
      if (!r.subtest) return;
      var c = by[r.subtest] = by[r.subtest] || { total: 0, correct: 0, unreached: 0 };
      c.total++;
      if (r.correct) c.correct++;
      if (r.notReached) c.unreached++;
    });
    var card = el('div', { class: 'card' });
    d.append(card, el('strong', 'By subtest'));
    Object.keys(by).sort().forEach(function (code) {
      var c = by[code];
      var pct = c.total ? Math.round(100 * c.correct / c.total) : 0;
      var un = c.total ? Math.round(100 * c.unreached / c.total) : 0;
      d.append(card, el('div', { class: 'sbar-row' }, [
        el('span', { class: 'sbar-code', text: code }),
        el('span', { class: 'sbar' }, [
          el('span', { class: 'sbar-fill', style: 'width:' + pct + '%' }),
          un ? el('span', { class: 'sbar-unreached', style: 'width:' + un + '%' }) : null
        ]),
        el('span', { class: 'sbar-num', text: c.correct + '/' + c.total })
      ]));
    });
    if (Object.keys(by).some(function (k) { return by[k].unreached; })) {
      d.append(card, el('p', { class: 'tiny muted', style: 'margin:6px 0 0' },
        'The paler part of a bar is questions you never reached before time was called.'));
    }
    return card;
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

  var reviewFilter = 'wrong';

  function reviewView(attemptId, opts) {
    opts = opts || {};
    var att = A.state.attempt(attemptId);
    if (!att) return el('p', { class: 'muted' }, 'That attempt could not be found.');
    var results = att.per_item_results || [];
    var box = el('div');

    // A question never reached has nothing to review, so it is counted and
    // then kept out of the list rather than shown as a blank card.
    var reachable = results.filter(function (r) { return !r.notReached && r.template_id; });
    var slowCut = medianSeconds(reachable) * 1.5;

    var FILTERS = [
      ['wrong', 'Wrong', function (r) { return !r.correct; }],
      ['flagged', 'Flagged', function (r) { return r.flagged; }],
      ['slow', 'Slow', function (r) { return r.seconds && r.seconds >= slowCut; }],
      ['all', 'All', function () { return true; }]
    ];
    if (opts.print) reviewFilter = 'wrong';
    var active = FILTERS.filter(function (f) { return f[0] === reviewFilter; })[0] || FILTERS[0];
    var missed = reachable.filter(active[2]);

    if (!opts.print) {
      var bar = el('div', { class: 'card tight' });
      d.append(bar, el('div', { class: 'row between' }, [
        el('span', [el('strong', missed.length + ' shown'), el('span', { class: 'muted' }, ' of ' + reachable.length)]),
        el('a', { class: 'btn ghost small', href: '#/misssheet/' + attemptId }, 'Print')
      ]));
      var tabs = el('div', { class: 'row', style: 'margin-top:8px' });
      FILTERS.forEach(function (f) {
        var n = reachable.filter(f[2]).length;
        d.append(tabs, el('button', {
          class: 'btn small' + (f[0] === reviewFilter ? '' : ' ghost'),
          type: 'button',
          onclick: function () {
            reviewFilter = f[0];
            var main = d.$('#main');
            d.clear(main);
            d.append(main, reviewView(attemptId, opts));
          }
        }, f[1] + ' ' + n));
      });
      d.append(bar, tabs);
      d.append(box, bar);

      var unreached = results.filter(function (r) { return r.notReached; }).length;
      if (unreached) {
        d.append(box, el('p', { class: 'banner warn' },
          unreached + ' question' + (unreached === 1 ? ' was' : 's were') + ' never reached before ' +
          'time was called. They counted as wrong, but there is nothing to review.'));
      }
    }
    if (!missed.length) {
      d.append(box, el('p', { class: 'banner good' },
        reviewFilter === 'wrong' ? 'Nothing missed in this attempt.' : 'Nothing matches that filter.'));
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

  function medianSeconds(rows) {
    var a = rows.map(function (r) { return r.seconds || 0; })
      .filter(function (x) { return x > 0; })
      .sort(function (x, y) { return x - y; });
    return a.length ? a[Math.floor(a.length / 2)] : 45;
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
    workOnList: workOnList, subtestBars: subtestBars,
    scoreReport: scoreReport, reviewView: reviewView, analysisView: analysisView,
    missSheet: missSheet, progressCard: progressCard, heatmapCard: heatmapCard
  };
})(typeof self !== 'undefined' ? self : this);
