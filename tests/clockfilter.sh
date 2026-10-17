#!/usr/bin/env bash
# The clock the export tools burn into the picture.
#
# This one is worth explaining, because it checks a thing that cannot be
# checked by reading. The tools build an ffmpeg drawtext filter inside a batch
# file, and the string has to survive three parsers in a row: cmd, which turns
# %% into %; the filter graph, which splits on : and ,; and then ffmpeg's own
# text expansion, which splits on : again. That is what the \, and the \\\:
# in those lines are for. Get one wrong and the export does not draw the wrong
# time, it stops - and nothing on this machine runs cmd, so a test that only
# looked at the characters would be agreeing with whoever wrote them.
#
# So the line is taken out of each batch, cmd's part is applied to it, and the
# result is handed to a real ffmpeg. Three things are then true or they are
# not: it renders at all, it renders the time it was given, and it renders in
# the font it was told to use.
#
# That last one is not padding. A build of ffmpeg with fontconfig quietly
# falls back to some other font when fontfile cannot be opened - no error, no
# exit code, just different letters - which is exactly what an unescaped drive
# colon produces. It was caught that way here.
set -u
SP="$(cd "$(dirname "$0")" && pwd)"
SRC="${DCP_SRC:-$(cd "$SP/.." && pwd)/src}"
export LC_ALL=C TZ=UTC

command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg is not available"; exit 2; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
bad=0
fail(){ bad=$((bad+1)); echo "  FAIL $1"; }

# A real font file, under a path shaped like the one the tools build: a drive
# letter and a colon. The colon is the whole point - it is what has to be
# escaped - and a directory may be called "C:" here just as well as there.
mkdir -p "$tmp/C:/Windows/Fonts"
FONTSRC=$(fc-match -f '%{file}' monospace 2>/dev/null)
[ -n "$FONTSRC" ] && [ -f "$FONTSRC" ] || FONTSRC=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf
[ -f "$FONTSRC" ] || { echo "no font to test with"; exit 2; }
cp "$FONTSRC" "$tmp/C:/Windows/Fonts/consola.ttf"

EPOCH=1760400000
WANT=$(date -d "@$EPOCH" +'%a, %b %d, %Y  %H:%M:%S')

# One frame to draw on: flat mid-grey, so white text on a dark box is the only
# thing in the picture that could differ between two renders.
ffmpeg -v error -y -f lavfi -i color=c=gray:s=640x480:d=0.2:r=5 -frames:v 1 "$tmp/base.png" 2>/dev/null \
  || { echo "could not make a test frame"; exit 2; }

# Render with a filter, returning a hash of the PIXELS rather than of the file:
# two PNGs of the same picture need not be the same bytes.
render(){ # $1 filter  $2 name
  ffmpeg -v error -y -i "$tmp/base.png" -vf "null$1" -frames:v 1 "$tmp/$2.png" 2>"$tmp/$2.err"
  echo $? > "$tmp/$2.rc"
  [ -f "$tmp/$2.png" ] || return 0
  ffmpeg -v error -y -i "$tmp/$2.png" -f rawvideo -pix_fmt rgb24 - 2>/dev/null | sha256sum | cut -d' ' -f1 > "$tmp/$2.hash"
}

