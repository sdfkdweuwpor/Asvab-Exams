/* Assembling Objects: items are generated geometrically, not authored.

   connection  -- two shapes each carrying a marked attachment point; the
                  correct option joins exactly those two points.
   assembly    -- a master polygon is sliced into pieces; the stem scatters the
                  pieces and the correct option is the one assembly those exact
                  pieces make. Distractor assemblies come from perturbed cuts,
                  so they genuinely cannot be built from the pieces shown. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rng.js'), require('./engine.js'));
  else { root.ASVAB = root.ASVAB || {}; root.ASVAB.ao = factory(root.ASVAB.rng, root.ASVAB.engine); }
})(typeof self !== 'undefined' ? self : this, function (rng, engine) {
  'use strict';
  var LETTERS = ['A', 'B', 'C', 'D'];

  // ---------- geometry ----------
  function rot(p, a) {
    return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
  }
  function add(p, q) { return { x: p.x + q.x, y: p.y + q.y }; }
  function mul(p, s) { return { x: p.x * s, y: p.y * s }; }
  function lerp(p, q, t) { return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }; }
  function area(poly) {
    var s = 0;
    for (var i = 0; i < poly.length; i++) {
      var j = (i + 1) % poly.length;
      s += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
    }
    return Math.abs(s) / 2;
  }
  function centroid(poly) {
    var c = { x: 0, y: 0 };
    poly.forEach(function (p) { c.x += p.x; c.y += p.y; });
    return { x: c.x / poly.length, y: c.y / poly.length };
  }
  function transform(poly, angle, offset, mirror) {
    return poly.map(function (p) {
      var q = mirror ? { x: -p.x, y: p.y } : p;
      return add(rot(q, angle), offset);
    });
  }
  function path(poly) {
    return 'M' + poly.map(function (p) { return p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' L') + ' Z';
  }
  function bbox(polys) {
    var xs = [], ys = [];
    polys.forEach(function (poly) { poly.forEach(function (p) { xs.push(p.x); ys.push(p.y); }); });
    return { x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs), y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys) };
  }

  // ---------- shape library (unit shapes, centred on the origin) ----------
  function regular(n, r, phase) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var a = phase + (i / n) * Math.PI * 2;
      out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return out;
  }
  var SHAPES = {
    triangle: function () { return regular(3, 30, -Math.PI / 2); },
    square: function () { return regular(4, 28, Math.PI / 4); },
    pentagon: function () { return regular(5, 30, -Math.PI / 2); },
    hexagon: function () { return regular(6, 30, 0); },
    trapezoid: function () { return [{ x: -32, y: 18 }, { x: 32, y: 18 }, { x: 18, y: -18 }, { x: -18, y: -18 }]; },
    rectangle: function () { return [{ x: -36, y: 16 }, { x: 36, y: 16 }, { x: 36, y: -16 }, { x: -36, y: -16 }]; },
    lshape: function () { return [{ x: -26, y: 26 }, { x: 6, y: 26 }, { x: 6, y: -2 }, { x: 28, y: -2 }, { x: 28, y: -26 }, { x: -26, y: -26 }]; },
    tshape: function () { return [{ x: -30, y: 26 }, { x: 30, y: 26 }, { x: 30, y: 6 }, { x: 10, y: 6 }, { x: 10, y: -26 }, { x: -10, y: -26 }, { x: -10, y: 6 }, { x: -30, y: 6 }]; },
    chevron: function () { return [{ x: -28, y: 22 }, { x: 0, y: 4 }, { x: 28, y: 22 }, { x: 28, y: -4 }, { x: 0, y: -22 }, { x: -28, y: -4 }]; },
    kite: function () { return [{ x: 0, y: 34 }, { x: 22, y: 2 }, { x: 0, y: -32 }, { x: -22, y: 2 }]; }
  };
  var SHAPE_NAMES = Object.keys(SHAPES);

  // Attachment points: every vertex, then every edge midpoint.
  function attachPoints(poly) {
    var pts = poly.slice();
    for (var i = 0; i < poly.length; i++) pts.push(lerp(poly[i], poly[(i + 1) % poly.length], 0.5));
    return pts;
  }

  // ---------- SVG ----------
  function wrap(w, h, body, label) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + label +
      '" class="ao" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linejoin="round">' + body + '</svg>';
  }

  // ---------- connection problems ----------
  function connectionItem(seed) {
    var r = rng.make('AO_conn:' + seed);
    var names = r.sample(SHAPE_NAMES, 3);
    var s1 = SHAPES[names[0]](), s2 = SHAPES[names[1]](), sAlt = SHAPES[names[2]]();

    var a1 = attachPoints(s1), a2 = attachPoints(s2);
    var i1 = r.int(0, a1.length - 1), i2 = r.int(0, a2.length - 1);
    // a clearly different point on each shape, for the "wrong attachment" options
    var j1 = (i1 + 1 + r.int(0, a1.length - 3)) % a1.length;
    var j2 = (i2 + 1 + r.int(0, a2.length - 3)) % a2.length;

    /* Label placement matters more than it looks: the whole problem is reading
       WHERE the dot sits, so the letter is pushed outward along the line from
       the shape's centre through the dot. That keeps it clear of the outline
       whatever shape and vertex the draw picked. */
    function labelFor(letter, shape, pt, origin) {
      var c = centroid(shape);
      var dx = pt.x - c.x, dy = pt.y - c.y;
      var len = Math.hypot(dx, dy) || 1;
      var lx = origin.x + pt.x + (dx / len) * 15;
      var ly = origin.y + pt.y + (dy / len) * 15 + 4.5;
      return '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" font-size="14" font-weight="700" ' +
        'text-anchor="middle" stroke="none" fill="currentColor">' + letter + '</text>';
    }

    function stemPanel() {
      var L = { x: 86, y: 78 }, R = { x: 250, y: 78 };
      var p1 = transform(s1, 0, L), p2 = transform(s2, 0, R);
      var m1 = add(a1[i1], L), m2 = add(a2[i2], R);
      return wrap(336, 160,
        '<path d="' + path(p1) + '"/><path d="' + path(p2) + '"/>' +
        '<circle cx="' + m1.x.toFixed(1) + '" cy="' + m1.y.toFixed(1) + '" r="4" fill="currentColor"/>' +
        '<circle cx="' + m2.x.toFixed(1) + '" cy="' + m2.y.toFixed(1) + '" r="4" fill="currentColor"/>' +
        labelFor('A', s1, a1[i1], L) + labelFor('B', s2, a2[i2], R),
        'Two shapes, each with a marked connection point');
    }

    // each option re-orients both shapes, so the point must be tracked, not eyeballed
    var rot1 = r.pick([0, 0.5, 1.1, 2.0, 2.7, 3.7, 4.6, 5.4]);
    var rot2 = r.pick([0, 0.6, 1.4, 2.3, 3.1, 4.0, 4.9, 5.8]);

    function optionPanel(shapeA, ptsA, idxA, shapeB, ptsB, idxB, mirrorA) {
      var L = { x: 62, y: 62 }, R = { x: 188, y: 62 };
      var pa = transform(shapeA, rot1, L, mirrorA), pb = transform(shapeB, rot2, R);
      var ma = add(rot(mirrorA ? { x: -ptsA[idxA].x, y: ptsA[idxA].y } : ptsA[idxA], rot1), L);
      var mb = add(rot(ptsB[idxB], rot2), R);
      return wrap(250, 124,
        '<path d="' + path(pa) + '"/><path d="' + path(pb) + '"/>' +
        '<line x1="' + ma.x.toFixed(1) + '" y1="' + ma.y.toFixed(1) + '" x2="' + mb.x.toFixed(1) + '" y2="' + mb.y.toFixed(1) + '"/>',
        'Two shapes joined by a connecting line');
    }

    var altPts = attachPoints(sAlt);
    var variants = [
      { svg: optionPanel(s1, a1, i1, s2, a2, i2, false), correct: true, error: null },
      { svg: optionPanel(s1, a1, j1, s2, a2, i2, false), correct: false, error: 'the line meets the first shape at the wrong point — it attaches somewhere other than the marked dot' },
      { svg: optionPanel(s1, a1, i1, s2, a2, j2, false), correct: false, error: 'the line meets the second shape at the wrong point' },
      { svg: optionPanel(s1, a1, i1, sAlt, altPts, r.int(0, altPts.length - 1), false), correct: false, error: 'one of the two shapes has been swapped for a different shape' },
      { svg: optionPanel(s1, a1, i1, s2, a2, i2, true), correct: false, error: 'the first shape is mirrored — a reflection, not a rotation, of the shape in the question' }
    ];
    var wrongs = r.shuffle(variants.slice(1)).slice(0, 3);

    return {
      kind: 'connection',
      topic: 'connection_problems',
      stemFigure: stemPanel(),
      stemText: 'Which choice connects point A on the first shape to point B on the second shape?',
      correct: variants[0],
      wrongs: wrongs,
      cue: 'Check the dots first, not the overall picture. Find where each dot sits on its own shape, then confirm the line lands on those same two spots after the shapes are turned.',
      difficulty: 2
    };
  }

  // ---------- shape-assembly problems ----------
  // Slice a convex polygon edge-to-edge; both halves stay convex.
  function slice(poly, ei, ti, ej, tj) {
    var n = poly.length;
    var A = lerp(poly[ei], poly[(ei + 1) % n], ti);
    var B = lerp(poly[ej], poly[(ej + 1) % n], tj);
    var p1 = [A], k;
    for (k = (ei + 1) % n; ; k = (k + 1) % n) { p1.push(poly[k]); if (k === ej) break; }
    p1.push(B);
    var p2 = [B];
    for (k = (ej + 1) % n; ; k = (k + 1) % n) { p2.push(poly[k]); if (k === ei) break; }
    p2.push(A);
    return [p1, p2];
  }

  // Repeatedly cut the largest remaining piece. Returns {pieces, cuts}.
  function carve(master, nPieces, r, jitter) {
    var pieces = [master];
    var cuts = [];
    var guard = 0;
    while (pieces.length < nPieces && guard++ < 60) {
      pieces.sort(function (a, b) { return area(b) - area(a); });
      var target = pieces.shift();
      var n = target.length;
      var ei = r.int(0, n - 1);
      var ej = (ei + 1 + r.int(1, Math.max(1, n - 3))) % n;
      if (ej === ei) { pieces.push(target); continue; }
      var ti = 0.3 + r.next() * 0.4 + (jitter || 0);
      var tj = 0.3 + r.next() * 0.4 - (jitter || 0);
      ti = Math.max(0.12, Math.min(0.88, ti));
      tj = Math.max(0.12, Math.min(0.88, tj));
      var parts;
      try { parts = slice(target, ei, ti, ej, tj); } catch (e) { pieces.push(target); continue; }
      if (parts.some(function (p) { return p.length < 3 || area(p) < 150; })) { pieces.push(target); continue; }
      cuts.push([lerp(target[ei], target[(ei + 1) % n], ti), lerp(target[ej], target[(ej + 1) % n], tj)]);
      pieces.push(parts[0], parts[1]);
    }
    return { pieces: pieces, cuts: cuts };
  }

  function assemblyItem(seed) {
    var r = rng.make('AO_asm:' + seed);
    var masters = [
      regular(4, 46, Math.PI / 4),
      regular(5, 48, -Math.PI / 2),
      regular(6, 46, 0),
      [{ x: -54, y: 30 }, { x: 54, y: 30 }, { x: 54, y: -30 }, { x: -54, y: -30 }],
      [{ x: -48, y: 26 }, { x: 48, y: 26 }, { x: 28, y: -30 }, { x: -28, y: -30 }]
    ];
    var master = r.pick(masters);
    var nPieces = r.int(3, 4);

    var baseSeedStr = 'AO_asm:' + seed + ':base';
    var base = carve(master, nPieces, rng.make(baseSeedStr), 0);

    // Pieces are laid out in a row, each rotated, so the student has to
    // mentally re-orient them rather than pattern-match the picture.
    function piecesPanel(pieces) {
      var slotW = 92, w = slotW * pieces.length + 16, h = 112;
      var body = '';
      pieces.forEach(function (p, i) {
        var ang = rng.make(baseSeedStr + ':rot' + i).next() * Math.PI * 2;
        var c = centroid(p);
        var moved = p.map(function (q) { return rot({ x: q.x - c.x, y: q.y - c.y }, ang); });
        var bb = bbox([moved]);
        var scale = Math.min(1, 74 / Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0));
        var off = { x: 8 + slotW * i + slotW / 2, y: h / 2 };
        body += '<path d="' + path(moved.map(function (q) { return add(mul(q, scale), off); })) + '"/>';
      });
      return wrap(w, h, body, pieces.length + ' separate pieces');
    }

    function assemblyPanel(carved) {
      var bb = bbox([master]);
      var off = { x: 112 - (bb.x0 + bb.x1) / 2, y: 62 - (bb.y0 + bb.y1) / 2 };
      var body = '<path d="' + path(master.map(function (p) { return add(p, off); })) + '"/>';
      carved.cuts.forEach(function (c) {
        body += '<line x1="' + (c[0].x + off.x).toFixed(1) + '" y1="' + (c[0].y + off.y).toFixed(1) +
          '" x2="' + (c[1].x + off.x).toFixed(1) + '" y2="' + (c[1].y + off.y).toFixed(1) + '"/>';
      });
      return wrap(224, 124, body, 'An assembled figure');
    }

    // Distractors: same outline, different internal cuts -> the pieces shown
    // cannot make them. Plus one with the wrong number of pieces.
    var d1 = carve(master, nPieces, rng.make('AO_asm:' + seed + ':d1'), 0.18);
    var d2 = carve(master, nPieces, rng.make('AO_asm:' + seed + ':d2'), -0.2);
    var d3 = carve(master, nPieces + 1, rng.make('AO_asm:' + seed + ':d3'), 0);

    return {
      kind: 'assembly',
      topic: 'shape_assembly',
      stemFigure: piecesPanel(base.pieces),
      stemText: 'Which figure can be made from exactly these ' + base.pieces.length + ' pieces, with no gaps, overlaps, or leftover pieces?',
      correct: { svg: assemblyPanel(base), correct: true, error: null },
      wrongs: [
        { svg: assemblyPanel(d1), correct: false, error: 'the internal edges sit at different angles — these piece shapes are not the ones supplied' },
        { svg: assemblyPanel(d2), correct: false, error: 'the dividing lines meet the outline at the wrong places, so at least one piece is the wrong size' },
        { svg: assemblyPanel(d3), correct: false, error: 'this figure is divided into ' + d3.pieces.length + ' pieces, but only ' + base.pieces.length + ' were supplied' }
      ],
      cue: 'Count the pieces first, then match the longest edge of the biggest piece to an edge of the finished figure. A wrong count rules a choice out instantly.',
      difficulty: 3
    };
  }

  // ---------- public ----------
  function render(seed, kind) {
    var r = rng.make('AO_pick:' + seed);
    var k = kind || (r.bool(0.5) ? 'connection' : 'assembly');
    var spec = k === 'connection' ? connectionItem(seed) : assemblyItem(seed);

    var slot = engine.correctSlot('AO_' + spec.kind, seed);
    var options = new Array(4);
    options[slot] = { text: '', svg: spec.correct.svg, isCorrect: true, error: null };
    var di = 0;
    for (var s = 0; s < 4; s++) {
      if (s === slot) continue;
      options[s] = { text: '', svg: spec.wrongs[di].svg, isCorrect: false, error: spec.wrongs[di].error };
      di++;
    }
    options.forEach(function (o, i) { o.key = LETTERS[i]; });

    return {
      uid: 'AO_' + spec.kind + ':' + seed,
      source: 'procedural',
      template_id: 'AO_' + spec.kind,
      seed: seed,
      subtest: 'AO',
      topic: spec.topic,
      difficulty: spec.difficulty,
      composites: [],
      stem: spec.stemText,
      figure: spec.stemFigure,
      options: options,
      correctKey: LETTERS[slot],
      correctIndex: slot,
      solution_steps: [
        spec.kind === 'connection'
          ? 'Locate point A on the first shape and point B on the second, noting which corner or edge each dot sits on.'
          : 'Count the pieces supplied, then look at the size and shape of the largest one.',
        spec.kind === 'connection'
          ? 'The shapes are rotated in the answer choices, so follow the dot round with the shape rather than judging by position on the page.'
          : 'Check the internal dividing lines: they have to meet the outline where the supplied piece edges would.',
        'Only one choice keeps every detail intact; the rest change a shape, a size, or a count.'
      ],
      recognition_cue: spec.cue,
      lesson: spec.kind === 'connection' ? 'ao_connection_problems' : 'ao_shape_assembly',
      target_seconds: 60
    };
  }

  return { render: render, SHAPES: SHAPES, carve: carve, slice: slice, area: area };
});
