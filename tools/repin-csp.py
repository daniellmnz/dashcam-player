#!/usr/bin/env python3
"""Re-pin the page's Content-Security-Policy hash after editing its script.

The page pins script-src to the sha256 of its own inline script, so the
browser refuses to run it if a single byte changes. Every edit to the script
therefore needs this. The test suite catches a stale hash, but it is the
suite's job to notice, not to be the only way anyone finds out.

    python3 tools/repin-csp.py
"""
import base64, hashlib, os, pathlib, re, sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = pathlib.Path(os.environ.get('DCP_SRC', HERE.parent / 'src'))
page = SRC / 'dashcam-player.html'

s = page.read_text(encoding='utf-8')
m = re.search(r'<script\b[^>]*>([\s\S]*?)</script>', s)
if not m:
    sys.exit('no inline script found in %s' % page)
want = base64.b64encode(hashlib.sha256(m.group(1).encode('utf-8')).digest()).decode()

cur = re.search(r"'sha256-([A-Za-z0-9+/=]+)'", s)
if not cur:
    sys.exit('no sha256 pin found in the Content-Security-Policy')
if cur.group(1) == want:
    print('already correct: sha256-%s' % want)
else:
    page.write_text(s.replace("'sha256-%s'" % cur.group(1), "'sha256-%s'" % want),
                    encoding='utf-8')
    print('re-pinned: sha256-%s' % want)
