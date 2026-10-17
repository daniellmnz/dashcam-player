#!/usr/bin/env bash
# Exporting a camera from a recording whose frame is not a grid.
#
# One recorder folds its four cameras into columns, so a camera is not a
# rectangle in the file: three of the four are split across two columns. The
# export tools cannot work that out from the frame's shape and cannot read the
# sidecar that describes it, so the player sends the rectangles - w:h:x:y, as
# ffmpeg's crop takes them, the pieces of one camera joined by commas.
#
# What is checked here is the thing that cannot be checked by reading: that the
# filter those pieces are spliced into crops the camera that was asked for,
# whole, the right way up, and with the two pieces meeting exactly.
#
# The filter is not written out here. The TEMPLATES are taken out of the batch
# file and filled in, so a change to how a piece is spliced is a change to what
# this runs. Nothing on this machine runs cmd, which is why the strings come
# from the file rather than from whoever wrote the test.
set -u
SP="$(cd "$(dirname "$0")" && pwd)"
SRC="${DCP_SRC:-$(cd "$SP/.." && pwd)/src}"
export LC_ALL=C

command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg is not available"; exit 2; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
bad=0
fail(){ bad=$((bad+1)); echo "  FAIL $1"; }

# The real recording's geometry, out of its sidecar.
IW=1280; IH=5140; STRIP=1728; EW=3840; EH=1728
# lane y0 values; every lane is 1280 tall and the full width
LY=(4 1288 2572 3856)
COLOURS=(red green blue yellow)
WANT=("255 0 0" "0 128 0" "0 0 255" "255 255 0")
BAR=200          # a white bar this far down each camera
BAR2=1060        # and a black one here

# --- a file rastered the way the recorder rasters one -----------------------
inputs=(-f lavfi -i "color=c=black:s=${IW}x${IH}:d=1:r=5")
graph=""
prev="[0:v]"
for i in 0 1 2 3; do
  inputs+=(-f lavfi -i "color=c=${COLOURS[$i]}:s=${IW}x1280:d=1:r=5,drawbox=0:${BAR}:${IW}:20:white:t=fill,drawbox=0:${BAR2}:${IW}:20:black:t=fill")
  out="[o$i]"; [ $i -eq 3 ] && out="[tall]"
  graph="${graph}${prev}[$((i+1)):v]overlay=0:${LY[$i]}${out};"
  prev="[o$i]"
done
cols=$(( (IH + STRIP - 1) / STRIP ))
split=""; names=""
for ((i=0;i<cols;i++)); do split="${split}[t$i]"; names="${names}[c$i]"; done
graph="${graph}[tall]split=${cols}${split};"
for ((i=0;i<cols;i++)); do
  y=$((i*STRIP)); h=$((IH-y)); [ $h -gt $STRIP ] && h=$STRIP
  pad=""; [ $h -lt $STRIP ] && pad=",pad=${IW}:${STRIP}:0:0:black"
  graph="${graph}[t$i]crop=${IW}:${h}:0:${y}${pad}[c$i];"
done
graph="${graph}${names}hstack=inputs=${cols}[enc]"
ffmpeg -v error -y "${inputs[@]}" -filter_complex "$graph" -map '[enc]' \
  -c:v libx264 -preset ultrafast -pix_fmt yuv420p -frames:v 3 "$tmp/raster.mp4" 2>"$tmp/mk.err" \
  || { echo "the rastered fixture could not be built: $(head -c 300 "$tmp/mk.err")"; exit 2; }

