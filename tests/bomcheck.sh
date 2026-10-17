#!/usr/bin/env bash
# "-Encoding UTF8" means two different things.
#
# Windows PowerShell 5.1 - which is what actually runs these scripts - writes a
# byte order mark. PowerShell 7, which is what they get tested under here,
# writes none. So a file that any other program has to parse comes out fine in
# every test and broken on every real machine: ffmpeg read the mark as part of
# the first filter's name and refused the whole graph.
#
# Any file written for another program to read must therefore say plainly which
# encoding it wants. This refuses the ambiguous spelling outright.
set -u
P="${DCP_SRC:-$(cd "$(dirname "$0")/../src" && pwd)}"
bad=0

# Comment lines are skipped - the warning about this trap names the very
# spelling it warns against, and would otherwise trip its own check.
hits=$(grep -n -- '-Encoding[[:space:]]\+UTF8' "$P"/*.ps1 2>/dev/null \
       | grep -v ':[[:space:]]*[0-9]*:[[:space:]]*#' || true)
if [ -n "$hits" ]; then
  echo "ambiguous encoding - writes a BOM on 5.1, none on 7:"
  echo "$hits"
  bad=1
fi

# The status file is parsed by the page, so it must use the explicit
# BOM-less writer. (The adjusted-split filter graph was the other one; that
# feature is gone.)
for v in '$stat'; do
  if ! grep -q "WriteAllText(\s*$(printf '%s' "$v" | sed 's/[$]/\\$/g')" "$P/Run-Tool.ps1"; then
    echo "$v is not written with an explicit encoding"; bad=1
  fi
done
if [ "$(grep -c 'UTF8Encoding($false)' "$P/Run-Tool.ps1")" -lt 1 ]; then
  echo "expected the status file to be written without a BOM"; bad=1
fi


# --- and a batch file must end its lines the way cmd expects ---------------
#
# This is the same class of trap as the BOM, and it cost a long evening.
#
# cmd.exe reads a .bat by byte offset and seeks back and forth through it to
# find labels. That bookkeeping assumes CRLF. Give it LF-only line endings and
# it mostly works - which is the worst possible failure, because it works
# until the file grows or a label moves, and then one GOTO lands somewhere
# that is not a label and the run stops with "The system cannot find the batch
# label specified". Adding three labels near the top of rectify-fisheye.bat
# was enough: the export failed at two quality settings and worked at the
# third, because the three jumped to different offsets.
#
# These files are edited from Linux, where every tool writes LF by default and
# nothing complains. Nothing here can run cmd, so this is the check that
# stands in for it.
for f in "$P"/*.bat "$P"/*.cmd; do
  [ -e "$f" ] || continue
  n=$(basename "$f")
  total=$(wc -l < "$f" | tr -d ' ')
  crlf=$(grep -c $'\r$' "$f" || true)
  if [ "$total" != "$crlf" ]; then
    echo "$n has $((total - crlf)) of $total lines ending in a bare LF - cmd needs CRLF to find its labels"
    bad=1
  fi
  # A lone CR inside a line is its own kind of wrong, and would be invisible
  # above because the line still ends CRLF.
  if LC_ALL=C grep -q $'\r[^\n]' "$f" 2>/dev/null; then
    echo "$n has a carriage return in the middle of a line"; bad=1
  fi
done

[ $bad -eq 0 ] || exit 1
echo "machine-read files are written without a BOM, and the batch files end their lines the way cmd needs"
exit 0
