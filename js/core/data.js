/* Single access point for all content. In the browser the bundle has already
   been loaded by a <script> tag; under Node it is required directly. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../tools/bundle.js').build());
  else { root.ASVAB = root.ASVAB || {}; root.ASVAB.data = factory(root.ASVAB_DATA); }
})(typeof self !== 'undefined' ? self : this, function (DATA) {
  'use strict';
  DATA = DATA || { config: { subtests: [] }, formats: { profiles: [] }, templates: [], banks: {}, passages: [], lessons: [] };
  DATA.formats = DATA.formats || { profiles: [], default: null };
  DATA.scoring = DATA.scoring || {};
  DATA.composites = DATA.composites || { groups: [] };

  var byId = {};
  DATA.templates.forEach(function (t) { byId[t.id] = t; });
  var lessonById = {};
  DATA.lessons.forEach(function (l) { lessonById[l.id] = l; });
  var subtestByCode = {};
  DATA.config.subtests.forEach(function (s) { subtestByCode[s.code] = s; });
  var profileById = {};
  (DATA.formats.profiles || []).forEach(function (p) { profileById[p.id] = p; });

  // Paper-and-pencil scores Auto and Shop as one subtest; the CAT splits them.
  // A section can therefore name the pools it draws from, defaulting to itself.
  function poolsFor(section) { return section.pools || [section.code]; }

  function sectionName(code) {
    if (code === 'AS') return 'Auto & Shop Information';
    var s = subtestByCode[code];
    return s ? s.name : code;
  }

  function templatesFor(code) {
    return DATA.templates.filter(function (t) { return t.subtest === code; });
  }
  function topicsFor(code) { return (DATA.config.topics || {})[code] || []; }

  return {
    raw: DATA,
    config: DATA.config,
    formats: DATA.formats,
    scoringConfig: DATA.scoring,
    compositeGroups: DATA.composites.groups || [],
    profiles: DATA.formats.profiles || [],
    profile: function (id) { return profileById[id] || profileById[DATA.formats.default] || null; },
    defaultProfileId: DATA.formats.default,
    poolsFor: poolsFor,
    sectionName: sectionName,
    templates: DATA.templates,
    banks: DATA.banks,
    passages: DATA.passages,
    lessons: DATA.lessons,
    template: function (id) { return byId[id]; },
    lesson: function (id) { return lessonById[id]; },
    subtest: function (code) { return subtestByCode[code]; },
    subtests: DATA.config.subtests,
    templatesFor: templatesFor,
    topicsFor: topicsFor,
    // A subtest's composite memberships, so items inherit them automatically.
    compositesFor: function (code) { return (subtestByCode[code] || {}).composites || []; }
  };
});
