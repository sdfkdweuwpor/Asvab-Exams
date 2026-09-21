#!/usr/bin/env python3
"""Extract the ASVAB question bank from the source PDF.

Runs once at build time. The app never needs Python.

    python3 scripts/extract_bank.py --probe 12      # inspect layout, change nothing
    python3 scripts/extract_bank.py                 # full extraction

Probe first on any new source file. The record grammar below is tolerant, but
page furniture and section headings differ between PDF producers, and guessing
at them silently corrupts the bank.
"""
import argparse
import json
import os
import re
import sys
from collections import Counter, OrderedDict, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PDF = os.path.join(ROOT, 'source', 'asvab-source.pdf')
OUT_DIR = os.path.join(ROOT, 'data')
FIG_DIR = os.path.join(ROOT, 'assets', 'figures')

try:
    import pymupdf as fitz
except ImportError:  # older wheels only ship the deprecated alias
    import fitz

# --------------------------------------------------------------- page furniture
# Lines matching any of these are dropped before parsing. Kept as a list so the
# probe can report which ones actually fired -- a rule that never fires is a rule
# written against an imagined document.
FURNITURE = [
    ('running-header', re.compile(r'^\s*ASVAB\s*$', re.I)),
    ('xcerts-footer', re.compile(r'xcerts\s*\.\s*com', re.I)),
    ('bare-page-number', re.compile(r'^\s*\d{1,3}\s*$')),
    ('page-of', re.compile(r'^\s*page\s+\d+\s*(of\s+\d+)?\s*$', re.I)),
    ('url-line', re.compile(r'^\s*https?://\S+\s*$', re.I)),
]

# --------------------------------------------------------------- record grammar
RE_QUESTION = re.compile(r'^\s*QUESTION\s*:?\s*(\d+)\s*$', re.I)
RE_OPTION = re.compile(r'^\s*([A-D])\s*[\.\)]\s+(.*)$')
RE_ANSWER = re.compile(r'^\s*Answer\(?s?\)?\s*:\s*(.+?)\s*$', re.I)
RE_EXPLANATION = re.compile(r'^\s*Explanation\s*:?\s*(.*)$', re.I)

# Section headings, in PDF order. Only the "Section N: <name>" form is
# authoritative -- page 3 is a table of contents listing all nine, and a stem
# like "The purpose of mechanical comprehension is ___" also matches a bare
# name. Note the source mislabels Mathematical Knowledge as "Section 4"
# (General Science is also 4), so the NAME decides, never the number.
RE_SECTION_HEAD = re.compile(r'^\s*Section\s+\d+\s*:\s*(.+?)\s*$', re.I)

SECTIONS = [
    ('AR', re.compile(r'arithmetic\s+reasoning', re.I)),
    ('AS', re.compile(r'auto\s*(and|&)?\s*shop\s+information', re.I)),
    ('EI', re.compile(r'electronic[s]?\s+information', re.I)),
    ('GS', re.compile(r'general\s+science', re.I)),
    ('MK', re.compile(r'mathematic(s|al)\s+knowledge', re.I)),
    ('PC', re.compile(r'paragraph\s+comprehension', re.I)),
    ('WK', re.compile(r'word\s+knowledge', re.I)),
    ('MC', re.compile(r'mechanical\s+comprehension', re.I)),
    ('AO', re.compile(r'assembling\s+objects', re.I)),
]

# ------------------------------------------------------- auto / shop classifier
AUTO_TERMS = [
    'engine', 'carburetor', 'alternator', 'transmission', 'spark plug', 'brake',
    'radiator', 'camshaft', 'piston', 'crankshaft', 'muffler', 'exhaust',
    'distributor', 'clutch', 'differential', 'ignition', 'cylinder', 'valve',
    'fuel injector', 'coolant', 'odometer', 'tachometer', 'axle', 'catalytic',
    'oil pan', 'timing belt', 'starter motor', 'battery', 'spark', 'gasket',
    'two-cycle', 'two cycle', 'four-cycle', 'oil pressure', 'engine oil',
    'tire', 'steering', 'suspension', 'shock absorber', 'antifreeze',
    'fuel pump', 'throttle', 'manifold', 'torque converter', 'drive belt',
    'headlight', 'windshield', 'vehicle', 'automobile', 'car ', 'truck',
]
SHOP_TERMS = [
    'chisel', 'plane', 'miter', 'lathe', 'solder', 'rivet', 'wrench',
    'wood joint', 'file', 'punch', 'hacksaw', 'screwdriver', 'pliers',
    'sandpaper', 'vise', 'clamp', 'drill bit', 'router', 'awl', 'mallet',
    'dovetail', 'plywood', 'tenon', 'mortise', 'level', 'square', 'caliper',
    'saw', 'hammer', 'anvil', 'grinder', 'tap and die', 'lumber',
    'rebar', 'washer', 'bolt', 'nut ', 'screw', 'nail', 'sheet metal',
    'micrometer', 'sandpaper', 'wood', 'metalwork', 'workbench', 'bench',
    'blade', 'bit ', 'gauge', 'measur', 'weld', 'braze', 'concrete',
    'masonry', 'trowel', 'putty', 'adhesive', 'glue', 'joint', 'plumb',
]

