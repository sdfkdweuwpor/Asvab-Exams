#!/usr/bin/env python3
"""Clear the tagging stragglers by hand.

    python3 scripts/tag_review.py            # review items that hit a fallback
    python3 scripts/tag_review.py --subtest PC
    python3 scripts/tag_review.py --list     # just count what is left

Shows one low-confidence item, offers its subtest's topics, and on a keystroke
appends a rule to data/tag_rules.yaml so the next extraction tags it and every
item phrased like it. Re-run scripts/extract_bank.py afterwards to apply.
"""
import argparse
import json
import os
import re
import sys
from collections import Counter

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
RULES = os.path.join(DATA, 'tag_rules.yaml')

HEADER = ('# Topic tagging rules. Editable by hand; scripts/tag_review.py appends here.\n'
          '# Topic IDs are EXACTLY the 64 declared in config/test-config.json, so every\n'
          '# tag resolves to one of the 64 existing lessons. _fallback is the topic used\n'
          '# when no rule fires, so no item is left unrankable.\n')

STOP = set('the a an of to in is are and or for on with that this it its by as be from at '
           'which was were will would can could not no so if then than you your they their '
           'what how many much more most some all any each other into out up down about '
           'following these those there when where who whom whose does did has have had'.split())


def load_rules():
    with open(RULES) as f:
        return yaml.safe_load(f)


def save_rules(r):
    with open(RULES, 'w') as f:
        f.write(HEADER)
        yaml.safe_dump(r, f, default_flow_style=False, sort_keys=True,
                       width=100, allow_unicode=True)


def suggest(stem, options):
    """Distinctive phrases from the item, as starting points for a rule."""
    text = ' '.join((stem or '').split())
    out = []
    # a stock question frame is the most reusable rule
    m = re.search(r'([A-Z][^.?]{12,70}(?:__+|\?))\s*$', text)
    if m:
        frame = m.group(1)
        frame = re.sub(r'_{2,}', '', frame).strip(' .?')
        frame = re.sub(r'\s+', r'\\s+', re.escape(frame.lower()))
        if len(frame) < 120:
            out.append(frame)
    words = [w for w in re.findall(r"[a-z][a-z'-]{4,}", text.lower()) if w not in STOP]
    for w, _ in Counter(words).most_common(4):
        out.append(r'\b%s\b' % re.escape(w))
    return out[:5]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--subtest')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args()

    with open(os.path.join(DATA, 'questions.json')) as f:
        items = [q for q in json.load(f)['questions'] if not q.get('excluded')]
    pending = [q for q in items if 'tag_fallback' in q.get('flags', [])]
    if args.subtest:
        pending = [q for q in pending if q['subtest'] == args.subtest.upper()]

    if args.list or not pending:
        c = Counter(q['subtest'] for q in pending)
        print('%d item(s) on a fallback tag' % len(pending))
        for s, n in c.most_common():
            print('  %-3s %d' % (s, n))
        if not pending:
            print('nothing to review.')
        return 0

    rules = load_rules()
    added = 0
    print('%d item(s) to review. Enter=skip, q=quit and save.\n' % len(pending))

    for idx, q in enumerate(pending, 1):
        if args.limit and added >= args.limit:
            break
        sub = q['subtest']
        look = 'AI' if sub == 'AS' else sub
        topics = sorted(rules.get(look, {}))
        if not topics:
            continue

        print('=' * 68)
        print('[%d/%d]  %s  %s   currently: %s'
              % (idx, len(pending), q['id'], sub, ', '.join(q['topics']) or '-'))
        print('-' * 68)
        stem = ' '.join((q['stem'] or '').split())
        print(stem[:600] + ('...' if len(stem) > 600 else ''))
        for k, v in sorted((q.get('options') or {}).items()):
            print('   %s. %s' % (k, str(v)[:80]))
        print()
        for i, t in enumerate(topics, 1):
            print('  %2d) %s' % (i, t))

        try:
            choice = input('\ntopic number (Enter=skip, q=quit): ').strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if choice.lower() == 'q':
            break
        if not choice.isdigit() or not (1 <= int(choice) <= len(topics)):
            continue
        topic = topics[int(choice) - 1]

        cands = suggest(q['stem'], q.get('options'))
        print('\nsuggested patterns:')
        for i, c in enumerate(cands, 1):
            print('  %2d) %s' % (i, c))
        try:
            pick = input('pattern number, or type your own regex: ').strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not pick:
            continue
        pattern = cands[int(pick) - 1] if pick.isdigit() and 1 <= int(pick) <= len(cands) else pick
        try:
            re.compile(pattern)
        except re.error as e:
            print('  !! not a valid regex (%s) -- skipped' % e)
            continue

        bucket = rules.setdefault(look, {}).setdefault(topic, [])
        if pattern in bucket:
            print('  (already present)')
            continue
        bucket.append(pattern)
        added += 1
        print('  + %s -> %s.%s' % (pattern, look, topic))

    if added:
        save_rules(rules)
        print('\nwrote %d new rule(s) to data/tag_rules.yaml' % added)
        print('re-run:  python3 scripts/extract_bank.py')
    else:
        print('\nno rules added.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
