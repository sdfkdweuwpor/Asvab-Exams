# MIGRATION.md — Phase 0 recon

Written before any code changed, to answer one question: **can the generated
content layer be swapped for a fixed bank behind the interface the runner
already uses?**

**Short answer: yes.** The runner never touches a template, a bank entry, a
passage or the AO generator. It talks to the content layer through four things
only, listed in §1. Everything else in this document is the detail behind that
claim, plus the places where the swap is genuinely not clean.

Repo state at time of writing: commit `ae9d647`, `node validate.js` passes with
27 checks and 1 warning.

---

## 1. The runner ↔ content interface

`js/app/runner.js` is the whole exam runtime. Grepping every call it makes into
the content layer gives exactly this list:

| Call | Where | Purpose |
|---|---|---|
| `A.exam.<mode>()` | `app.js:227,246,252,256,274` | Build an exam |
| `A.exam.itemRef(item)` | `runner.js:31` | Item → persistable reference |
| `A.exam.rehydrate(ref)` | `runner.js:63`, `report.js:229` | Reference → item |
| `A.exam.lessonPractice(l,n,seed)` | `lessons.js:104` | 3 items for a lesson |

Plus the **shape of the item object** itself (§2), and `A.data.lesson(id)` for
lesson lookup.

That is the entire surface. `runner.js` contains no reference to
`A.engine`, `A.bank`, `A.ao` or `A.passage`. Neither does `report.js`,
`lessons.js` or `app.js`.

### 1.1 What an exam object looks like

Every mode builder returns the same envelope:

```js
{
  mode: 'simulation'|'diagnostic'|'practice'|'drill'|'review',
  created: ISO8601,
  subtest: 'AR'|null,          // practice mode only
  focus: [{subtest,topic}]|null, // drill mode only
  sections: [ { code, name, seconds|null, items: [Item,...] } ],
  totalItems: int,
  totalSeconds: int|null
}
```

`seconds: null` means untimed and the runner counts up instead of down
(`runner.js:88-99`).

### 1.2 The persistence round-trip — the one load-bearing design decision

The runner does **not** store items. On `begin()` it converts each item to a
reference and keeps only that (`runner.js:31`):

```js
itemRef(item) = { source, template_id, seed, subtest, topic,
                  passage_id, target_seconds }
```

On `loadSection()` it calls `rehydrate(ref)`, which re-renders the item from
`(template_id, seed)`. Rendering is deterministic, so the rebuilt item is
byte-identical. The comment in `exam.js` gives the reason: AO figures alone
would be megabytes in `localStorage`.

**This is the single most important thing to preserve.** A fixed bank makes it
*easier* — `rehydrate` becomes a dictionary lookup instead of a re-render — but
`template_id` and `seed` are not private to the runner. They are written into
`state.seen` rows and into `attempt.per_item_results`, which is user history on
disk. §5 covers what that means for migration.

---

## 2. The item object — what the UI and scorer consume

Produced identically by `engine.renderTemplate`, `bank.render`,
`passage.renderQuestion` and `ao.render`:

```js
{
  uid:            'ar_rate_01:83921',   // template_id + ':' + seed
  source:         'template'|'bank'|'passage'|'procedural',
  template_id:    'ar_rate_01',
  seed:           83921,
  subtest:        'AR',
  topic:          'rate_time_distance',
  difficulty:     1..4,
  composites:     ['AFQT','M','G','E'],
  stem:           'A truck travels 240 miles…',
  figure:         '<svg …>' | null,     // raw HTML, injected via innerHTML
  options: [                            // ALWAYS an array of 4, in display order
    { key:'A', text:'42', isCorrect:false, error:'doubled instead of squaring', svg:undefined },
    …
  ],
  correctKey:     'C',
  correctIndex:   2,
  solution_steps: ['…','…'],            // ordered list, rendered as <ol>
  recognition_cue:'…',
  lesson:         'ar_rate_time_distance' | null,
  target_seconds: 45,
  // PC only:
  passage:        'full passage text',
  passage_title:  'Tides',
  passage_id:     'pc_tides'
}
```

### 2.1 Field-by-field consumers

- `stem` → `runner.js:301`, `report.js:253` via `d.richText()`
- `figure` → injected as **raw HTML**, not escaped (`runner.js:302`)
- `options[].svg` → if present, rendered instead of `text` (AO only)
- `options[].error` → the "why this one is wrong" line in feedback and review
- `solution_steps` → `<ol>` in the feedback card and the miss sheet
- `recognition_cue` → the "Spotting this next time" box
- `lesson` → deep-link `#/lesson/<id>`
- `target_seconds` → analytics timing forensics (`analytics.js:135-147`)