# ------------------------------------------------------------- figure detection
FIGURE_WORDS = re.compile(
    r'\b(figure|shown below|diagram|circuit|pulley|gear|illustrated|'
    r'pictured|shown above|the drawing|as shown|following figure)\b', re.I)
RE_BOILERPLATE_OPTION = re.compile(r'^\s*option\s+[A-D]\s*$', re.I)


def clean_lines(raw):
    """Drop page furniture. Returns (kept_lines, Counter of rules that fired)."""
    kept, fired = [], Counter()
    for line in raw.split('\n'):
        hit = None
        for name, rx in FURNITURE:
            if rx.search(line) if name == 'xcerts-footer' else rx.match(line):
                hit = name
                break
        if hit:
            fired[hit] += 1
        else:
            kept.append(line.rstrip())
    return kept, fired


def page_text(page):
    return page.get_text('text')


# ------------------------------------------------------------------- probe mode

def probe(doc, n):
    print('=' * 72)
    print('PDF: %d pages' % doc.page_count)
    print('=' * 72)

    fired_total = Counter()
    section_hits = []
    q_numbers = []
    drawings = 0
    images = 0

    for i in range(doc.page_count):
        page = doc[i]
        raw = page_text(page)
        kept, fired = clean_lines(raw)
        fired_total.update(fired)
        d = len(page.get_drawings())
        im = len(page.get_images(full=True))
        drawings += d
        images += im
        for line in kept:
            m = RE_QUESTION.match(line)
            if m:
                q_numbers.append(int(m.group(1)))
            for code, rx in SECTIONS:
                if rx.search(line) and len(line.strip()) < 60:
                    section_hits.append((i + 1, code, line.strip()))

    print('\n--- furniture rules that fired ---')
    for name, _ in FURNITURE:
        print('  %-20s %d' % (name, fired_total.get(name, 0)))
    print('\n--- structure ---')
    print('  QUESTION: markers found : %d' % len(q_numbers))
    if q_numbers:
        print('  numbering range        : %d .. %d' % (min(q_numbers), max(q_numbers)))
        dupes = [k for k, v in Counter(q_numbers).items() if v > 1]
        print('  duplicate numbers      : %d %s' % (len(dupes), sorted(dupes)[:10]))
        expected = set(range(min(q_numbers), max(q_numbers) + 1))
        gaps = sorted(expected - set(q_numbers))
        print('  gaps in numbering      : %d %s' % (len(gaps), gaps[:20]))
    print('  vector drawing objects : %d' % drawings)
    print('  embedded raster images : %d' % images)

    print('\n--- section headings detected (page, code, text) ---')
    for pg, code, txt in section_hits[:40]:
        print('  p%-5d %-3s %s' % (pg, code, txt[:60]))
    if not section_hits:
        print('  NONE -- section headings do not match the patterns in SECTIONS.')

    print('\n--- raw text of first %d pages ---' % n)
    for i in range(min(n, doc.page_count)):
        print('\n' + '-' * 72)
        print('PAGE %d  (drawings=%d images=%d)' % (
            i + 1, len(doc[i].get_drawings()), len(doc[i].get_images(full=True))))
        print('-' * 72)
        print(page_text(doc[i]))


# --------------------------------------------------------------- parse records

