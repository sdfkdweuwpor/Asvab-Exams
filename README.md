# ASVAB Practice Test

A full-length ASVAB practice app. Static, client-side only, installable to a phone,
and fully usable offline.

Open `index.html` by double-clicking it, or serve the folder over HTTP. Both work.

---

## Where the questions come from

The app is built on **1,878 questions extracted from a published ASVAB practice
question set** (706 pages, `source/asvab-source.pdf`). These are practice items in the
style of the real test — they are **not** real ASVAB questions. Actual test items are
protected material and are not published anywhere.

The extraction is honest about what it found, because a fixed bank has one failure mode
a generator does not: **a wrong answer key teaches the wrong thing, permanently, to
everyone who uses the app.** So:

- Of the AR and MK items that could be re-solved independently with `sympy`, **none
  disagreed with its answer key.** Coverage of that check is low (about 4%) by choice —
  the solvers refuse anything they cannot resolve exactly, because a solver that guesses
  accuses correct keys of being wrong.
- Answer letters are close to uniform in the source already (A 24.0%, B 27.3%, C 26.3%,
  D 22.4%), so option order is left exactly as printed rather than shuffled.
- **15 questions were excluded** as unusable and are kept in `data/questions.json` for
  audit rather than deleted. Nine of them are corrupted by the source: the PDF renders
  **no superscript or radical glyph anywhere**, so `10³` prints as `103` and `√49` as
  `49`. A stem is only called corrupted when it fails as written *and* resolves once the
  notation is restored — `2.5 × 33 = 67.5` is wrong as printed (82.5) and exact as
  2.5 × 3³.
- **868 of the questions have no explanation** in the source, concentrated in Word
  Knowledge (66% missing) and all of Assembling Objects. The app says so rather than
  inventing one.
- Five explanations appear to belong to the following question. They are flagged in
  `data/review_needed.json`.

`scripts/validate_bank.py` re-runs every one of those checks.

## A note on the scores

The official raw-to-standard-score conversion tables are not public, so **every score in
this app is an approximation**, labelled an estimate everywhere it appears. The numbers
live in `config/scoring.json`, not in code:

- Percent correct maps onto the 20–80 standard-score band, so half right lands on 50.
- **VE** is a table-driven weighted conversion of WK and PC, not a plain sum.
- **AFQT** = 2VE + AR + MK, placed on a normal curve, then mapped to its category
  (I through V).
- The confidence band comes from the standard error of a proportion over everything you
  have answered, so it narrows as you practise.

**Branch minimums** are shown for your own credential, because the diploma and GED
figures differ sharply — the Air Force asks 36 with a diploma and **65** with a GED.
Job-specific cut scores are deliberately absent; they change and vary by contract.
Take real scores to a recruiter.

---

## Exam formats

Published CAT-ASVAB numbers **disagree between sources**, so the app does not pretend
one is authoritative. `config/exam_formats.json` holds five selectable profiles, each
carrying its source and a note, and every result records which one produced it.

| Profile | Questions | Minutes | Behaviour |
|---|---:|---:|---|
| `cat_135` (default) | 135 | 198 | adaptive, answers lock |
| `cat_126_scored` | 145 | 206 | adaptive; ~19 tryout items timed but unscored |
| `cat_current_app` | 145 | 154 | the app's original shape, kept so old results stay comparable |
| `pp_225` | 225 | 149 | paper-and-pencil: skip, flag and return |
| `afqt_only` | 55 | 122 | AR, MK, WK, PC at real timing |

**CAT profiles lock answers.** Advancing from a question seals it: no back button, no
flagging, options disabled if you reach it again. This is the real computer-adaptive
test's defining constraint. Whether answers lock is a property of the format, not a
preference — a CAT you can go back in is not a CAT.

**Adaptive selection** draws the next question only once the previous one is answered.
The estimate starts mid-band and steps on each answer; the draw takes the nearest
unadministered item, picking at random among everything within half a band so two
sittings at the same ability are not the same exam.

**Paper-and-pencil** is a fixed stratified draw with a navigator grid showing answered,
blank and flagged at a glance. It is the only place questions the Auto/Shop keyword
split could not resolve are used, since the paper test scores Auto and Shop together.

---

## Modes

- **Placement test** — 30 questions across all subtests, for a baseline.
- **Full simulation** — the selected profile, timed section by section.
- **AFQT-only** — the four subtests that decide whether you can enlist. Half the sitting.
- **Weak-spot exam** — full length, drawn about 60/40 toward your current weak topics.
- **Single subtest** — one subtest at its exact official timing.
- **Practice** — one subtest, untimed, with the explanation after each question.
- **Drills** — 10 or 15 questions on a topic, launched from a Work On card.
- **Spaced review** — missed items return at 3, 7 and 14 days.

**During a test** — a visible timer held as a wall-clock deadline (so a reload resumes
with the remaining time still right), a scratch pad, a sure/unsure/guessed tag, and an
autosave after every answer. Keyboard throughout: `1`–`4` or `A`–`D` to answer, `Enter`
to advance, `F` to flag where the format allows it. **No calculator anywhere**, because
there isn't one on the real test.

