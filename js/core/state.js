/* All user state, in localStorage. There is no server and nothing leaves the
   device, so the export/import path is the only backup that exists -- the UI
   says so plainly. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.ASVAB = root.ASVAB || {}; root.ASVAB.state = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'asvab.progress.v1';
  var SEEN_CAP = 6000;       // trimmed oldest-first; analytics never needs more

  function blank() {
    return {
      version: 1,
      created: new Date().toISOString(),
      settings: { catRules: false, theme: 'auto', scratchOpen: false },
      diagnostic: null,
      seen: [],
      attempts: [],
      queue: [],
      session: null
    };
  }

  var store = (function () {
    // A private window or blocked storage must not take the app down.
    try {
      var t = '__asvab_probe__';
      localStorage.setItem(t, '1'); localStorage.removeItem(t);
      return localStorage;
    } catch (e) {
      var mem = {};
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem: function (k, v) { mem[k] = String(v); },
        removeItem: function (k) { delete mem[k]; },
        _volatile: true
      };
    }
  })();

  var cache = null;

  function load() {
    if (cache) return cache;
    var raw = null;
    try { raw = store.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) { cache = blank(); return cache; }
    try {
      var parsed = JSON.parse(raw);
      cache = migrate(parsed);
    } catch (e) {
      cache = blank();
    }
    return cache;
  }

  function migrate(s) {
    var base = blank();
    Object.keys(base).forEach(function (k) { if (s[k] === undefined) s[k] = base[k]; });
    s.settings = Object.assign({}, base.settings, s.settings || {});
    return s;
  }

  function save() {
    if (!cache) return false;
    if (cache.seen.length > SEEN_CAP) cache.seen = cache.seen.slice(cache.seen.length - SEEN_CAP);
    try {
      store.setItem(KEY, JSON.stringify(cache));
      return true;
    } catch (e) {
      // Quota exceeded: drop the oldest half of `seen` and try once more,
      // rather than silently losing the whole session.
      try {
        cache.seen = cache.seen.slice(Math.floor(cache.seen.length / 2));
        store.setItem(KEY, JSON.stringify(cache));
        return true;
      } catch (e2) { return false; }
    }
  }

  function isVolatile() { return !!store._volatile; }

  // ---------------- seen table ----------------

  function recordSeen(entry) {
    var s = load();
    s.seen.push({
      t: entry.template_id, s: entry.seed, d: entry.date || new Date().toISOString(),
      c: entry.correct ? 1 : 0, f: entry.confidence || 'unsure',
      sec: Math.round(entry.seconds || 0), st: entry.subtest, tp: entry.topic, src: entry.source
    });
    save();
  }

  // Expanded view of the compact rows above.
  function seenList() {
    return load().seen.map(function (r) {
      return {
        template_id: r.t, seed: r.s, date: r.d, correct: !!r.c, confidence: r.f,
        seconds: r.sec, subtest: r.st, topic: r.tp, source: r.src
      };
    });
  }

  // Seeds already used for a template, so a new draw can avoid repeats.
  function seedsUsed(templateId) {
    var out = {};
    load().seen.forEach(function (r) { if (r.t === templateId) out[r.s] = true; });
    return out;
  }

  function timesSeen(templateId) {
    var n = 0;
    load().seen.forEach(function (r) { if (r.t === templateId) n++; });
    return n;
  }

  // ---------------- attempts ----------------

  function recordAttempt(attempt) {
    var s = load();
    attempt.id = attempt.id || ('att_' + Date.now().toString(36));
    attempt.date = attempt.date || new Date().toISOString();
    s.attempts.push(attempt);
    save();
    return attempt.id;
  }

  function attempts() { return load().attempts; }
  function attempt(id) {
    var list = load().attempts;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  // How many AFQT-relevant questions have ever been answered. Drives the
  // confidence band on the score report.
  function afqtSampleSize() {
    var n = 0;
    load().seen.forEach(function (r) {
      if (r.st === 'WK' || r.st === 'PC' || r.st === 'AR' || r.st === 'MK') n++;
    });
    return n;
  }

  // ---------------- spaced repetition ----------------

  var INTERVALS = [3, 7, 14];

  function scheduleReview(item, stage) {
    var s = load();
    stage = stage || 0;
    if (stage >= INTERVALS.length) return;
    var due = new Date();
    due.setDate(due.getDate() + INTERVALS[stage]);
    // One live entry per concept; a repeat miss restarts the ladder.
    s.queue = s.queue.filter(function (q) { return q.template_id !== item.template_id; });
    s.queue.push({
      template_id: item.template_id, subtest: item.subtest, topic: item.topic,
      source: item.source, passage_id: item.passage_id || null,
      due: due.toISOString(), stage: stage
    });
    save();
  }

  function advanceReview(templateId) {
    var s = load();
    var q = s.queue.filter(function (x) { return x.template_id === templateId; })[0];
    if (!q) return;
    s.queue = s.queue.filter(function (x) { return x.template_id !== templateId; });
    if (q.stage + 1 < INTERVALS.length) {
      var due = new Date();
      due.setDate(due.getDate() + INTERVALS[q.stage + 1]);
      q.due = due.toISOString(); q.stage = q.stage + 1;
      s.queue.push(q);
    }
    save();
  }

  function dueReviews(now) {
    var t = (now ? new Date(now) : new Date()).getTime();
    return load().queue.filter(function (q) { return new Date(q.due).getTime() <= t; });
  }

  function queueSize() { return load().queue.length; }

  // ---------------- in-progress session (autosave) ----------------

  function saveSession(session) { load().session = session; return save(); }
  function getSession() { return load().session; }
  function clearSession() { load().session = null; save(); }

  // ---------------- settings & diagnostic ----------------

  function settings() { return load().settings; }
  function setSetting(k, v) { load().settings[k] = v; save(); }
  function diagnostic() { return load().diagnostic; }
  function setDiagnostic(d) { load().diagnostic = d; save(); }

  // ---------------- portability ----------------

  function exportObject() {
    var s = load();
    return {
      format: 'asvab-practice-progress', version: 1,
      exported: new Date().toISOString(),
      data: { created: s.created, settings: s.settings, diagnostic: s.diagnostic, seen: s.seen, attempts: s.attempts, queue: s.queue }
    };
  }

  function exportJSON() { return JSON.stringify(exportObject(), null, 2); }

  // UTF-8 safe base64, so the sync string survives any characters in the data.
  function toB64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64(b64) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function syncString() {
    return 'ASVAB1:' + toB64(JSON.stringify(exportObject().data));
  }

  function importSyncString(text) {
    text = String(text).trim();
    if (text.indexOf('ASVAB1:') !== 0) throw new Error('That does not look like a sync string (it should start with ASVAB1:).');
    var obj = JSON.parse(fromB64(text.slice(7)));
    return importData(obj, 'merge');
  }

  function importJSON(text, mode) {
    var parsed = JSON.parse(text);
    var payload = parsed.data || parsed;
    if (!payload || !Array.isArray(payload.seen)) throw new Error('This file does not contain a progress export.');
    return importData(payload, mode || 'merge');
  }

  /* Merge is the safe default: attempts are keyed by id and seen rows by
     template+seed+date, so importing the same file twice changes nothing. */
  function importData(payload, mode) {
    var s = load();
    if (mode === 'replace') {
      s.seen = []; s.attempts = []; s.queue = [];
    }
    var before = { seen: s.seen.length, attempts: s.attempts.length };

    var haveAttempt = {};
    s.attempts.forEach(function (a) { haveAttempt[a.id] = true; });
    (payload.attempts || []).forEach(function (a) {
      if (a && a.id && !haveAttempt[a.id]) { s.attempts.push(a); haveAttempt[a.id] = true; }
    });

    var haveSeen = {};
    s.seen.forEach(function (r) { haveSeen[r.t + '|' + r.s + '|' + r.d] = true; });
    (payload.seen || []).forEach(function (r) {
      var k = r.t + '|' + r.s + '|' + r.d;
      if (!haveSeen[k]) { s.seen.push(r); haveSeen[k] = true; }
    });

    var haveQ = {};
    s.queue.forEach(function (q) { haveQ[q.template_id] = true; });
    (payload.queue || []).forEach(function (q) {
      if (q && q.template_id && !haveQ[q.template_id]) { s.queue.push(q); haveQ[q.template_id] = true; }
    });

    if (payload.diagnostic && !s.diagnostic) s.diagnostic = payload.diagnostic;
    s.attempts.sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
    s.seen.sort(function (a, b) { return new Date(a.d) - new Date(b.d); });
    save();
    return { addedSeen: s.seen.length - before.seen, addedAttempts: s.attempts.length - before.attempts };
  }

  function reset() { cache = blank(); save(); }

  return {
    load: load, save: save, reset: reset, isVolatile: isVolatile,
    recordSeen: recordSeen, seenList: seenList, seedsUsed: seedsUsed, timesSeen: timesSeen,
    recordAttempt: recordAttempt, attempts: attempts, attempt: attempt, afqtSampleSize: afqtSampleSize,
    scheduleReview: scheduleReview, advanceReview: advanceReview, dueReviews: dueReviews, queueSize: queueSize,
    saveSession: saveSession, getSession: getSession, clearSession: clearSession,
    settings: settings, setSetting: setSetting, diagnostic: diagnostic, setDiagnostic: setDiagnostic,
    exportJSON: exportJSON, exportObject: exportObject, syncString: syncString,
    importJSON: importJSON, importSyncString: importSyncString,
    INTERVALS: INTERVALS
  };
});
