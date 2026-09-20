/* Router and the top-level views. Hash routing, so the whole thing works from
   file:// as happily as it does from GitHub Pages. */
(function (root) {
  'use strict';
  var A = root.ASVAB;
  var d = A.dom, el = d.el, $ = d.$;

  // ---------------- router ----------------

  var routes = [
    { re: /^\/$/, view: home, title: 'ASVAB Practice', tab: '/' },
    { re: /^\/start$/, view: startMenu, title: 'Start a test', tab: '/', back: '#/' },
    { re: /^\/practice$/, view: practiceMenu, title: 'Practice a subtest', tab: '/', back: '#/start' },
    { re: /^\/exam$/, view: null, title: '', exam: 'run' },
    { re: /^\/exam-break$/, view: null, title: '', exam: 'break' },
    { re: /^\/report\/(.+)$/, view: function (id) { return A.report.scoreReport(id); }, title: 'Score report', tab: '/progress', back: '#/' },
    { re: /^\/review\/(.+)$/, view: function (id) { return A.report.reviewView(id); }, title: 'Question review', tab: '/progress', back: function (id) { return '#/report/' + id; } },
    { re: /^\/analysis\/(.+)$/, view: function (id) { return A.report.analysisView(id); }, title: 'Analysis', tab: '/progress', back: function (id) { return '#/report/' + id; } },
    { re: /^\/misssheet\/(.+)$/, view: function (id) { return A.report.missSheet(id); }, title: 'Miss sheet', tab: '/progress', back: function (id) { return '#/report/' + id; } },
    { re: /^\/lessons$/, view: function () { return A.lessons.library(''); }, title: 'Lessons', tab: '/lessons' },
    { re: /^\/lesson\/(.+)$/, view: function (id) { return A.lessons.detail(id); }, title: 'Lesson', tab: '/lessons', back: '#/lessons' },
    { re: /^\/progress$/, view: progressView, title: 'Progress', tab: '/progress' },
    { re: /^\/data$/, view: dataView, title: 'Your data', tab: '/data' },
    { re: /^\/formats$/, view: formatsView, title: 'Exam format', tab: '/', back: '#/start' },
    { re: /^\/settings$/, view: settingsView, title: 'Settings', tab: '/', back: '#/' }
  ];

  function path() {
    var h = location.hash.replace(/^#/, '');
    return h || '/';
  }

  function go(hash, replace) {
    if (replace && location.hash !== hash) history.replaceState(null, '', hash);
    else if (!replace) location.hash = hash;
    render();
  }

  function render() {
    var p = path();
    var main = $('#main');

    for (var i = 0; i < routes.length; i++) {
      var m = p.match(routes[i].re);
      if (!m) continue;
      var r = routes[i];

      if (r.exam) {
        // Resuming reads item refs that name bank chunks which may not be
        // loaded yet -- on a cold start after a refresh, none of them are.
        if (!A.runner.current()) {
          var saved = A.state.getSession();
          if (!saved || saved.done) { go('#/', true); return; }
          var need = sessionSubtests(saved);
          if (need.some(function (c) { return !A.bankdata.isLoaded(c); })) {
            d.clear(main);
            d.append(main, el('p', { class: 'muted center', style: 'padding:32px' }, 'Loading your test…'));
            A.bankdata.ensure(need, function () { render(); });
            return;
          }
          if (!A.runner.resume()) { go('#/', true); return; }
        }
        if (r.exam === 'break') A.runner.drawBreak(); else A.runner.draw();
        setTab(null);
        return;
      }

      // Report and review views rehydrate stored items, so the chunks holding
      // them have to be present before the view draws.
      if (/^\/(report|review|analysis|misssheet)\//.test(p)) {
        var att = A.state.attempt(m[1]);
        if (att) {
          var want = attemptSubtests(att);
          if (want.some(function (c) { return !A.bankdata.isLoaded(c); })) {
            A.runner.exit();
            d.clear(main);
            d.append(main, el('p', { class: 'muted center', style: 'padding:32px' }, 'Loading…'));
            A.bankdata.ensure(want, function () { render(); });
            return;
          }
        }
      }

      A.runner.exit();
      document.body.classList.remove('in-exam');
      d.clear(main);
      $('#topTitle').textContent = r.title;
      var backTo = typeof r.back === 'function' ? r.back(m[1]) : r.back;
      setBack(backTo);
      setTab(r.tab);
      try {
        d.append(main, r.view ? r.view(m[1]) : null);
      } catch (e) {
        d.append(main, el('div', { class: 'card' }, [
          el('strong', 'Something went wrong drawing this page.'),
          el('p', { class: 'small muted', text: String(e && e.message || e) }),
          el('a', { class: 'btn ghost small', href: '#/' }, 'Back to home')
        ]));
      }
      main.focus();
      window.scrollTo(0, 0);
      return;
    }
    go('#/', true);
  }

  // Which bank chunks a stored session or attempt needs before it can render.
  function sessionSubtests(sess) {
    var out = {};
    (sess.sections || []).forEach(function (sec) {
      (sec.refs || []).forEach(function (r) { if (r.subtest) out[r.subtest] = true; });
    });
    return Object.keys(out);
  }

  function attemptSubtests(att) {
    var out = {};
    (att.per_item_results || []).forEach(function (r) { if (r.subtest) out[r.subtest] = true; });
    return Object.keys(out);
  }

  function setBack(target) {
    var b = $('#backBtn');
    b.hidden = !target;
    b.onclick = target ? function () { location.hash = target; } : null;
  }

  function setTab(tab) {
    d.$$('#tabbar a').forEach(function (a) {
      if (tab && a.getAttribute('data-tab') === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  // ---------------- home ----------------

  function home() {
    var box = el('div');
    var diag = A.state.diagnostic();
    var attempts = A.state.attempts();
    var due = A.state.dueReviews();

    (A.state.notices() || []).forEach(function (n) {
      d.append(box, el('div', { class: 'card stack notice-card' }, [
        el('strong', 'Your progress was carried over'),
        el('p', { class: 'small muted', style: 'margin:0', text: n.text }),
        el('button', {
          class: 'btn ghost small', type: 'button',
          onclick: function () { A.state.dismissNotice(n.id); render(); }
        }, 'Got it')
      ]));
    });

    if (A.state.isVolatile()) {
      d.append(box, el('p', { class: 'banner warn' },
        'This browser is blocking local storage, so progress will not survive a refresh. ' +
        'Private browsing is the usual cause.'));
    }

    if (A.runner.hasSession()) {
      var s = A.state.getSession();
      d.append(box, el('div', { class: 'card stack' }, [
        el('strong', 'You have a test in progress'),
        el('p', { class: 'muted small', style: 'margin:0' },
          s.mode + ' · section ' + (s.si + 1) + ' of ' + s.sections.length + ', question ' + (s.ii + 1)),
        el('a', { class: 'btn block', href: '#/exam' }, 'Resume'),
        el('button', {
          class: 'btn ghost block', type: 'button', onclick: function () {
            if (confirm('Discard the test in progress? Answers so far will be lost.')) { A.runner.abandon(); render(); }
          }
        }, 'Discard it')
      ]));
    }

    if (!diag) {
      d.append(box, el('div', { class: 'card stack' }, [
        el('h2', { style: 'margin:0' }, 'Start with the placement test'),
        el('p', { class: 'muted small', style: 'margin:0' },
          A.data.config.diagnostic.items + ' questions across all ten subtests. It sets your starting ' +
          'difficulty and gives you a baseline to measure against.'),
        el('button', { class: 'btn block', type: 'button', onclick: startDiagnostic }, 'Take the placement test'),
        el('a', { class: 'btn ghost block', href: '#/start' }, 'Skip it, let me choose')
      ]));
    } else {
      d.append(box, el('div', { class: 'card stack' }, [
        el('a', { class: 'btn block', href: '#/start' }, 'Start a test'),
        due.length
          ? el('button', { class: 'btn ghost block', type: 'button', onclick: startReview },
              due.length + ' question' + (due.length === 1 ? '' : 's') + ' due for review')
          : el('p', { class: 'muted small center', style: 'margin:0' },
              A.state.queueSize() ? A.state.queueSize() + ' items queued, none due yet.' : 'Nothing due for review.'),
        attempts.length
          ? el('button', {
              class: 'btn ghost block', type: 'button',
              onclick: function () { startDrillFrom(attempts[attempts.length - 1].id); }
            }, 'Drill my weakest subtopics')
          : null
      ]));
    }

    // Memorisation and pool depth: with a fixed bank, recognising a question is
    // not the same as knowing the material, and the pool eventually runs thin.
    if (A.state.seenList().length > 40) {
      var ids = {};
      A.state.seenList().forEach(function (r) { if (r.template_id) ids[r.template_id] = true; });
      var memo = A.state.memorizedCount(Object.keys(ids));
      var health = [];
      A.bankdata.codes().forEach(function (c) {
        if (A.bankdata.isLoaded(c)) health.push(A.exam.poolHealth(c));
      });
      var thin = health.filter(function (h) { return h.examsLeft < 2; });
      if (memo || thin.length) {
        d.append(box, el('div', { class: 'card stack' }, [
          el('strong', 'Bank health'),
          memo ? el('p', { class: 'small', style: 'margin:0' },
            memo + ' item' + (memo === 1 ? '' : 's') + ' you may be recognising rather than ' +
            'solving. They are pushed down the draw order, not removed.') : null,
          thin.length ? el('p', { class: 'small', style: 'margin:0' },
            'Running low on unseen questions in ' +
            thin.map(function (h) { return h.code + ' (' + h.unseen + ')'; }).join(', ') +
            '. Repeats become unavoidable there.') : null
        ]));
      }
    }

    if (attempts.length) {
      var last = attempts[attempts.length - 1];
      d.append(box, el('a', { class: 'card tight', href: '#/report/' + last.id, style: 'display:block;text-decoration:none;color:inherit' }, [
        el('div', { class: 'row between' }, [
          el('strong', 'Last attempt'),
          el('span', { class: 'muted small', text: d.fmtDate(last.date) })
        ]),
        el('div', { class: 'row', style: 'margin-top:6px' }, [
          el('span', { class: 'chip', text: last.mode }),
          last.scores && last.scores.afqt
            ? el('span', { class: 'chip', text: 'AFQT est. ' + last.scores.afqt.percentile + ' ±' + last.scores.afqt.band })
            : null,
          el('span', { class: 'chip' },
            (last.per_item_results || []).filter(function (r) { return r.correct; }).length + '/' +
            (last.per_item_results || []).length + ' correct')
        ])
      ]));
    }

    d.append(box, el('div', { class: 'card tight' }, [
      el('a', { class: 'subtest-row', href: '#/settings', style: 'border:none;padding:6px 0' }, [
        el('span', { class: 'grow' }, 'Settings'),
        el('span', { class: 'muted' }, '›')
      ])
    ]));

    d.append(box, el('p', { class: 'tiny muted center', style: 'margin-top:18px' },
      'All questions in this app are original, written to the published content outline for each ' +
      'subtest. Scores are estimates only — take real scores to a recruiter.'));
    return box;
  }

  // ---------------- start menu ----------------

  function currentProfile() {
    return A.data.profile(A.state.settings().profileId || A.data.defaultProfileId);
  }

  function startMenu() {
    var box = el('div');
    var prof = currentProfile();

    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'Full simulation'),
      el('p', { class: 'muted small', style: 'margin:0' },
        prof.total_items + ' questions, ' + prof.total_minutes + ' minutes, ' +
        prof.sections.length + ' subtests timed section by section. No feedback until the end.'),
      el('p', { class: 'tiny muted', style: 'margin:0' }, 'Format: ' + prof.name),
      el('button', { class: 'btn block', type: 'button', onclick: function () { startProfile(prof.id, 'simulation'); } },
        'Start ' + prof.short),
      el('a', { class: 'btn ghost block small', href: '#/formats' }, 'Change format')
    ]));

    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'AFQT only'),
      el('p', { class: 'muted small', style: 'margin:0' },
        'Arithmetic Reasoning, Mathematics Knowledge, Word Knowledge and Paragraph ' +
        'Comprehension at real timing. Half the sitting, and the only score that ' +
        'decides whether you can enlist.'),
      el('button', { class: 'btn block', type: 'button', onclick: function () { startProfile('afqt_only', 'simulation'); } },
        'Start AFQT-only exam')
    ]));

    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'Paper-and-pencil ASVAB'),
      el('p', { class: 'muted small', style: 'margin:0' },
        '225 questions, 149 minutes, nine subtests. You can skip, flag and return ' +
        'within a subtest until its time is called.'),
      el('button', { class: 'btn ghost block', type: 'button', onclick: function () { startProfile('pp_225', 'simulation'); } },
        'Start P&P exam')
    ]));

    if (A.state.seenList().length >= 20) {
      d.append(box, el('div', { class: 'card stack' }, [
        el('strong', 'Weak-spot exam'),
        el('p', { class: 'muted small', style: 'margin:0' },
          'A full-length sitting weighted about 60/40 toward the topics you are ' +
          'currently weakest in. Still a real exam, not a long drill.'),
        el('button', { class: 'btn ghost block', type: 'button', onclick: startWeakSpotExam },
          'Start weak-spot exam')
      ]));
    }

    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'Practice one subtest'),
      el('p', { class: 'muted small', style: 'margin:0' },
        'Untimed, with the worked answer and explanation straight after each question.'),
      el('a', { class: 'btn ghost block', href: '#/practice' }, 'Choose a subtest')
    ]));

    // The CAT-rules toggle is gone: whether answers lock is a property of the
    // format, not a preference, and a CAT you can go back in is not a CAT.
    d.append(box, el('p', { class: 'tiny muted center', style: 'margin-top:14px' },
      prof.lock_answers
        ? 'Under ' + prof.short + ', moving on from a question locks it — no going back, ' +
          'no changing an answer. That is how the real computer-adaptive test works.'
        : 'Under ' + prof.short + ' you may skip, flag and return within a subtest until ' +
          'its time is called.'));

    if (!A.state.diagnostic()) {
      d.append(box, el('button', { class: 'btn ghost block', type: 'button', onclick: startDiagnostic },
        'Take the ' + A.data.config.diagnostic.items + '-question placement test'));
    }
    return box;
  }

  /* Format picker. The published CAT numbers disagree between sources, so the
     app does not pretend one is authoritative -- each profile shows where its
     numbers come from and the result records which was used. */
  function formatsView() {
    var box = el('div');
    var chosen = A.state.settings().profileId || A.data.defaultProfileId;

    d.append(box, el('p', { class: 'banner info' },
      'Published CAT-ASVAB numbers disagree between sources. Pick the convention ' +
      'you want to practise against — every result records which one it used. ' +
      'Treat the official ASVAB program materials or a recruiter as the tiebreaker, ' +
      'not any option here.'));

    var card = el('div', { class: 'card' });
    A.data.profiles.forEach(function (p) {
      var input = el('input', {
        type: 'radio', name: 'profile', value: p.id,
        checked: p.id === chosen ? true : null,
        onchange: function () { A.state.setSetting('profileId', p.id); d.toast('Format set to ' + p.short); render(); }
      });
      d.append(card, el('label', { class: 'profile-row' }, [
        input,
        el('span', { class: 'grow' }, [
          el('div', { style: 'font-weight:600' }, p.name),
          el('div', { class: 'tiny muted' },
            p.total_items + ' questions · ' + p.total_minutes + ' minutes · ' +
            (p.adaptive ? 'adaptive, answers lock' : 'fixed, skip and return allowed')),
          el('div', { class: 'profile-src', text: p.source }),
          el('div', { class: 'profile-src', text: p.note })
        ])
      ]));
    });
    d.append(box, card);
    return box;
  }

  var practiceTimed = false;

  function practiceMenu() {
    var box = el('div');
    var prof = currentProfile();

    d.append(box, el('div', { class: 'card' }, [
      el('label', { class: 'switch' }, [
        el('input', {
          type: 'checkbox', checked: practiceTimed ? true : null,
          onchange: function (e) {
            practiceTimed = e.target.checked;
            var main = d.$('#main'); d.clear(main); d.append(main, practiceMenu());
          }
        }),
        el('span', { class: 'lbl' }, [
          el('div', { style: 'font-weight:600' }, 'Timed, at the real section length'),
          el('div', { class: 'tiny muted' },
            'Runs the subtest at its ' + prof.short + ' timing, with no feedback until the end. ' +
            'Off, it is untimed with the answer after each question.')
        ])
      ])
    ]));
    var wrap = el('div', { class: 'subtest-list' });
    A.data.subtests.forEach(function (s) {
      d.append(wrap, el('button', {
        class: 'subtest-row', type: 'button',
        onclick: function () {
          if (practiceTimed) { startSubtestSim(s.code); return; }
          A.bankdata.ensure([s.code], function () {
            A.runner.begin(A.exam.practice(s.code, s.items), {});
          });
        }
      }, [
        el('span', { class: 'code', text: s.code }),
        el('span', { class: 'grow' }, [
          el('div', { class: 'nm', text: s.name }),
          el('div', { class: 'tiny muted', text: (A.bankdata.counts()[s.code] || 0) +
            ' in the bank · ' + A.data.topicsFor(s.code).length + ' subtopics' })
        ]),
        el('span', { class: 'muted' }, '›')
      ]));
    });
    d.append(box, wrap);
    return box;
  }

  // ---------------- launchers ----------------

  function startProfile(profileId, mode) {
    var prof = A.data.profile(profileId);
    if (!prof) { d.toast('That format is not available.'); return; }
    d.toast('Building ' + prof.total_items + ' questions…');
    var need = {};
    prof.sections.forEach(function (sec) {
      A.data.poolsFor(sec).forEach(function (c) { need[c] = true; });
    });
    A.bankdata.ensure(Object.keys(need), function () {
      var ex = A.exam.buildExam(profileId, Date.now(), { mode: mode || 'simulation' });
      if (!ex) { d.toast('Could not build that exam.'); return; }
      A.runner.begin(ex, {});
    });
  }

  function weakSpots(limit) {
    var rows = A.state.seenList();
    if (rows.length < 20) return [];
    return A.workon.workOn(rows, {
      limit: limit || 6,
      profile: A.data.profile(A.state.settings().profileId || A.data.defaultProfileId)
    }).map(function (c) { return { subtest: c.subtest, topic: c.topic }; });
  }

  function startWeakSpotExam() {
    var spots = weakSpots(6);
    if (!spots.length) {
      d.toast('Answer more questions first — there are no clear weak spots yet.');
      return;
    }
    var pid = A.state.settings().profileId || A.data.defaultProfileId;
    d.toast('Building a weighted exam…');
    A.bankdata.ensure(null, function () {
      var ex = A.exam.weakSpotExam(pid, spots, Date.now());
      if (!ex || !ex.totalItems) { d.toast('Could not build that exam.'); return; }
      A.runner.begin(ex, {});
    });
  }

  function startSubtestSim(code) {
    var pid = A.state.settings().profileId || A.data.defaultProfileId;
    A.bankdata.ensure([code, 'AI', 'SI', 'AS'], function () {
      var ex = A.exam.subtestSimulation(pid, code, Date.now());
      if (!ex) { d.toast('That subtest is not in the current format.'); return; }
      A.runner.begin(ex, {});
    });
  }

  function drillTopic(subtest, topic, n) {
    A.bankdata.ensure([subtest], function () {
      var ex = A.exam.drill([{ subtest: subtest, topic: topic }], n || 10);
      if (!ex.totalItems) { d.toast('No unseen questions left for that topic.'); return; }
      A.runner.begin(ex, {});
    });
  }

  function startSimulation() {
    var n = A.data.config.subtests.reduce(function (a, s) { return a + s.items; }, 0);
    d.toast('Building ' + n + ' questions…');
    A.bankdata.ensure(null, function () {
      A.runner.begin(A.exam.fullSimulation(), {});
    });
  }
  function startDiagnostic() {
    d.toast('Building your placement test…');
    A.bankdata.ensure(null, function () {
      A.runner.begin(A.exam.diagnostic(), { catRules: false });
    });
  }
  function startReview() {
    var due = A.state.dueReviews();
    var need = {};
    due.forEach(function (q) { if (q.subtest) need[q.subtest] = true; });
    A.bankdata.ensure(Object.keys(need), function () {
      var ex = A.exam.review();
      if (!ex.totalItems) { d.toast('Nothing is due for review yet.'); return; }
      A.runner.begin(ex, { catRules: false });
    });
  }
  function startDrillFrom(attemptId) {
    var att = A.state.attempt(attemptId);
    // Weak spots come from the whole history, not just this attempt, so the
    // drill reflects a real pattern rather than one bad section.
    var rows = A.state.seenList().map(function (r) {
      return { subtest: r.subtest, topic: r.topic, correct: r.correct, confidence: r.confidence, seconds: r.seconds };
    });
    if (att) {
      rows = rows.concat((att.per_item_results || []).map(function (r) {
        return { subtest: r.subtest, topic: r.topic, correct: r.correct, confidence: r.confidence, seconds: r.seconds };
      }));
    }
    var weak = A.analytics.weakSpots(rows, { limit: 5 });
    if (!weak.length) { d.toast('No clear weak spots yet — take a longer test first.'); return; }
    var spots = weak.map(function (w) { return { subtest: w.subtest, topic: w.topic }; });
    A.bankdata.ensure(spots.map(function (w) { return w.subtest; }), function () {
      A.runner.begin(A.exam.drill(spots), { catRules: false });
    });
  }

  // ---------------- progress ----------------

  function progressView() {
    var box = el('div');
    var attempts = A.state.attempts();
    if (!attempts.length) {
      d.append(box, el('p', { class: 'banner info' }, 'No attempts yet. Take a test and your history will build here.'));
      return box;
    }

    d.append(box, A.report.progressCard());

    var rows = A.state.seenList().map(function (r) {
      return { subtest: r.subtest, topic: r.topic, correct: r.correct, confidence: r.confidence, seconds: r.seconds };
    });
    if (rows.length) {
      d.append(box, el('div', { class: 'card tight' }, [
        el('div', { class: 'row between' }, [
          el('strong', 'All-time'),
          el('span', { class: 'muted small' }, rows.length + ' questions answered')
        ])
      ]));
      d.append(box, A.report.heatmapCard(A.analytics.heatmap(rows)));
    }

    d.append(box, el('h2', 'Attempts'));
    attempts.slice().reverse().forEach(function (a) {
      var n = (a.per_item_results || []).length;
      var c = (a.per_item_results || []).filter(function (r) { return r.correct; }).length;
      d.append(box, el('a', { class: 'subtest-row', href: '#/report/' + a.id, style: 'margin-bottom:8px;text-decoration:none' }, [
        el('span', { class: 'code', text: a.mode.slice(0, 4).toUpperCase() }),
        el('span', { class: 'grow' }, [
          el('div', { class: 'nm' }, d.fmtDate(a.date) + (a.subtest ? ' · ' + a.subtest : '')),
          el('div', { class: 'tiny muted' },
            c + '/' + n + ' correct' +
            (a.scores && a.scores.afqt ? ' · AFQT est. ' + a.scores.afqt.percentile : ''))
        ]),
        el('span', { class: 'muted' }, '›')
      ]));
    });
    return box;
  }

  // ---------------- data portability ----------------

  function dataView() {
    var box = el('div');
    var s = A.state.load();

    d.append(box, el('p', { class: 'banner warn' },
      'Your progress lives only in this browser, on this device. Clearing site data or switching ' +
      'browsers loses it. Export a backup now and again.'));

    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'What is stored'),
      el('div', { class: 'row' }, [
        el('span', { class: 'chip', text: s.seen.length + ' questions answered' }),
        el('span', { class: 'chip', text: s.attempts.length + ' attempts' }),
        el('span', { class: 'chip', text: s.queue.length + ' in the review queue' })
      ])
    ]));

    // --- export ---
    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'Export a backup'),
      el('p', { class: 'muted small', style: 'margin:0' }, 'Downloads a JSON file holding your full history.'),
      el('button', {
        class: 'btn block', type: 'button', onclick: function () {
          var blob = new Blob([A.state.exportJSON()], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'asvab-progress-' + new Date().toISOString().slice(0, 10) + '.json';
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
          d.toast('Backup downloaded');
        }
      }, 'Download backup file')
    ]));

    // --- sync string ---
    var syncBox = el('textarea', { class: 'io', readonly: true, 'aria-label': 'Sync string' });
    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'Move progress to another device'),
      el('p', { class: 'muted small', style: 'margin:0' },
        'Generate a sync string here, then paste it into this app on the other device.'),
      el('button', {
        class: 'btn ghost block', type: 'button', onclick: function () {
          var str = A.state.syncString();
          syncBox.value = str;
          syncBox.hidden = false;
          syncBox.select();
          if (navigator.clipboard) {
            navigator.clipboard.writeText(str).then(
              function () { d.toast('Sync string copied'); },
              function () { d.toast('Select and copy the text below'); });
          } else d.toast('Select and copy the text below');
        }
      }, 'Generate sync string'),
      syncBox
    ]));
    syncBox.hidden = true;

    // --- import ---
    var importArea = el('textarea', {
      class: 'io', placeholder: 'Paste a sync string or the contents of a backup file…',
      'aria-label': 'Paste backup or sync string'
    });
    var fileInput = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { importArea.value = String(fr.result); d.toast('File loaded — now tap Import'); };
      fr.readAsText(f);
    });

    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'Import'),
      el('p', { class: 'muted small', style: 'margin:0' },
        'Merges with what is already here. Importing the same backup twice changes nothing.'),
      el('button', { class: 'btn ghost block', type: 'button', onclick: function () { fileInput.click(); } }, 'Choose a backup file'),
      fileInput,
      importArea,
      el('button', {
        class: 'btn block', type: 'button', onclick: function () {
          var text = importArea.value.trim();
          if (!text) { d.toast('Nothing to import'); return; }
          try {
            var res = text.indexOf('ASVAB1:') === 0 ? A.state.importSyncString(text) : A.state.importJSON(text, 'merge');
            d.toast('Imported ' + res.addedAttempts + ' attempts, ' + res.addedSeen + ' questions');
            render();
          } catch (e) {
            d.toast('Could not import: ' + (e.message || e), 4200);
          }
        }
      }, 'Import')
    ]));

    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'Start over'),
      el('p', { class: 'muted small', style: 'margin:0' }, 'Deletes every attempt and all history on this device.'),
      el('button', {
        class: 'btn danger block', type: 'button', onclick: function () {
          if (!confirm('Delete all progress on this device? This cannot be undone.')) return;
          if (!confirm('Really delete everything? Export a backup first if you might want it.')) return;
          A.state.reset(); d.toast('All progress cleared'); render();
        }
      }, 'Delete all progress')
    ]));
    return box;
  }

  // ---------------- settings ----------------

  function settingsView() {
    var box = el('div');
    var st = A.state.settings();
    var prof = currentProfile();

    d.append(box, el('a', { class: 'card tight', href: '#/formats',
                            style: 'display:block;text-decoration:none;color:inherit' }, [
      el('div', { class: 'row between' }, [
        el('strong', 'Exam format'),
        el('span', { class: 'muted', text: '›' })
      ]),
      el('div', { class: 'tiny muted', style: 'margin-top:4px' },
        prof.name + ' — ' + prof.total_items + ' questions, ' + prof.total_minutes + ' minutes')
    ]));

    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'Your target'),
      el('p', { class: 'small muted', style: 'margin:0' },
        'The AFQT score you are aiming for. Results are shown against it.'),
      el('div', { class: 'row' }, [
        el('input', {
          type: 'number', min: '1', max: '99', value: st.targetAfqt || '',
          placeholder: 'e.g. 50', 'aria-label': 'Target AFQT',
          style: 'width:120px;min-height:44px;padding:8px 10px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit',
          onchange: function (e) {
            var v = parseInt(e.target.value, 10);
            A.state.setSetting('targetAfqt', (v >= 1 && v <= 99) ? v : null);
            d.toast(v ? 'Target set to ' + v : 'Target cleared');
          }
        })
      ]),
      el('p', { class: 'small muted', style: 'margin:8px 0 0' }, 'Your education credential:'),
      el('div', { class: 'row' }, [['diploma', 'High-school diploma'], ['ged', 'GED']].map(function (pair) {
        return el('button', {
          class: 'btn small' + ((st.credential || 'diploma') === pair[0] ? '' : ' ghost'),
          type: 'button',
          onclick: function () { A.state.setSetting('credential', pair[0]); render(); }
        }, pair[1]);
      })),
      el('p', { class: 'tiny muted', style: 'margin:0' },
        'This changes which minimum each branch is shown against. The GED minimums ' +
        'are much higher — the Air Force asks 65 rather than 36 — so the distinction ' +
        'is not cosmetic.')
    ]));

    d.append(box, el('div', { class: 'card' }, [
      el('label', { class: 'switch' }, [
        el('input', {
          type: 'checkbox', checked: st.drillVariants ? true : null,
          onchange: function (e) { A.state.setSetting('drillVariants', e.target.checked); }
        }),
        el('span', { class: 'lbl' }, [
          el('div', { style: 'font-weight:600' }, 'Number-swapped variants in drills'),
          el('div', { class: 'tiny muted' },
            'When you drill a maths question you have already missed, show it with ' +
            'different numbers so you have to redo the method instead of recalling ' +
            'the answer. Drills only — exams are always 100% real questions. ' +
            'Only applies where the numbers can be swapped with certainty.')
        ])
      ])
    ]));

    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'Keyboard'),
      el('p', { class: 'small muted', style: 'margin:0' },
        '1–4 or A–D picks an answer, Enter moves on, F flags a question where the ' +
        'format allows it. There is no calculator anywhere in this app, because there ' +
        'is none on the real test — use the scratch pad instead.')
    ]));
    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'About the scores'),
      el('p', { class: 'small muted', style: 'margin:0' },
        'The official raw-to-standard-score tables are not published, so this app approximates them: ' +
        'percent correct is mapped onto the 20–80 standard-score band, VE is derived from Word Knowledge ' +
        'and Paragraph Comprehension together, and AFQT = 2VE + AR + MK is placed on a normal curve. ' +
        'Treat every number here as a practice estimate.'),
      el('p', { class: 'small muted', style: 'margin:0' },
        'Job cut scores are deliberately absent: they change and vary by contract. Take your real scores to a recruiter.')
    ]));
    var counts = A.bankdata.counts();
    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'Content'),
      el('p', { class: 'small muted', style: 'margin:0' },
        A.bankdata.total() + ' questions across ' + Object.keys(counts).length +
        ' subtests, and ' + A.data.lessons.length + ' lessons. Questions load a ' +
        'subtest at a time, so the first test you take downloads only what it needs.'),
      el('p', { class: 'small muted', style: 'margin:0' },
        'Questions come from a published ASVAB practice question set, not from ' +
        'the real exam — actual test items are protected and are not available ' +
        'anywhere. Some carry no explanation, and a few have known defects in ' +
        'the source; those are excluded.')
    ]));

    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'Pool health'),
      el('p', { class: 'small muted', style: 'margin:0' },
        'How many questions you have not yet seen in each subtest.'),
      el('div', { class: 'row' }, Object.keys(counts).sort().map(function (code) {
        if (!A.bankdata.isLoaded(code)) return null;
        var h = A.exam.poolHealth(code);
        return el('span', { class: 'chip', text: code + ' ' + h.unseen + '/' + h.total });
      }))
    ]));
    return box;
  }

  // ---------------- scratch pad ----------------

  function initScratch() {
    var panel = $('#scratchPanel'), text = $('#scratchText');
    try { text.value = sessionStorage.getItem('asvab.scratch') || ''; } catch (e) { }
    function persist() { try { sessionStorage.setItem('asvab.scratch', text.value); } catch (e) { } }
    text.addEventListener('input', persist);
    $('#scratchBtn').addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) text.focus();
    });
    $('#scratchClose').addEventListener('click', function () { panel.hidden = true; });
    $('#scratchClear').addEventListener('click', function () { text.value = ''; persist(); text.focus(); });
  }

  // ---------------- boot ----------------

  function boot() {
    initScratch();
    window.addEventListener('hashchange', render);
    // Persist the live session if the tab is backgrounded or closed.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && A.runner.current()) A.state.saveSession(A.runner.current());
    });
    window.addEventListener('pagehide', function () {
      if (A.runner.current()) A.state.saveSession(A.runner.current());
    });
    render();

    // Service worker: only meaningful over http(s). From file:// it is simply
    // skipped, and the app still works because everything is already local.
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is a bonus, not a requirement */ });
      });
    }
  }

  A.router = { go: go, render: render, path: path };
  A.app = {
    startDrillFrom: startDrillFrom, startReview: startReview,
    startSimulation: startSimulation, startProfile: startProfile,
    drillTopic: drillTopic, startWeakSpotExam: startWeakSpotExam,
    startSubtestSim: startSubtestSim
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof self !== 'undefined' ? self : this);