---

## The "Work On" list

Ranking weak topics by accuracy is the obvious thing and it is wrong: it puts a topic
you got 1 of 2 wrong above one you got 8 of 20 wrong, and it treats a topic worth 15
questions the same as one worth two.

So topics rank by **estimated score leverage** — how many AFQT points bringing this
topic to 85% would actually be worth. Accuracy carries a Beta prior so two answers
cannot outrank twenty, and the card draws the confidence band beside the bar so a topic
judged on four answers never looks as settled as one judged on forty.

**Pace is tracked separately.** A topic you answer correctly but at more than 1.5× your
own subtest median fails under real time pressure while looking fine on accuracy, and
nothing else surfaces it.

Each card gives one plain-language diagnosis leading with counts — *"Missed 14 of 20
rate time distance questions in Arithmetic Reasoning"* — and three actions: **Drill 10**,
**Open lesson**, **Review missed**. Mastery is gated at 85% over at least 12 questions
spanning at least 2 sessions.

## Memorisation controls

A fixed bank means you eventually recognise a question rather than solving it. So:

- Nothing repeats within a sitting, and unseen items are drawn before seen ones.
- An item answered correctly three or more times in under 40% of your own median for
  that subtest is marked **likely memorised** and pushed down the draw order. It is never
  removed — the pool is too small to discard from.
- The home screen reports how many items look recognised, and which subtests are running
  low on unseen questions.
- **Number-swapped variants** are available as opt-in *drill* remediation for AR and MK
  questions you have already missed. Exams stay 100% real bank. Variants are only
  produced where the stem can be re-solved with certainty, which is about 1% of AR and
  MK — a variant with a wrong answer would teach an error.

**Pool depth:** roughly 9 full CAT sittings before repeats are unavoidable, with Shop
Information and Assembling Objects the binding constraints. AFQT-only does better: AR 17,
WK 21, MK 15, PC 15.

---

## Lessons

64 short lessons, one per subtopic — the rule, two worked examples, the usual trap, and
three practice questions drawn live from that subtopic. Every question tag resolves to
one of them by construction.

Two lessons have no questions behind them (`pc_author_purpose`,
`wk_roots_prefixes_suffixes`) because the source contains none of either kind. Four
areas have questions but no lesson — AR area word problems, MC thermal properties, EI
digital hardware, AI tires — and are recorded in `data/taxonomy.json` rather than folded
silently into a neighbouring topic.

## Your data

JSON export/import plus a paste-able sync string. Settings travel with the history;
local values win on a merge. `localStorage` is per-device and the app says so.

Progress is at **version 2**. Upgrading from the generated content keeps every answered
question, every attempt and its scores; retired review-queue entries are reported in a
notice rather than dropped in silence.

---

## Running and developing

```sh
open index.html                 # or just double-click it
npx http-server -p 8080 .       # or serve it

node validate.js                # gate everything before committing
node tools/bundle.js            # regenerate the bundle after editing config/ or lessons/

# rebuild the bank from the source PDF (needs pymupdf, pdfplumber, sympy, pillow, pyyaml)
python3 scripts/extract_bank.py --probe 12    # inspect layout first
python3 scripts/extract_bank.py               # extract
python3 scripts/validate_bank.py              # the answer-key gate
python3 scripts/build_taxonomy.py             # taxonomy + lesson coverage report
python3 scripts/tag_review.py                 # clear tagging stragglers by hand
```

Python runs **once at build time**. The app never needs it.

### Why questions are `.js` and not `.json`

Browsers block `fetch()` on `file://` URLs, so `index.html` could not read a `.json`
bank when opened by double-clicking. Each subtest ships as `data/questions.<CODE>.js`,
a plain script assigning into `ASVAB_BANK`, injected on demand. That is genuinely lazy —
a Word Knowledge drill does not pull Paragraph Comprehension's 174KB — and works from
`file://`, GitHub Pages and the offline cache alike.

### Layout

```
index.html  styles.css  sw.js  manifest.json  validate.js
config/     test-config   — subtest metadata, subtopics, composites
            exam_formats  — five selectable profiles, each with its source
            scoring       — standard-score band, VE table, AFQT categories, branch minimums
            composites    — 24 line scores across four branches
lessons/    one lesson per subtopic
scripts/    extract_bank, validate_bank, build_taxonomy, tag_review  (build time only)
js/core/    rng, bankdata, items, variants, exam, scoring, workon, analytics, state, data
js/app/     dom, runner, report, lessons, app
data/       questions.json (audit) · questions.<CODE>.js (served) · taxonomy · tag_rules
            review_needed.json · bundle.js (generated)
assets/     figures/ — 311 figures extracted from the source
source/     asvab-source.pdf
```

`js/core/*` runs unchanged in the browser and under Node, which is how `validate.js`
exercises the real path rather than a copy of it.

## Licence

Code is original work for this project. The question bank is extracted from a
third-party published practice set and is included here for personal study use.