for bat in split-views.bat rectify-fisheye.bat; do
  [ -f "$SRC/$bat" ] || { fail "$bat is missing"; continue; }

  # cmd's share of the work, applied here as cmd really does it rather than
  # as a search and replace: %% becomes one per cent sign, %NAME% becomes a
  # value, and a lone % is DROPPED - which is what makes a missing doubling
  # visible. Treating %% as "the same as %" would have let the one mistake
  # this is most likely to catch sail straight through.
  # Nothing else is touched: every backslash goes to ffmpeg exactly as the
  # batch file holds it, which is the point of the exercise.
  FILTER=$(python3 - "$SRC/$bat" "$tmp" "$EPOCH" <<'PY'
import re, sys
bat, tmp, epoch = sys.argv[1], sys.argv[2], sys.argv[3]
txt = open(bat, encoding='utf-8', newline='').read().replace('\r\n', '\n')
m = [l for l in txt.split('\n') if l.startswith('set "CLK=,drawtext=')]
if len(m) != 1:
    sys.stderr.write('expected exactly one CLK line, found %d\n' % len(m)); sys.exit(3)
s = m[0][len('set "CLK='):]
if not s.endswith('"'):
    sys.stderr.write('the CLK line does not end in a quote\n'); sys.exit(3)
s = s[:-1]
# The font path as the batch builds it: backslashes to forward slashes, then
# the drive colon escaped. Done the same way here, so the two conversions are
# written down in one place and compared below.
win = tmp + '\\C:\\Windows\\Fonts\\consola.ttf'
font = win.replace('\\', '/').replace(':', '\\:')

def percent_phase(t, env):
    out, i = [], 0
    while i < len(t):
        if t[i] != '%':
            out.append(t[i]); i += 1; continue
        if t.startswith('%%', i):
            out.append('%'); i += 2; continue
        j = t.find('%', i + 1)
        name = t[i+1:j] if j > i + 1 else None
        if name is not None and re.fullmatch(r'\w+', name) and name in env:
            out.append(env[name]); i = j + 1; continue
        # An unmatched per cent sign is simply removed by cmd. "echo 100%"
        # prints 100.
        i += 1
    return ''.join(out)

s = percent_phase(s, {})
for name, val in (('CLOCKFONT', font), ('CLOCKAT', epoch),
                  ('CFS', '26'), ('CPAD', '15'), ('CBOR', '6')):
    s = s.replace('!%s!' % name, val)
if '!' in s:
    sys.stderr.write('something in the line was not expanded: %s\n' % s); sys.exit(3)
print(s)
PY
) || { fail "$bat: the clock line could not be read"; continue; }

  # It is one filter appended to a chain, so it has to begin with a comma -
  # without it the chain it is spliced into silently becomes something else.
  case "$FILTER" in ,drawtext=*) ;; *) fail "$bat: the clock is not a filter to append: ${FILTER:0:40}" ;; esac

  render "$FILTER" "a_$bat"
  rc=$(cat "$tmp/a_$bat.rc")
  err=$(cat "$tmp/a_$bat.err")
  if [ "$rc" != "0" ] || [ ! -f "$tmp/a_$bat.png" ]; then
    fail "$bat: ffmpeg would not run the clock filter: ${err:-exit $rc}"
    continue
  fi
  # ffmpeg says "Stray %" and carries on drawing nonsense rather than stopping,
  # so a clean exit is not enough on its own.
  [ -z "$err" ] || fail "$bat: ffmpeg complained about the clock filter: $err"

  # The time it drew. Compared against the same filter with the expected text
  # handed over in a FILE, which needs no escaping at all - so if the two
  # pictures match, the escaping delivered exactly the characters intended,
  # in the same font, at the same size, in the same place.
  printf '%s' "$WANT" > "$tmp/want.txt"
  REF=$(python3 - "$FILTER" "$tmp/want.txt" <<'PY'
import re, sys
f, path = sys.argv[1], sys.argv[2]
out, n = re.subn(r"text='[^']*'", "textfile='" + path + "'", f)
if n != 1:
    sys.stderr.write('could not find the text in the filter\n'); sys.exit(3)
print(out)
PY
) || { fail "$bat: the reference filter could not be built"; continue; }
  render "$REF" "b_$bat"
  if [ ! -f "$tmp/b_$bat.png" ]; then
    fail "$bat: the reference render failed: $(cat "$tmp/b_$bat.err")"
  elif [ "$(cat "$tmp/a_$bat.hash")" != "$(cat "$tmp/b_$bat.hash")" ]; then
    fail "$bat: the stamp is not '$WANT' - the escaping is delivering something else"
  fi

  # And it sits where the player's own clock sits: bottom right. Not a matter
  # of taste - the tools stack the vehicle status strip UNDER the picture, and
  # a stamp drawn low enough or wide enough to leave the picture would land on
  # the vehicle data, which is the complaint that started all of this.
  ffmpeg -v error -y -i "$tmp/a_$bat.png" -f rawvideo -pix_fmt gray - 2>/dev/null > "$tmp/a_$bat.gray"
  python3 - "$tmp/a_$bat.gray" <<'PY' || fail "$bat: the stamp is not in the bottom right of the picture"