def parse(doc, verbose=True):
    """Walk every page, emit raw records. Layout-tolerant: a record ends when the
    next QUESTION marker appears, so trailing junk lands in the explanation
    rather than silently truncating a stem."""
    lines = []           # (page_index, text)
    for i in range(doc.page_count):
        kept, _ = clean_lines(page_text(doc[i]))
        for ln in kept:
            lines.append((i, ln))

    # locate section boundaries by first heading occurrence
    current = None
    section_of_line = []
    for _, ln in lines:
        s = ln.strip()
        if len(s) < 60:
            for code, rx in SECTIONS:
                if rx.search(s):
                    current = code
                    break
        section_of_line.append(current)

    records, cur = [], None
    for idx, (pg, ln) in enumerate(lines):
        m = RE_QUESTION.match(ln)
        if m:
            if cur:
                records.append(cur)
            cur = {'source_number': int(m.group(1)), 'page': pg,
                   'section': section_of_line[idx], 'body': []}
            continue
        if cur is not None:
            cur['body'].append(ln)
    if cur:
        records.append(cur)
    if verbose:
        print('parsed %d raw records' % len(records))
    return records


def split_record(rec):
    """body lines -> stem / options / answer / explanation."""
    stem, options, answer, expl = [], OrderedDict(), None, []
    mode = 'stem'
    for ln in rec['body']:
        if answer is None:
            ma = RE_ANSWER.match(ln)
            if ma:
                answer = ma.group(1).strip()
                mode = 'post'
                continue
        me = RE_EXPLANATION.match(ln)
        if me and mode in ('post', 'expl'):
            mode = 'expl'
            if me.group(1).strip():
                expl.append(me.group(1).strip())
            continue
        mo = RE_OPTION.match(ln)
        if mo and mode in ('stem', 'opts'):
            mode = 'opts'
            options[mo.group(1)] = mo.group(2).strip()
            continue
        if mode == 'stem':
            stem.append(ln)
        elif mode == 'opts' and options:
            # continuation of the last option
            last = next(reversed(options))
            if ln.strip():
                options[last] = (options[last] + ' ' + ln.strip()).strip()
        elif mode == 'expl':
            expl.append(ln)
    return {
        'stem': '\n'.join(stem).strip(),
        'options': options,
        'answer_raw': answer,
        'explanation': '\n'.join(expl).strip(),
    }


def _as_number(text):
    if text is None:
        return None
    t = str(text).replace('\u2212', '-').replace(',', '').replace('$', '').strip()
    m = re.fullmatch(r'(-?\d+)\s*/\s*(\d+)', t)
    if m:
        return int(m.group(1)) / int(m.group(2))
    m = re.match(r'^-?\d*\.?\d+', t)
    return float(m.group(0)) if m else None


def lost_notation(rec):
    """The source renders no superscript or radical glyph anywhere in 1,893
    questions: it drops them or substitutes a base character. So "10 cubed"
    prints as "103" and "the square root of 49" as "49".

    A stem is only called corrupted when it does not work as written AND does
    work once the notation is restored -- "2.5 x 33 = 67.5" is wrong as printed
    (82.5) but exact as 2.5 x 3 cubed. That is proof, not a guess, and these
    items are unusable: a student reading them computes the printed sum and is
    marked wrong for being right."""
    if rec['subtest'] not in ('AR', 'MK'):
        return None
    stem = ' '.join((rec['stem'] or '').split())
    keyed = _as_number((rec['options'] or {}).get(rec['answer']))
    if keyed is None:
        return None

    # "xx" is x-squared and x-cubed alike, with the exponent gone for good.
    if re.search(r'\b([a-z])\1\b', stem):
        return 'lost_exponent_notation'

    m = re.match(r'^([\d.]+)\s*([×x*÷/])\s*([\d.]+)\s*=', stem)
    if not m:
        return None
    a, op, b = m.group(1), m.group(2), m.group(3)
    try:
        av, bv = float(a), float(b)
    except ValueError:
        return None

    def close(v):
        return v is not None and abs(v - keyed) <= 0.01

    literal = av * bv if op in '×x*' else (av / bv if bv else None)
    if close(literal):
        return None                      # reads correctly as printed

    for split in range(1, len(b)):
        base, exp = b[:split], b[split:]
        if not base.isdigit() or not exp.isdigit() or len(exp) > 1:
            continue
        try:
            v = float(base) ** int(exp)
        except Exception:
            continue
        if close(av * v if op in '×x*' else (av / v if v else None)):
            return 'lost_exponent_notation'

    try:
        if bv > 0 and close((av ** 0.5) * (bv ** 0.5) if op in '×x*' else (av ** 0.5) / (bv ** 0.5)):
            return 'lost_radical_notation'
    except Exception:
        pass
    return None


