#!/usr/bin/env python3
"""Nothing the player can start may wait for a keypress.

Both tools run hidden when the player starts them: no console, no taskbar
entry, nothing to press a key on. A bare "pause" on any path therefore stops
the tool dead where nobody can see it - the work is finished, the file is
written, and the player sits on "working" until the window is closed.

split-views.bat learned this when it grew a button. rectify-fisheye.bat grew
its button later and still had seven bare pauses, one of them on the ordinary
success path. So this is a rule about the batch files rather than a fix:
every wait goes through :hold, which returns at once when DCP_QUIET is set.
"""
import os
import re
import sys

SRC = os.environ.get('DCP_SRC') or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'src')

bad = []
for name in sorted(os.listdir(SRC)):
    if not name.lower().endswith('.bat'):
        continue
    path = os.path.join(SRC, name)
    with open(path, encoding='utf-8', errors='replace') as fh:
        lines = fh.read().splitlines()

    # The one allowed pause is the body of :hold itself, which is only
    # reached once DCP_QUIET has been checked.
    in_hold = False
    guarded = False
    has_hold = False
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        low = stripped.lower()
        if low.startswith(':'):
            in_hold = low.startswith(':hold')
            if in_hold:
                has_hold = True
                guarded = False
            continue
        if in_hold and 'dcp_quiet' in low:
            guarded = True
        if re.fullmatch(r'pause', low):
            if in_hold and guarded:
                continue
            where = 'inside :hold but before the DCP_QUIET check' if in_hold \
                else 'on a path the player can reach'
            bad.append(f'{name}:{i}: waits for a keypress {where}')

    if not has_hold:
        bad.append(f'{name}: has no :hold, so it has no way to skip waiting '
                   f'when it is run hidden')
    elif not guarded and has_hold:
        # guarded is reset per label, so re-check the :hold body as a whole.
        body = []
        grab = False
        for line in lines:
            low = line.strip().lower()
            if low.startswith(':'):
                grab = low.startswith(':hold')
                continue
            if grab:
                body.append(low)
                if low.startswith('exit /b'):
                    break
        if not any('dcp_quiet' in b for b in body):
            bad.append(f'{name}: :hold does not check DCP_QUIET, so running '
                       f'hidden still waits')

    # And the tools must actually be told. A flag nothing sets is no flag.
    run = os.path.join(SRC, 'Run-Tool.ps1')
    if os.path.exists(run):
        with open(run, encoding='utf-8', errors='replace') as fh:
            if 'DCP_QUIET' not in fh.read():
                bad.append('Run-Tool.ps1 never sets DCP_QUIET, so every '
                           'hidden run would wait')

if bad:
    for b in bad:
        print('  ' + b)
    print(f'FAIL: {len(bad)} problem(s)')
    sys.exit(1)
print('no batch waits for a keypress where the player cannot provide one')
