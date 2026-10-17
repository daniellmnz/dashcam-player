#!/usr/bin/env bash
# The export quality levels, run through real ffmpeg.
#
# The tools encode by QUALITY, never by bitrate, and the three levels are
# meant to be genuinely different: lower QP, bigger file, picture measurably
# closer to the source. That is easy to assert in a comment and easy to get
# wrong in a batch file - a typo in a goto label, or a level that falls
# through to the default, leaves three settings that all encode identically
# and nobody notices, because every file still plays.
#
# So the libx264 lines are lifted OUT of the batch as the batch sets them,
# and actually run: one view cropped from a synthetic 2560x2660 recording,
# encoded at each level, and measured for size and for PSNR against a
# lossless cut of the same crop. The hardware encoders cannot be exercised
# here - there is no GPU in this container - so this covers the software
# path, which is also the fallback every machine ends up on.
set -u
P="${DCP_SRC:-$(cd "$(dirname "$0")/../src" && pwd)}"
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT
bad=0
say(){ echo "  $*"; }

command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg absent, nothing measured"; exit 0; }

# --- what does the batch actually set for each level? ---------------------
# Read from the file rather than written down again here: a test that keeps
# its own copy of the settings passes happily while the shipped tool is
# wrong, which is the whole failure this is meant to catch.
bat="$P/split-views.bat"
[ -f "$bat" ] || { echo "split-views.bat is missing"; exit 1; }

# The batch is CRLF, as cmd requires (tests/bomcheck.sh holds that), so the
# carriage return is stripped before anything is matched - leave it in and
# every anchored pattern here quietly stops matching, which is how this test
# first reported that the shipped tool had no encoder at all.
encsw_for(){   # level -> the ENCSW line the batch sets under that label
  tr -d '\r' < "$bat" | awk -v lbl=":q_$1" '
    $0 ~ "^"lbl"$" {inblk=1; next}
    inblk && /^:q_/ {exit}
    inblk && /^set "ENCSW=/ {
      sub(/^set "ENCSW=/,""); sub(/"[[:space:]]*$/,""); print; exit }
  '
}

declare -A ENC
for lvl in standard high maximum; do
  ENC[$lvl]=$(encsw_for "$lvl")
  if [ -z "${ENC[$lvl]}" ]; then
    say "FAIL the batch sets no software encoder for '$lvl'"; bad=1
  fi
done
# The default the batch falls back to must be one of the three, not a fourth
# setting that only appears when something is misspelt.
if ! tr -d '\r' < "$bat" | grep -q '^set "QUALITY=high"'; then
  say "FAIL the batch does not default to a named quality level"; bad=1
fi
# Every level must be reachable: a label with no jump to it is a level the
# player can ask for and never get.
for lvl in standard high maximum; do
  tr -d '\r' < "$bat" | grep -q "goto :q_$lvl" || { say "FAIL nothing ever jumps to :q_$lvl"; bad=1; }
done
[ $bad -eq 0 ] || { echo "FAIL: the quality levels are not wired up"; exit 1; }

# --- a recording to cut up ------------------------------------------------
# Detailed on purpose. A flat test pattern compresses to nothing at every
# setting, and the levels would look identical for reasons that say nothing
# about the levels.
ffmpeg -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=s=1280x1280:r=30:d=4" \
  -f lavfi -i "mandelbrot=s=1280x1280:r=30" -t 4 \
  -f lavfi -i "life=s=1280x1280:r=30:mold=10" \
  -f lavfi -i "testsrc=s=1280x1280:r=30:d=4" \
  -f lavfi -i "color=c=gray:s=2560x100:r=30:d=4" \
  -filter_complex "[0:v][1:v]hstack[t];[2:v][3:v]hstack[b];[t][b]vstack[g];[g][4:v]vstack,noise=alls=12:allf=t+u,format=yuv420p,trim=duration=4,setpts=PTS-STARTPTS[v]" \
  -map "[v]" -t 4 -c:v libx264 -preset veryfast -b:v 20M -maxrate 20M -bufsize 40M \
  -y "$W/src.mp4" 2>/dev/null || { echo "could not build the test recording"; exit 1; }

