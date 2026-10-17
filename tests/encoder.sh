#!/usr/bin/env bash
# Neither batch file may name a hardware encoder and hope.
#
# They used to open with "-c:v h264_nvenc". On a machine without an Nvidia
# card that is not slower, it is fatal: ffmpeg stops with "Cannot load
# nvcuda.dll" and nothing is written. An encoder being compiled into ffmpeg
# says nothing about whether the hardware is there, so each candidate has to
# be tried, and the chain has to end somewhere that cannot fail.
set -u
P="${DCP_SRC:-$(cd "$(dirname "$0")/../src" && pwd)}"
bad=0

for b in split-views.bat rectify-fisheye.bat; do
  f="$P/$b"
  [ -f "$f" ] || { echo "missing $b"; bad=1; continue; }

  # The live setting, not one of the commented-out alternatives.
  live=$(grep -E '^set "ENC=' "$f" | head -1)
  case "$live" in
    *'ENC=auto'*) ;;
    *) echo "$b: ENC is set outright, not probed: $live"; bad=1;;
  esac

  # Every candidate is tried before giving up.
  for e in h264_nvenc h264_qsv h264_amf; do
    grep -q -- "call :encprobe -c:v $e" "$f" || { echo "$b: never probes $e"; bad=1; }
  done

  # And the probe must judge by what was written, not by the exit code.
  # IF ERRORLEVEL n is true for n OR MORE, so a negative code - which ffmpeg
  # returns - made "if not errorlevel 1" true and picked the encoder that had
  # just failed. A failed encoder also leaves a zero-byte file, so "if exist"
  # is not enough either.
  grep -q 'if %%~zA GTR 0 set "ENCOK=1"' "$f" \
    || { echo "$b: the probe does not check that anything was written"; bad=1; }
  if grep -n 'errorlevel' "$f" | grep -qi 'enc'; then
    echo "$b: an encoder decision still turns on errorlevel"; bad=1
  fi

  # And the last resort is the processor, which needs no hardware at all.
  grep -qE '^set "ENCSW=-c:v libx264' "$f" || { echo "$b: no software fallback defined"; bad=1; }
  grep -q 'set "ENC=%ENCSW%"' "$f" || { echo "$b: never falls back to the processor"; bad=1; }
done

# Quick Sync is one encoder block: it must not be chosen as both.
grep -q 'if /i "%ENCKIND%"=="qs" goto :enc2_none' "$P/split-views.bat" \
  || { echo "split-views.bat: would run Quick Sync as both encoders"; bad=1; }

# The probe must actually tell a usable encoder from an unusable one. This
# machine has no Nvidia card either, which makes it a fair stand-in.
if command -v ffmpeg >/dev/null 2>&1; then
  probe() { ffmpeg -hide_banner -loglevel error -f lavfi \
            -i color=c=black:s=640x480:r=25:d=0.2 -c:v "$1" -f null - >/dev/null 2>&1; }
  probe libx264 || { echo "the software encoder failed - the fallback is not a fallback"; bad=1; }
  if probe h264_nvenc; then
    echo "note: this machine has NVENC, so the negative case was not exercised"
  fi
fi

[ $bad -eq 0 ] || exit 1
echo "both batches probe for an encoder and end at the processor"
exit 0
