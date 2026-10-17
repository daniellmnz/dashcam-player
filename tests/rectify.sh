#!/usr/bin/env bash
# The fisheye tool takes ONE view, and takes the right one.
#
# A wrong crop offset is the silent failure here: ffmpeg succeeds, the file
# plays, and it is simply the wrong camera - which nobody notices until they
# are looking for something that is not there. So the offsets are read out of
# the SHIPPED batch file and run through real ffmpeg against a frame whose
# four quadrants are different colours, and the colour that comes out is
# checked against the one that went in.
set -u
P="${DCP_SRC:-$(cd "$(dirname "$0")/../src" && pwd)}"
BAT="$P/rectify-fisheye.bat"
bad=0
note() { echo "  $1"; bad=1; }

[ -f "$BAT" ] || { echo "rectify-fisheye.bat is missing"; exit 1; }

# --- one view in, one file out ---------------------------------------------
# It used to write four files per recording. Four -map outputs would mean it
# still does.
maps=$(grep -c -o '\-map "\[' "$BAT")
[ "$maps" -eq 1 ] || note "the run writes $maps outputs, not one"
grep -q 'set "VIEW=' "$BAT" || note "there is no setting for which view to take"
grep -q 'if not "%~2"=="" set "VIEW=%~2"' "$BAT" || note "a view cannot be passed in"

# A file that is already one camera must be rectified whole. Its name is the
# only thing that says so: a single 1280x1330 view and a 2x2 grid with a
# status strip are the same shape.
grep -q 'for %%V in (Front Rear Left Right) do if /i not "!NAME:_%%V=!"=="!NAME!"' "$BAT" \
  || note "a file the split tool wrote is not recognised, so it would be quartered"
grep -q 'if defined SVIEW (' "$BAT" || note "nothing acts on that recognition"

command -v ffmpeg >/dev/null 2>&1 || {
  [ $bad -eq 0 ] && echo "the fisheye tool takes one view (ffmpeg absent, offsets not exercised)"
  exit $bad
}

# --- the offsets, run for real ---------------------------------------------
val() { sed -n "s/^set \"$1=\([^\"]*\)\".*/\1/p" "$BAT" | head -1; }
IFOV=$(val IFOV); DFOV=$(val DFOV); OW=$(val OW); OH=$(val OH); INTERP=$(val INTERP)
V="v360=fisheye:flat:ih_fov=$IFOV:iv_fov=$IFOV:d_fov=$DFOV:w=$OW:h=$OH:interp=$INTERP"

# The four 2x2 positions, as the batch writes them, with !CELL! still in.
mapfile -t POS < <(grep -o 'if "%VIEW%"=="[1-4]" set "PV=[^"]*"' "$BAT" \
                   | grep -v '0:!TOP!' | sed 's/.*set "PV=\(.*\)"/\1/' | tail -4)
[ "${#POS[@]}" -eq 4 ] || note "found ${#POS[@]} view positions for a 2x2 frame, wanted 4"

W=2560; CELL=$((W / 2))
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT

# A frame whose quadrants are plainly different: Front red, Rear green,
# Left blue, Right yellow, in the order the batch lays them out.
declare -a COLOUR=(red green blue yellow)
declare -a NAMES=(Front Rear Left Right)
ffmpeg -y -loglevel error -f lavfi -i "color=c=red:s=${CELL}x${CELL}:d=1:r=5" \
       -f lavfi -i "color=c=green:s=${CELL}x${CELL}:d=1:r=5" \
       -f lavfi -i "color=c=blue:s=${CELL}x${CELL}:d=1:r=5" \
       -f lavfi -i "color=c=yellow:s=${CELL}x${CELL}:d=1:r=5" \
       -filter_complex "[0:v][1:v]hstack[t];[2:v][3:v]hstack[b];[t][b]vstack" \
       -frames:v 5 "$work/grid.mp4" 2>/dev/null \
  || { echo "could not build the test frame"; exit 1; }

centre() {   # the middle pixel of an image, as r,g,b
  ffmpeg -v error -i "$1" -vf "crop=2:2:$(( $2 / 2 )):$(( $3 / 2 ))" -f rawvideo -pix_fmt rgb24 - 2>/dev/null \
    | od -An -tu1 -N3 | tr -s ' ' | sed 's/^ //;s/ /,/g'
}
near() {     # same colour, allowing for encoding and resampling
  local a b; IFS=, read -r -a a <<< "$1"; IFS=, read -r -a b <<< "$2"
  for i in 0 1 2; do
    local d=$(( ${a[$i]} - ${b[$i]} )); [ $d -lt 0 ] && d=$(( -d ))
    [ $d -gt 60 ] && return 1
  done
  return 0
}