### 2.2 Where the PDF schema and the runtime shape disagree

The upgrade spec's target schema is:

```json
{ "options": {"A":"$12.00","B":"$3.50"}, "answer": "C" }
```

The runtime wants an **array** with an `isCorrect` flag and no answer letter.
These are not compatible, but they don't need to be — the on-disk schema and the
in-memory shape were never the same thing even now (a template on disk looks
nothing like a rendered item).

**Recommendation:** keep the spec's schema on disk exactly as written, and add
one adapter module, `js/core/items.js`, that maps a bank record to the runtime
shape. Zero changes to `runner.js`, `report.js`, `lessons.js`. The adapter is
the whole content-layer swap.

### 2.3 Fields the PDF does not supply

| Runtime field | Generated today by | For a bank record |
|---|---|---|
| `solution_steps` | authored per template | `[explanation]`, same as `bank.js:113` already does |
| `options[].error` | authored per distractor | **nothing to map it to** |
| `recognition_cue` | authored per template | **nothing to map it to** |
| `composites` | `data.compositesFor(subtest)` | same — derives from subtest |
| `difficulty` | authored | heuristic (Part 2) |

`error` and `recognition_cue` are both optional in every consumer — the UI
already guards with `o.error ? … : null` and `it.recognition_cue ? … : null`.
So they degrade gracefully to absent. But it is worth being clear-eyed: the
review screen gets **materially thinner** with bank items. Today a missed
question tells you which specific error you made; with a PDF record it tells you
the correct answer and gives one explanation paragraph. That is a real
regression in the review experience, traded for a large gain in question
realism. Flagging it rather than burying it.

---

## 3. Exam structure — already config-driven

`config/test-config.json` → `data.config`. Per subtest:

```json
{ "code":"AR", "name":"Arithmetic Reasoning", "items":16, "seconds":2340,
  "order":2, "composites":["AFQT","M","G","E"], "sources":["template"] }
```

`exam.fullSimulation()` iterates `data.subtests` sorted by `order` and reads
`items` and `seconds` off each. Nothing about the structure is hardcoded in the
exam builder — adding a profile layer is genuinely additive.

Current totals: **145 items, 9240s = 154 min**, which matches `total_minutes`.

### 3.1 Hardcoded numbers that must move

Three places assume 145 and will fight a profile system:

| File | Line | Problem |
|---|---|---|
| `validate.js` | 71 | `items === 145 ? pass : fail` — asserts the count |
| `app.js` | 244 | toast literal `'Building 145 questions…'` |
| `README.md` | 38-46 | structure table written out by hand |

`sources` becomes vestigial once everything is `bank`, but removing the field
means touching `validate.js:84-88`. Cheaper to keep it and let every subtest
declare `["bank"]`, with AO optionally keeping `["procedural"]` (§7).

---

## 4. Lessons and the topic vocabulary

**64 lessons, 64 declared topics, exactly 1:1.** Verified: summing
`config.topics` gives 64, and `lessons.json` has 64 entries, one per topic.

```js
{ id:'ar_rate_time_distance', subtest:'AR', topic:'rate_time_distance',
  title:'Rate, Time and Distance', concept:'…',
  examples:[{problem, steps:[…]}, …],   // 2+ enforced
  trap:'…' }
```

The vocabulary is `config.topics`, a `subtest → [topic_id]` map:

| Subtest | n | Topic IDs |
|---|---|---|
| AR | 9 | `rate_time_distance, percentages_discount, ratio_proportion, simple_interest, work_rate, averages, unit_conversion, basic_probability, cost_profit` |
| MK | 9 | `exponents_roots, factoring, linear_equations, inequalities, area_perimeter_volume, angles_triangles, sequences, fractions_decimals, order_of_operations` |
| WK | 3 | `synonyms_isolation, words_in_context, roots_prefixes_suffixes` |
| PC | 5 | `main_idea, specific_detail, inference, vocabulary_in_context, author_purpose` |
| GS | 4 | `life_science, earth_space_science, chemistry_basics, physics_basics` |
| EI | 8 | `ohms_law, series_parallel, components, ac_dc, frequency_wavelength, conductors_insulators, circuit_symbols, electrical_safety` |
| AI | 8 | `engine_operation, ignition, fuel_system, cooling, brakes, transmission, auto_electrical, diagnostics` |
| SI | 6 | `hand_tools, power_tools, fasteners, materials, measuring, wood_metalworking` |
| MC | 10 | `levers, pulleys, gears, mechanical_advantage, force_pressure, hydraulics, springs, friction, center_of_gravity, work_energy` |
| AO | 2 | `connection_problems, shape_assembly` |