# Answer keys proven wrong by symbolic re-solve and checked by hand. A bad key
# is the worst defect a fixed bank can carry -- it teaches the error to
# everyone -- so these are excluded rather than shipped with a caveat.
# Re-run scripts/verify_math.py to reproduce.
WRONG_KEYS = {
    'MK-0053': 'Factor 9x^3 + 18x^2 - x - 2. Grouping gives 9x^2(x+2) - 1(x+2) '
               '= (9x^2 - 1)(x + 2), which is option A. The source keys C, '
               'which expands to 9x^3 - 9x^2 + 2x - 2 and is not the stem.',
}


def classify_auto_shop(text):
    t = text.lower()
    a = sum(1 for w in AUTO_TERMS if w in t)
    s = sum(1 for w in SHOP_TERMS if w in t)
    if a > s:
        return 'AI'
    if s > a:
        return 'SI'
    return 'AS'



# --------------------------------------------------------------- figures
# Figures live as embedded rasters (96 DPI JPEGs). Extracting the embedded
# bitmap beats re-rendering the page region: rendering would resample a 96 DPI
# source and lose detail rather than gain it.

FOOTER_Y = 700.0   # below this is the page rule and number box, never a figure


def question_anchors(doc):
    """{page_index: [(y_top, source_number), ...]} for every QUESTION marker."""
    anchors = {}
    for i in range(doc.page_count):
        page = doc[i]
        found = []
        for inst in page.search_for('QUESTION:'):
            if inst.y0 > FOOTER_Y:
                continue
            line = page.get_text('text', clip=fitz.Rect(
                inst.x0 - 2, inst.y0 - 2, page.rect.x1, inst.y1 + 2))
            m = re.search(r'QUESTION\s*:?\s*(\d+)', line)
            if m:
                found.append((inst.y0, int(m.group(1))))
        if found:
            anchors[i] = sorted(found)
    return anchors


def extract_figures(doc, records):
    """Attach each embedded image to the question whose vertical span holds it."""
    anchors = question_anchors(doc)
    by_number = {r['source_number']: r for r in records}
    os.makedirs(FIG_DIR, exist_ok=True)

    # Which question is live at the top of each page (a record can span pages).
    live_at_top = {}
    current = None
    for i in range(doc.page_count):
        live_at_top[i] = current
        for _, num in anchors.get(i, []):
            current = num

    saved = 0
    for i in range(doc.page_count):
        page = doc[i]
        marks = anchors.get(i, [])
        for img in page.get_images(full=True):
            xref = img[0]
            rects = page.get_image_rects(xref)
            if not rects:
                continue
            r = rects[0]
            if r.y0 > FOOTER_Y or r.width < 40 or r.height < 20:
                continue
            owner = live_at_top.get(i)
            for y, num in marks:
                if y <= r.y0:
                    owner = num
            rec = by_number.get(owner)
            if rec is None:
                continue
            try:
                info = doc.extract_image(xref)
            except Exception:
                continue
            # Write the embedded bytes untouched. These are JPEGs of line art:
            # re-encoding to PNG cannot undo the existing lossy artefacts and
            # roughly triples the size, which the offline cache pays for.
            ext = info['ext'] if info['ext'] in ('jpeg', 'jpg', 'png', 'gif') else 'png'
            ext = 'jpg' if ext == 'jpeg' else ext
            name = 'q%04d.%s' % (rec['source_number'], ext)
            if rec.get('figure'):                       # second image for one item
                rec['_fign'] = rec.get('_fign', 1) + 1
                name = 'q%04d_%d.%s' % (rec['source_number'], rec['_fign'], ext)
            dest = os.path.join(FIG_DIR, name)
            with open(dest, 'wb') as f:
                f.write(info['image'])
            if not rec.get('figure'):
                rec['figure'] = 'assets/figures/' + name
            saved += 1
    return saved


# ------------------------------------------------------------- PC passages