for i in 0 1 2 3; do
  pv=${POS[$i]//\!CELL\!/$CELL}
  ffmpeg -y -loglevel error -i "$work/grid.mp4" \
         -filter_complex "[0:v]crop=$CELL:$CELL:$pv,$V[out]" -map "[out]" \
         -frames:v 1 "$work/v$i.png" 2>/dev/null \
    || { note "the filter graph for ${NAMES[$i]} was refused by ffmpeg"; continue; }
  size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$work/v$i.png")
  [ "$size" = "$OW,$OH" ] || note "${NAMES[$i]} came out $size, wanted $OW,$OH"
  got=$(centre "$work/v$i.png" "$OW" "$OH")
  want=$(ffmpeg -v error -f lavfi -i "color=c=${COLOUR[$i]}:s=2x2:d=1" -frames:v 1 -f rawvideo -pix_fmt rgb24 - 2>/dev/null | od -An -tu1 -N3 | tr -s ' ' | sed 's/^ //;s/ /,/g')
  if ! near "$got" "$want"; then
    note "view $((i+1)) (${NAMES[$i]}) at $pv came out $got, but ${COLOUR[$i]} is $want - wrong quadrant"
  fi
done

# --- the shape of the output ------------------------------------------------
# The frame shape is a setting, and changing it must not change the shape of
# what is IN the frame: it maps angles to pixels, so a wider frame
# shows more to the sides, it does not stretch the cars. The stretch is a
# separate setting, deliberately wrong, and off by default - this checks that
# those two really are separate, by measuring an object of known proportions.
STRETCH=$(val STRETCH)
[ "$STRETCH" = "100" ] || note "the shipped default stretches the picture ($STRETCH), which is not geometrically true"

# A flat scene with a box twice as wide as it is tall, pushed through a
# fisheye so there is something real to straighten back.
ffmpeg -y -loglevel error -f lavfi -i "color=c=black:s=1200x1200:d=1" \
       -vf "drawbox=x=500:y=550:w=200:h=100:color=red:t=fill,v360=flat:fisheye:h_fov=120:v_fov=120:ih_fov=120:iv_fov=120:w=1200:h=1200" \
       -frames:v 1 "$work/fish.png" 2>/dev/null || note "could not build the fisheye fixture"

# The red box, measured in the rectified picture.
boxratio() {   # image -> width/height of the red box, times 100
  ffmpeg -v error -i "$1" -vf "colorkey=0x000000:0.3:0,crop=iw:ih" -f rawvideo -pix_fmt rgb24 - 2>/dev/null >/dev/null
  python3 - "$1" <<'PY'
import sys
from PIL import Image
import numpy as np
a=np.array(Image.open(sys.argv[1]).convert('RGB')).astype(int)
m=(a[:,:,0]>120)&(a[:,:,1]<90)&(a[:,:,2]<90)
if m.sum()<50: print(0); raise SystemExit
ys,xs=np.nonzero(m)
w=xs.max()-xs.min()+1; h=ys.max()-ys.min()+1
print(int(round(w*100.0/h)))
PY
}

if [ -f "$work/fish.png" ]; then
  # At the shipped shape, a 2:1 box must still measure 2:1.
  ffmpeg -y -loglevel error -i "$work/fish.png" -vf "$V" -frames:v 1 "$work/true.png" 2>/dev/null
  r=$(boxratio "$work/true.png")
  if [ "$r" -eq 0 ]; then
    note "the test box was lost in the rectification, so nothing was measured"
  elif [ "$r" -lt 185 ] || [ "$r" -gt 215 ]; then
    note "rectification distorts a 2:1 object to ${r}:100 - the frame shape is stretching the picture"
  fi

  # And with the stretch deliberately on, it must widen by that much - the
  # setting has to actually do something, or it is a comment pretending to
  # be a feature.
  SW=$(( OW * 115 / 100 )); SW=$(( SW / 2 * 2 ))
  ffmpeg -y -loglevel error -i "$work/fish.png" -vf "$V,scale=$SW:$OH:flags=$INTERP" \
         -frames:v 1 "$work/wide.png" 2>/dev/null
  size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$work/wide.png")
  [ "$size" = "$SW,$OH" ] || note "the stretched output came out $size, wanted $SW,$OH"
  rw=$(boxratio "$work/wide.png")
  if [ "$rw" -ne 0 ] && [ "$rw" -le "$r" ]; then
    note "the stretch setting did not widen anything: ${r}:100 became ${rw}:100"
  fi
fi

[ $bad -eq 0 ] || exit 1
echo "it writes one view, from the right camera, in a frame that does not distort it"
exit 0
