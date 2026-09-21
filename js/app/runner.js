/* The exam runner: one question at a time, a visible timer, and an autosave
   after every answer so a refresh or a phone call never costs a session.

   Two behaviours differ by format profile and they are the point of the whole
   thing:

   CAT  -- advancing locks the question you just left, permanently. No back
           button, no changing an answer. This is the real computer-adaptive
           test's defining constraint and the thing most practice apps get
           wrong. The next question is also drawn only once the previous one is
           answered, because which question comes next depends on how you did.

   P&P  -- skip, flag and return freely within a subtest until its time is
           called, with a navigator grid showing what is answered, unanswered
           and flagged.

   Time is held as a wall-clock deadline rather than a ticking counter, so a
   reload resumes with the remaining time still correct to the second. */
(function (root) {
  'use strict';
  var A = root.ASVAB;
  var d = A.dom, el = d.el, $ = d.$;

  var S = null;          // live session
  var items = [];        // rehydrated items for the CURRENT section
  var itemStart = 0;     // when the current question first appeared
  var ticker = null;
  var feedback = null;   // practice mode: the result being shown
  var navOpen = false;

  function key(si, ii) { return si + ':' + ii; }
  function section() { return S.sections[S.si]; }
  function answerFor(ii) { return S.answers[key(S.si, ii === undefined ? S.ii : ii)]; }
  function isLocked(ii) {
    return !!(S.lockAnswers && S.locked[key(S.si, ii === undefined ? S.ii : ii)]);
  }

  // ---------------- lifecycle ----------------

  function begin(exam, opts) {
    opts = opts || {};
    var lock = exam.lockAnswers !== undefined ? exam.lockAnswers : !!opts.catRules;
    S = {
      mode: exam.mode,
      created: exam.created,
      profileId: exam.profileId || null,
      profileName: exam.profileName || null,
      adaptive: !!exam.adaptive,
      lockAnswers: !!lock,
      allowFlag: exam.allowFlag !== undefined ? !!exam.allowFlag : !lock,
      subtest: exam.subtest || null,
      focus: exam.focus || null,
      instant: exam.mode === 'practice' || exam.mode === 'drill' || exam.mode === 'review',
      startedAt: Date.now(),
      sections: exam.sections.map(function (s) {
        return {
          code: s.code, name: s.name, seconds: s.seconds,
          n: s.n || (s.items || []).length,
          scored: s.scored === undefined ? (s.n || (s.items || []).length) : s.scored,
          adaptive: !!s.adaptive,
          poolIds: s.poolIds || [],
          administered: s.administered || [],
          refs: (s.items || []).map(A.exam.itemRef)
        };
      }),
      si: 0, ii: 0,
      deadline: null,       // epoch ms the current section ends, null = untimed
      answers: {},
      locked: {},
      elapsed: 0,
      done: false
    };
    startSection();
    A.state.saveSession(S);
    A.router.go('#/exam', true);
  }

  function resume() {
    S = A.state.getSession();
    if (!S || S.done) return false;
    S.locked = S.locked || {};
    loadSection();
    return true;
  }

  function hasSession() {
    var s = A.state.getSession();
    return !!(s && !s.done);
  }

  function abandon() {
    stopTicker();
    A.state.clearSession();
    S = null;
  }

  function startSection() {
    var sec = section();
    S.deadline = sec.seconds ? Date.now() + sec.seconds * 1000 : null;
    loadSection();
  }

  function loadSection() {
    var sec = section();
    items = sec.refs.map(function (r) { return A.exam.rehydrate(r); })
      .filter(function (x) { return !!x; });
    // An adaptive section holds no questions until they are administered, so
    // the first one is drawn here and each later one as its predecessor is left.
    if (sec.adaptive && !items.length) drawNext();
    itemStart = Date.now();
  }

  /* Draw the next adaptive item. What comes next depends on the answers so far,
     so this cannot be pre-computed at the start of the section. */
  function drawNext() {
    var sec = section();
    if (!sec.adaptive || sec.refs.length >= sec.n) return false;
    var results = [];
    for (var i = 0; i < sec.refs.length; i++) {
      var a = S.answers[key(S.si, i)];
      results.push({ correct: !!(a && a.correct) });
    }
    var used = {};
    S.sections.forEach(function (s) {
      (s.administered || []).forEach(function (id) { used[id] = true; });
    });
    var plan = { code: sec.code, n: sec.n, poolIds: sec.poolIds, administered: sec.administered };
    var it = A.exam.drawAdaptive(plan, results, used, A.rng.make('draw:' + S.startedAt + ':' + S.si + ':' + sec.refs.length));
    if (!it) return false;
    sec.administered = plan.administered;
    sec.refs.push(A.exam.itemRef(it));
    items.push(it);
    return true;
  }

  // ---------------- timer ----------------

  function remaining() {
    if (S.deadline === null || S.deadline === undefined) return null;
    return Math.max(0, Math.round((S.deadline - Date.now()) / 1000));
  }

  function startTicker() {
    stopTicker();
    ticker = setInterval(function () {
      S.elapsed = (S.elapsed || 0) + 1;
      paintTimer();
      var left = remaining();
      if (left !== null && left <= 0) { timeUp(); return; }
      if (S.elapsed % 5 === 0) A.state.saveSession(S);
    }, 1000);
  }
  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

  function paintTimer() {
    var t = $('#timer'), w = $('#timerWrap'), c = $('#progressCount');
    if (!S) { w.hidden = true; return; }
    w.hidden = false;
    var left = remaining();
    if (left === null) {
      t.textContent = d.fmtClock(S.elapsed || 0);
      t.className = '';
    } else {
      t.textContent = d.fmtClock(left);
      t.className = left <= 30 ? 'critical' : (left <= 120 ? 'warning' : '');
    }
    var total = section().adaptive ? section().n : items.length;
    c.textContent = 'Q' + (S.ii + 1) + ' of ' + total +
      (S.sections.length > 1 ? '  ·  ' + section().code : '');
  }

  /* Time called. Every unanswered question in the section is scored incorrect,
     exactly as the real test does -- they are recorded as unanswered so the
     review can tell a wrong answer from one never reached. */
  function sealSection() {
    var sec = section();
    var total = sec.adaptive ? sec.refs.length : items.length;
    for (var i = 0; i < total; i++) {
      var k = key(S.si, i);
      if (!S.answers[k] || S.answers[k].optIndex === null || S.answers[k].optIndex === undefined) {
        S.answers[k] = {
          optIndex: null, optKey: null, correct: false, seconds: 0,
          confidence: 'guessed', flagged: false, expired: true
        };
      }
      S.locked[k] = true;
    }
    /* An adaptive section only ever holds the questions it actually
       administered. The ones it never reached are still part of the subtest,
       so they are counted as unreached and scored wrong -- otherwise answering
       2 of 15 and stopping would score as 2 out of 2. They are deliberately
       NOT written to the seen table: the student never saw them. */
    sec.unreached = Math.max(0, sec.n - total);
    A.state.saveSession(S);
  }

  function timeUp() {
    stopTicker();
    var sec = section();
    sealSection();
    d.toast('Time is up for ' + sec.name);
    nextSection();
  }

  // ---------------- answering ----------------

  function choose(optIndex) {
    if (isLocked()) { d.toast('That question is locked — the real CAT does not let you go back.'); return; }
    var it = items[S.ii];
    if (!it) return;
    var k = key(S.si, S.ii);
    var prev = S.answers[k];
    var secs = prev && prev.seconds ? prev.seconds : Math.round((Date.now() - itemStart) / 1000);
    var picked = it.options[optIndex];
    if (!picked) return;

    S.answers[k] = {
      optIndex: optIndex,
      optKey: picked.key,
      correct: !!picked.isCorrect,
      seconds: secs,
      // Guessing is inferred from how long the answer took, not self-reported:
      // a sub-8-second answer is a guess whatever the student would have said.
      confidence: secs <= 8 ? 'guessed' : 'worked',
      flagged: !!(prev && prev.flagged)
    };
    A.state.saveSession(S);

    if (S.instant) {
      feedback = { index: optIndex, correct: !!picked.isCorrect };
      stopTicker();
    }
    draw();
  }

  function toggleFlag() {
    if (!S.allowFlag) return;
    var k = key(S.si, S.ii);
    var a = S.answers[k] || (S.answers[k] = { optIndex: null, correct: false, seconds: 0, confidence: null });
    a.flagged = !a.flagged;
    A.state.saveSession(S);
    draw();
  }

  /* Advancing is the irreversible step under CAT rules, so the question being
     left is locked here and nowhere else. */
  function next() {
    feedback = null;
    var sec = section();
    if (S.lockAnswers) S.locked[key(S.si, S.ii)] = true;

    var lastIndex = sec.adaptive ? sec.n - 1 : items.length - 1;
    if (S.ii < lastIndex) {
      if (sec.adaptive && S.ii + 1 >= items.length && !drawNext()) {
        // pool exhausted early: end the section rather than show a blank
        nextSection();
        return;
      }
      S.ii++;
      itemStart = Date.now();
      A.state.saveSession(S);
      draw();
    } else {
      if (S.lockAnswers) sealSection();
      nextSection();
    }
  }

  function back() {
    if (S.lockAnswers || S.ii === 0) return;
    feedback = null;
    S.ii--;
    itemStart = Date.now();
    A.state.saveSession(S);
    draw();
  }

  function goTo(ii) {
    if (S.lockAnswers) return;
    feedback = null;
    S.ii = ii;
    navOpen = false;
    itemStart = Date.now();
    A.state.saveSession(S);
    draw();
  }

  /* Finishing a section early is irreversible -- the real test does not let you
     bank the time or come back -- so it is confirmed. */
  function finishSectionEarly() {
    var sec = section();
    var total = sec.adaptive ? sec.refs.length : items.length;
    var unanswered = 0;
    for (var i = 0; i < total; i++) {
      var a = S.answers[key(S.si, i)];
      if (!a || a.optIndex === null || a.optIndex === undefined) unanswered++;
    }
    var msg = 'End ' + sec.name + ' now?\n\n' +
      (unanswered ? unanswered + ' question(s) are unanswered and will be marked wrong.\n\n' : '') +
      'You cannot come back to this section, and the time left is not carried over.';
    if (!confirm(msg)) return;
    timeUpQuiet();
  }

  function timeUpQuiet() {
    stopTicker();
    sealSection();
    nextSection();
  }

  function nextSection() {
    feedback = null;
    navOpen = false;
    if (S.si + 1 < S.sections.length) {
      S.si++;
      S.ii = 0;
      startSection();
      A.state.saveSession(S);
      A.router.go('#/exam-break', true);
    } else {
      finish();
    }
  }

  // ---------------- finishing ----------------

  function finish() {
    stopTicker();
    var results = [];
    S.sections.forEach(function (sec, si) {
      sec.refs.forEach(function (ref, ii) {
        var a = S.answers[key(si, ii)];
        // A profile with tryout items administers more than it scores; the
        // surplus is timed like any question and then left out of the tally.
        var scored = ii < (sec.scored === undefined ? sec.refs.length : sec.scored);
        results.push({
          template_id: ref.template_id, seed: ref.seed, source: ref.source,
          subtest: ref.subtest, topic: ref.topic, passage_id: ref.passage_id || null,
          target_seconds: ref.target_seconds || 45,
          answered: !!(a && a.optIndex !== null && a.optIndex !== undefined),
          optIndex: a ? a.optIndex : null,
          correct: !!(a && a.correct),
          confidence: (a && a.confidence) || 'guessed',
          seconds: (a && a.seconds) || 0,
          flagged: !!(a && a.flagged),
          expired: !!(a && a.expired),
          scored: scored
        });
      });

      for (var u = 0; u < (sec.unreached || 0); u++) {
        results.push({
          template_id: null, seed: 0, source: 'unreached',
          subtest: sec.code, topic: null, passage_id: null, target_seconds: 0,
          answered: false, optIndex: null, correct: false,
          confidence: 'guessed', seconds: 0, flagged: false,
          expired: true, notReached: true, scored: true
        });
      }
    });

    var now = new Date().toISOString();
    results.forEach(function (r) {
      if (r.notReached || !r.template_id) return;
      A.state.recordSeen({
        template_id: r.template_id, seed: r.seed, date: now, correct: r.correct,
        confidence: r.confidence, seconds: r.seconds, subtest: r.subtest,
        topic: r.topic, source: r.source
      });
      if (!r.correct) A.state.scheduleReview(r, 0);
      else if (S.mode === 'review') A.state.advanceReview(r.template_id);
    });

    var forScore = results.filter(function (r) { return r.subtest && r.scored; });
    var tallies = A.scoring.tally(forScore);
    var scores = A.scoring.score(tallies, A.state.afqtSampleSize());

    var attemptId = A.state.recordAttempt({
      date: now, mode: S.mode, subtest: S.subtest || null,
      profileId: S.profileId, profileName: S.profileName,
      catRules: S.lockAnswers,
      contentGeneration: 2,
      durationSec: Math.round((Date.now() - S.startedAt) / 1000),
      scores: scores,
      per_item_results: results
    });

    if (S.mode === 'diagnostic') {
      A.state.setDiagnostic({ date: now, attemptId: attemptId, scores: scores });
    }

    S.done = true;
    A.state.clearSession();
    S = null;
    A.router.go('#/report/' + attemptId, true);
  }

  // ---------------- views ----------------

  function draw() {
    if (!S) { A.router.go('#/', true); return; }
    if (navOpen) { drawNavigator(); return; }
    var main = d.clear($('#main'));
    var it = items[S.ii];
    if (!it) { nextSection(); return; }

    document.body.classList.add('in-exam');
    $('#topTitle').textContent = section().name;
    $('#scratchBtn').hidden = false;
    $('#backBtn').hidden = true;
    paintTimer();
    if (!ticker && !feedback) startTicker();

    var a = answerFor();
    var locked = isLocked();
    d.append(main, el('div', { class: 'qmeta' }, [
      el('span', { class: 'chip', text: it.subtest }),
      el('span', { class: 'chip', text: A.analytics.topicLabel(it.topic) }),
      a && a.flagged ? el('span', { class: 'chip flagged', text: '⚑ Flagged' }) : null,
      locked ? el('span', { class: 'chip', text: '🔒 Locked' }) : null
    ]));

    if (it.passage) {
      d.append(main, el('div', { class: 'passage' }, [
        it.passage_title ? el('h4', { text: it.passage_title }) : null,
        el('div', { text: it.passage })
      ]));
    }

    d.append(main, el('p', { class: 'stem', html: d.richText(it.stem) }));
    if (it.figure) d.append(main, el('div', { html: it.figure }));

    var opts = el('ul', { class: 'opts' });
    it.options.forEach(function (o, i) {
      var cls = 'opt';
      if (feedback) {
        if (o.isCorrect) cls += ' correct';
        else if (i === feedback.index) cls += ' wrong';
      }
      var btn = el('button', {
        class: cls, type: 'button',
        'aria-pressed': a && a.optIndex === i ? 'true' : 'false',
        disabled: !!feedback || locked,
        onclick: function () { choose(i); }
      }, [
        el('span', { class: 'key', text: o.key }),
        el('span', { class: 'body', html: o.svg ? o.svg : d.richText(o.text) })
      ]);
      d.append(opts, el('li', null, btn));
    });
    d.append(main, opts);

    if (feedback) d.append(main, feedbackCard(it, feedback));

    drawFooter();
    window.scrollTo(0, 0);
  }

  /* P&P only: the whole section at a glance, so a skipped question can be
     found again before time is called. */
  function drawNavigator() {
    var main = d.clear($('#main'));
    var sec = section();
    document.body.classList.add('in-exam');
    $('#topTitle').textContent = sec.name + ' — overview';
    paintTimer();

    var grid = el('div', { class: 'navgrid' });
    var answered = 0, flagged = 0, blank = 0;
    for (var i = 0; i < items.length; i++) {
      var a = S.answers[key(S.si, i)];
      var has = a && a.optIndex !== null && a.optIndex !== undefined;
      var cls = 'navcell' + (has ? ' answered' : ' blank') + (a && a.flagged ? ' flagged' : '') +
        (i === S.ii ? ' current' : '');
      if (has) answered++; else blank++;
      if (a && a.flagged) flagged++;
      (function (idx) {
        d.append(grid, el('button', { class: cls, type: 'button', onclick: function () { goTo(idx); } },
          String(idx + 1)));
      })(i);
    }

    d.append(main, el('div', { class: 'card tight row' }, [
      el('span', { class: 'chip', text: answered + ' answered' }),
      el('span', { class: 'chip', text: blank + ' blank' }),
      el('span', { class: 'chip flagged', text: flagged + ' flagged' })
    ]));
    d.append(main, el('p', { class: 'small muted' },
      'There is no penalty for a wrong answer on the paper test, so fill in every ' +
      'question before time is called — a blank scores the same as a wrong answer.'));
    d.append(main, grid);
    d.append(main, el('button', {
      class: 'btn block', type: 'button', style: 'margin-top:16px',
      onclick: function () { navOpen = false; draw(); }
    }, 'Back to question ' + (S.ii + 1)));
    var f = $('.examfoot'); if (f) f.remove();
  }

  function feedbackCard(it, fb) {
    var wrongOpt = it.options[fb.index];
    return el('div', { class: 'card', style: 'margin-top:16px' }, [
      el('p', { class: 'row', style: 'margin-top:0' }, [
        el('strong', { text: fb.correct ? 'Correct' : 'Not quite',
                       style: 'color:' + (fb.correct ? 'var(--good)' : 'var(--bad)') })
      ]),
      !fb.correct && wrongOpt && wrongOpt.error
        ? el('p', { class: 'why', html: '<b>Why ' + wrongOpt.key + ' is wrong:</b> ' + d.escapeHtml(wrongOpt.error) + '.' })
        : null,
      it.solution_steps && it.solution_steps.length
        ? el('ol', { class: 'steps' }, it.solution_steps.map(function (s) { return el('li', { text: s }); }))
        : el('p', { class: 'small muted' },
            'This question came without an explanation in the source. The correct answer is ' +
            it.correctKey + '.'),
      it.recognition_cue
        ? el('div', { class: 'cue' }, [el('strong', { text: 'Spotting this next time' }), it.recognition_cue])
        : null,
      it.lesson && A.data.lesson(it.lesson)
        ? el('a', { class: 'btn ghost small', href: '#/lesson/' + it.lesson, style: 'margin-top:10px' },
            'Lesson: ' + A.data.lesson(it.lesson).title)
        : null
    ]);
  }

  function drawFooter() {
    var old = $('.examfoot');
    if (old) old.remove();
    var a = answerFor();
    var answered = a && a.optIndex !== null && a.optIndex !== undefined;
    var sec = section();
    var lastIndex = sec.adaptive ? sec.n - 1 : items.length - 1;
    var last = S.ii >= lastIndex && S.si + 1 >= S.sections.length;

    var buttons = [];
    if (!S.lockAnswers) {
      buttons.push(el('button', {
        class: 'btn ghost', type: 'button', disabled: S.ii === 0, onclick: back
      }, 'Back'));
      if (S.allowFlag) {
        buttons.push(el('button', { class: 'btn ghost', type: 'button', onclick: toggleFlag },
          a && a.flagged ? '⚑ Unflag' : '⚑ Flag'));
      }
      if (items.length > 1) {
        buttons.push(el('button', {
          class: 'btn ghost', type: 'button',
          onclick: function () { navOpen = true; drawNavigator(); }
        }, [
          el('span', {
            class: 'ico', 'aria-hidden': 'true',
            html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                  'stroke-width="1.9" stroke-linejoin="round">' +
                  '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/>' +
                  '<rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/>' +
                  '<rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/>' +
                  '<rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>'
          }),
          el('span', { class: 'btn-label' }, 'All')
        ]));
      }
    } else if (sec.seconds) {
      buttons.push(el('button', {
        class: 'btn ghost', type: 'button', onclick: finishSectionEarly
      }, 'End section'));
    }

    buttons.push(el('button', {
      class: 'btn', type: 'button',
      disabled: S.instant && !answered,
      onclick: function () {
        if (last) {
          if (!answered && !confirm('You have not answered this question. Finish the test anyway?')) return;
          finish();
        } else next();
      }
    }, last ? 'Finish' : 'Next'));

    // The bar spans the window so its background and border do, but the
    // buttons inside are capped to the same measure as the questions above --
    // on a desktop the old full-width row put Next about a foot from Back.
    d.append(document.body, el('div', { class: 'examfoot' },
      el('div', { class: 'examfoot-inner' }, buttons)));
  }

  function drawBreak() {
    stopTicker();
    var main = d.clear($('#main'));
    document.body.classList.add('in-exam');
    $('#timerWrap').hidden = true;
    $('#scratchBtn').hidden = true;
    var sec = section();

    d.append(main, el('div', { class: 'card center stack' }, [
      el('p', { class: 'muted small', text: 'Section ' + (S.si + 1) + ' of ' + S.sections.length }),
      el('h2', { text: sec.name, style: 'margin:4px 0' }),
      el('p', { class: 'muted' }, sec.n + ' questions · ' + Math.round(sec.seconds / 60) + ' minutes'),
      el('p', { class: 'small muted' },
        S.lockAnswers
          ? 'Once you move on from a question you cannot return to it or change your answer.'
          : 'You can skip, flag and come back to any question until time is called.'),
      el('p', { class: 'small muted' }, 'The timer starts when you tap Begin.'),
      el('button', {
        class: 'btn block', type: 'button', onclick: function () {
          // The deadline is set here, not when the section was planned, so the
          // break itself does not eat into the section's time.
          S.deadline = sec.seconds ? Date.now() + sec.seconds * 1000 : null;
          A.state.saveSession(S);
          A.router.go('#/exam', true);
        }
      }, 'Begin ' + sec.code)
    ]));
    var footer = $('.examfoot'); if (footer) footer.remove();
  }

  function exit() {
    stopTicker();
    document.body.classList.remove('in-exam');
    var f = $('.examfoot'); if (f) f.remove();
    $('#timerWrap').hidden = true;
    $('#scratchBtn').hidden = true;
  }

  /* Keyboard first: 1-4 or A-D to choose, Enter to advance, F to flag where the
     format allows it. */
  function onKey(e) {
    if (!S || !document.body.classList.contains('in-exam')) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;

    if (/^[1-4]$/.test(k)) { e.preventDefault(); choose(parseInt(k, 10) - 1); return; }
    if (/^[a-dA-D]$/.test(k)) { e.preventDefault(); choose(k.toUpperCase().charCodeAt(0) - 65); return; }
    if (k === 'Enter') {
      e.preventDefault();
      var sec = section();
      var lastIndex = sec.adaptive ? sec.n - 1 : items.length - 1;
      if (S.ii >= lastIndex && S.si + 1 >= S.sections.length) finish(); else next();
      return;
    }
    if ((k === 'f' || k === 'F') && S.allowFlag) { e.preventDefault(); toggleFlag(); return; }
    if (k === 'ArrowLeft' && !S.lockAnswers) { e.preventDefault(); back(); }
  }
  document.addEventListener('keydown', onKey);

  A.runner = {
    begin: begin, resume: resume, hasSession: hasSession, abandon: abandon,
    draw: draw, drawBreak: drawBreak, exit: exit,
    current: function () { return S; },
    remaining: remaining
  };
})(typeof self !== 'undefined' ? self : this);