# --- the filter, built from the batch file's own templates ------------------
build(){ # $1 batch file  $2 view number (1-4)  $3 every lane, as the player sends them
python3 - "$1" "$2" "$3" <<'PY'
import re, sys
bat, idx, lanes_all = sys.argv[1], int(sys.argv[2]), sys.argv[3]
txt = open(bat, encoding='utf-8', newline='').read().replace('\r\n', '\n')

def one(pattern, what):
    m = re.search(pattern, txt)
    if not m:
        sys.stderr.write('could not find %s in %s\n' % (what, bat)); sys.exit(3)
    return m.group(1)

# Which camera this view takes. Read out of the file rather than assumed: a
# selection that always landed on the first one would export four copies of
# the front camera and look entirely successful.
sel = one(r'for /f "tokens=(\S+) delims=;" %%a in \("!LANES!"\) do set "LANEPIECES=%%a"',
          'the lane selection')
pick = idx if sel.strip() == '%1' else int(sel)
parts = lanes_all.split(';')
if not (1 <= pick <= len(parts)):
    sys.stderr.write('the lane selection picks %s of %d\n' % (pick, len(parts))); sys.exit(3)
lane = parts[pick - 1]

# How the pieces of one camera are walked. A plain FOR takes every one; a
# FOR /F with a token list takes only some, which would quietly export half a
# camera. Modelled from whichever form the file actually uses.
if re.search(r'for %%p in \(%~2\) do call :lanepiece', txt):
    ps = [x for x in re.split(r'[, ]+', lane) if x]
else:
    m = re.search(r'for /f "tokens=(\S+) delims=(\S+)" %%p in \("%~2"\) do call :lanepiece', txt)
    if not m:
        sys.stderr.write('could not find the piece loop in %s\n' % bat); sys.exit(3)
    fields = [x for x in re.split('[' + re.escape(m.group(2)) + ']+', lane) if x]
    ps = [fields[int(t) - 1] for t in m.group(1).split(',') if int(t) <= len(fields)]

# The two strings a piece is accumulated into, taken whole - including which
# side of them the running value sits on, since stacking the two halves of a
# camera in the wrong order is the mistake worth catching here.
# The ACCUMULATING line of each, not the reset above it - both names are set
# empty first, and taking that would leave nothing to stack.
pre_t = one(r'set "LPRE=([^"]*!LPRE![^"]*)"\n', 'the piece chain')
lab_t = one(r'set "LLAB=([^"]*!LLAB![^"]*)"\n', 'the piece label')
one_t = one(r'set "LMAIN=(\[0:v\]crop=!LONE!)"\n', 'the single-piece chain')
many_t = one(r'set "LMAIN=(!LLAB!vstack=inputs=!LN!)"\n', 'the stacked chain')

prefix = 'q%d_' % idx
lpre, llab, lone = '', '', ''
for n, p in enumerate(ps, 1):
    def fill(t):
        return t.replace('%~2', p).replace('%~1', prefix).replace('!LN!', str(n))
    lpre = fill(pre_t).replace('!LPRE!', lpre)
    llab = fill(lab_t).replace('!LLAB!', llab)
    lone = p
if len(ps) == 1:
    lpre = ''
    main = one_t.replace('!LONE!', lone)
else:
    main = many_t.replace('!LLAB!', llab).replace('!LN!', str(len(ps)))

# And the line that puts a view into the graph, with no status strip - the
# recorder this is for leaves room for none. The two tools word it
# differently, so both forms are looked for and whichever is there is used.
m = re.search(r'if "!USESTRIP!"=="0" set "FC=!FC!(.*?)"\n', txt)
if m:
    fc, label = m.group(1), '[v%d]' % idx
else:
    fc = one(r'\n  set "FC=(!VPRE!!VSRC!,%V%!CLK!\[out\])"\n', 'the view line')
    label = '[out]'
    # The straightening is left out. It bends every straight line in the
    # picture, which is the whole point of it and would make nonsense of
    # reading colours back at known heights - and it has a test of its own.
    fc = fc.replace(',%V%', '')
# What the view line is actually handed. Read from the file as well: dropping
# the preamble leaves the labelled pieces built and never emitted, which
# ffmpeg would refuse - but only if the preamble is what the file says it is.
vpre_t = one(r'set "VPRE=([^"]*!LPRE![^"]*)"\n', 'the preamble handover')
vsrc_t = one(r'set "VSRC=([^"]*!LMAIN![^"]*)"\n', 'the picture handover')
lpre = vpre_t.replace('!LPRE!', lpre)
main = vsrc_t.replace('!LMAIN!', main)

fc = (fc.replace('!VPRE!', lpre).replace('!VSRC!', main)
        .replace('!CLK!', '').replace('!RESIZE!', '')
        .replace('%IDX%', str(idx)))
print(label + '\t' + fc)
PY
}

# The pieces, worked out here the way the player works them out.
pieces_for(){ # $1 lane y0
  local y0=$1
  local y1=$(( y0 + 1280 ))
  local out=""
  local y=$y0
  while [ $y -lt $y1 ]; do
    local c=$(( y / STRIP ))
    local end=$(( (c+1) * STRIP ))
    [ $end -gt $y1 ] && end=$y1
    local px=$(( c * IW ))
    local py=$(( y - c * STRIP ))
    local ph=$(( end - y ))
    [ -n "$out" ] && out="${out},"
    out="${out}${IW}:${ph}:${px}:${py}"
    y=$end
  done
  printf '%s' "$out"
}

