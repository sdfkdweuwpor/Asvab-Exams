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
from collections import Counter, OrderedDict

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

# Section headings, in PDF order. Matched loosely against a whole line.
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
]
SHOP_TERMS = [
    'chisel', 'plane', 'miter', 'lathe', 'solder', 'rivet', 'wrench',
    'wood joint', 'file', 'punch', 'hacksaw', 'screwdriver', 'pliers',
    'sandpaper', 'vise', 'clamp', 'drill bit', 'router', 'awl', 'mallet',
    'dovetail', 'plywood', 'tenon', 'mortise', 'level', 'square', 'caliper',
    'saw', 'hammer', 'anvil', 'grinder', 'tap and die', 'lumber',
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


def classify_auto_shop(text):
    t = text.lower()
    a = sum(1 for w in AUTO_TERMS if w in t)
    s = sum(1 for w in SHOP_TERMS if w in t)
    if a > s:
        return 'AI'
    if s > a:
        return 'SI'
    return 'AS'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', default=DEFAULT_PDF)
    ap.add_argument('--probe', type=int, metavar='N',
                    help='inspect layout of first N pages and exit')
    args = ap.parse_args()

    if not os.path.exists(args.pdf):
        sys.exit('source PDF not found: %s\n'
                 'Push it to the repo (see MIGRATION.md §8) or pass --pdf.' % args.pdf)

    doc = fitz.open(args.pdf)

    if args.probe is not None:
        probe(doc, args.probe)
        return

    records = parse(doc)
    if not records:
        sys.exit('No QUESTION: markers matched. Run --probe 12 and adjust '
                 'RE_QUESTION / FURNITURE to the real layout before retrying.')

    by_section = Counter(r['section'] for r in records)
    print('\nrecords per PDF section:')
    for k, v in by_section.items():
        print('  %-6s %d' % (k, v))
    print('\nSplitting and figure extraction are wired in the next pass, once '
          '--probe has confirmed the layout against the real file.')


if __name__ == '__main__':
    main()