def group_passages(records):
    """Consecutive PC questions repeating the same passage share a passage_id.
    The passage is the stem minus its trailing question line."""
    import difflib

    def split_stem(stem):
        """Passage, then the question line. The question often wraps, leaving a
        final line that is just the answer blank, so pull preceding lines in
        until the question actually reads as one."""
        lines = [l for l in (stem or '').split('\n') if l.strip()]
        if len(lines) < 2:
            return '', stem or ''
        take = 1
        while take < len(lines) - 1:
            tail = ' '.join(lines[-take:]).strip()
            if len(re.sub(r'[_\s\.]', '', tail)) >= 12:
                break
            take += 1
        return '\n'.join(lines[:-take]).strip(), ' '.join(lines[-take:]).strip()

    pc = [r for r in records if r['subtest'] == 'PC']
    pc.sort(key=lambda r: r['source_number'])
    gid = 0
    prev_body, prev_id = None, None
    for r in pc:
        body, question = split_stem(r['stem'])
        r['_passage'] = body
        r['_question_line'] = question
        if prev_body and body and difflib.SequenceMatcher(
                None, prev_body[:300], body[:300]).ratio() > 0.85:
            r['passage_id'] = prev_id
        else:
            gid += 1
            prev_id = 'PSG-%03d' % gid
            r['passage_id'] = prev_id
        prev_body = body or prev_body
    sizes = Counter(r['passage_id'] for r in pc)
    return sum(1 for v in sizes.values() if v > 1), gid


# ----------------------------------------------------------------- tagging

def load_tag_rules():
    import yaml
    path = os.path.join(OUT_DIR, 'tag_rules.yaml')
    with open(path) as f:
        raw = yaml.safe_load(f)
    out = {'_fallback': raw.get('_fallback', {})}
    for sub, topics in raw.items():
        if sub in ('version', '_fallback'):
            continue
        out[sub] = [(t, [re.compile(p, re.I) for p in pats])
                    for t, pats in topics.items()]
    return out


def tag(rec, rules):
    sub = rec['subtest']
    lookup = 'AI' if sub == 'AS' else sub
    # A PC stem is mostly passage prose, which swamps the signal. What the item
    # actually tests is in its question line, so tag on that plus the options.
    if sub == 'PC':
        # Isolating the question line exactly is unreliable -- it wraps, and it
        # can trail passage prose. The last few hundred characters always hold
        # it, and are still short enough not to drown the signal in passage.
        stem = rec['stem'] or ''
        text = stem[-260:] + ' ' + ' '.join(str(v) for v in rec['options'].values())
    else:
        text = (rec['stem'] or '') + ' ' + ' '.join(str(v) for v in rec['options'].values())
    hits = []
    for topic, pats in rules.get(lookup, []):
        score = sum(1 for p in pats if p.search(text))
        if score:
            hits.append((score, topic))
    if not hits and sub == 'AS':
        for topic, pats in rules.get('SI', []):
            score = sum(1 for p in pats if p.search(text))
            if score:
                hits.append((score, topic))
    hits.sort(reverse=True)
    topics = [t for _, t in hits[:3]]
    if not topics:
        # A WK item that is a bare word is a synonym question; one embedded in a
        # sentence is testing the word in context.
        if sub == 'WK':
            return ['words_in_context'] if len((rec['stem'] or '').split()) > 4 \
                else ['synonyms_isolation']
        fb = (rules.get('_fallback') or {}).get(sub)
        if fb:
            rec['flags'].append('tag_fallback')
            return [fb]
    return topics


# -------------------------------------------------------------- difficulty

