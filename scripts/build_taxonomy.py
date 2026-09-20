#!/usr/bin/env python3
"""Build data/taxonomy.json and print the lesson-coverage report.

Answers two questions the fixed bank raises and the generated content never
did: which of the 64 lessons now have no questions behind them, and which
questions are about something no lesson teaches.
"""
import json
import os
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')

# Content the bank carries that none of the 64 lessons covers. Recorded rather
# than quietly folded into a neighbouring topic, because a "Work On" card that
# deep-links to a lesson which does not teach the thing is worse than one that
# admits the gap.
KNOWN_GAPS = {
    'AR': [('area_word_problems',
            'Carpeting, flooring and work-space problems: area arithmetic in an '
            'AR word problem. Currently tagged unit_conversion. MK teaches the '
            'geometry, but no lesson teaches it as an AR word problem.')],
    'MC': [('thermal_properties',
            'Heat conduction and material properties ("which tool feels hottest"). '
            'Currently tagged force_pressure. No MC lesson covers thermal behaviour.')],
    'EI': [('digital_computer',
            'Memory cards, serial cables, connectors. Currently tagged components. '
            'No lesson covers digital or computer hardware.')],
    'AI': [('tires_wheels',
            'Tire designation codes (205/55 R 15, G78-15), wheel balance and '
            'alignment. Currently tagged diagnostics. No lesson covers tires.')],
}


def main():
    with open(os.path.join(DATA, 'questions.json')) as f:
        items = [q for q in json.load(f)['questions'] if not q.get('excluded')]
    with open(os.path.join(ROOT, 'config/test-config.json')) as f:
        cfg = json.load(f)
    with open(os.path.join(ROOT, 'lessons/lessons.json')) as f:
        raw = json.load(f)
        lessons = raw if isinstance(raw, list) else raw.get('lessons', [])

    lesson_by_key = {(l['subtest'], l['topic']): l for l in lessons}
    declared = cfg['topics']

    counts = Counter()
    diffs = defaultdict(list)
    fallbacks = Counter()
    for q in items:
        sub = q['subtest']
        look = 'AI' if sub == 'AS' else sub
        for t in q['topics']:
            counts[(look, t)] += 1
            diffs[(look, t)].append(q.get('difficulty', 2))
            if 'tag_fallback' in q.get('flags', []):
                fallbacks[(look, t)] += 1

    taxonomy = {'version': 1,
                'note': 'Topic IDs match config/test-config.json and lessons/lessons.json '
                        '1:1. gaps[] lists content the bank carries that no lesson teaches.',
                'subtests': {}}

    print('=' * 70)
    print('LESSON COVERAGE REPORT')
    print('=' * 70)

    orphan_lessons, thin_lessons = [], []
    for sub in sorted(declared):
        entry = {'topics': {}, 'gaps': []}
        for topic in declared[sub]:
            n = counts.get((sub, topic), 0)
            lesson = lesson_by_key.get((sub, topic))
            ds = diffs.get((sub, topic), [])
            entry['topics'][topic] = {
                'lesson': lesson['id'] if lesson else None,
                'title': lesson['title'] if lesson else None,
                'questions': n,
                'tag_fallbacks': fallbacks.get((sub, topic), 0),
                'difficulty_mean': round(sum(ds) / len(ds), 2) if ds else None,
                'difficulty_spread': sorted(set(ds)),
                'subtopics': [],
            }
            if n == 0:
                orphan_lessons.append((sub, topic, lesson['id'] if lesson else '-'))
            elif n < 8:
                thin_lessons.append((sub, topic, n))
        for name, why in KNOWN_GAPS.get(sub, []):
            entry['gaps'].append({'proposed_topic': name, 'lesson': None, 'why': why})
        taxonomy['subtests'][sub] = entry

    print('\n--- lessons with NO questions (deep-link would dead-end) ---')
    if orphan_lessons:
        for sub, topic, lid in orphan_lessons:
            print('  %-3s %-24s %s' % (sub, topic, lid))
    else:
        print('  none -- all 64 lessons have questions behind them')

    print('\n--- lessons with fewer than 8 questions (drill of 10 will repeat) ---')
    if thin_lessons:
        for sub, topic, n in sorted(thin_lessons, key=lambda x: x[2]):
            print('  %-3s %-24s %d' % (sub, topic, n))
    else:
        print('  none')

    print('\n--- content with questions but NO lesson (uncovered) ---')
    total_gaps = 0
    for sub, gaps in KNOWN_GAPS.items():
        for name, why in gaps:
            total_gaps += 1
            print('  %-3s %-22s %s' % (sub, name, why.split('.')[0] + '.'))
    print('  %d uncovered areas. Each needs a lesson, or stays explicitly listed here.'
          % total_gaps)

    print('\n--- questions per topic ---')
    for sub in sorted(declared):
        row = ['%s %d' % (t, taxonomy['subtests'][sub]['topics'][t]['questions'])
               for t in declared[sub]]
        print('  %-3s %s' % (sub, '  '.join(row)))

    with open(os.path.join(DATA, 'taxonomy.json'), 'w') as f:
        json.dump(taxonomy, f, indent=1)
    print('\nwrote data/taxonomy.json')

    tagged = sum(1 for q in items if q['topics'])
    print('\n%d of %d served questions carry at least one topic (%.1f%%)'
          % (tagged, len(items), 100.0 * tagged / len(items)))
    return 0 if tagged == len(items) else 1


if __name__ == '__main__':
    sys.exit(main())
