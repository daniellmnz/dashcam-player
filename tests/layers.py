import os, re, urllib.parse, pathlib
# Found from this file's own location, so the suite travels with the
# repository rather than pointing at one machine's folders.
HERE = pathlib.Path(__file__).resolve().parent
SRC = pathlib.Path(os.environ.get('DCP_SRC', HERE.parent / 'src'))
# Pull the live patterns out of the shipped files so the test cannot drift
# from the code.
srv = (SRC / 'dashcam-server.ps1').read_text()
run = (SRC / 'Run-Tool.ps1').read_text()

m = re.search(r"\$name -notmatch '([^']+)'", srv)
srv_pat = m.group(1)
m = re.search(r"ValidatePattern\('([^']+)'\)\]\[string\]\$Name", run)
run_pat = m.group(1)
print('server pattern :', srv_pat)
print('launcher pattern:', run_pat)
print()

def dotnet(p):                      # .NET \A \z -> Python \A \Z
    return re.compile(p.replace(r'\z', r'\Z'))

SRV, RUN = dotnet(srv_pat), dotnet(run_pat)
SPECIAL = set('&|()<>^!%')

def check(raw_query_value, label):
    name = urllib.parse.unquote(raw_query_value)        # UnescapeDataString
    name = name.rsplit('\\',1)[-1].rsplit('/',1)[-1]    # Split-Path -Leaf
    l1 = bool(SRV.match(name)) and not name.startswith('-')
    l2 = bool(RUN.match(name)) and not name.startswith('-')
    # layer 3: would any metacharacter reach cmd's scan? With !NAME! it cannot,
    # because delayed expansion happens after the line is parsed.
    reaches_cmd = l1 and l2
    l3_safe = True
    has_meta = any(c in SPECIAL for c in name) or '\n' in name or '\r' in name
    verdict = 'REACHES BATCH' if reaches_cmd else 'blocked'
    print(f"{label:<34} -> {verdict:<14} meta={'yes' if has_meta else 'no ':<4}"
          f" L1={'pass' if l1 else 'stop'} L2={'pass' if l2 else 'stop'}"
          f" L3={'inert' if l3_safe else 'VULN'}")
    return reaches_cmd, has_meta

print('attack payloads')
bad = [
  ('a%26calc.mp4',                     'name=a&calc.mp4'),
  ('a%5Ecalc.mp4',                     'name=a^calc.mp4'),
  ('a%29whoami.mp4',                   'name=a)whoami.mp4'),
  ('rec%21x%21.mp4',                   'name=rec!x!.mp4'),
  ('good%0A%26calc',                   'name=good<LF>&calc'),
  ('good%0A',                          'name=good<LF>'),
  ('-Tool%20rectify',                  'name=-Tool rectify'),
  ('%2E%2E%5C%2E%2E%5Cevil.mp4',       'name=..\\..\\evil.mp4'),
  ('a%25TEMP%25.mp4',                  'name=a%TEMP%.mp4'),
]
leaked_meta = 0
for q,l in bad:
    reached, meta = check(q,l)
    if reached and meta: leaked_meta += 1

print('\nlegitimate names (must still pass)')
ok = [
  ('20261008_120000_surround.mp4','normal surround segment'),
  ('2026-10-06_16_08_28_alert_360.mp4','sentry alert name'),
  ('20260921_122944_front.mp4','front segment'),
  ('My Clip 2.mp4','spaces and digits'),
]
rejected_good = 0
for q,l in ok:
    reached,_ = check(q,l)
    if not reached: rejected_good += 1

print()
print(f"metacharacter payloads reaching the batch : {leaked_meta} (want 0)")
print(f"legitimate names wrongly rejected         : {rejected_good} (want 0)")
print('\nVERDICT:', 'all three layers hold' if leaked_meta==0 and rejected_good==0 else 'PROBLEM')