# Common English, for a crude vocabulary-rarity signal on Word Knowledge. A
# word outside this list is treated as the harder kind of item.
COMMON_WORDS = set("""
about above accept across act add admit agree allow almost alone along already also always
amount anger angry animal answer appear apply area argue arm arrive art ask attack attempt
avoid back bad bag ball bank base beat beautiful become begin behind believe below best better
big bill bird bit black blood blow blue board boat body book born both box boy break bring
brother build burn business buy call calm car care carry case catch cause center certain chance
change charge cheap check child choose city claim clean clear close cold collect color come
common company compare complete concern condition consider contain continue control cook copy
correct cost count country couple course cover create cross crowd cut dark date day dead deal
death decide deep degree depend describe design desire destroy detail develop die difference
difficult direct discover discuss divide do doctor dog door doubt down draw dream dress drink
drive drop dry early earth easy eat edge effect effort element else empty end enemy enough
enter equal escape even event ever exact example expect explain express eye face fact fail fall
false family far fast father fear feed feel few field fight fill final find fine finish fire
first fit fix flat floor flow fly follow food foot force forget form forward free fresh friend
front full future game general get girl give glass go gold good govern great green ground group
grow guard guess guide hair half hand hang happen happy hard head hear heart heat heavy help
high hold hole home hope horse hot hour house how human hundred hurt idea imagine important
increase indeed inside instead interest into iron join joy judge jump just keep key kill kind
king know land large last late laugh law lay lead learn leave left leg length less let letter
level lie life lift light like limit line list listen little live local long look lose lot loud
love low machine main major make man many mark market match matter may mean measure meet member
memory mention method middle might mind minute miss mix modern moment money month moon more
morning most mother mountain mouth move much music must name nation nature near necessary need
never new news next nice night none north note nothing notice now number object occur ocean
offer office often oil old once only open order other out over own page pain paint pair paper
part pass past pay peace people perfect perhaps period person pick picture piece place plan
plant play please point poor position possible power practice prepare present press pretty
prevent price print probable problem produce program promise prove provide public pull purpose
push put quality question quick quiet quite race raise reach read ready real reason receive
record red reduce refuse regard remain remember remove repeat reply report represent require
rest result return rich ride right ring rise river road rock roll room round rule run safe sail
same save say school science sea search season seat second secret see seem sell send sense
separate serious serve set settle several shake shape share sharp she ship shoot short should
show side sign silence similar simple since sing single sister sit size skin sky sleep slow
small smell smile snow social soft soldier solid some son song soon sort sound south space
speak special speed spend spirit spot spread spring square stand star start state station stay
step stick still stone stop store story straight strange street strength strike strong student
study subject succeed such sudden suffer suggest summer sun supply support suppose sure
surprise system table take talk teach team tell term test than thank that theory there thick
thin thing think third though thought thousand threat throw thus time tire today together too
top total touch toward town trade train travel treat tree trouble true trust try turn type
understand unit until up use usual value various very view visit voice wait walk wall want war
warm wash watch water way weak wear weather week weight well west what wheel when where whether
which while white who whole why wide wife wild will win wind window wish with woman wonder wood
word work world worry would write wrong year yes yet young
""".split())

MULTISTEP = re.compile(
    r'\b(then|after|remaining|left over|in total|altogether|combined|each of|'
    r'per (?:hour|mile|week|month|year|day)|how much more|how many more|'
    r'difference between|average of)\b', re.I)
NEGATION = re.compile(r'\b(EXCEPT|NOT|least likely|never|incorrect)\b')


def hardness(rec):
    """A relative score, not a level. Difficulty is assigned by rank within a
    subtest afterwards, because an absolute rule produces no spread at all:
    scored absolutely, four fifths of this bank lands on the same level and
    adaptive selection has nothing to choose between."""
    stem = rec['stem'] or ''
    opts = list(rec['options'].values())
    words = stem.split()
    score = 0.0

    score += min(len(words), 140) / 28.0                       # length
    score += min(len(re.findall(r'[+\-*/=×÷]', stem)), 8) * 0.55   # arithmetic
    score += min(len(re.findall(r'\d+(?:\.\d+)?', stem)), 8) * 0.30  # quantities
    if MULTISTEP.search(stem):
        score += 1.1
    if NEGATION.search(stem):
        score += 0.9
    if len(re.findall(r'[.?!]', stem)) >= 3:                    # several clauses
        score += 0.6

    # Long or widely varying options take longer to work through.
    if opts:
        lens = [len(str(o)) for o in opts]
        score += min(sum(lens) / max(len(lens), 1), 90) / 45.0
        score += min(max(lens) - min(lens), 60) / 60.0

    # Word Knowledge has no arithmetic to measure, so rarity carries it.
    if rec['subtest'] == 'WK':
        pool = [str(o).lower() for o in opts] + [w.lower().strip('.,;:') for w in words]
        rare = [w for w in pool if w.isalpha() and len(w) > 3 and w not in COMMON_WORDS]
        score += min(len(rare), 8) * 0.45
        longest = max([len(w) for w in pool if w.isalpha()] or [0])
        score += min(longest, 14) / 5.0

    # A long explanation usually means a long road to the answer.
    score += min(len(rec['explanation'] or ''), 600) / 300.0
    return score


def assign_difficulty(records):
    """Rank within subtest, then cut into five bands. Ranking guarantees a
    spread for adaptive selection to work across; the bands are 20/25/25/20/10
    rather than even fifths because a real test has fewer very hard items."""
    CUTS = [(0.20, 1), (0.45, 2), (0.70, 3), (0.90, 4), (1.01, 5)]
    by_sub = defaultdict(list)
    for rec in records:
        by_sub[rec['subtest']].append(rec)
    for sub, group in by_sub.items():
        scored = sorted(group, key=lambda r: hardness(r))
        n = len(scored)
        for i, rec in enumerate(scored):
            q = (i + 0.5) / n
            for edge, level in CUTS:
                if q < edge:
                    rec['difficulty'] = level
                    break


