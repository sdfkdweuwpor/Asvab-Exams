#!/usr/bin/env node
/* Stamp index.html and sw.js with the current build number.

   Run after changing any script or stylesheet. Cache-busting the URL is what
   actually makes an update reach someone who already has the app installed: a
   service worker holding an old copy of js/app/dom.js will serve it forever,
   because nothing ever asks for that URL again. Asking for a NEW url is the
   only reliable way through, and it works even against a worker that predates
   the fix. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');

const build = String(parseInt(execSync('git rev-list --count HEAD', { cwd: ROOT }).toString().trim(), 10) + 1);

function stamp() {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/(\b(?:src|href)="[^"]+?)\?v=\d+(")/g, '$1$2');
  html = html.replace(/(\b(?:src|href)=")([^"]+?)(")/g, (m, a, url, c) => {
    if (/^(https?:|#)/.test(url) || !/\.(js|css)$/.test(url)) return m;
    return a + url + '?v=' + build + c;
  });
  html = html.replace(/self\.ASVAB_BUILD\s*=\s*"\d+";/, 'self.ASVAB_BUILD = "' + build + '";');
  fs.writeFileSync(path.join(ROOT, 'index.html'), html);

  let sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  sw = sw.replace(/var CACHE = 'asvab-practice-b\d+';/, "var CACHE = 'asvab-practice-b" + build + "';");
  sw = sw.replace(/var BUILD = '\d+';/, "var BUILD = '" + build + "';");
  fs.writeFileSync(path.join(ROOT, 'sw.js'), sw);

  const n = (html.match(/\?v=/g) || []).length;
  console.log('stamped build ' + build + ' onto ' + n + ' asset URLs and sw.js');
}

stamp();
