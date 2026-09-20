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
    escapeHtml: escapeHtml, richText: richText,
    fmtClock: fmtClock, fmtDuration: fmtDuration, fmtDate: fmtDate, pct: pct,
    toast: toast, accuracyColor: accuracyColor
  };
})(typeof self !== 'undefined' ? self : this);