Lesson id convention: `<subtest lowercase>_<topic>`. So a topic tag resolves to
its lesson by string construction — no lookup table needed. This is why
"re-keyed, not rewritten" is achievable: **if bank tags use these 64 topic IDs,
zero lessons change.**

### 4.1 Two validator rules that will bite

`validate.js:390` fails if a lesson is **orphaned** — no item links to it. With
a fixed bank, any of the 64 topics the PDF happens not to cover turns into a
hard validator failure. `validate.js:402` similarly fails a lesson whose topic
has no practice supply.

These must become *reports* rather than *failures*, which is what the spec's
"topics with questions but no lesson / lessons with no questions" coverage
report already implies. But it is a deliberate loosening of a gate that
currently holds, and worth naming as such.

---

## 5. Persistence — `localStorage`, key `asvab.progress.v1`

```js
{ version:1, created, settings:{catRules,theme,scratchOpen},
  diagnostic:{date,attemptId,scores}|null,
  seen:[…], attempts:[…], queue:[…], session:{…}|null }
```

### 5.1 `seen` — drives non-repetition and every analytic

Compact rows, capped at 6000 (`SEEN_CAP`), trimmed oldest-first:

```js
{ t:template_id, s:seed, d:ISO, c:0|1, f:'sure'|'unsure'|'guessed',
  sec:int, st:subtest, tp:topic, src:source }
```

Read by `timesSeen(id)`, `seedsUsed(id)`, `seenList()`. **Keyed on
`template_id`.**

### 5.2 `attempts` — the score history

```js
{ id:'att_<base36>', date, mode, subtest, catRules, durationSec,
  scores:{…},                    // frozen output of scoring.score()
  per_item_results:[ { template_id, seed, source, subtest, topic, passage_id,
                       target_seconds, answered, optIndex, correct,
                       confidence, seconds, flagged } ] }
```

`report.js:229` calls `A.exam.rehydrate(r)` on these rows to redraw a past
review. **A stored attempt is only viewable while its `template_id` still
resolves.**

### 5.3 `queue` — SRS

```js
{ template_id, subtest, topic, source, passage_id, due:ISO, stage:0|1|2 }
```

Intervals `[3,7,14]` days. One entry per concept, keyed `template_id`; a repeat
miss restarts the ladder.

### 5.4 `session` — the live autosave

The runner's `S` object, saved after **every answer** (`runner.js:117`) and every
5 ticks. Holds `sections[].refs[]`, `si`, `ii`, `remaining`, `answers{}`.

Resume already works and already restores remaining time. The spec's
"resume-after-crash to within 1 second" acceptance test largely passes today —
the gap is that `remaining` is only flushed every 5s while idle, so a crash can
cost up to 5 seconds. Tightening that is small.

### 5.5 The migration hazard — read this one carefully

Every structure above keys on `template_id`. New bank IDs (`AR-0001`) will not
collide with old ones (`ar_rate_01`, `wk_017`, `pc_tides/q3`), so:

- Old `seen` rows: **keep working** for analytics. `topic`/`subtest` are stored
  on the row itself, so heatmaps, weak spots and timing all still compute over
  history. Nothing is lost.
- Old `attempts`: **scores keep working** (`scores` is frozen at write time).
  But `rehydrate` will return `null` for old refs once templates are deleted,
  so *the question-review screen for historical attempts goes blank*.
  `report.js:230` guards with `if (!item) return;` — so it degrades to an empty
  list, not a crash. Still a silent loss.
- Old `queue` entries: `exam.review()` drops any ref that fails to render, so
  stale SRS items **vanish silently**.

The spec says "do not silently wipe my history." Meeting that honestly needs a
`version: 2` migration that:
1. bumps `version` and keeps every `seen` row untouched;
2. marks pre-migration attempts `contentGeneration: 1` and shows "questions from
   the previous generated bank — text no longer available" instead of an empty
   review;
3. drops stale `queue` entries **with a one-time notice**, not silently.

