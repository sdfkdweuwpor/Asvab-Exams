# ASVAB Practice Test

A full-length ASVAB practice app for someone preparing to enlist in the U.S. Air Force.
Static, client-side only, installable to a phone, and fully usable offline.

Open `index.html` by double-clicking it, or serve the folder over HTTP. Both work.

---

## A note on the questions

**No real ASVAB questions appear anywhere in this app.** Actual items are protected
test material and are not published. Everything here is original, written to match the
published content outline for each subtest — the same format, difficulty band and topic
coverage, different questions. The reading passages are original prose written for this
project, not excerpts from anything.

## A note on the scores

The official raw-to-standard-score conversion tables are not public, so **every score in
this app is an approximation** and is labelled as an estimate in the UI:

- Percent correct is mapped linearly onto the 20–80 standard-score band, so half right
  lands on the mean of 50.
- VE is derived from Word Knowledge and Paragraph Comprehension pooled together.
- AFQT = 2VE + AR + MK, placed on a normal curve to produce a percentile.
- The confidence band comes from the standard error of a proportion over every question
  you have ever answered, so it narrows as you practise (±26 at 40 questions, ±9 at 400).

The four Air Force MAGE composites are computed the same way. **Job cut scores are
deliberately absent** — they change over time and vary by contract. Take real scores to a
recruiter.

---

## What it does

**Test structure** mirrors the CAT-ASVAB: 10 subtests, 145 items, 154 minutes, with
per-subtest time limits in `config/test-config.json`.

| Subtest | Items | Minutes | | Subtest | Items | Minutes |
|---|---|---|---|---|---|---|
| General Science | 16 | 8 | | Electronics Information | 16 | 8 |
| Arithmetic Reasoning | 16 | 39 | | Auto Information | 11 | 7 |
| Word Knowledge | 16 | 8 | | Shop Information | 11 | 6 |
| Paragraph Comprehension | 11 | 22 | | Mechanical Comprehension | 16 | 20 |
| Mathematics Knowledge | 16 | 20 | | Assembling Objects | 16 | 16 |

**Modes**
- **Diagnostic** — 30 questions across all ten subtests on first launch, seeding
  difficulty targeting and a baseline.
- **Practice** — one subtest, untimed, worked answer and explanation after each question.
- **Simulation** — the full 145 items, timed section by section, no feedback until the end.
- **Drills** — one tap builds a 15-question set from your weakest subtopics.
- **Spaced review** — missed items return at 3, 7 and 14 days with a **new seed**, so it is
  the same concept with different numbers rather than a memory test.

**During a test** — a persistent visible timer, a CAT-rules toggle (no going back, no
flagging), flag-for-review when CAT rules are off, a built-in scratch pad, a
sure/unsure/guessed tag per question, and **an autosave after every single answer**. A
refresh drops you back on the same question with every answer intact.

**No calculator anywhere**, because there isn't one on the real test.

**Post-exam review** is the point of the app:
- AFQT percentile estimate with a confidence band tied to how much you have answered.
- All four MAGE composites with relative strength.
- Every missed question: how it appeared, your answer, the right answer, a worked
  solution using the actual numbers you saw, **why each wrong option was wrong** from the
  template's named error patterns, the recognition cue, and a link to the lesson.
- Topic heatmap where every row carries its sample size — one miss shows as "too few to
  judge", not as a red weakness.
- Pattern detection at subtopic level: "Missed 5 of 6 exponents roots questions".
- Timing forensics separating answers under 8 seconds (guessing) from time sinks, and
  reporting pacing apart from knowledge.
- Confident-and-wrong flagged separately from unsure-and-wrong.
- A printable one-page miss sheet.

**Lessons** — 64 short lessons, one per subtopic, each with the rule, two worked examples,
the usual trap, and three practice questions generated live from that subtopic.

**Your data** — JSON export/import plus a paste-able sync string for moving between
devices. `localStorage` is per-device, and the app says so.

---

## How questions are generated

Three mechanisms, chosen per subtest:

