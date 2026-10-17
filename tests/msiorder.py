#!/usr/bin/env python3
"""The built MSI's tables must be stored sorted by primary key.

This is what shipped broken in 1.34.0. Windows Installer binary-searches a
table's rows, so an out-of-order table cannot be built: the install stops at
FileCost with "Error 2211: Could not create database table RemoveFile",
naming no row, no file and no reason.

Nothing else here could have caught it. msiinfo, msiextract and wine all read
the package back perfectly, every table's schema and metadata were byte for
byte what the previous working release had, and the rows themselves were
right - only their order was wrong. So this checks the built package itself,
and then proves the check works by putting the fault back and watching it
fail.
"""
import os, pathlib, shutil, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
INST = pathlib.Path(os.environ.get('DCP_INSTALLER', ROOT / 'installer'))
TOOL = ROOT / 'tools' / 'msi-table-order.py'

def check(msi):
    r = subprocess.run([sys.executable, '-I', str(TOOL), '--check', str(msi)],
                       capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()

msis = sorted(INST.glob('DashcamPlayer-*.msi'))
if not msis:
    print('no built MSI to check - run installer/build.sh first')
    sys.exit(0)          # nothing built is not a failure; wxscheck covers the source
msi = msis[-1]

try:
    import olefile  # noqa: F401
except ImportError:
    print('olefile is not installed - skipping (pip install --break-system-packages olefile)')
    sys.exit(0)

bad = 0

code, out = check(msi)
if code != 0:
    bad += 1
    print(f'  {out}')

# Now put the fault back: swap two rows of RemoveFile in a copy and confirm
# the check notices. A check that cannot fail is not a check.
import struct
sys.path.insert(0, str(ROOT / 'tools'))
import importlib.util
spec = importlib.util.spec_from_file_location('mto', TOOL)
mto = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mto)

with tempfile.TemporaryDirectory() as tmp:
    broken = pathlib.Path(tmp) / 'broken.msi'
    shutil.copy(msi, broken)
    found = [t for t in mto.examine(broken) if t[0] == 'RemoveFile']
    if not found:
        bad += 1
        print('  the built package has no RemoveFile table, so uninstall leaves files behind')
    else:
        table, entry, cols, columns, rows, keys, ok = found[0]
        if rows < 2:
            print('  RemoveFile has too few rows to shuffle; the negative case was not exercised')
        else:
            order = list(range(rows))
            order[-1], order[0] = order[0], order[-1]
            shuffled = [[c[r] for r in order] for c in columns]
            ole = mto.olefile.OleFileIO(str(broken), write_mode=True)
            ole.write_stream('/'.join(entry), mto.encode(shuffled, cols))
            ole.close()
            code, out = check(broken)
            if code == 0:
                bad += 1
                print('  a deliberately out-of-order table passed the check')

# ffmpeg is fetched by the install itself when it is missing. Checked in the
# built package, not just the source: the action has to be sequenced after
# InstallFinalize (the script it runs is not on disk before that), must not
# run on uninstall, and must be type 242 - asyncNoWait, ignore the result - so
# a download that takes two minutes or fails outright cannot stall the
# installer or roll the whole thing back.
def table(name):
    r = subprocess.run(['msiinfo', 'export', str(msi), name], capture_output=True, text=True)
    return [ln.split('\t') for ln in r.stdout.splitlines()[3:]] if r.returncode == 0 else []

ca = {r[0]: r for r in table('CustomAction') if r}
seq = {r[0]: r for r in table('InstallExecuteSequence') if r}
if 'GetFfmpeg' not in ca:
    bad += 1; print('  the install never fetches ffmpeg')
else:
    if ca['GetFfmpeg'][1] != '242':
        bad += 1; print(f"  fetching ffmpeg is action type {ca['GetFfmpeg'][1]}, not 242 (asyncNoWait, ignore result)")
    if 'Install-FFmpeg.ps1' not in ca['GetFfmpeg'][3]:
        bad += 1; print('  the action does not run Install-FFmpeg.ps1')
    row = seq.get('GetFfmpeg')
    if not row:
        bad += 1; print('  the action exists but is never sequenced, so it never runs')
    else:
        final = int(seq['InstallFinalize'][2])
        if int(row[2]) <= final:
            bad += 1; print(f'  ffmpeg is fetched at {row[2]}, before InstallFinalize at {final} - the script is not on disk yet')
        if 'NOT REMOVE' not in row[1]:
            bad += 1; print(f'  ffmpeg would be fetched on uninstall too (condition: {row[1]!r})')

if bad:
    print(f'FAIL: {bad} problem(s)')
    sys.exit(1)
print(f'{msi.name}: tables are in key order, the check catches it when they are not, '
      'and the install fetches ffmpeg after it finishes')
