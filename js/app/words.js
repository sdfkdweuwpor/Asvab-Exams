/* Word Knowledge mastery: every WK question in the bank, worked through in
   rounds until each word is mastered. Two ways to study the same deck:

   Quiz       -- the real four-option question, options shuffled so a letter
                 cannot be remembered in place of the meaning. Right is "got
                 it", wrong is "missed", and a lucky guess can be marked as one.
   Flashcards -- the word on the front, its meaning on the back, and you say
                 whether you got it or missed it.

   Both feed the same records (core/mastery.js has the rules). A round lives
   in memory only; every answer is saved the moment it is given, so leaving
   mid-round loses nothing but the place in the queue. */
(function (root) {
  'use strict';
  var A = root.ASVAB;
  var d = A.dom, el = d.el, $ = d.$;
  var M = A.mastery;

  var LETTERS = ['A', 'B', 'C', 'D', 'E'];
  var SIZES = [10, 20, 50, 0];          // 0 = everything not yet mastered
  var R = null;                         // the live round
  var loadFailed = false;

  // ---------------- data ----------------

  function ids() {
    return A.bankdata.forSubtest('WK').map(function (r) { return r.id; });
  }

  function entry(id) {
    var rec = A.bankdata.byId(id);
    if (!rec) return null;
    return {
      id: id,
      word: rec.headword || '?',
      antonym: rec.relation === 'antonym',
      meaning: String((rec.options || {})[rec.answer] || '')
    };
  }

  // "goad means incite", or the reverse for the few antonym questions.
  function meaningLine(e) {
    return e.antonym
      ? el('p', { class: 'wm-meaning' }, ['The opposite of ', el('b', e.word), ' is ', el('b', e.meaning), '.'])
      : el('p', { class: 'wm-meaning' }, [el('b', e.word), ' means ', el('b', e.meaning), '.']);
  }

  function roundSize() {
    var v = A.state.settings().wordRound;
    return SIZES.indexOf(v) >= 0 ? v : 20;
  }

  // The WK chunk has to be present before anything here can draw.
  function needBank() {
    if (A.bankdata.isLoaded('WK')) return null;
    if (loadFailed) {
      return el('div', { class: 'card stack center' }, [
        el('p', { class: 'muted', style: 'margin:0' },
          'The word list could not be loaded. It needs a connection the first time.'),
        el('button', {
          class: 'btn ghost', type: 'button',
          onclick: function () { loadFailed = false; A.router.render(); }
        }, 'Try again')
      ]);
    }
    A.bankdata.ensure(['WK'], function () {
      if (!A.bankdata.isLoaded('WK')) loadFailed = true;
      A.router.render();
    });
    return el('p', { class: 'muted center', style: 'padding:32px' }, 'Loading the word list…');
  }

  // ---------------- dashboard ----------------

  function dashboard() {
    var wait = needBank();
    if (wait) return wait;

    var box = el('div');
    var all = ids();
    var recs = A.state.wordRecords();
    var sum = M.summary(all, recs);
    var size = roundSize();

    var pct = function (n) { return (sum.total ? n / sum.total * 100 : 0) + '%'; };
    d.append(box, el('div', { class: 'card wm-hero' }, [
      el('div', { class: 'tiny muted wm-eyebrow' }, 'Word Knowledge'),
      el('div', { class: 'wm-score' }, [
        el('span', { class: 'wm-num', text: String(sum.mastered) }),
        el('span', { class: 'wm-of', text: ' of ' + sum.total + ' words mastered' })
      ]),
      el('div', { class: 'wm-bar', role: 'img',
                  'aria-label': sum.mastered + ' mastered, ' + sum.learning + ' halfway, ' +
                    sum.missed + ' missed, ' + sum['new'] + ' not seen yet' }, [
        el('span', { class: 'seg-mastered', style: 'width:' + pct(sum.mastered) }),
        el('span', { class: 'seg-learning', style: 'width:' + pct(sum.learning) }),
        el('span', { class: 'seg-missed', style: 'width:' + pct(sum.missed) })
      ]),
      el('div', { class: 'wm-legend' }, [
        legend('mastered', sum.mastered + ' mastered'),
        legend('learning', sum.learning + ' halfway'),
        legend('missed', sum.missed + ' missed'),
        legend('new', sum['new'] + ' not seen')
      ])
    ]));

    if (R && !R.done) {
      d.append(box, el('div', { class: 'card stack notice-card' }, [
        el('strong', 'Round in progress'),
        el('p', { class: 'small muted', style: 'margin:0' },
          (R.mode === 'cards' ? 'Flashcards' : 'Quiz') + ' · card ' + (R.pos + 1) + ' of ' + R.queue.length),
        el('a', { class: 'btn block', href: '#/words/play' }, 'Resume round')
      ]));
    }

    var left = sum.total - sum.mastered;
    if (!left) {
      d.append(box, el('p', { class: 'banner good' },
        'Every word in the bank is mastered. Review rounds keep them that way — ' +
        'miss one and it comes back.'));
    }

    var sizeRow = el('div', { class: 'wm-sizes', role: 'group', 'aria-label': 'Words per round' },
      SIZES.map(function (n) {
        var label = n ? String(n) : 'All ' + left;
        return el('button', {
          class: 'wm-size' + (n === size ? ' on' : ''), type: 'button',
          'aria-pressed': n === size ? 'true' : 'false',
          onclick: function () { A.state.setSetting('wordRound', n); A.router.render(); }
        }, label);
      }));

    d.append(box, el('div', { class: 'card stack' }, [
      el('strong', 'Study the words'),
      el('p', { class: 'muted small', style: 'margin:0' },
        'Missed words come first, then ones you are halfway on, then new ones. ' +
        'Get a word right twice in a row and it is mastered.'),
      el('div', { class: 'tiny muted', style: 'margin-bottom:-4px' }, 'Words per round'),
      sizeRow,
      left ? el('button', { class: 'btn block', type: 'button', onclick: function () { start('quiz', false); } },
        'Start quiz') : null,
      left ? el('button', { class: 'btn ghost block', type: 'button', onclick: function () { start('cards', false); } },
        'Flashcards — got it or missed it') : null,
      sum.mastered
        ? el('button', { class: 'btn ghost block small', type: 'button', onclick: function () { start('quiz', true); } },
            'Review mastered words')
        : null
    ]));

    var missed = [], halfway = [], mastered = [];
    all.forEach(function (id) {
      var st = M.status(recs[id]);
      if (st === 'missed') missed.push(id);
      else if (st === 'learning') halfway.push(id);
      else if (st === 'mastered') mastered.push(id);
    });
    missed.sort(function (a, b) { return (recs[b].m - recs[a].m) || (a < b ? -1 : 1); });

    if (missed.length) {
      d.append(box, el('h2', 'Missed — study these'));
      d.append(box, wordList(missed, recs, 'missed'));
    }
    if (halfway.length) {
      d.append(box, el('h2', 'Halfway — one more right answer each'));
      d.append(box, wordList(halfway, recs, 'learning'));
    }
    if (mastered.length) {
      d.append(box, el('details', { class: 'foldout', style: 'margin-top:18px' }, [
        el('summary', 'Mastered words (' + mastered.length + ')'),
        el('div', null, wordList(mastered, recs, 'mastered'))
      ]));
    }

    d.append(box, el('p', { class: 'tiny muted', style: 'margin-top:18px' },
      'Practice here is kept separate from your test history, so studying the ' +
      'words does not inflate your Word Knowledge score estimate. ' +
      sum.total + ' questions in the bank test ' + uniqueWords(all) + ' different words; ' +
      'a few words are tested twice, with different answer choices.'));

    if (Object.keys(recs).length) {
      d.append(box, el('button', {
        class: 'btn ghost small', type: 'button', style: 'margin-top:6px',
        onclick: function () {
          if (!confirm('Reset word progress? Every word goes back to not seen. Your test history is not touched.')) return;
          A.state.resetWords(); R = null; d.toast('Word progress reset'); A.router.render();
        }
      }, 'Reset word progress'));
    }
    return box;
  }

  function uniqueWords(list) {
    var seen = {};
    list.forEach(function (id) { var e = entry(id); if (e) seen[e.word] = 1; });
    return Object.keys(seen).length;
  }

  function legend(kind, text) {
    return el('span', null, [el('span', { class: 'wm-dot ' + kind }), text]);
  }

  function wordList(list, recs, kind) {
    var wrap = el('div', { class: 'card tight wm-list' });
    list.forEach(function (id) {
      var e = entry(id);
      if (!e) return;
      var r = recs[id] || {};
      d.append(wrap, el('div', { class: 'wm-row' }, [
        el('span', { class: 'wm-dot ' + kind }),
        el('span', { class: 'wm-word', text: e.word }),
        el('span', { class: 'wm-mean', text: (e.antonym ? 'opposite: ' : '') + e.meaning }),
        kind === 'missed' && r.m > 1 ? el('span', { class: 'chip', text: 'missed ' + r.m + '×' }) : null
      ]));
    });
    return wrap;
  }

  // ---------------- rounds ----------------

  function start(mode, review) {
    var all = ids();
    var seed = Date.now();
    var queue = M.pickRound(all, A.state.wordRecords(), roundSize(), A.rng.make('round:' + seed), { review: review });
    if (!queue.length) { d.toast(review ? 'No mastered words to review yet.' : 'Nothing left to study.'); return; }
    var recs = A.state.wordRecords();
    var startStatus = {};
    queue.forEach(function (id) { startStatus[id] = M.status(recs[id]); });
    R = {
      mode: mode, review: !!review, seed: seed,
      queue: queue, pos: 0, reasks: {}, log: [],
      startStatus: startStatus, card: null, done: false
    };
    if (location.hash === '#/words/play') A.router.render();
    else location.hash = '#/words/play';
  }

  // The card at the current position, built once so a redraw keeps its
  // shuffled order and the answer already given.
  function card() {
    if (R.card && R.card.pos === R.pos) return R.card;
    var id = R.queue[R.pos];
    var item = A.items.render(A.bankdata.byId(id), 0);
    var rng = A.rng.make('words:' + R.seed + ':' + R.pos);
    var opts = (R.mode === 'quiz' ? rng.shuffle(item.options) : item.options).map(function (o, i) {
      return { key: LETTERS[i], text: o.text, isCorrect: o.isCorrect };
    });
    R.card = {
      pos: R.pos, id: id, item: item, entry: entry(id), options: opts,
      before: A.state.wordRecords()[id] || null,
      answered: null, revealed: false, graded: false, guessed: false, after: null, reasked: false
    };
    return R.card;
  }

  function record(got) {
    var c = R.card;
    c.after = M.apply(c.before, got);
    A.state.setWordRecord(c.id, c.after);
    c.graded = true;
    R.log.push({ id: c.id, got: got });
    if (!got && (R.reasks[c.id] || 0) < M.REASK_MAX) {
      R.queue.splice(M.reaskAt(R.pos, R.queue.length), 0, c.id);
      R.reasks[c.id] = (R.reasks[c.id] || 0) + 1;
      c.reasked = true;
    }
  }

  function choose(i) {
    var c = card();
    if (R.mode !== 'quiz' || c.answered || !c.options[i]) return;
    c.answered = { index: i, correct: !!c.options[i].isCorrect };
    record(c.answered.correct);
    draw();
  }

  // A right answer that was a guess: undo the "got it" and count it missed.
  function guessed() {
    var c = R.card;
    if (!c || !c.answered || !c.answered.correct || c.guessed) return;
    c.guessed = true;
    R.log.pop();
    record(false);
    draw();
  }

  function reveal() {
    var c = card();
    if (R.mode !== 'cards' || c.revealed) return;
    c.revealed = true;
    draw();
  }

  function grade(got) {
    var c = card();
    if (R.mode !== 'cards' || !c.revealed || c.graded) return;
    record(got);
    next();
  }

  function next() {
    if (!R.card || !R.card.graded) return;
    R.pos++;
    R.card = null;
    if (R.pos >= R.queue.length) R.done = true;
    draw();
  }

  // ---------------- play view ----------------

  function play() {
    var wait = needBank();
    if (wait) return wait;
    if (!R) { setTimeout(function () { A.router.go('#/words', true); }, 0); return null; }
    document.body.classList.add('in-words');
    draw();
    return null;
  }

  function draw() {
    var main = d.clear($('#main'));
    var old = $('.examfoot'); if (old) old.remove();
    if (R.done) { drawSummary(main); return; }

    var c = card();
    var before = M.status(c.before);
    var chip = { 'new': 'New word', missed: 'Missed last time', learning: '1 of 2 — halfway', mastered: 'Mastered' }[before];

    d.append(main, el('div', { class: 'wm-top' }, [
      el('div', { class: 'row between' }, [
        el('span', { class: 'small muted', text: 'Word ' + (R.pos + 1) + ' of ' + R.queue.length }),
        el('span', { class: 'chip' + (before === 'missed' ? ' missed' : ''), text: chip })
      ]),
      el('div', { class: 'wm-track' }, el('span', { style: 'width:' + (R.pos / R.queue.length * 100) + '%' }))
    ]));

    if (R.mode === 'cards') drawCard(main, c); else drawQuiz(main, c);
    drawFooter(c);
    window.scrollTo(0, 0);
  }

  function drawQuiz(main, c) {
    d.append(main, el('p', { class: 'stem', html: d.richText(c.item.stem) }));
    var ul = el('ul', { class: 'opts' });
    c.options.forEach(function (o, i) {
      var cls = 'opt';
      if (c.answered) {
        if (o.isCorrect) cls += ' correct';
        else if (i === c.answered.index) cls += ' wrong';
      }
      d.append(ul, el('li', null, el('button', {
        class: cls, type: 'button', disabled: !!c.answered,
        'aria-pressed': c.answered && c.answered.index === i ? 'true' : 'false',
        onclick: function () { choose(i); }
      }, [el('span', { class: 'key', text: o.key }), el('span', { class: 'body', text: o.text })])));
    });
    d.append(main, ul);
    if (c.answered) d.append(main, resultCard(c, c.answered.correct && !c.guessed));
  }

  // Front: the word, and the sentence it came in if there was one. Back: the
  // meaning, then you say whether you had it.
  function drawCard(main, c) {
    var e = c.entry;
    var context = (c.item.stem || '').split('\n').filter(function (line) {
      return line.trim() && !/most nearly mean|opposite in meaning/i.test(line);
    }).join(' ');
    d.append(main, el('div', { class: 'card flash' }, [
      el('div', { class: 'flash-label', text: e.antonym ? 'Opposite of' : 'What does it mean?' }),
      el('div', { class: 'flash-word', text: e.word }),
      context ? el('p', { class: 'flash-context', html: d.richText(context) }) : null,
      c.revealed ? el('div', { class: 'flash-back' }, [
        el('div', { class: 'flash-label', text: e.antonym ? 'Opposite' : 'Meaning' }),
        el('div', { class: 'flash-answer', text: e.meaning }),
        explanation(c)
      ]) : null
    ]));
  }

  function explanation(c) {
    var steps = c.item.solution_steps || [];
    return steps.length ? el('p', { class: 'small muted wm-expl', text: steps[0] }) : null;
  }

  function resultCard(c, got) {
    var after = c.after || {};
    var note;
    if (got) {
      if (M.status(after) === 'mastered') {
        note = R.startStatus[c.id] === 'mastered' ? 'Still mastered.' : 'Mastered — it drops out of your rounds.';
      } else {
        note = '1 of 2. Get it right again next round and it is mastered.';
      }
    } else {
      note = c.reasked ? 'It comes back in a few cards.' : 'It comes back next round.';
    }
    return el('div', { class: 'card wm-result ' + (got ? 'good' : 'bad') }, [
      el('div', { class: 'wm-verdict', text: got ? '✓ Got it' : (c.guessed ? 'Counted as missed' : '✗ Missed') }),
      meaningLine(c.entry),
      explanation(c),
      el('p', { class: 'tiny muted', style: 'margin:6px 0 0', text: note })
    ]);
  }

  function drawFooter(c) {
    var buttons = [];
    if (R.mode === 'quiz') {
      if (c.answered && c.answered.correct && !c.guessed) {
        buttons.push(el('button', { class: 'btn ghost', type: 'button', onclick: guessed, title: 'Shortcut: M' },
          'I guessed'));
      }
      buttons.push(el('button', { class: 'btn', type: 'button', disabled: !c.answered, onclick: next },
        R.pos + 1 >= R.queue.length ? 'Finish round' : 'Next'));
    } else if (!c.revealed) {
      buttons.push(el('button', { class: 'btn', type: 'button', onclick: reveal }, 'Show answer'));
    } else {
      buttons.push(el('button', { class: 'btn wm-miss', type: 'button', onclick: function () { grade(false); }, title: 'Shortcut: M' },
        '✗ Missed it'));
      buttons.push(el('button', { class: 'btn wm-got', type: 'button', onclick: function () { grade(true); }, title: 'Shortcut: G' },
        '✓ Got it'));
    }
    d.append(document.body, el('div', { class: 'examfoot' }, el('div', { class: 'examfoot-inner' }, buttons)));
  }

  function drawSummary(main) {
    var first = {}, missedIds = [];
    R.log.forEach(function (x) {
      if (!(x.id in first)) first[x.id] = x.got;
      if (!x.got && missedIds.indexOf(x.id) < 0) missedIds.push(x.id);
    });
    var words = Object.keys(first);
    var gotFirst = words.filter(function (id) { return first[id]; }).length;
    var recs = A.state.wordRecords();
    var newlyMastered = words.filter(function (id) {
      return M.status(recs[id]) === 'mastered' && R.startStatus[id] !== 'mastered';
    }).length;
    var sum = M.summary(ids(), recs);

    d.append(main, el('div', { class: 'card center stack wm-hero' }, [
      el('div', { class: 'tiny muted wm-eyebrow' }, 'Round complete'),
      el('div', { class: 'wm-score' }, [
        el('span', { class: 'wm-num', text: String(gotFirst) }),
        el('span', { class: 'wm-of', text: ' of ' + words.length + ' right first time' })
      ]),
      el('div', { class: 'row', style: 'justify-content:center' }, [
        newlyMastered ? el('span', { class: 'chip good', text: newlyMastered + ' newly mastered' }) : null,
        missedIds.length ? el('span', { class: 'chip missed', text: missedIds.length + ' missed' }) : null,
        el('span', { class: 'chip', text: sum.mastered + ' of ' + sum.total + ' mastered overall' })
      ])
    ]));

    if (missedIds.length) {
      d.append(main, el('h2', 'Words you missed'));
      d.append(main, wordList(missedIds, recs, 'missed'));
    }

    var more = sum.total - sum.mastered;
    var buttons = [el('a', { class: 'btn ghost', href: '#/words' }, 'Word list')];
    if (R.review ? sum.mastered : more) {
      buttons.push(el('button', {
        class: 'btn', type: 'button', onclick: function () { start(R.mode, R.review); }
      }, 'Next round'));
    }
    d.append(document.body, el('div', { class: 'examfoot' }, el('div', { class: 'examfoot-inner' }, buttons)));
    window.scrollTo(0, 0);
  }

  // Keyboard: 1-4 or A-D answers, Enter moves on or turns the card,
  // G and M are got it / missed it.
  document.addEventListener('keydown', function (e) {
    if (!R || location.hash !== '#/words/play') return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var k = e.key;
    if (R.done) {
      if (k === 'Enter') { e.preventDefault(); start(R.mode, R.review); }
      return;
    }
    var c = card();
    if (R.mode === 'quiz') {
      if (!c.answered) {
        if (/^[1-4]$/.test(k)) { e.preventDefault(); choose(parseInt(k, 10) - 1); }
        else if (/^[a-dA-D]$/.test(k)) { e.preventDefault(); choose(k.toUpperCase().charCodeAt(0) - 65); }
        return;
      }
      if (k === 'Enter') { e.preventDefault(); next(); }
      else if (k === 'm' || k === 'M') { e.preventDefault(); guessed(); }
      return;
    }
    if (!c.revealed) {
      if (k === 'Enter' || k === ' ') { e.preventDefault(); reveal(); }
      return;
    }
    if (k === 'g' || k === 'G') { e.preventDefault(); grade(true); }
    else if (k === 'm' || k === 'M') { e.preventDefault(); grade(false); }
  });

  // Home and the start menu show progress without loading the WK chunk.
  function masteredCount() {
    var recs = A.state.wordRecords(), n = 0;
    Object.keys(recs).forEach(function (id) { if (M.status(recs[id]) === 'mastered') n++; });
    return n;
  }

  A.words = { dashboard: dashboard, play: play, masteredCount: masteredCount };
})(typeof self !== 'undefined' ? self : this);
