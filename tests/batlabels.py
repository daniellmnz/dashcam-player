#!/usr/bin/env python3
"""Every goto in the batch files must have somewhere to go.

cmd resolves labels at run time, so a mistyped one is not a syntax error:
the script simply stops dead at that line with "The system cannot find the
batch label specified" and whatever it was doing is half done. None of the
rest of this suite can run cmd, so this is the only thing standing between a
typo and a release.
"""
import os, pathlib, re, sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = pathlib.Path(os.environ.get('DCP_SRC', HERE.parent / 'src'))

bad = 0
for bat in sorted(SRC.glob('*.bat')):
    text = bat.read_text(encoding='utf-8', errors='replace')
    lines = text.split('\n')

    labels, dupes = set(), []
    for ln in lines:
        m = re.match(r'^\s*:([A-Za-z0-9_]+)', ln)
        # "::" is the comment idiom, not a label.
        if m and not ln.lstrip().startswith('::'):
            if m.group(1).lower() in labels:
                dupes.append(m.group(1))
            labels.add(m.group(1).lower())

    targets = []
    for n, ln in enumerate(lines, 1):
        for m in re.finditer(r'\bgoto\s+:?([A-Za-z0-9_]+)', ln, re.I):
            targets.append((n, m.group(1)))
        for m in re.finditer(r'\bcall\s+:([A-Za-z0-9_]+)', ln, re.I):
            targets.append((n, m.group(1)))

    missing = [(n, t) for n, t in targets if t.lower() not in labels and t.lower() != 'eof']
    for n, t in missing:
        print(f'  {bat.name}:{n}: goto :{t} - no such label'); bad += 1
    for d in dupes:
        print(f'  {bat.name}: label :{d} is defined more than once'); bad += 1
    if not missing and not dupes:
        print(f'  {bat.name}: {len(labels)} labels, {len(targets)} jumps, all resolve')

if bad:
    print(f'FAIL: {bad} problem(s)')
    sys.exit(1)
print('every batch jump has a label to land on')
