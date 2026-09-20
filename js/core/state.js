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
  var VERSION = 2;           // 2: content moved from generated items to the fixed bank

  function blank() {
    return {
      version: VERSION,
      created: new Date().toISOString(),
      settings: { catRules: false, theme: 'auto', scratchOpen: false },
      diagnostic: null,
      seen: [],
      attempts: [],
      queue: [],
      session: null,
      notices: []
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

  /* v1 -> v2. The question bank changed from generated items keyed by
     (template_id, seed) to fixed items keyed by bank id, and the two id spaces
     do not overlap. Nothing is deleted:

     - `seen` rows are kept exactly as they are. Every row carries its own
       subtest and topic, so heatmaps, weak spots, timing and the AFQT sample
       size all still compute over the full history.
     - Past attempts keep their scores, which were frozen at the time. They are
       marked contentGeneration 1 so the review screen can say the question text
       is no longer available instead of rendering an empty list.
     - Queued reviews name items that no longer exist. They are dropped, but a
       notice records how many, because silently emptying someone's review queue
       is exactly the kind of thing the app should not do. */
  function migrate(s) {
    var base = blank();
    Object.keys(base).forEach(function (k) { if (s[k] === undefined) s[k] = base[k]; });
    s.settings = Object.assign({}, base.settings, s.settings || {});

    if ((s.version || 1) < 2) {
      var staleQueue = 0;
      s.queue = (s.queue || []).filter(function (q) {
        var live = q.source === 'pdf' || /^[A-Z]{2}-\d{4}$/.test(String(q.template_id || ''));
        if (!live) staleQueue++;
        return live;
      });

      var oldAttempts = 0;
      (s.attempts || []).forEach(function (a) {
        if (a.contentGeneration === undefined) {
          var fromBank = (a.per_item_results || []).some(function (r) {
            return r.source === 'pdf';
          });
          a.contentGeneration = fromBank ? 2 : 1;
          if (a.contentGeneration === 1) oldAttempts++;
        }
      });

      // An in-flight session cannot survive: its refs name generated items.
      var hadSession = !!s.session;
      if (hadSession) s.session = null;

      if (staleQueue || oldAttempts || hadSession) {
        s.notices = (s.notices || []).concat([{
          id: 'migrate-v2', date: new Date().toISOString(),
          text: 'The question bank was replaced with real exam-style questions. ' +
                'Your ' + (s.seen || []).length + ' answered questions and ' +
                (s.attempts || []).length + ' attempts are all kept. ' +
                (oldAttempts ? oldAttempts + ' earlier attempt(s) keep their scores but ' +
                  'can no longer show the question text. ' : '') +
                (staleQueue ? staleQueue + ' review-queue item(s) were retired. ' : '') +
                (hadSession ? 'A test that was in progress could not be carried over.' : '')
        }]);
      }
      s.version = 2;
    }
    return s;
  }

  function notices() { return load().notices || []; }
  function dismissNotice(id) {
    var s = load();
    s.notices = (s.notices || []).filter(function (n) { return n.id !== id; });
    save();
  }

  function save() {
    if (!cache) return false;
    medianCache = null;
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

  /* Median answering time per subtest, over answers that were actually worked.
     Cached per load, because the selection pass asks for it once per candidate. */
  var medianCache = null;
  function medianSeconds(code) {
    if (!medianCache) {
      medianCache = {};
      var bySub = {};
      load().seen.forEach(function (r) {
        if (!r.st || !r.sec) return;
        (bySub[r.st] = bySub[r.st] || []).push(r.sec);
      });
      Object.keys(bySub).forEach(function (k) {
        var a = bySub[k].sort(function (x, y) { return x - y; });
        medianCache[k] = a[Math.floor(a.length / 2)];
      });
    }
    return medianCache[code] || null;
  }

  /* A fixed bank means a question can be recognised rather than solved.
     Answered right, three or more times, in under 40% of the student's own
     median for that subtest is the signal. It deprioritises an item in exam
     draws; it never removes it, because the pool is too small to discard from. */
  function isLikelyMemorized(templateId) {
    var rows = load().seen.filter(function (r) { return r.t === templateId; });
    if (rows.length < 3) return false;
    var code = rows[rows.length - 1].st;
    var med = medianSeconds(code);
    if (!med) return false;
    var fast = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].c && rows[i].sec && rows[i].sec < med * 0.4) fast++;
    }
    return fast >= 2;
  }

  function memorizedCount(ids) {
    var n = 0;
    (ids || []).forEach(function (id) { if (isLikelyMemorized(id)) n++; });
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
      format: 'asvab-practice-progress', version: VERSION,
      exported: new Date().toISOString(),
      data: { created: s.created, settings: s.settings, diagnostic: s.diagnostic,
              seen: s.seen, attempts: s.attempts, queue: s.queue, version: s.version }
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

    /* Settings travel with the history, since a target AFQT and a credential
       are part of what the student set up rather than incidental state. Local
       values win, so importing a backup never silently changes the settings on
       the device doing the importing. */
    if (payload.settings) {
      var base = blank().settings;
      Object.keys(payload.settings).forEach(function (k) {
        var isDefault = s.settings[k] === undefined ||
          JSON.stringify(s.settings[k]) === JSON.stringify(base[k]);
        if (isDefault && payload.settings[k] !== undefined) s.settings[k] = payload.settings[k];
      });
    }
    s.attempts.sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
    s.seen.sort(function (a, b) { return new Date(a.d) - new Date(b.d); });
    save();
    return { addedSeen: s.seen.length - before.seen, addedAttempts: s.attempts.length - before.attempts };
  }

  function reset() { cache = blank(); save(); }

  return {
    load: load, save: save, reset: reset, isVolatile: isVolatile,
    recordSeen: recordSeen, seenList: seenList, seedsUsed: seedsUsed, timesSeen: timesSeen,
    isLikelyMemorized: isLikelyMemorized, memorizedCount: memorizedCount,
    medianSeconds: medianSeconds, notices: notices, dismissNotice: dismissNotice,
    VERSION: VERSION,
    recordAttempt: recordAttempt, attempts: attempts, attempt: attempt, afqtSampleSize: afqtSampleSize,
    scheduleReview: scheduleReview, advanceReview: advanceReview, dueReviews: dueReviews, queueSize: queueSize,
    saveSession: saveSession, getSession: getSession, clearSession: clearSession,
    settings: settings, setSetting: setSetting, diagnostic: diagnostic, setDiagnostic: setDiagnostic,
    exportJSON: exportJSON, exportObject: exportObject, syncString: syncString,
    importJSON: importJSON, importSyncString: importSyncString,
    INTERVALS: INTERVALS
  };
});
