/* Small DOM helpers. No framework, no virtual DOM -- every view builds its
   nodes and hands them back to the router. */
(function (root) {
  'use strict';
  var A = root.ASVAB = root.ASVAB || {};

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    // Allow el(tag, children) as well as el(tag, attrs, children): anything
    // that is not a plain attribute object is taken as children.
    if (attrs !== null && attrs !== undefined &&
        (typeof attrs !== 'object' || Array.isArray(attrs) || attrs instanceof Node)) {
      children = attrs;
      attrs = null;
    }
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'html') n.innerHTML = v;      // only for generated SVG
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (v === true) n.setAttribute(k, '');
        else n.setAttribute(k, v);
      });
    }
    append(n, children);
    return n;
  }

  function append(parent, children) {
    if (children === null || children === undefined) return parent;
    if (Array.isArray(children)) { children.forEach(function (c) { append(parent, c); }); return parent; }
    parent.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
    return parent;
  }

  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Bank stems may contain <b> for the word under test, and nothing else.
  function richText(s) {
    var safe = escapeHtml(s).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
    return safe.replace(/\n/g, '<br>');
  }

  /* The source PDF renders no superscript glyph anywhere, so "x cubed" arrives
     as "x3" and "(x squared) cubed" as "(x2)3". Where the question is
     unusable as printed -- "xx" is x-squared and x-cubed alike -- extraction
     excludes it. This case is different: a variable cannot be followed by a
     literal digit in standard notation, because a coefficient is written in
     front (3x, never x3), so the digit can only be an exponent and the
     original is recoverable exactly.

     Applied at render time rather than baked into the bank, so data/questions
     .json stays faithful to the source and this stays reviewable.

     Maths subtests ONLY. In chemistry the same shape is a subscript -- H2O is
     not H squared -- which is why this is not in richText. */
  function mathText(s, opts) {
    var safe = escapeHtml(s).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
    safe = safe
      .replace(/([a-zA-Z])(\d{1,2})\b/g, '$1<sup>$2</sup>')   // x3  -> x³
      .replace(/\)(\d{1,2})\b/g, ')<sup>$1</sup>');           // (x2)3 -> (x²)³
    safe = mixedFractions(safe, opts);
    /* Pi vanished too, leaving "Use 22/7 for the value of ." -- a sentence that
       stops before its subject. Restored only in that exact shape, where the
       missing symbol is named by the 22/7 beside it and cannot be anything
       else. Items whose options lost their pi are not repairable this way and
       are excluded at extraction instead. */
    safe = safe.replace(/(value of)\s*([.,])/gi, '$1 \u03c0$2');
    return safe.replace(/\n/g, '<br>');
  }

  /* The source also lost the space inside mixed numbers, so twelve and a half
     per cent prints as "121/2%", which reads as a hundred and twenty-one
     halves. Restoring the space is not as safe as restoring an exponent,
     because "13/16" is thirteen sixteenths in one question and one and three
     sixteenths in another, so two guards apply.

     First, only common mixed denominators with a proper numerator are touched,
     which protects 22/7 for pi, 205/55 on a tyre, and 25/36 as a probability.
     Second, an item whose options are ALL bare fractions is a question about
     fractions -- "which of these is largest?" -- where every value is meant as
     written, so nothing in it is split at all. */
  var BARE_FRACTION = /^\s*\d+\s*\/\s*\d+\s*$/;
  var SAFE_DEN = { 2: 1, 3: 1, 4: 1, 8: 1, 16: 1 };

  function allOptionsAreBareFractions(opts) {
    if (!opts || opts.length < 2) return false;
    for (var i = 0; i < opts.length; i++) {
      if (!BARE_FRACTION.test(String(opts[i].text === undefined ? opts[i] : opts[i].text))) return false;
    }
    return true;
  }

  function mixedFractions(text, opts) {
    if (allOptionsAreBareFractions(opts)) return text;
    return text.replace(/\b(\d+)(\d)\/(\d+)\b/g, function (whole, lead, num, den) {
      var n = parseInt(num, 10), d = parseInt(den, 10);
      if (!SAFE_DEN[d] || n >= d) return whole;
      return lead + '\u2009' + num + '/' + den;     // thin space, not a full one
    });
  }

  function fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = (h ? String(m).padStart(2, '0') : String(m));
    return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
  }

  function fmtDuration(sec) {
    sec = Math.round(sec);
    if (sec < 60) return sec + 's';
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return m + 'm' + (s ? ' ' + s + 's' : '');
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function pct(x) { return Math.round((x || 0) * 100) + '%'; }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2600);
  }

  /* Colour for an accuracy bar. Two rules, and the second matters as much as
     the first: colour follows the Wilson lower bound rather than raw accuracy,
     so a single miss is not painted as a weakness -- and when the sample is too
     small to judge at all, the bar goes neutral rather than red. Otherwise a
     row reading "1 of 1, 100%" would be drawn in alarm colours, which is both
     confusing and the opposite of what the number says. */
  function accuracyColor(lower, level) {
    if (level === 'low') return 'var(--ink-soft)';
    if (lower >= 0.7) return 'var(--good)';
    if (lower >= 0.45) return 'var(--accent)';
    if (lower >= 0.25) return 'var(--warn)';
    return 'var(--bad)';
  }

  A.dom = {
    el: el, append: append, clear: clear, $: $, $$: $$,
    escapeHtml: escapeHtml, richText: richText, mathText: mathText,
    mixedFractions: mixedFractions,
    fmtClock: fmtClock, fmtDuration: fmtDuration, fmtDate: fmtDate, pct: pct,
    toast: toast, accuracyColor: accuracyColor
  };
})(typeof self !== 'undefined' ? self : this);