# ------------------------------------------------------- explanation shift

def flag_explanation_shift(records):
    """The source misattaches some explanations to the previous question.
    Signal: the explanation's wording matches the NEXT question's options far
    better than its own. Flagged, never silently repaired."""
    STOP = set('the a an of to in is are and or for on with that this it its by as be '
               'from at which was were will would can could not no so if then than '
               'you your they their what how many much more most some all any'.split())

    def toks(t):
        return set(w for w in re.findall(r"[a-z']{3,}", (t or '').lower()) if w not in STOP)

    def optset(r):
        return toks(' '.join(str(v) for v in r['options'].values()))

    def score(a, b):
        return len(a & b) / len(b) if a and b else 0.0

    ordered = sorted(records, key=lambda r: r['source_number'])
    n = 0
    for i, r in enumerate(ordered):
        e = r.get('explanation') or ''
        if len(e) < 40 or i + 1 >= len(ordered):
            continue
        et = toks(e)
        own, nxt = score(et, optset(r)), score(et, optset(ordered[i + 1]))
        if nxt >= own + 0.15 and nxt >= 0.3:
            r['flags'].append('explanation_may_belong_to_next')
            n += 1
    return n


# ---------------------------------------------------------------- assemble

def build(doc):
    raw = parse(doc, verbose=False)
    records = []
    for r in raw:
        parts = split_record(r)
        sec = r['section']
        stem, options = parts['stem'], parts['options']
        flags = []

        # Options rendered as pictures come through as bare "A." with no text.
        if len(options) < 4:
            if re.search(r'^\s*[A-D]\s*\.\s*$', stem or '', re.M):
                flags.append('image_options_unextractable')

        ans = (parts['answer_raw'] or '').strip()
        letters = re.findall(r'[A-D]', ans.upper())
        if len(letters) > 1:
            flags.append('multi_answer')

        subtest = sec
        if sec == 'AS':
            subtest = classify_auto_shop(
                (stem or '') + ' ' + ' '.join(str(v) for v in options.values()))

        records.append({
            'id': None,
            'source_number': r['source_number'],
            'subtest': subtest,
            'stem': stem,
            'options': dict(options),
            'answer': letters[0] if letters else None,
            'answer_raw': ans,
            'explanation': parts['explanation'],
            'figure': None,
            'passage_id': None,
            'topics': [],
            'difficulty': 2,
            'flags': flags,
            'page': r['page'],
        })

    assign_difficulty(records)
    nfig = extract_figures(doc, records)
    shared, npsg = group_passages(records)
    nshift = flag_explanation_shift(records)

    rules = load_tag_rules()
    for rec in records:
        rec['topics'] = tag(rec, rules)
        if rec['figure']:
            rec['flags'].append('has_figure')
        if not rec['topics']:
            rec['flags'].append('untagged')
        rec.pop('_fign', None)
        # The runtime shows the passage in its own panel above the question, so
        # PC items carry them apart rather than as one run-on stem.
        if rec['subtest'] == 'PC':
            rec['passage'] = rec.pop('_passage', '') or ''
            rec['question'] = rec.pop('_question_line', '') or rec['stem']
        else:
            rec.pop('_passage', None)
            rec.pop('_question_line', None)

    # An item the source cannot supply intact is marked rather than dropped:
    # questions.json keeps the full record for audit, the per-subtest chunks the
    # app loads leave it out.
    for rec in records:
        bad = []
        if not (rec['stem'] or '').strip():
            bad.append('no_stem')
        if len(rec['options']) < 2:
            bad.append('no_options')
        if not rec['answer']:
            bad.append('no_answer_key')
        # The source stripped every superscript and radical; a stem that only
        # resolves once they are restored cannot be shown as printed.
        lost = lost_notation(rec)
        if lost:
            bad.append(lost)
        if bad:
            rec['excluded'] = True
            rec['flags'].extend(bad)
        else:
            rec['excluded'] = False

    # stable per-subtest ids in source order
    counters = Counter()
    for rec in sorted(records, key=lambda r: r['source_number']):
        counters[rec['subtest']] += 1
        rec['id'] = '%s-%04d' % (rec['subtest'], counters[rec['subtest']])

    # Ids exist only now, so the verified-wrong keys are applied here.
    for rec in records:
        why = WRONG_KEYS.get(rec['id'])
        if why:
            rec['excluded'] = True
            rec['flags'].append('wrong_answer_key')
            rec['key_error'] = why

    return records, {'figures': nfig, 'passage_sets': npsg,
                     'shared_passages': shared, 'explanation_shift': nshift}