for bat in split-views.bat rectify-fisheye.bat; do
  [ -f "$SRC/$bat" ] || { fail "$bat is missing"; continue; }
  # Every camera, as the player sends them: the tools pick one out of the list
  # themselves, and picking the wrong one is a mistake worth catching.
  all=""
  for v in 1 2 3 4; do
    [ -n "$all" ] && all="${all};"
    all="${all}$(pieces_for "${LY[$((v-1))]}")"
  done
  for v in 1 2 3 4; do
    built=$(build "$SRC/$bat" "$v" "$all") || { fail "$bat view $v: the filter could not be built"; continue; }
    label=${built%%$'\t'*}
    fc=${built#*$'\t'}
    ffmpeg -v error -y -i "$tmp/raster.mp4" -filter_complex "$fc" -map "$label" \
      -frames:v 1 "$tmp/out.png" 2>"$tmp/ff.err"
    if [ ! -s "$tmp/out.png" ]; then
      fail "$bat view $v: ffmpeg would not run the filter: $(head -c 200 "$tmp/ff.err")"
      continue
    fi
    [ -s "$tmp/ff.err" ] && fail "$bat view $v: ffmpeg complained: $(head -c 160 "$tmp/ff.err")"
    read -r w h < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$tmp/out.png" | tr ',' ' ')
    [ "$w" = "$IW" ] && [ "$h" = "1280" ] \
      || fail "$bat view $v: the camera came out ${w}x${h}, not ${IW}x1280"
    # The pixels: the right camera, both ends of it, and the two markers where
    # they were drawn - which is what says the pieces met in the right place.
    ffmpeg -v error -y -i "$tmp/out.png" -f rawvideo -pix_fmt rgb24 - 2>/dev/null > "$tmp/out.raw"
    python3 - "$tmp/out.raw" "$w" "$h" "${WANT[$((v-1))]}" "$BAR" "$BAR2" <<'PY' || fail "$bat view $v: the exported camera is not the one that was asked for"
import sys
raw = open(sys.argv[1], 'rb').read()
W, H = int(sys.argv[2]), int(sys.argv[3])
want = [int(x) for x in sys.argv[4].split()]
bar, bar2 = int(sys.argv[5]), int(sys.argv[6])
if len(raw) != W * H * 3: sys.exit(1)
def at(x, y):
    i = (y * W + x) * 3
    return [raw[i], raw[i+1], raw[i+2]]
def near(got, w, tol=70):
    return all(abs(a - b) < tol for a, b in zip(got, w))
mid = W // 2
# The camera itself, at both ends, so neither a neighbour has come with it nor
# part of it been left behind.
for y in (40, H // 2, H - 40):
    if not near(at(mid, y), want): sys.exit(1)
# The markers, where they were drawn. The join between two columns falls
# inside three of these four cameras; a few rows out and these move.
if not near(at(mid, bar + 10), [255, 255, 255]): sys.exit(1)
if not near(at(mid, bar2 + 10), [0, 0, 0]): sys.exit(1)
PY
  done
done

# --- the page writes the pieces in the order the tools read them ------------
# The batch splices a piece in whole, without picking it apart, so it is the
# PAGE that decides whether those four numbers mean w:h:x:y or x:y:w:h. Get
# that the wrong way round and the crop is a perfectly valid rectangle in the
# wrong place - no error anywhere, just the wrong picture. So the page's own
# line is taken out and run.
node -e '
  const fs = require("fs");
  const page = fs.readFileSync(process.argv[1], "utf8");
  const m = page.match(/const pieceStr=(ps=>[^\n]*?);\n/);
  if (!m) { console.log("NOTFOUND"); process.exit(2); }
  const pieceStr = eval("(" + m[1] + ")");
  console.log(pieceStr([{ x: 10, y: 20, w: 30, h: 40 }, { x: 1, y: 2, w: 3, h: 4 }]));
' "$SRC/dashcam-player.html" > "$tmp/order.txt" 2>/dev/null
got=$(cat "$tmp/order.txt" 2>/dev/null)
if [ "$got" != "30:40:10:20,3:4:1:2" ]; then
  fail "the page writes a piece as '$got', not the w:h:x:y that ffmpeg's crop takes"
fi

# --- and nothing is sent for an ordinary recording --------------------------
# Every other recorder's frame IS the picture, and both tools work it out from
# the frame's own shape as they always have. The supplied geometry has to be
# something they do WITHOUT, or a bug in it would reach recordings that have
# no columns in them at all.
for bat in split-views.bat rectify-fisheye.bat; do
  txt=$(cat "$SRC/$bat")
  printf '%s' "$txt" | grep -q 'if defined LANES' \
    || fail "$bat does not check whether any geometry was sent"
  printf '%s' "$txt" | grep -q 'set "LANES="' \
    || fail "$bat does not start with no geometry, so one run could leak into the next"
done

if [ "$bad" -gt 0 ]; then echo "FAIL: $bad problem(s)"; exit 1; fi
echo "a camera folded across two columns is exported whole, by both tools"
exit 0