# The same crop the split tool makes: one camera, with the status strip
# scaled to its width and stacked under it.
FC="[0:v]crop=1280:1280:0:0[g];[0:v]crop=2560:100:0:2560,scale=1280:-2[s];[g][s]vstack[out]"
ffmpeg -hide_banner -loglevel error -i "$W/src.mp4" -filter_complex "$FC" -map "[out]" \
  -c:v libx264 -preset ultrafast -qp 0 -y "$W/ref.mp4" 2>/dev/null \
  || { echo "could not build the reference crop"; exit 1; }

size_of(){ wc -c < "$1" | tr -d ' '; }
psnr_of(){
  ffmpeg -hide_banner -loglevel info -i "$1" -i "$W/ref.mp4" -lavfi "[0:v][1:v]psnr" \
    -f null - 2>&1 | grep -o "average:[0-9.]*" | tail -1 | cut -d: -f2
}

declare -A SIZE PSNR
for lvl in standard high maximum; do
  # Unquoted on purpose: these are ffmpeg arguments, not one string.
  # shellcheck disable=SC2086
  ffmpeg -hide_banner -loglevel error -i "$W/src.mp4" -filter_complex "$FC" -map "[out]" \
    ${ENC[$lvl]} -y "$W/$lvl.mp4" 2>/dev/null
  if [ ! -s "$W/$lvl.mp4" ]; then
    say "FAIL '$lvl' did not encode at all with: ${ENC[$lvl]}"; bad=1; continue
  fi
  SIZE[$lvl]=$(size_of "$W/$lvl.mp4")
  PSNR[$lvl]=$(psnr_of "$W/$lvl.mp4")
  mb=$(echo "scale=2; ${SIZE[$lvl]}*8/4/1000000" | bc)
  say "$(printf '%-9s %6s Mb/s  PSNR %s' "$lvl" "$mb" "${PSNR[$lvl]}")"
done
[ $bad -eq 0 ] || { echo "FAIL: a quality level does not encode"; exit 1; }

# --- the levels must actually differ, in the right direction --------------
gt(){ [ "$(echo "$1 > $2" | bc -l)" = 1 ]; }

for pair in "high standard" "maximum high"; do
  hi=${pair%% *}; lo=${pair##* }
  if ! gt "${SIZE[$hi]}" "${SIZE[$lo]}"; then
    say "FAIL '$hi' is no larger than '$lo' (${SIZE[$hi]} vs ${SIZE[$lo]}) - the levels are not distinct"
    bad=1
  fi
  if ! gt "${PSNR[$hi]}" "${PSNR[$lo]}"; then
    say "FAIL '$hi' is not measurably closer to the recording than '$lo' (${PSNR[$hi]} vs ${PSNR[$lo]} dB)"
    bad=1
  fi
done

# High is the default, and the point of changing it was that the old setting
# gave away more than it had to. Worth at least a quarter of a dB over
# standard, or the default is not earning the extra bytes.
d=$(echo "${PSNR[high]} - ${PSNR[standard]}" | bc -l)
if ! gt "$d" 0.25; then
  say "FAIL the default buys only ${d} dB over standard, which is not worth the size"
  bad=1
fi

# --- and nothing anywhere names a fixed bitrate ---------------------------
# A -b:v with a real number would override the quality setting and spend the
# same bits on an empty car park as on rain at night. The only -b:v allowed
# is the explicit zero that tells NVENC to obey -cq instead of its own 2 Mb/s
# default - which is the bug that made every rectified file come out at 2 Mb/s.
for f in "$P/split-views.bat" "$P/rectify-fisheye.bat"; do
  while IFS= read -r line; do
    say "FAIL $(basename "$f") pins a bitrate, which overrides the quality: $line"
    bad=1
  done < <(tr -d '\r' < "$f" | grep -o '\-b:v [^ "]*' | grep -v '^-b:v 0$')
done
# NVENC in VBR mode MUST carry the zero, or ffmpeg's 2 Mb/s default silently
# becomes the ceiling and -cq does almost nothing.
while IFS= read -r line; do
  case "$line" in
    *"-b:v 0"*) ;;
    *) say "FAIL an NVENC line uses -cq without -b:v 0, so 2 Mb/s caps it: $line"; bad=1 ;;
  esac
done < <(cat "$P/split-views.bat" "$P/rectify-fisheye.bat" | tr -d '\r' | grep 'h264_nvenc' | grep -- '-rc vbr')

if [ $bad -ne 0 ]; then echo "FAIL"; exit 1; fi
echo "the three quality levels encode, differ in size and in measured quality, and none pins a bitrate"
