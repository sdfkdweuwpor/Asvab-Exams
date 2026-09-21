#!/usr/bin/env python3
"""Symbolically re-solve the algebra questions and check their answer keys.

This became possible only once the lost superscripts were recoverable. Before,
"x3 x x3" was unparseable noise; restored to x**3 * x**3 it is something sympy
can evaluate exactly, and an exact symbolic check is far stronger than the
numeric spot-checks in validate_bank.py.

Same rule as dom.mathText: a variable followed by digits is an exponent,
because a coefficient is written in front (3x, never x3). Maths subtests only.
"""
import json, os, re, sys
from collections import Counter

import sympy
from sympy import symbols, simplify, expand, factor, sympify, Eq, solve, nsimplify

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK = os.path.join(ROOT, 'data', 'questions.json')

VAR_POW = re.compile(r'([a-zA-Z])(\d{1,2})\b')
PAREN_POW = re.compile(r'\)(\d{1,2})\b')


def restore(t):
    """x3 -> x**3, (x2)3 -> (x**2)**3."""
    t = VAR_POW.sub(r'\1**\2', t)
    t = PAREN_POW.sub(r')**\1', t)
    return t


def to_expr(t):
    """Parse a stem fragment or an option into a sympy expression, or None."""
    if t is None:
        return None
    s = str(t).strip()
    s = (s.replace('−', '-').replace('×', '*').replace('÷', '/')
           .replace('^', '**').replace(',', ''))
    s = re.sub(r'_{2,}', '', s)
    s = s.strip(' .=')
    if not s or re.search(r'[A-Za-z]{3,}', s):     # prose, not an expression
        return None
    s = restore(s)
    s = re.sub(r'(\d)\s*\(', r'\1*(', s)           # 2(x+1)
    s = re.sub(r'\)\s*\(', ')*(', s)               # (x+1)(x+2)
    s = re.sub(r'(\d)\s*([a-zA-Z])', r'\1*\2', s)  # 3x
    s = re.sub(r'\)\s*([a-zA-Z])', r')*\1', s)
    try:
        e = sympify(s, rational=True)
        return e if e.free_symbols or e.is_number else None
    except Exception:
        return None


def stem_target(stem):
    """The expression a stem is asking the student to evaluate, plus any
    substitution it supplies. Returns (expr, subs) or (None, None)."""
    s = ' '.join((stem or '').split())
    subs = {}

    # "If a = 4, then a3 / a = ___"
    m = re.match(r"^If\s+([a-z])\s*=\s*(-?\d+(?:\.\d+)?)\s*,?\s*then\s+(.+?)\s*=\s*_+", s, re.I)
    if m:
        subs[symbols(m.group(1))] = sympify(m.group(2))
        return to_expr(m.group(3)), subs

    # "Factor x2 - 6x + 9."
    m = re.match(r"^Factor\s+(.+?)\s*[\.\?]?$", s, re.I)
    if m:
        e = to_expr(m.group(1))
        return (factor(e) if e is not None else None), subs

    # "Simplify / Evaluate / What is  EXPR"
    m = re.match(r"^(?:Simplify|Evaluate|Expand|What is|Compute)\s*:?\s*(.+?)\s*[\.\?]?$", s, re.I)
    if m and '=' not in m.group(1):
        return to_expr(m.group(1)), subs

    # plain "EXPR = ___"
    m = re.match(r"^(.+?)\s*=\s*_+", s)
    if m and '=' not in m.group(1):
        return to_expr(m.group(1)), subs

    return None, None


def solve_for_unknown(q):
    """Stems that state an equation and ask for the variable's value:
       "Solve for x: 3x + 5 = 20"  /  "(9)(2)(8) = x2. What's the value of x?"
    Returns a set of solutions, or None."""
    s = ' '.join((q.get('stem') or '').split())
    if not re.search(r"(solve for|value of|what(?:'s| is) )\s*([a-z])\b", s, re.I):
        return None, None
    mv = re.search(r"(?:solve for|value of|what(?:'s| is))\s*([a-z])\b", s, re.I)
    if not mv:
        return None, None
    var = symbols(mv.group(1))

    # the equation is the part containing a single '='
    for chunk in re.split(r"[.?]", s):
        if chunk.count('=') != 1:
            continue
        lhs, rhs = chunk.split('=')
        lhs = re.sub(r"^\s*(?:solve for\s+[a-z]\s*:?)\s*", '', lhs, flags=re.I)
        L, R = to_expr(lhs), to_expr(rhs)
        if L is None or R is None:
            continue
        if var not in (L - R).free_symbols:
            continue
        try:
            sols = solve(Eq(L, R), var)
        except Exception:
            continue
        if sols:
            return set(sols), var
    return None, None


