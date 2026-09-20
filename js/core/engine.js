/* Template engine: (template, seed) -> a fully rendered, self-consistent item.
   Every option recomputes from the sampled parameters; nothing is pre-baked. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./rng.js'), require('./expr.js'), require('./figures.js'));
  } else {
    root.ASVAB = root.ASVAB || {};
    root.ASVAB.engine = factory(root.ASVAB.rng, root.ASVAB.expr, root.ASVAB.figures);
  }
})(typeof self !== 'undefined' ? self : this, function (rng, expr, figures) {
  'use strict';

  var MAX_ATTEMPTS = 300;
  var LETTERS = ['A', 'B', 'C', 'D'];

  // ---------- number formatting ----------

  function group(intPart) {
    return String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fixed(v, places) {
    var s = Math.abs(v).toFixed(places);
    var parts = s.split('.');
    var out = group(parts[0]) + (parts[1] ? '.' + parts[1] : '');
    // U+2212 MINUS SIGN, so "-8" matches the "\u2212" used in stems
    return (v < 0 ? '\u2212' : '') + out;
  }

  var FORMATTERS = {
    int: function (v) { return fixed(v, 0); },
    decimal1: function (v) { return fixed(v, 1); },
    decimal2: function (v) { return fixed(v, 2); },
    money: function (v) {
      var neg = v < 0, a = Math.abs(v);
      // whole dollars stay whole; cents always show two places
      var s = (Math.abs(a - Math.round(a)) < 1e-9) ? '$' + fixed(a, 0) : '$' + fixed(a, 2);
      return (neg ? '\u2212' : '') + s;
    },
    percent: function (v) {
      var s = (Math.abs(v - Math.round(v)) < 1e-9) ? fixed(v, 0) : fixed(v, 1);
      return s + '%';
    },
    text: function (v) { return String(v); }
  };

  // How many decimal places a format is allowed to carry. Anything dirtier
  // than this means the parameter set produced an unclean answer -> resample.
  var CLEAN_PLACES = { int: 0, decimal1: 1, decimal2: 2, money: 2, percent: 1 };

  // Templates may bound the plausible answer space (a probability can never
  // exceed 100%), so a distractor formula that strays outside it is dropped
  // rather than offered as an obviously impossible option.
  function inRange(v, tpl) {
    if (!tpl.option_range) return true;
    var lo = tpl.option_range[0], hi = tpl.option_range[1];
    if (lo !== null && lo !== undefined && v < lo) return false;
    if (hi !== null && hi !== undefined && v > hi) return false;
    return true;
  }

  function isClean(v, format) {
    if (typeof v !== 'number' || !isFinite(v)) return false;
    if (Math.abs(v) >= 1e9) return false;
    var places = CLEAN_PLACES[format];
    if (places === undefined) return true;
    var scaled = v * Math.pow(10, places);
    return Math.abs(scaled - Math.round(scaled)) < 1e-6;
  }

  // ---------- string interpolation ----------

  // Neutral rendering for numbers interpolated into prose: grouped integer, or
  // up to two decimals with trailing zeros trimmed. The template's `format`
  // describes the ANSWER, not every number in the stem, so a money template
  // must not print "{years}" as "$6".
  function neutral(v) {
    if (Math.abs(v - Math.round(v)) < 1e-9) return fixed(Math.round(v), 0);
    var s2 = fixed(v, 2);
    return s2.replace(/\.?0+$/, '');
  }

  // "{speed} mph" -> scope lookup; "{=speed*hours}" -> inline computation.
  // "{{" and "}}" are literal braces, so prose like "{{distance, rate, time}}"
  // survives interpolation untouched.
  function interpolate(text, scope, format) {
    if (text === undefined || text === null) return '';
    return String(text).replace(/\{\{|\}\}|\{([^{}]+)\}/g, function (whole, body) {
      if (whole === '{{') return '\u0001';
      if (whole === '}}') return '\u0002';
      body = body.trim();
      if (body.charAt(0) === '=') {
        var spec = body.slice(1);
        var fmt = null;
        var bar = spec.lastIndexOf('|');
        if (bar > 0) { fmt = spec.slice(bar + 1).trim(); spec = spec.slice(0, bar); }
        var val = expr.evaluate(spec, scope);
        return fmt ? (FORMATTERS[fmt] || FORMATTERS.int)(val) : neutral(val);
      }
      // {~name} -> "a truck" / "an airport shuttle"; {^name} -> capitalised
      var mod = body.charAt(0);
      if (mod === '~' || mod === '^') {
        var nm = body.slice(1).trim();
        if (!Object.prototype.hasOwnProperty.call(scope, nm)) {
          throw new Error('interpolation: unknown name "' + nm + '"');
        }
        var word = String(scope[nm]);
        if (mod === '^') return word.charAt(0).toUpperCase() + word.slice(1);
        return (/^[aeiou]/i.test(word) ? 'an ' : 'a ') + word;
      }
      if (Object.prototype.hasOwnProperty.call(scope, body)) {
        var raw = scope[body];
        if (typeof raw === 'number') return neutral(raw);
        return String(raw);
      }
      throw new Error('interpolation: unknown name "' + body + '"');
    }).replace(/\u0001/g, '{').replace(/\u0002/g, '}');
  }

  // ---------- parameter sampling ----------

  function sampleOne(spec, r) {
    if (Array.isArray(spec)) return r.pick(spec);
    if (spec && typeof spec === 'object') {
      if (Array.isArray(spec.choices)) return r.pick(spec.choices);
      var step = spec.step || 1;
      return r.step(spec.min, spec.max, step);
    }
    return spec; // literal constant
  }

  function sampleScope(tpl, r) {
    var scope = {};
    // skins bundle co-ordinated context words so the surface story stays coherent
    if (tpl.skins && tpl.skins.length) {
      var skin = r.pick(tpl.skins);
      for (var sk in skin) if (Object.prototype.hasOwnProperty.call(skin, sk)) scope[sk] = skin[sk];
    }
    var keys = Object.keys(tpl.params || {});
    for (var i = 0; i < keys.length; i++) scope[keys[i]] = sampleOne(tpl.params[keys[i]], r);
    // derived values are computed in declaration order and may use earlier ones
    if (tpl.derived) {
      var dkeys = Object.keys(tpl.derived);
      for (var j = 0; j < dkeys.length; j++) scope[dkeys[j]] = expr.evaluate(tpl.derived[dkeys[j]], scope);
    }
    return scope;
  }

  function constraintsHold(tpl, scope) {
    var list = tpl.constraints || [];
    for (var i = 0; i < list.length; i++) {
      if (!expr.evaluate(list[i], scope)) return false;
    }
    return true;
  }

  // ---------- option construction ----------

  function optionValue(opt, scope, format) {
    if (opt && typeof opt === 'object' && typeof opt.text === 'string') {
      return { value: null, display: interpolate(opt.text, scope, format), error: opt.error };
    }
    var src = (opt && typeof opt === 'object') ? opt.expr : opt;
    var v = expr.evaluate(src, scope);
    return { value: v, display: null, error: opt && opt.error };
  }

  function decorate(display, tpl) {
    if (tpl.unit) return display + ' ' + tpl.unit;
    return display;
  }

  function lengthsBalanced(displays) {
    var lens = displays.map(function (d) { return d.length; });
    var min = Math.min.apply(null, lens), max = Math.max.apply(null, lens);
    if (max <= 12) return true;                 // short numeric options: nothing to give away
    if (max - min > 14) return false;
    return max <= min * 2.0;
  }

  // The correct answer's slot comes from a hash of (id, seed) rather than a
  // draw, so the letter distribution is uniform by construction across a bank.
  function correctSlot(templateId, seed) {
    return rng.hashString(templateId + '#' + seed + '#slot') % 4;
  }

  // ---------- main ----------

  function renderTemplate(tpl, seed, opts) {
    opts = opts || {};
    var format = tpl.format || 'int';
    var lastError = null;

    for (var attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      var r = rng.make(tpl.id + ':' + seed + ':' + attempt);
      var scope;
      try {
        scope = sampleScope(tpl, r);
        if (!constraintsHold(tpl, scope)) continue;
      } catch (e) { lastError = e; continue; }

      try {
        var ans = optionValue(tpl.answer_text ? { text: tpl.answer_text } : tpl.answer, scope, format);
        if (ans.display === null) {
          if (!isClean(ans.value, format)) { lastError = new Error('unclean answer'); continue; }
          if (ans.value < 0 && !tpl.allow_negative) { lastError = new Error('negative answer'); continue; }
          if (!inRange(ans.value, tpl)) { lastError = new Error('answer outside option_range'); continue; }
          ans.display = FORMATTERS[format](ans.value);
        }
        scope.answer = ans.value !== null ? ans.value : ans.display;

        var pool = [], seen = {};
        seen[ans.display] = true;
        var rawDistractors = tpl.distractors || [];
        // shuffle the pool so templates may over-supply distractors and still
        // vary which three a student sees
        var order = r.shuffle(rawDistractors.map(function (_, i) { return i; }));
        for (var k = 0; k < order.length; k++) {
          var d = rawDistractors[order[k]];
          var dv;
          try { dv = optionValue(d, scope, format); } catch (e) { continue; }
          if (dv.display === null) {
            if (!isClean(dv.value, format)) continue;
            if (dv.value < 0 && !tpl.allow_negative) continue;
            if (!inRange(dv.value, tpl)) continue;
            dv.display = FORMATTERS[format](dv.value);
          }
          if (seen[dv.display]) continue;       // no duplicate of answer or each other
          seen[dv.display] = true;
          pool.push(dv);
          if (pool.length === 3) break;
        }
        if (pool.length < 3) { lastError = new Error('could not build 3 distinct distractors'); continue; }

        var displays = [ans.display].concat(pool.map(function (p) { return p.display; })).map(function (d) {
          return decorate(d, tpl);
        });
        if (!lengthsBalanced(displays)) { lastError = new Error('option lengths unbalanced'); continue; }

        // place the correct answer, fill the rest in shuffled order
        var slot = correctSlot(tpl.id, seed);
        var options = new Array(4);
        options[slot] = { text: displays[0], isCorrect: true, error: null };
        var di = 0;
        for (var s = 0; s < 4; s++) {
          if (s === slot) continue;
          options[s] = { text: displays[di + 1], isCorrect: false, error: pool[di].error || null };
          di++;
        }
        options.forEach(function (o, i) { o.key = LETTERS[i]; });

        var steps = (tpl.solution_steps || []).map(function (st) { return interpolate(st, scope, format); });

        var fig = null;
        if (tpl.figure && figures) {
          try { fig = figures.render(tpl.figure, scope, expr); } catch (e) { fig = null; }
        }

        return {
          uid: tpl.id + ':' + seed,
          source: 'template',
          template_id: tpl.id,
          seed: seed,
          subtest: tpl.subtest,
          topic: tpl.topic,
          difficulty: tpl.difficulty,
          composites: tpl.composites || [],
          stem: interpolate(tpl.stem, scope, format),
          figure: fig,
          options: options,
          correctKey: LETTERS[slot],
          correctIndex: slot,
          solution_steps: steps,
          recognition_cue: interpolate(tpl.recognition_cue || '', scope, format),
          lesson: tpl.lesson || null,
          target_seconds: tpl.target_seconds || 45,
          scope: opts.keepScope ? scope : undefined
        };
      } catch (e) { lastError = e; continue; }
    }
    throw new Error('template "' + tpl.id + '" seed ' + seed + ': no valid render in ' +
      MAX_ATTEMPTS + ' attempts' + (lastError ? ' (last: ' + lastError.message + ')' : ''));
  }

  return {
    renderTemplate: renderTemplate,
    interpolate: interpolate,
    isClean: isClean,
    inRange: inRange,
    lengthsBalanced: lengthsBalanced,
    correctSlot: correctSlot,
    FORMATTERS: FORMATTERS,
    LETTERS: LETTERS
  };
});
