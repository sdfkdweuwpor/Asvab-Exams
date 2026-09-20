/* Procedural SVG diagrams for MC/EI items.
   Everything is stroked in currentColor so figures theme with the page. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.ASVAB = root.ASVAB || {}; root.ASVAB.figures = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function svg(w, h, body, title) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(title || 'diagram') +
      '" class="fig" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }
  function txt(x, y, s, anchor, size) {
    return '<text x="' + x + '" y="' + y + '" text-anchor="' + (anchor || 'middle') +
      '" font-size="' + (size || 13) + '" stroke="none" fill="currentColor">' + esc(s) + '</text>';
  }

  var KINDS = {
    // Class-1 lever: fulcrum between effort and load.
    lever: function (a) {
      var total = 300, f = 60 + (total - 120) * (a.d1 / (a.d1 + a.d2));
      var b = '<line x1="40" y1="70" x2="340" y2="70"/>' +
        '<polygon points="' + f + ',74 ' + (f - 16) + ',104 ' + (f + 16) + ',104" fill="currentColor" stroke="none"/>' +
        '<line x1="70" y1="70" x2="70" y2="36"/><polygon points="70,30 64,44 76,44" fill="currentColor" stroke="none"/>' +
        '<rect x="300" y="38" width="32" height="30"/>' +
        '<line x1="70" y1="118" x2="' + f + '" y2="118"/>' +
        '<line x1="' + f + '" y1="118" x2="330" y2="118"/>' +
        txt((70 + f) / 2, 134, a.left_label || (a.d1 + ' ' + (a.unit || 'ft'))) +
        txt((f + 330) / 2, 134, a.right_label || (a.d2 + ' ' + (a.unit || 'ft'))) +
        txt(70, 24, a.effort_label || 'Effort') +
        txt(316, 30, a.load_label || 'Load');
      return svg(380, 148, b, 'Lever with fulcrum between effort and load');
    },
    // n supporting rope segments on a block-and-tackle.
    pulley: function (a) {
      var n = Math.max(1, Math.min(6, Math.round(a.strands || 2)));
      var b = '<line x1="30" y1="20" x2="330" y2="20"/>';
      for (var i = 0; i < n; i++) {
        var x = 80 + i * (200 / Math.max(1, n - 1 || 1));
        if (n === 1) x = 180;
        b += '<circle cx="' + x + '" cy="40" r="14"/>';
        b += '<line x1="' + x + '" y1="54" x2="' + x + '" y2="120"/>';
      }
      b += '<rect x="140" y="120" width="80" height="44"/>' + txt(180, 148, a.load_label || 'Load');
      b += '<line x1="330" y1="20" x2="330" y2="90"/>' + txt(330, 108, a.effort_label || 'Effort');
      b += txt(180, 184, n + ' supporting strand' + (n === 1 ? '' : 's'), 'middle', 12);
      return svg(380, 196, b, 'Pulley system with ' + n + ' supporting strands');
    },
    // Two meshed gears, teeth counts labelled.
    gears: function (a) {
      var r1 = 44, r2 = 44 * Math.max(0.5, Math.min(2.2, (a.teeth2 || 20) / (a.teeth1 || 20)));
      var cx1 = 90, cx2 = cx1 + r1 + r2 + 4, cy = 90;
      function gear(cx, r, teeth) {
        var out = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(1) + '"/>' +
          '<circle cx="' + cx + '" cy="' + cy + '" r="6"/>';
        var t = Math.max(6, Math.min(24, Math.round(teeth / 2)));
        for (var i = 0; i < t; i++) {
          var ang = (i / t) * Math.PI * 2;
          out += '<line x1="' + (cx + Math.cos(ang) * r).toFixed(1) + '" y1="' + (cy + Math.sin(ang) * r).toFixed(1) +
            '" x2="' + (cx + Math.cos(ang) * (r + 7)).toFixed(1) + '" y2="' + (cy + Math.sin(ang) * (r + 7)).toFixed(1) + '"/>';
        }
        return out;
      }
      var b = gear(cx1, r1, a.teeth1) + gear(cx2, r2, a.teeth2) +
        txt(cx1, cy + r1 + 26, (a.label1 || 'Drive') + ': ' + a.teeth1 + 'T') +
        txt(cx2, cy + r2 + 26, (a.label2 || 'Driven') + ': ' + a.teeth2 + 'T');
      return svg(cx2 + r2 + 24, cy + Math.max(r1, r2) + 40, b, 'Two meshed gears');
    },
    // Resistors in series across a battery.
    series_circuit: function (a) {
      var vals = a.values || [], n = vals.length;
      var w = 380, b = '<rect x="40" y="40" width="300" height="110" rx="4"/>';
      b += '<line x1="34" y1="80" x2="34" y2="110" stroke-width="4"/><line x1="46" y1="88" x2="46" y2="102" stroke-width="4"/>';
      b = '<path d="M40 95 L40 40 L340 40 L340 150 L40 150 L40 105"/>';
      b += '<line x1="30" y1="95" x2="50" y2="95"/><line x1="34" y1="102" x2="46" y2="102"/>';
      b += txt(14, 100, (a.volts || '') + 'V', 'start', 12);
      for (var i = 0; i < n; i++) {
        var x = 90 + i * (220 / Math.max(1, n));
        b += '<rect x="' + x + '" y="30" width="46" height="20"/>' + txt(x + 23, 22, vals[i] + 'Ω', 'middle', 12);
      }
      return svg(w, 172, b, 'Series circuit');
    },
    // Resistors on parallel branches across a battery.
    parallel_circuit: function (a) {
      var vals = a.values || [], n = vals.length;
      var b = '<path d="M40 95 L40 40 L320 40"/><path d="M40 105 L40 170 L320 170"/>';
      b += '<line x1="30" y1="95" x2="50" y2="95"/><line x1="34" y1="102" x2="46" y2="102"/>';
      b += txt(14, 100, (a.volts || '') + 'V', 'start', 12);
      for (var i = 0; i < n; i++) {
        var x = 110 + i * (200 / Math.max(1, n));
        b += '<line x1="' + x + '" y1="40" x2="' + x + '" y2="85"/>';
        b += '<rect x="' + (x - 14) + '" y="85" width="28" height="40"/>';
        b += '<line x1="' + x + '" y1="125" x2="' + x + '" y2="170"/>';
        b += txt(x + 24, 110, vals[i] + 'Ω', 'start', 12);
      }
      b += '<line x1="320" y1="40" x2="320" y2="170"/>';
      return svg(380, 192, b, 'Parallel circuit');
    },
    // Ramp of given rise and run.
    incline: function (a) {
      var run = 260, rise = Math.max(40, Math.min(120, 260 * (a.rise / Math.max(1, a.run))));
      var b = '<path d="M40 ' + (30 + rise) + ' L' + (40 + run) + ' ' + (30 + rise) + ' L40 30 Z"/>' +
        '<rect x="70" y="' + (rise - 4) + '" width="26" height="22" transform="rotate(' +
        (-Math.atan2(rise, run) * 180 / Math.PI).toFixed(1) + ' 83 ' + (rise + 7) + ')"/>' +
        txt(40 + run / 2, 30 + rise + 20, (a.run) + ' ' + (a.unit || 'ft') + ' run') +
        txt(26, 30 + rise / 2, (a.rise) + ' ' + (a.unit || 'ft'), 'end');
      return svg(40 + run + 20, 30 + rise + 34, b, 'Inclined plane');
    },
    // Two-piston hydraulic press.
    hydraulic: function (a) {
      var b = '<path d="M40 70 L40 130 L340 130 L340 70"/>' +
        '<rect x="40" y="46" width="70" height="24"/><rect x="250" y="30" width="90" height="40"/>' +
        '<line x1="75" y1="46" x2="75" y2="22"/><line x1="295" y1="30" x2="295" y2="10"/>' +
        txt(75, 152, (a.a1 || '') + ' ' + (a.unit || 'in²')) +
        txt(295, 152, (a.a2 || '') + ' ' + (a.unit || 'in²')) +
        txt(75, 14, a.left_label || 'Force in') + txt(295, 8, a.right_label || 'Force out');
      return svg(380, 164, b, 'Hydraulic press with two pistons');
    },
    // Coil spring with a hanging load.
    spring: function (a) {
      var coils = 7, top = 24, d = 0, path = 'M180 ' + top;
      for (var i = 0; i < coils; i++) {
        d = top + 12 + i * 14;
        path += ' L' + (i % 2 ? 210 : 150) + ' ' + d;
      }
      path += ' L180 ' + (d + 12);
      var b = '<line x1="120" y1="' + top + '" x2="240" y2="' + top + '"/><path d="' + path + '"/>' +
        '<rect x="150" y="' + (d + 12) + '" width="60" height="34"/>' +
        txt(180, d + 34, (a.load || '') + (a.unit || ' lb'), 'middle', 12) +
        txt(280, d / 2, 'k = ' + (a.k || '') + (a.k_unit || ' lb/in'), 'middle', 12);
      return svg(360, d + 62, b, 'Coil spring with hanging load');
    }
  };

  // figure spec: {kind, args:{name: "<expression or literal>"}}
  // numeric args are expressions evaluated in the item's scope; strings starting
  // with "'" are literals; arrays map element-wise.
  function resolveArg(v, scope, expr) {
    if (Array.isArray(v)) return v.map(function (x) { return resolveArg(x, scope, expr); });
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      if (v.charAt(0) === "'") return v.slice(1);
      try { return expr.evaluate(v, scope); } catch (e) { return v; }
    }
    return v;
  }

  function render(spec, scope, expr) {
    var fn = KINDS[spec.kind];
    if (!fn) throw new Error('unknown figure kind "' + spec.kind + '"');
    var args = {};
    var src = spec.args || {};
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) args[k] = resolveArg(src[k], scope, expr);
    return fn(args);
  }

  return { render: render, kinds: Object.keys(KINDS), esc: esc, svg: svg, txt: txt };
});