def check(q):
    """-> (verdict, detail). agree / disagree / unverifiable."""
    if q.get('subtest') not in ('MK', 'AR'):
        return 'skipped', None

    # equations asking for a variable's value are checked against the option set
    sols, var = solve_for_unknown(q)
    if sols:
        opts = q.get('options') or {}
        hits = []
        for k, v in opts.items():
            vals = set()
            for part in str(v).split(','):
                e = to_expr(part)
                if e is not None:
                    vals.add(e)
            if vals and vals <= sols:
                hits.append(k)
        key = q.get('answer')
        if len(hits) == 1:
            if hits[0] == key:
                return 'agree', '%s = %s' % (var, opts[key])
            return 'disagree', ('solved %s in %s, matching option %s, key says %s (%s)'
                                % (var, sols, hits[0], key, opts.get(key)))
        return 'unverifiable', 'solved %s = %s, matched %d option(s)' % (var, sols, len(hits))

    target, subs = stem_target(q.get('stem'))
    if target is None:
        return 'unverifiable', 'stem is not a single expression to evaluate'
    try:
        if subs:
            target = target.subs(subs)
        target = simplify(expand(target))
    except Exception as e:
        return 'unverifiable', 'could not simplify: %s' % e

    opts, parsed = q.get('options') or {}, {}
    for k, v in opts.items():
        e = to_expr(v)
        if e is None:
            return 'unverifiable', 'option %s is not an expression' % k
        try:
            parsed[k] = simplify(expand(e.subs(subs) if subs else e))
        except Exception:
            return 'unverifiable', 'could not simplify option %s' % k

    matches = []
    for k, e in parsed.items():
        try:
            if simplify(e - target) == 0:
                matches.append(k)
        except Exception:
            pass

    key = q.get('answer')
    if not matches:
        return 'unverifiable', 'computed %s, which matches no option' % target
    if len(matches) > 1:
        return 'unverifiable', 'options %s are all equal to %s' % (','.join(sorted(matches)), target)
    if matches[0] == key:
        return 'agree', '%s = %s' % (target, opts[key])
    return 'disagree', 'computed %s = option %s, key says %s (%s)' % (
        target, matches[0], key, opts.get(key))


def main():
    with open(BANK) as f:
        items = [q for q in json.load(f)['questions'] if not q.get('excluded')]

    verdicts, bad, unver = Counter(), [], []
    for q in items:
        v, d = check(q)
        verdicts[v] += 1
        if v == 'disagree':
            bad.append((q, d))
        elif v == 'unverifiable' and q.get('subtest') in ('MK', 'AR'):
            unver.append((q, d))

    math_n = sum(1 for q in items if q.get('subtest') in ('MK', 'AR'))
    print('=' * 70)
    print('SYMBOLIC RE-SOLVE — algebra and arithmetic expressions')
    print('=' * 70)
    print('  AR + MK items        : %d' % math_n)
    print('  symbolically checked : %d' % (verdicts['agree'] + verdicts['disagree']))
    print('  key CONFIRMED        : %d' % verdicts['agree'])
    print('  key DISAGREES        : %d' % verdicts['disagree'])
    print('  not an expression    : %d' % verdicts['unverifiable'])

    if bad:
        print('\n--- disagreements ---')
        for q, d in bad:
            print('  %-9s %s' % (q['id'], ' '.join(q['stem'].split())[:52]))
            print('            options %s' % q['options'])
            print('            %s' % d)
    return len(bad)


if __name__ == '__main__':
    sys.exit(0 if main() == 0 else 1)