def write_outputs(records):
    os.makedirs(OUT_DIR, exist_ok=True)
    ordered = sorted(records, key=lambda r: r['source_number'])
    with open(os.path.join(OUT_DIR, 'questions.json'), 'w') as f:
        json.dump({'version': 1, 'source': 'source/asvab-source.pdf',
                   'count': len(ordered), 'questions': ordered}, f, indent=1)

    by_sub = defaultdict(list)
    for r in ordered:
        if not r.get('excluded'):
            by_sub[r['subtest']].append(r)
    # `total` counts what the app is actually served, so a loader can check it
    # against the chunks. `extracted` is the full parse, excluded items and all.
    nex = sum(1 for r in ordered if r.get('excluded'))
    manifest = {'version': 1,
                'total': len(ordered) - nex,
                'extracted': len(ordered),
                'excluded': nex,
                'subtests': {}}
    for code, group in sorted(by_sub.items()):
        # .js not .json: fetch() cannot read file:// URLs, and index.html must
        # keep working when double-clicked. See MIGRATION.md 7.3.
        path = os.path.join(OUT_DIR, 'questions.%s.js' % code)
        with open(path, 'w') as f:
            f.write('/* GENERATED by scripts/extract_bank.py -- do not edit. */\n')
            f.write('(function (root) {\n  root.ASVAB_BANK = root.ASVAB_BANK || {};\n')
            f.write('  root.ASVAB_BANK[%s] = %s;\n' % (json.dumps(code), json.dumps(group)))
            f.write('})(typeof self !== "undefined" ? self : this);\n')
        manifest['subtests'][code] = {
            'file': 'data/questions.%s.js' % code,
            'count': len(group),
            'bytes': os.path.getsize(path),
            'with_explanation': sum(1 for r in group if (r['explanation'] or '').strip()),
            'with_figure': sum(1 for r in group if r['figure']),
        }
    with open(os.path.join(OUT_DIR, 'questions.manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    # A script form as well: the browser cannot fetch() the .json from file://,
    # and the manifest has to be readable before any chunk is requested.
    with open(os.path.join(OUT_DIR, 'questions.manifest.js'), 'w') as f:
        f.write('/* GENERATED by scripts/extract_bank.py -- do not edit. */\n')
        f.write('(function (root) {\n  root.ASVAB_BANK_MANIFEST = %s;\n'
                % json.dumps(manifest))
        f.write('  if (typeof module === "object" && module.exports) '
                'module.exports = root.ASVAB_BANK_MANIFEST;\n')
        f.write('})(typeof self !== "undefined" ? self : this);\n')
    return manifest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', default=DEFAULT_PDF)
    ap.add_argument('--probe', type=int, metavar='N',
                    help='inspect layout of first N pages and exit')
    args = ap.parse_args()

    if not os.path.exists(args.pdf):
        sys.exit('source PDF not found: %s\n'
                 'Push it to the repo (see MIGRATION.md) or pass --pdf.' % args.pdf)

    doc = fitz.open(args.pdf)

    if args.probe is not None:
        probe(doc, args.probe)
        return

    records, stats = build(doc)
    manifest = write_outputs(records)

    nex = sum(1 for r in records if r.get('excluded'))
    print('extracted %d questions (%d excluded as unusable, %d served)'
          % (len(records), nex, len(records) - nex))
    print('  figures saved      : %d' % stats['figures'])
    print('  PC passage sets    : %d (%d questions share one)'
          % (stats['passage_sets'], stats['shared_passages']))
    print('  explanation shift  : %d flagged' % stats['explanation_shift'])
    print()
    print('%-5s %6s %8s %8s %9s' % ('sub', 'n', 'expl', 'figure', 'KB'))
    print('-' * 40)
    for code, m in sorted(manifest['subtests'].items()):
        print('%-5s %6d %8d %8d %9.1f'
              % (code, m['count'], m['with_explanation'], m['with_figure'],
                 m['bytes'] / 1024.0))
    print('-' * 40)
    print('%-5s %6d' % ('ALL', manifest['total']))


if __name__ == '__main__':
    main()