import sys
W, H = 640, 480
d = open(sys.argv[1], 'rb').read()
if len(d) != W * H: sys.exit(1)
# The box of everything brighter than the grey it was drawn on. A line of
# text is wide, so quadrants are the wrong measure: where it ENDS is what
# says it is anchored to the bottom right corner.
xs = [x for y in range(H) for x in range(W) if d[y * W + x] > 240]
ys = [y for y in range(H) for x in range(W) if d[y * W + x] > 240]
if len(xs) < 40: sys.exit(1)
if max(xs) < W * 0.9 or max(ys) < H * 0.85 or min(ys) < H * 0.5: sys.exit(1)
# Inside the picture, not hanging off the edge of it: a stamp placed a few
# pixels too low keeps its corner and loses its letters.
if max(ys) > H - 6 or max(ys) - min(ys) < 12: sys.exit(1)
PY

  # An hour later must look different, or the number is being ignored and
  # every clip would carry the same time.
  LATER=$(python3 -c "import sys;print(sys.argv[1].replace('$EPOCH',str($EPOCH+3600)))" "$FILTER")
  render "$LATER" "c_$bat"
  if [ -f "$tmp/c_$bat.png" ] && [ "$(cat "$tmp/c_$bat.hash")" = "$(cat "$tmp/a_$bat.hash")" ]; then
    fail "$bat: the stamp does not depend on the time it is given"
  fi

  # And the font it was told to use is the font it used. A path ffmpeg cannot
  # open does not fail here, it draws in something else - which is what an
  # unescaped drive colon looks like from the outside.
  NOFONT=$(python3 - "$FILTER" <<'PY'
import re, sys
print(re.sub(r"fontfile='[^']*'", "fontfile='/nonexistent/none.ttf'", sys.argv[1]))
PY
)
  render "$NOFONT" "d_$bat"
  if [ -f "$tmp/d_$bat.png" ] && [ "$(cat "$tmp/d_$bat.hash")" = "$(cat "$tmp/a_$bat.hash")" ]; then
    fail "$bat: the same picture comes out with the font missing, so the one named is not being loaded"
  fi

  # The tools must be able to decide against a clock, and that decision is
  # carried by CLK being empty - so every use of it has to be the bare !CLK!,
  # with nothing around it that would leave a stray comma behind.
  if ! grep -q 'if not defined CLOCKAT exit /b 0' "$SRC/$bat"; then
    fail "$bat: nothing stops the clock filter being built when there is no time to draw"
  fi
  if grep -nq '"!CLK!"' "$SRC/$bat"; then
    fail "$bat: the clock is used quoted, which puts an empty argument in the graph when there is none"
  fi

  # The font path is converted in two steps, and the order is not optional:
  # backslashes to forward slashes FIRST, then the drive colon escaped. Doing
  # it the other way round escapes a colon that is about to be replaced.
  #
  # This part is read rather than run - nothing here is cmd - so what the
  # reading is worth rests on the renders above, which use the very shape
  # these two lines produce and prove that shape loads the font.
  slash=$(grep -nF 'CLOCKFONT=!FONTPATH:\=/!' "$SRC/$bat" | head -1 | cut -d: -f1)
  colon=$(grep -nF 'CLOCKFONT=!CLOCKFONT::=\:!' "$SRC/$bat" | head -1 | cut -d: -f1)
  if [ -z "$slash" ] || [ -z "$colon" ]; then
    fail "$bat: the font path is not turned into the form a filter graph can read"
  elif [ "$slash" -ge "$colon" ]; then
    fail "$bat: the font path's colon is escaped before the backslashes are replaced, which undoes it"
  fi
done

# The whole point of the exercise: the instant comes from the player, through
# the helper, as digits and nothing else. A filter expression assembled from
# something a page can set is only safe while that is true.
for f in "$SRC/dashcam-server.ps1" "$SRC/Run-Tool.ps1"; do
  grep -q 'd{9,11}' "$f" || fail "$(basename "$f"): the stamped instant is not checked for being a plain number"
done

if [ "$bad" -gt 0 ]; then echo "FAIL: $bad problem(s)"; exit 1; fi
echo "the burned-in clock survives cmd, draws the time it is given, and uses the font it names"
exit 0
