/* The exam runner: one question at a time, a visible timer, and an autosave
   after every single answer so a refresh or a phone call never costs a session. */
(function (root) {
  'use strict';
  var A = root.ASVAB;
  var d = A.dom, el = d.el, $ = d.$;

  var S = null;          // live session
  var items = [];        // rehydrated items for the CURRENT section
  var itemStart = 0;     // when the current question first appeared
  var ticker = null;
  var feedback = null;   // practice mode: the result being shown

  function key(si, ii) { return si + ':' + ii; }
  function section() { return S.sections[S.si]; }
  function answerFor(ii) { return S.answers[key(S.si, ii === undefined ? S.ii : ii)]; }

  // ---------------- lifecycle ----------------

  function begin(exam, opts) {
    opts = opts || {};
    S = {
      mode: exam.mode,
      created: exam.created,
      subtest: exam.subtest || null,
      focus: exam.focus || null,
      catRules: !!opts.catRules,
      instant: exam.mode === 'practice' || exam.mode === 'drill' || exam.mode === 'review',
      startedAt: Date.now(),
      sections: exam.sections.map(function (s) {
        return { code: s.code, name: s.name, seconds: s.seconds, refs: s.items.map(A.exam.itemRef) };
      }),
      si: 0, ii: 0,
      remaining: exam.sections[0].seconds,
      answers: {},
      elapsed: 0,
      done: false
    };
    A.state.saveSession(S);
    loadSection();
    A.router.go('#/exam', true);
  }

  function resume() {
    S = A.state.getSession();
    if (!S || S.done) return false;
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

  function loadSection() {
    items = section().refs.map(function (r) { return A.exam.rehydrate(r); })
      .filter(function (x) { return !!x; });
    itemStart = Date.now();
  }

  // ---------------- timer ----------------

  function startTicker() {
    stopTicker();
    ticker = setInterval(function () {
      S.elapsed = (S.elapsed || 0) + 1;
      if (S.remaining !== null && S.remaining !== undefined) {
        S.remaining = Math.max(0, S.remaining - 1);
        paintTimer();
        if (S.remaining === 0) { timeUp(); return; }
        // Persist about every five seconds; every answer also forces a save.
        if (S.remaining % 5 === 0) A.state.saveSession(S);
      } else {
        paintTimer();
      }
    }, 1000);
  }
  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

  function paintTimer() {
    var t = $('#timer'), w = $('#timerWrap'), c = $('#progressCount');
    if (!S) { w.hidden = true; return; }
    w.hidden = false;
    if (S.remaining === null || S.remaining === undefined) {
      t.textContent = d.fmtClock(S.elapsed || 0);
      t.className = '';
    } else {
      t.textContent = d.fmtClock(S.remaining);
      t.className = S.remaining <= 30 ? 'critical' : (S.remaining <= 120 ? 'warning' : '');
    }
    c.textContent = 'Q' + (S.ii + 1) + ' of ' + items.length +
      (S.sections.length > 1 ? '  ·  ' + section().code : '');
  }

  function timeUp() {
    stopTicker();
    d.toast('Time is up for ' + section().name);
    nextSection();
  }

  // ---------------- answering ----------------

  function choose(optIndex) {
    var it = items[S.ii];
    var k = key(S.si, S.ii);
    var prev = S.answers[k];
    var secs = prev && prev.seconds ? prev.seconds : Math.round((Date.now() - itemStart) / 1000);
    var picked = it.options[optIndex];

    S.answers[k] = {
      optIndex: optIndex,
      optKey: picked.key,
      correct: !!picked.isCorrect,
      seconds: secs,
      confidence: (prev && prev.confidence) || null,
      flagged: !!(prev && prev.flagged)
    };
    A.state.saveSession(S);   // autosave after every single answer

    if (S.instant) {
      feedback = { index: optIndex, correct: !!picked.isCorrect };
      stopTicker();
    }
    draw();
  }

  function setConfidence(level) {
    var k = key(S.si, S.ii);
    var a = S.answers[k] || (S.answers[k] = { optIndex: null, correct: false, seconds: 0, flagged: false });
    a.confidence = level;
    A.state.saveSession(S);
    draw();
  }

  function toggleFlag() {
    if (S.catRules) return;
    var k = key(S.si, S.ii);
    var a = S.answers[k] || (S.answers[k] = { optIndex: null, correct: false, seconds: 0, confidence: null });
    a.flagged = !a.flagged;
    A.state.saveSession(S);
    draw();
  }

  function next() {
    feedback = null;
    if (S.ii + 1 < items.length) {
      S.ii++;
      itemStart = Date.now();
      A.state.saveSession(S);
      draw();
    } else {
      nextSection();
    }
  }

  function back() {
    if (S.catRules || S.ii === 0) return;
    feedback = null;
    S.ii--;
    itemStart = Date.now();
    A.state.saveSession(S);
    draw();
  }

  function nextSection() {
    feedback = null;
    if (S.si + 1 < S.sections.length) {
      S.si++;
      S.ii = 0;
      S.remaining = S.sections[S.si].seconds;
      loadSection();
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
        results.push({
          template_id: ref.template_id, seed: ref.seed, source: ref.source,
          subtest: ref.subtest, topic: ref.topic, passage_id: ref.passage_id || null,
          target_seconds: ref.target_seconds || 45,
          answered: !!(a && a.optIndex !== null && a.optIndex !== undefined),
          optIndex: a ? a.optIndex : null,
          correct: !!(a && a.correct),
          confidence: (a && a.confidence) || 'unsure',
          seconds: (a && a.seconds) || 0,
          flagged: !!(a && a.flagged)
        });
      });
    });

    // Feed the seen table, which powers non-repetition and every analytic.
    var now = new Date().toISOString();
    results.forEach(function (r) {
      A.state.recordSeen({
        template_id: r.template_id, seed: r.seed, date: now, correct: r.correct,
        confidence: r.confidence, seconds: r.seconds, subtest: r.subtest,
        topic: r.topic, source: r.source
      });
      // Missed items come back at 3, 7 and 14 days with a new seed.
      if (!r.correct) A.state.scheduleReview(r, 0);
      else if (S.mode === 'review') A.state.advanceReview(r.template_id);
    });

    var tallies = A.scoring.tally(results.filter(function (r) { return r.subtest; }));
    var scores = A.scoring.score(tallies, A.state.afqtSampleSize());

    var attemptId = A.state.recordAttempt({
      date: now, mode: S.mode, subtest: S.subtest || null,
      catRules: S.catRules,
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
    var meta = el('div', { class: 'qmeta' }, [
      el('span', { class: 'chip', text: it.subtest }),
      el('span', { class: 'chip', text: A.analytics.topicLabel(it.topic) }),
      a && a.flagged ? el('span', { class: 'chip flagged', text: '⚑ Flagged' }) : null
    ]);
    d.append(main, meta);

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
        disabled: !!feedback,
        onclick: function () { choose(i); }
      }, [
        el('span', { class: 'key', text: o.key }),
        el('span', { class: 'body', html: o.svg ? o.svg : d.richText(o.text) })
      ]);
      d.append(opts, el('li', null, btn));
    });
    d.append(main, opts);

    // Confidence tag: recorded per question, and the report separates
    // confident-and-wrong from unsure-and-wrong.
    d.append(main, el('div', { class: 'conf', role: 'group', 'aria-label': 'How sure are you?' },
      [['sure', 'Sure'], ['unsure', 'Unsure'], ['guessed', 'Guessed']].map(function (pair) {
        return el('button', {
          type: 'button', 'aria-pressed': a && a.confidence === pair[0] ? 'true' : 'false',
          onclick: function () { setConfidence(pair[0]); }
        }, pair[1]);
      })));

    if (feedback) d.append(main, feedbackCard(it, feedback));

    d.append(document.body, null);
    drawFooter();
    window.scrollTo(0, 0);
  }

  function feedbackCard(it, fb) {
    var wrongOpt = it.options[fb.index];
    return el('div', { class: 'card', style: 'margin-top:16px' }, [
      el('p', { class: 'row', style: 'margin-top:0' }, [
        el('strong', { text: fb.correct ? 'Correct' : 'Not quite' , style: 'color:' + (fb.correct ? 'var(--good)' : 'var(--bad)') })
      ]),
      !fb.correct && wrongOpt && wrongOpt.error
        ? el('p', { class: 'why', html: '<b>Why ' + wrongOpt.key + ' is wrong:</b> ' + d.escapeHtml(wrongOpt.error) + '.' })
        : null,
      it.solution_steps && it.solution_steps.length
        ? el('ol', { class: 'steps' }, it.solution_steps.map(function (s) { return el('li', { text: s }); }))
        : null,
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
    var last = S.ii + 1 >= items.length && S.si + 1 >= S.sections.length;

    var buttons = [];
    if (!S.catRules) {
      buttons.push(el('button', {
        class: 'btn ghost', type: 'button', disabled: S.ii === 0,
        onclick: back
      }, 'Back'));
      buttons.push(el('button', {
        class: 'btn ghost', type: 'button', onclick: toggleFlag
      }, a && a.flagged ? '⚑ Unflag' : '⚑ Flag'));
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
    }, last ? 'Finish' : (S.instant && answered ? 'Next' : 'Next')));

    d.append(document.body, el('div', { class: 'examfoot' }, buttons));
  }

  /* Between sections of a full simulation: a deliberate pause, because the real
     test moves section to section and pacing is part of what is being practised. */
  function drawBreak() {
    stopTicker();
    var main = d.clear($('#main'));
    document.body.classList.add('in-exam');
    $('#timerWrap').hidden = true;
    $('#scratchBtn').hidden = true;
    var sec = section();
    var done = S.si, total = S.sections.length;

    d.append(main, el('div', { class: 'card center stack' }, [
      el('p', { class: 'muted small', text: 'Section ' + (done + 1) + ' of ' + total }),
      el('h2', { text: sec.name, style: 'margin:4px 0' }),
      el('p', { class: 'muted' }, sec.refs.length + ' questions · ' + Math.round(sec.seconds / 60) + ' minutes'),
      el('p', { class: 'small muted' }, 'The timer starts when you tap Begin.'),
      el('button', {
        class: 'btn block', type: 'button', onclick: function () {
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

  A.runner = {
    begin: begin, resume: resume, hasSession: hasSession, abandon: abandon,
    draw: draw, drawBreak: drawBreak, exit: exit,
    current: function () { return S; }
  };
})(typeof self !== 'undefined' ? self : this);