That is the honest reading of the requirement, and it is more than a version
bump. Recommend doing it in M3 alongside the swap, not deferring to M6.

---

## 6. Scoring input

`scoring.tally(results)` takes `[{subtest, correct}]` → `{AR:{correct,total}}`.
`scoring.score(tallies, historyN)` consumes that plus `data.subtests` and
`data.config.composites`. It is already independent of how items were produced.

Notable: **AS is already pooled at scoring time** from `AI` + `SI`
(`scoring.js:73-75`), and VE is already pooled from raw WK+PC counts rather than
averaged standard scores (`scoring.js:68-70`) — which is the correct structure
and matches what the spec asks for. The spec's ask is to make the VE conversion
*table-driven* in `config/scoring.json` rather than linear; that is a
substitution inside `standardScore`, not a restructure.

`historyN` comes from `state.afqtSampleSize()`, which counts WK/PC/AR/MK rows
in `seen` across all time. Unaffected by the swap.

---

## 7. Answer to the Phase 0 question

**The content layer can be swapped behind its existing interface.** The runner
does not reach into template internals. Concretely, M3 is:

1. Add `js/core/items.js` — bank record → runtime item shape (§2.2).
2. Rewrite the internals of `exam.js`'s six builders to select from the bank
   instead of calling `engine`/`bank`/`passage`/`ao`. Public signatures unchanged.
3. `rehydrate(ref)` becomes `byId[ref.template_id]` → adapter.
4. `itemRef` keeps its shape; `seed` carries option-shuffle state (§7.2) or 0.

`runner.js`, `report.js`, `lessons.js` need **no changes** for M3.

### 7.1 The one place that isn't clean

`app.js:460-462` prints the content inventory in Settings by reading
`A.data.templates.length`, `A.data.banks[…].entries.length` and
`A.data.passages.length` directly. Cosmetic, one paragraph, trivially rewritten
— but it is the one genuine violation of the interface and it will throw if
those collections disappear.

### 7.2 Open decision — option order and answer-letter balance

Today the correct answer's slot is a **hash** of `(template_id, seed)`
(`engine.correctSlot`), so letter distribution is uniform *by construction*.
`validate.js:243` enforces no letter exceeding 30%.

A fixed bank inherits whatever letter skew the source PDF has, and dump PDFs are
often skewed. Two options, and they conflict:

- **Preserve source order.** Faithful, and keeps explanations that say "option C
  is correct" coherent. Inherits the skew, and a student can learn the skew.
- **Shuffle per `(id, seed)`.** Restores uniform letters and doubles as an
  anti-memorization measure — the same item shows a different arrangement on a
  later sitting. Breaks any explanation that references a letter.

**Recommendation:** detect it. Shuffle only items whose explanation contains no
option-letter reference (regex for `\b(option |answer |choice )?[A-D]\b` in an
answer-ish context), preserve order for the rest, and report the split. This is
a real decision with no free option — flagging rather than choosing silently.

### 7.3 Open decision — `data/bundle.js` is a `<script>` tag, not a `fetch`

`index.html:57` loads `data/bundle.js` as a plain script that assigns
`root.ASVAB_DATA`. The header comment in `tools/bundle.js` says why: browsers
block `fetch()` on `file://`, and `index.html` must work when double-clicked.
The README leads with that promise.

The spec asks for chunked `data/questions.AR.json` lazy-loaded per session.
**`fetch()` of a `.json` file cannot work from `file://`** — this would silently
break double-click-to-open, and `sw.js` precaching too.

**Recommendation:** chunk as `.js` not `.json` — `data/questions.AR.js` each
assigning `ASVAB_BANK.AR = […]` — injected on demand by appending a `<script>`
tag. That is genuinely lazy, works on `file://` and over HTTP, and keeps the
existing precache model intact. Current bundle is 424 KB and loads fine; ~1,894
records is likely 1–2 MB, so chunking is worth doing, just not via `fetch`.

---

## 8. Toolchain

Verified working in this container: PyMuPDF (text + clipped figure render),
pdfplumber (needed a `cryptography` upgrade to fix a pyo3 crash), sympy 1.14.0,
Pillow, PyYAML. Node v22.22.2.

**The source PDF is not reachable from this environment.** It is in the user's
Google Drive; `drive.google.com` is denied by egress policy (403) and
`www.googleapis.com` is reachable but needs an API key this session does not
hold. The MCP Drive connector returns base64 into context, which cannot be
written to disk at 8 MB. The PDF must be pushed to the repo.
