#!/usr/bin/env python3
"""Validate the extracted question bank.

    python3 scripts/validate_bank.py

A fixed bank has one failure mode a generator does not: a wrong answer key
teaches the wrong thing, permanently, to every user. Dump PDFs contain wrong
keys. Nothing here auto-corrects anything -- disagreements are written to
data/review_needed.json for a human to adjudicate.
"""
import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
BANK = os.path.join(DATA, 'questions.json')
REVIEW = os.path.join(DATA, 'review_needed.json')

EXPECTED_TOTAL = 1894
SUBTESTS = ['GS', 'AR', 'WK', 'PC', 'MK', 'EI', 'AI', 'SI', 'AS', 'MC', 'AO']

import sympy
from sympy import sympify, Rational, simplify, solve, Symbol, expand

# --------------------------------------------------------------------- helpers

def norm_stem(s):
    return re.sub(r'\s+', ' ', (s or '')).strip().lower()


def to_number(text):
    """'$42.00' -> 42.0 ; '3 1/2' -> 3.5 ; '12%' -> 12.0 ; else None."""
    if text is None:
        return None
    t = str(text).strip()
    t = t.replace('−', '-').replace('–', '-')
    t = re.sub(r'[,$]', '', t)
    t = re.sub(r'\s*(dollars|cents|percent|%)\s*$', '', t, flags=re.I)
    m = re.fullmatch(r'(-?\d+)\s+(\d+)\s*/\s*(\d+)', t)          # mixed number
    if m:
        a, b, c = map(int, m.groups())
        sign = -1 if a < 0 else 1
        return float(abs(a) + Rational(b, c)) * sign
    m = re.fullmatch(r'(-?\d+)\s*/\s*(\d+)', t)                   # plain fraction
    if m:
        return float(Rational(int(m.group(1)), int(m.group(2))))
    m = re.match(r'^-?\d*\.?\d+', t)
    if m:
        try:
            return float(m.group(0))
        except ValueError:
            return None
    return None


def as_expr(text):
    """Parse an option as a symbolic expression, for MK simplify/factor items."""
    if text is None:
        return None
    t = str(text).strip()
    t = t.replace('−', '-').replace('^', '**').replace('×', '*')
    t = re.sub(r'[,$]', '', t)
    t = re.sub(r'(\d)\s*([a-zA-Z])', r'\1*\2', t)       # 3x -> 3*x
    t = re.sub(r'\)\s*\(', ')*(', t)                     # (x+1)(x+2)
    t = re.sub(r'([a-zA-Z0-9\)])\s*\(', r'\1*(', t)
    try:
        return sympify(t, rational=True)
    except Exception:
        return None


# ------------------------------------------------------------- re-solve engine
# Each solver returns a number, or None if the pattern does not apply. They are
# deliberately narrow: a solver that guesses produces false mismatches, which is
# worse than no coverage because it buries the real wrong keys.

def _single_rate(stem):
    """Reject tiered pricing: "$4.75 per mile for the first 25 miles and then
    $5.25 per mile over 25" is not one multiplication, and treating it as one
    produces a false mismatch on a perfectly good key."""
    if len(re.findall(r'\$\s*\d', stem)) > 1:
        return False
    if re.search(r'\bfirst\b|\bover\b|\badditional\b|\beach mile after\b|\bthen\b',
                 stem, re.I):
        return False
    return True


def solve_percent_of(stem):
    m = re.search(r'what\s+is\s+(\d+\.?\d*)\s*%\s+of\s+\$?(\d+\.?\d*)', stem, re.I)
    if m:
        return float(m.group(1)) / 100.0 * float(m.group(2))
    m = re.search(r'(\d+\.?\d*)\s*%\s+of\s+\$?([\d,]+\.?\d*)\s*(?:is|=)', stem, re.I)
    if m:
        return float(m.group(1)) / 100.0 * float(m.group(2).replace(',', ''))
    return None


def solve_unit_cost(stem):
    if not _single_rate(stem):
        return None
    m = re.search(r'(\d+\.?\d*)\s*(?:miles|items|units|pounds|hours|gallons|feet)\b'
                  r'[^.]{0,60}?\$\s*(\d+\.?\d*)\s*(?:per|a|each)\b', stem, re.I)
    if m:
        return float(m.group(1)) * float(m.group(2))
    return None


