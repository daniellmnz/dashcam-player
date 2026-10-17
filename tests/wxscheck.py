#!/usr/bin/env python3
"""Guards what silently breaks an upgrade:
   - ProductCode must match uuid5(UpgradeCode, 'Product-'+Ver)
   - the Upgrade table's Maximum must equal Ver
   - every version string that ships must agree with Ver
Run before every release."""
import re, sys, uuid, pathlib
# The repository root, or wherever DCP_SRC/DCP_INSTALLER point.
import os
HERE = pathlib.Path(__file__).resolve().parent
SRC = pathlib.Path(os.environ.get('DCP_SRC', HERE.parent / 'src'))
INST = pathlib.Path(os.environ.get('DCP_INSTALLER', HERE.parent / 'installer'))
wxs = (INST/'DashcamPlayer.wxs').read_text(encoding='utf-8')
ver  = re.search(r'<\?define Ver\s*=\s*"([^"]+)"', wxs).group(1)
prod = re.search(r'<Product Id="\{([^}]+)\}"', wxs).group(1)
upg  = re.search(r'UpgradeCode="\{([^}]+)\}"', wxs).group(1)
want = str(uuid.uuid5(uuid.UUID('{'+upg+'}'), 'Product-'+ver)).upper()
ok = True
if prod.upper() != want:
    print(f'FAIL ProductCode {{{prod}}} but version {ver} needs {{{want}}}'); ok = False
if not re.search(r'Maximum="\$\(var\.Ver\)"', wxs):
    print('FAIL Upgrade Maximum is not tied to $(var.Ver)'); ok = False
if not re.search(r'Minimum="\$\(var\.Ver\)"', wxs):
    print('FAIL downgrade row Minimum is not tied to $(var.Ver)'); ok = False

# Every shipped version string. A stale helper is only detectable if the
# server and the page agree on what version they are.
html = (SRC/'dashcam-player.html').read_text(encoding='utf-8')
srv  = (SRC/'dashcam-server.ps1').read_text(encoding='utf-8')
doc  = (SRC/'DashcamPlayer.md').read_text(encoding='utf-8')
found = {
 'page sidebar' : re.search(r'class="ver">v([0-9.]+)', html).group(1),
 'page constant': re.search(r'DCP_VERSION="([0-9.]+)"', html).group(1),
 'server'       : re.search(r"ServerVersion\s*=\s*'([0-9.]+)'", srv).group(1),
 'docs'         : re.search(r'Version ([0-9.]+)', doc).group(1),
}
for k, v in found.items():
    if v != ver:
        print(f'FAIL {k} says {v}, installer says {ver}'); ok = False
print(('ok   ' if ok else 'FAIL ')+f'version {ver} everywhere, ProductCode {{{prod}}}')
sys.exit(0 if ok else 1)