**1. Parametric templates** (AR, MK, EI, MC) — a template defines structure, a parameter
space, the answer, and each distractor as a *formula*. Items render from
`(template_id, seed)`. The correct answer and every distractor recompute for every
parameter set; a fixed distractor list with randomised numbers would be a broken item.
Constraints keep answers clean, solution steps interpolate the actual numbers, and each
template carries 4+ unrelated context skins so the method is what sticks.

**2. Curated bank + generated options** (WK, GS, AI, SI, and the factual half of EI) —
facts can't be parameterised, so the bank stores the fact and the four options are
assembled at render time from semantically near-miss answers in the same category,
length-matched so the correct one never stands out.

**3. Passage + rotating questions** (PC) — 40 original passages, each carrying 4–5
questions across main idea, detail, inference, vocabulary-in-context and author purpose.
Which ones appear rotates with the seed, so one passage yields different tests.

**Assembling Objects** is generated geometrically rather than authored. Connection problems
place a marked point on each of two shapes and rotate them in the options. Assembly
problems slice a master polygon into pieces that provably tile it (verified to 1e-16), and
build distractors from perturbed cuts, so they genuinely cannot be made from the pieces
shown.

**Answer position** is derived from a hash of `(id, seed)` rather than drawn at random, so
the letter distribution is uniform by construction — measured at 25.6 / 24.9 / 24.5 / 25.0%
across 3,350 renders.

---

## Running and developing

```sh
# open it
open index.html                 # or just double-click it

# or serve it
npx http-server -p 8080 .

# validate everything before committing
node validate.js                # add --seeds 200 for a deeper sweep

# regenerate the browser data bundle after editing any JSON
node tools/bundle.js
```

### Why there is a `data/bundle.js`

The canonical content lives in `config/`, `templates/`, `banks/` and `lessons/` as JSON.
Browsers block `fetch()` on `file://` URLs, so `index.html` could not read those files when
opened by double-clicking. `tools/bundle.js` concatenates them into a single
`data/bundle.js` that loads with a plain `<script>` tag, which works from `file://`, from
GitHub Pages, and from the offline service-worker cache alike. **The JSON stays the source
of truth** — `validate.js` regenerates the bundle and warns if it has drifted.

### `validate.js`

Run it before finishing anything. It checks:

- every declared subtopic has content behind it;
- no duplicate stems across templates, banks and passages;
- answer-position distribution stays under 30% for any letter;
- option lengths within an item stay in range, and the correct option is never
  conspicuously the longest;
- **50 random seeds per template**, verifying the answer is clean, options are unique, and
  results are sane numbers;
- **every template's answer is re-derived a second way.** Numeric templates carry a
  `verify` formula that must reach the same answer by a different route; symbolic ones
  carry an `identity` checked by substituting probe values. A typo in the algebra fails the
  build rather than reaching a student;
- no orphaned lesson links, in either direction;
- no `all of the above`, `none of the above`, or double negatives;
- skin words never collide with parameter names (which would silently print a number where
  a word belongs);
- the service worker precaches exactly what `index.html` loads, so a new script can't
  quietly break offline use.

### Layout

```
index.html  styles.css  sw.js  manifest.json  validate.js
config/     test-config.json — item counts, time limits, subtopics, composites
templates/  ar, mk, ei, mc — parametric templates
banks/      wk, gs, ai, si, ei — curated facts; pc — passages
lessons/    one lesson per subtopic
js/core/    rng, expr, engine, figures, bank, passage, ao, scoring, state, exam, analytics
js/app/     dom, runner, report, lessons, app
tools/      bundle.js
data/       bundle.js (generated)
```

`js/core/*` runs unchanged in the browser and under Node, which is how `validate.js`
exercises the real rendering path rather than a copy of it.

### Adding a template

Add an object to the right file in `templates/`, run `node tools/bundle.js`, then
`node validate.js`. The validator will tell you what's missing — including a `verify`
formula or an `identity`, which are not optional.

---

## Content totals

67 parametric templates · 257 curated bank entries · 40 original passages with 165
questions · 64 lessons · procedurally unlimited Assembling Objects.

## Licence

Content and code are original work for this project.