def solve_rect_area(stem):
    """"How many square feet ... 12-foot x 12-foot room" -> 144.

    Refuses any stem that asks for a COST rather than an area. "$8 per square
    foot ... 12 x 16 patio" wants 192 x 8, and answering 192 accuses a correct
    key of being wrong."""
    if re.search(r'\$|\bcost\b|\bcharges?\b|\bprice\b|how much will', stem, re.I):
        return None
    if not re.search(r'how many square|\barea\b', stem, re.I):
        return None
    if not re.search(r'square\s+(feet|foot|yards?|inches|meters?)', stem, re.I):
        return None
    m = re.search(r'(\d+\.?\d*)\s*-?\s*(?:foot|feet|yard|inch|meter)\s*'
                  r'[x\u00d7*]\s*(\d+\.?\d*)\s*-?\s*(?:foot|feet|yard|inch|meter)', stem, re.I)
    if m:
        return float(m.group(1)) * float(m.group(2))
    return None


def solve_power_or_root(stem):
    m = re.search(r'\bthe\s+(square|cube)\s+of\s+(\d+\.?\d*)', stem, re.I)
    if m:
        return float(m.group(2)) ** (2 if m.group(1).lower() == 'square' else 3)
    m = re.search(r'\bsquare\s+root\s+of\s+(\d+\.?\d*)', stem, re.I)
    if m:
        return float(m.group(1)) ** 0.5
    ORD = {'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5, 'sixth': 6}
    m = re.search(r'\b(second|third|fourth|fifth|sixth)\s+root\s+of\s+(\d+\.?\d*)', stem, re.I)
    if m:
        return float(m.group(2)) ** (1.0 / ORD[m.group(1).lower()])
    return None


def solve_linear_equation(stem):
    """Solve for an unknown. Deliberately refuses a stem of the form
    "If x = 2, then <expr>", which assigns the variable rather than asking for
    it -- reading that as an equation returns the assignment and libels the key."""
    if re.search(r'\bif\s+[a-z]\s*=\s*-?\d', stem, re.I):
        return None
    if not re.search(r'solve|value of|what is\s+[a-z]\b|find\s+[a-z]\b', stem, re.I):
        return None
    m = re.search(r'([0-9xXyYnN\+\-\*/\^\(\)\s\.]+=[0-9xXyYnN\+\-\*/\^\(\)\s\.]+)', stem)
    if not m:
        return None
    eq = m.group(1).strip()
    if '=' not in eq or not re.search(r'[a-zA-Z]', eq):
        return None
    lhs, rhs = eq.split('=', 1)
    L, R = as_expr(lhs), as_expr(rhs)
    if L is None or R is None:
        return None
    syms = sorted((L - R).free_symbols, key=lambda s: s.name)
    if len(syms) != 1:
        return None
    try:
        sols = solve(L - R, syms[0])
    except Exception:
        return None
    if len(sols) == 1:
        try:
            return float(sols[0])
        except (TypeError, ValueError):
            return None
    return None


def solve_bare_arithmetic(stem):
    """"2.5 x 33 = ___" or "What is 18 + 7?". Refuses anything carrying a
    variable, a second clause, or units that change the meaning."""
    if re.search(r'[a-wyz]\s*[\u00d7x*/]|\bper\b|\bof\b', stem, re.I):
        return None
    m = re.search(r'^\s*([0-9\.\,\s\+\-\*/\u00d7\u00f7\(\)]+?)\s*=\s*_+', stem)
    if not m:
        m = re.search(r'(?:what\s+is|compute|calculate)\s*:?\s*'
                      r'([0-9\.\,\s\+\-\*/\u00d7\u00f7\(\)]+?)\s*[\?=]', stem, re.I)
    if not m:
        return None
    t = m.group(1).replace('\u00d7', '*').replace('\u00f7', '/').replace(',', '').strip()
    if not re.search(r'[\+\-\*/]', t):
        return None
    try:
        return float(sympify(t, rational=True))
    except Exception:
        return None


NUMERIC_SOLVERS = [
    ('percent_of', solve_percent_of),
    ('unit_cost', solve_unit_cost),
    ('rect_area', solve_rect_area),
    ('power_or_root', solve_power_or_root),
    ('bare_arithmetic', solve_bare_arithmetic),
    ('linear_equation', solve_linear_equation),
]


_RESOLVE_CACHE = {}


def resolve_item(q):
    """-> (verdict, detail). verdict in agree / disagree / unverifiable.

    Memoised: sympy is slow and the summary table re-asks for every item."""
    key = id(q)
    if key in _RESOLVE_CACHE:
        return _RESOLVE_CACHE[key]
    out = _resolve_item(q)
    _RESOLVE_CACHE[key] = out
    return out


def _resolve_item(q):
    if q.get('subtest') not in ('AR', 'MK'):
        return 'skipped', None
    stem = q.get('stem') or ''
    # A stem the source corrupted cannot arbitrate its own key.
    if q.get('subtest') in ('AR', 'MK') and re.search(r'\b([a-z])\1\b', stem):
        return 'unverifiable', 'stem lost its exponent notation'
    keyed = (q.get('options') or {}).get(q.get('answer'))
    if keyed is None:
        return 'unverifiable', 'no keyed option'

    for name, fn in NUMERIC_SOLVERS:
        try:
            got = fn(stem)
        except Exception:
            got = None
        if got is None:
            continue
        want = to_number(keyed)
        if want is None:
            return 'unverifiable', 'keyed option is not numeric'
        if abs(got - want) <= max(0.01, abs(want) * 1e-6):
            return 'agree', name
        # Before calling it a disagreement, check the computed value matches
        # SOME other option -- that is a genuine wrong key, not a bad parse.
        for letter, text in (q.get('options') or {}).items():
            ov = to_number(text)
            if ov is not None and abs(got - ov) <= max(0.01, abs(ov) * 1e-6):
                return 'disagree', ('%s: computed %s = option %s, key says %s'
                                    % (name, got, letter, q.get('answer')))
        return 'unverifiable', '%s computed %s, matches no option' % (name, got)
    return 'unverifiable', 'no solver matched'


# ------------------------------------------------------------------ structural

def check_structure(items):
    """Problems on items the extractor already excluded are expected -- they are
    why it excluded them. Only a problem on an item the app will actually serve
    is a build failure."""
    problems = []
    for q in items:
        if q.get('excluded'):
            continue
        qid = q.get('id', '<no id>')
        if not (q.get('stem') or '').strip():
            problems.append((qid, 'missing stem'))
        opts = q.get('options') or {}
        if len(opts) < 2:
            problems.append((qid, 'fewer than 2 options (%d)' % len(opts)))
        ans = q.get('answer')
        if not ans:
            problems.append((qid, 'missing answer letter'))
        elif ans not in opts:
            problems.append((qid, 'answer "%s" not among options %s'
                             % (ans, ''.join(sorted(opts)))))
        if not q.get('topics'):
            problems.append((qid, 'no topic tag'))
    return problems


def check_duplicates(items):
    """Two items are duplicates only if stem AND options AND figure all match.
    Stem alone is wrong here: every Assembling Objects item carries the same
    boilerplate sentence, and several EI items share "The symbol above is a/an"
    while showing different symbols. Those are distinct questions."""
    seen, dupes = {}, []
    for q in items:
        opts = '|'.join('%s=%s' % (k, norm_stem(str(v)))
                        for k, v in sorted((q.get('options') or {}).items()))
        k = norm_stem(q.get('stem')) + '||' + opts + '||' + str(q.get('figure') or '')
        if not norm_stem(q.get('stem')) and not opts:
            continue
        if k in seen:
            dupes.append((seen[k], q.get('id'), k[:70]))
        else:
            seen[k] = q.get('id')
    return dupes


def check_lost_math_notation(items):
    """The source PDF renders no superscript or radical glyph anywhere: it drops
    them or substitutes a base character. So "49 x 64 = 56" is really
    sqrt(49) x sqrt(64), and "xx" is x-squared or x-cubed with the exponent gone.
    These stems are unusable as extracted -- flagged, never guessed at."""
    flagged = []
    for q in items:
        if q.get('subtest') not in ('AR', 'MK'):
            continue
        stem = q.get('stem') or ''
        keyed = to_number((q.get('options') or {}).get(q.get('answer')))
        # doubled variable: x-squared and x-cubed both extract as "xx"
        if re.search(r'\b([a-z])\1\b', stem):
            q['_notation_lost'] = True
            flagged.append((q.get('id'), 'lost_exponent', stem[:60]))
            continue
        if keyed is None:
            continue
        m = re.match(r'^\s*(\d+)\s*[\u00d7x*]\s*(\d+)\s*=\s*_+', stem)
        if m:
            a, b = float(m.group(1)), float(m.group(2))
            if abs(a * b - keyed) > 0.01 and abs(a ** 0.5 * b ** 0.5 - keyed) <= 0.01:
                flagged.append((q.get('id'), 'lost_radical', stem[:60]))
                q['_notation_lost'] = True
    return flagged


def check_option_balance(items):
    """Correct option conspicuously the longest is a giveaway unrelated to
    knowledge. Only flagged when the gap is wide and the options are prose."""
    flagged = []
    for q in items:
        opts = q.get('options') or {}
        ans = q.get('answer')
        if ans not in opts or len(opts) < 3:
            continue
        correct = str(opts[ans])
        others = [str(v) for k, v in opts.items() if k != ans]
        if not others:
            continue
        longest_other = max(len(o) for o in others)
        if len(correct) > 24 and len(correct) > longest_other * 1.6 + 10:
            flagged.append((q.get('id'), len(correct), longest_other))
    return flagged


def check_explanations(items):
    empty, thin, restates = [], [], []
    for q in items:
        e = (q.get('explanation') or '').strip()
        qid = q.get('id')
        if not e:
            empty.append(qid)
            continue
        if len(e) < 15:
            thin.append(qid)
            continue
        keyed = (q.get('options') or {}).get(q.get('answer'))
        if keyed and norm_stem(e).rstrip('.') == norm_stem(str(keyed)).rstrip('.'):
            restates.append(qid)
    return empty, thin, restates


def check_numbering(items):
    nums = [q.get('source_number') for q in items if q.get('source_number')]
    if not nums:
        return [], []
    lo, hi = min(nums), max(nums)
    gaps = sorted(set(range(lo, hi + 1)) - set(nums))
    dupes = sorted(k for k, v in Counter(nums).items() if v > 1)
    return gaps, dupes


# ----------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bank', default=BANK)
    args = ap.parse_args()

    if not os.path.exists(args.bank):
        sys.exit('bank not found: %s\nRun scripts/extract_bank.py first.' % args.bank)

    with open(args.bank) as f:
        blob = json.load(f)
    items = blob['questions'] if isinstance(blob, dict) else blob

    print('=' * 68)
    print('BANK VALIDATION  --  %d questions' % len(items))
    print('=' * 68)

    review = []

    # ---- counts and gaps
    print('\n[counts]')
    print('  extracted            : %d' % len(items))
    print('  expected (approx)    : %d  (delta %+d)'
          % (EXPECTED_TOTAL, len(items) - EXPECTED_TOTAL))
    gaps, dupenums = check_numbering(items)
    print('  gaps in source_number: %d %s' % (len(gaps), gaps[:20]))
    print('  duplicate numbers    : %d %s' % (len(dupenums), dupenums[:20]))
    for g in gaps:
        review.append({'kind': 'missing_source_number', 'source_number': g})

    # ---- structural
    print('\n[structure]')
    problems = check_structure(items)
    nex = sum(1 for q in items if q.get('excluded'))
    print('  served items         : %d' % (len(items) - nex))
    print('  excluded as unusable : %d (kept in questions.json, not served)' % nex)
    print('  hard problems        : %d' % len(problems))
    for qid, msg in problems[:15]:
        print('    %-12s %s' % (qid, msg))
    if len(problems) > 15:
        print('    ... and %d more' % (len(problems) - 15))
    for qid, msg in problems:
        review.append({'kind': 'structure', 'id': qid, 'detail': msg})

    # ---- multi-answer keys
    multi = [q for q in items if len(str(q.get('answer_raw') or q.get('answer') or '')
                                     .replace(' ', '').replace(',', '')) > 1]
    print('  multi-letter keys    : %d  (real ASVAB is single-answer)' % len(multi))
    for q in multi:
        review.append({'kind': 'multi_answer', 'id': q.get('id'),
                       'answer_raw': q.get('answer_raw')})

    # ---- duplicates
    print('\n[duplicates]')
    dupes = check_duplicates(items)
    print('  duplicate stems      : %d' % len(dupes))
    for a, b, s in dupes[:10]:
        print('    %s == %s  "%s"' % (a, b, s))
    for a, b, s in dupes:
        review.append({'kind': 'duplicate_stem', 'kept': a, 'dropped': b, 'stem': s})

    # Lost-notation detection runs first so the re-solve can stand down on any
    # stem the source mangled.
    check_lost_math_notation(items)

    # ---- independent re-solve
    print('\n[independent re-solve: AR and MK]')
    verdicts = Counter()
    by_solver = Counter()
    for q in items:
        if q.get('_notation_lost'):
            verdicts['unverifiable'] += 1
            continue
        v, detail = resolve_item(q)
        verdicts[v] += 1
        if v == 'agree':
            by_solver[detail] += 1
        if v == 'disagree':
            review.append({'kind': 'key_mismatch', 'id': q.get('id'),
                           'stem': q.get('stem'), 'options': q.get('options'),
                           'keyed_answer': q.get('answer'), 'detail': detail})
    mathitems = sum(1 for q in items if q.get('subtest') in ('AR', 'MK'))
    print('  AR+MK items          : %d' % mathitems)
    print('  verified (agree)     : %d' % verdicts['agree'])
    print('  DISAGREE with key    : %d   <-- written to review_needed.json'
          % verdicts['disagree'])
    print('  unverifiable         : %d' % verdicts['unverifiable'])
    if mathitems:
        print('  coverage             : %.1f%%'
              % (100.0 * (verdicts['agree'] + verdicts['disagree']) / mathitems))
    if by_solver:
        print('  by solver            : %s' % dict(by_solver))

    # ---- lost math notation
    print('\n[lost math notation in source]')
    lost = check_lost_math_notation(items)
    print('  corrupted stems      : %d' % len(lost))
    for qid, kind, stem in lost[:8]:
        print('    %-12s %-14s %s' % (qid, kind, ' '.join(stem.split())[:46]))
    for qid, kind, stem in lost:
        review.append({'kind': kind, 'id': qid, 'stem': stem})

    # ---- option balance
    print('\n[option length balance]')
    bal = check_option_balance(items)
    print('  correct-is-longest   : %d' % len(bal))
    for qid, c, o in bal[:10]:
        print('    %-12s correct %d chars vs longest other %d' % (qid, c, o))
    for qid, c, o in bal:
        review.append({'kind': 'option_length', 'id': qid,
                       'correct_len': c, 'longest_other': o})

    # ---- explanations
    print('\n[explanations]')
    empty, thin, restates = check_explanations(items)
    print('  empty                : %d' % len(empty))
    print('  under 15 chars       : %d' % len(thin))
    print('  restates the answer  : %d' % len(restates))
    for qid in thin + restates:
        review.append({'kind': 'weak_explanation', 'id': qid})

    # ---- summary table
    print('\n' + '=' * 68)
    print('SUMMARY BY SUBTEST')
    print('=' * 68)
    hdr = ('%-5s %6s %8s %8s %8s %8s' %
           ('sub', 'n', '%expl', '%figure', '%verif', '%flagged'))
    print(hdr)
    print('-' * len(hdr))
    flagged_ids = {r.get('id') for r in review if r.get('id')}
    per = defaultdict(list)
    for q in items:
        per[q.get('subtest') or '??'].append(q)
    for code in SUBTESTS + sorted(set(per) - set(SUBTESTS)):
        group = per.get(code)
        if not group:
            continue
        n = len(group)
        pe = 100.0 * sum(1 for q in group if (q.get('explanation') or '').strip()) / n
        pf = 100.0 * sum(1 for q in group if q.get('figure')) / n
        ver = sum(1 for q in group if resolve_item(q)[0] in ('agree', 'disagree'))
        pv = 100.0 * ver / n
        pfl = 100.0 * sum(1 for q in group if q.get('id') in flagged_ids) / n
        print('%-5s %6d %7.1f%% %7.1f%% %7.1f%% %7.1f%%' % (code, n, pe, pf, pv, pfl))
    print('-' * len(hdr))
    print('%-5s %6d' % ('ALL', len(items)))

    # ---- pool depth
    print('\n' + '=' * 68)
    print('POOL DEPTH  --  full CAT exams before repeats are unavoidable')
    print('=' * 68)
    cat135 = {'GS': 15, 'AR': 15, 'WK': 15, 'PC': 10, 'MK': 15,
              'EI': 15, 'AI': 10, 'SI': 10, 'MC': 15, 'AO': 15}
    worst, worst_code = None, None
    for code, need in cat135.items():
        have = len(per.get(code, []))
        exams = have // need if need else 0
        flag = ''
        if worst is None or exams < worst:
            worst, worst_code = exams, code
        if exams < 3:
            flag = '  <-- thin'
        print('  %-3s  %4d items / %2d per exam = %3d exams%s'
              % (code, have, need, exams, flag))
    print('\n  BINDING CONSTRAINT: %s at %d full exams.' % (worst_code, worst))

    with open(REVIEW, 'w') as f:
        json.dump({'generated': 'scripts/validate_bank.py',
                   'count': len(review), 'items': review}, f, indent=2)
    print('\nwrote %s (%d entries)' % (os.path.relpath(REVIEW, ROOT), len(review)))

    hard = len(problems)
    if hard:
        print('\nFAIL -- %d structural problems' % hard)
    else:
        print('\nSTRUCTURE OK')
    return 1 if hard else 0


if __name__ == '__main__':
    sys.exit(main())
