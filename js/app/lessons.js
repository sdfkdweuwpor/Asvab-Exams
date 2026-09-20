/* Lesson library. Each lesson carries the rule, two worked examples, the trap
   that catches people, and three practice items generated live from the same
   subtopic -- so the practice is never the same three questions twice. */
(function (root) {
  'use strict';
  var A = root.ASVAB;
  var d = A.dom, el = d.el;

  function library(filter) {
    var box = el('div');
    var q = (filter || '').trim().toLowerCase();

    var search = el('input', {
      type: 'search', placeholder: 'Search lessons…', value: filter || '',
      'aria-label': 'Search lessons',
      style: 'width:100%;min-height:46px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit'
    });
    search.addEventListener('input', function () {
      var v = search.value;
      var main = d.$('#main');
      var scroll = window.scrollY;
      d.clear(main);
      d.append(main, library(v));
      var s2 = d.$('input[type=search]', main);
      if (s2) { s2.focus(); s2.setSelectionRange(v.length, v.length); }
      window.scrollTo(0, scroll);
    });
    d.append(box, el('div', { class: 'card tight' }, search));

    var matches = A.data.lessons.filter(function (l) {
      if (!q) return true;
      return (l.title + ' ' + l.concept + ' ' + l.topic + ' ' + l.subtest).toLowerCase().indexOf(q) >= 0;
    });

    if (!matches.length) {
      d.append(box, el('p', { class: 'muted center', style: 'padding:24px' }, 'No lessons match that.'));
      return box;
    }

    var bySub = {};
    matches.forEach(function (l) { (bySub[l.subtest] = bySub[l.subtest] || []).push(l); });
    A.data.subtests.forEach(function (s) {
      var list = bySub[s.code];
      if (!list) return;
      d.append(box, el('h2', { text: s.name }));
      var wrap = el('div', { class: 'subtest-list' });
      list.forEach(function (l) {
        d.append(wrap, el('a', { class: 'subtest-row', href: '#/lesson/' + l.id }, [
          el('span', { class: 'code', text: s.code }),
          el('span', { class: 'grow' }, [
            el('div', { class: 'nm', text: l.title }),
            el('div', { class: 'tiny muted', text: A.analytics.topicLabel(l.topic) })
          ]),
          el('span', { class: 'muted', text: '›' })
        ]));
      });
      d.append(box, wrap);
    });
    d.append(box, el('p', { class: 'tiny muted center', style: 'margin-top:16px' },
      A.data.lessons.length + ' lessons covering every subtopic on the test.'));
    return box;
  }

  function detail(lessonId) {
    var l = A.data.lesson(lessonId);
    if (!l) return el('p', { class: 'muted' }, 'That lesson could not be found.');
    var box = el('div');

    d.append(box, el('div', { class: 'card' }, [
      el('div', { class: 'qmeta' }, [
        el('span', { class: 'chip', text: l.subtest }),
        el('span', { class: 'chip', text: A.analytics.topicLabel(l.topic) })
      ]),
      el('h2', { style: 'margin:2px 0 8px', text: l.title }),
      el('p', { style: 'margin:0', text: l.concept })
    ]));

    l.examples.forEach(function (ex, i) {
      d.append(box, el('div', { class: 'card' }, [
        el('div', { class: 'tiny muted', text: 'Worked example ' + (i + 1) }),
        el('p', { style: 'font-weight:600;margin:4px 0 8px', text: ex.problem }),
        el('ol', { class: 'steps' }, ex.steps.map(function (s) { return el('li', { text: s }); }))
      ]));
    });

    d.append(box, el('div', { class: 'card' }, [
      el('div', { class: 'tiny muted', style: 'text-transform:uppercase;letter-spacing:.05em' }, 'The usual trap'),
      el('p', { style: 'margin:6px 0 0', text: l.trap })
    ]));

    d.append(box, practiceBlock(l));
    return box;
  }

  /* Three practice items, generated now from this lesson's own subtopic. They
     are answerable in place with instant feedback. */
  function practiceBlock(l) {
    var card = el('div', { class: 'card' }, [
      el('strong', 'Practice'),
      el('p', { class: 'muted small', style: 'margin:4px 0 10px' },
        'Three questions on this subtopic, freshly generated. Answers show as soon as you choose.')
    ]);

    var items = A.exam.lessonPractice(l, 3, Date.now());
    if (!items.length) {
      d.append(card, el('p', { class: 'muted small' }, 'No practice items available for this subtopic.'));
      return card;
    }

    items.forEach(function (item, n) {
      var answered = false;
      var wrap = el('div', { style: 'padding:12px 0;border-top:1px solid var(--line)' });
      d.append(wrap, el('p', { style: 'font-weight:600;margin:0 0 8px' },
        (n + 1) + '. '));
      var stem = el('span', { html: d.richText(item.stem) });
      d.append(wrap.lastChild, stem);
      if (item.passage) d.append(wrap, el('div', { class: 'passage' }, item.passage));
      if (item.figure) d.append(wrap, el('div', { html: item.figure }));

      var opts = el('ul', { class: 'opts' });
      var buttons = [];
      item.options.forEach(function (o, i) {
        var btn = el('button', { class: 'opt', type: 'button' }, [
          el('span', { class: 'key', text: o.key }),
          el('span', { class: 'body', html: o.svg ? o.svg : d.richText(o.text) })
        ]);
        btn.addEventListener('click', function () {
          if (answered) return;
          answered = true;
          buttons.forEach(function (b, j) {
            b.disabled = true;
            if (item.options[j].isCorrect) b.classList.add('correct');
            else if (j === i) b.classList.add('wrong');
          });
          // Practice here also feeds the seen table, so it counts toward the
          // heatmap and the confidence band like anything else.
          A.state.recordSeen({
            template_id: item.template_id, seed: item.seed, correct: !!o.isCorrect,
            confidence: 'unsure', seconds: 0, subtest: item.subtest,
            topic: item.topic, source: item.source
          });
          d.append(wrap, el('div', { class: 'cue', style: 'margin-top:10px' }, [
            el('strong', o.isCorrect ? 'Correct' : 'Not quite'),
            el('div', null, (item.solution_steps || []).join(' ')),
            !o.isCorrect && o.error ? el('p', { class: 'why', style: 'margin-top:6px' },
              'Option ' + o.key + ': ' + o.error + '.') : null
          ]));
        });
        buttons.push(btn);
        d.append(opts, el('li', null, btn));
      });
      d.append(wrap, opts);
      d.append(card, wrap);
    });

    d.append(card, el('button', {
      class: 'btn ghost block', type: 'button', style: 'margin-top:12px',
      onclick: function () {
        var fresh = practiceBlock(l);
        card.replaceWith(fresh);
        fresh.scrollIntoView({ block: 'start' });
      }
    }, 'Give me three more'));
    return card;
  }

  A.lessons = { library: library, detail: detail };
})(typeof self !== 'undefined' ? self : this);
