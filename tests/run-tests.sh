#!/usr/bin/env bash
# Regression set for the Dashcam Player fixes. All tests read the shipped
# files, so they cannot drift from the code.
SP="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SP/.." && pwd)"
# Everything under test is found from the repository, not from an absolute
# path on whoever's machine wrote it. DCP_SRC and DCP_INSTALLER let a
# caller point the suite somewhere else - an extracted release, say.
export DCP_SRC="${DCP_SRC:-$ROOT/src}"
export DCP_INSTALLER="${DCP_INSTALLER:-$ROOT/installer}"
# "npm install" in this folder puts them in tests/node_modules; the older
# layout kept them a level down. Accept either, and say so if neither is
# there rather than failing a dozen tests with a module-not-found.
if   [ -d "$SP/node_modules/jsdom" ];    then export NM="$SP/node_modules"
elif [ -d "$SP/t2/node_modules/jsdom" ]; then export NM="$SP/t2/node_modules"
else echo "Test dependencies are missing. Run: npm install --prefix \"$SP\""; exit 2
fi
P="$DCP_SRC"
# A browser for the tests that need real pixels. The path this was developed
# against is a sandbox's; a clone has no browser there, because playwright-core
# deliberately downloads none. Take one from the environment, fall back to the
# sandbox, and otherwise look where Playwright would have put one. The checks
# that need it skip themselves when there is none.
if [ -z "$DCP_CHROMIUM" ]; then
  for c in /opt/pw-browsers/chromium \
           "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux/chrome \
           "$(command -v chromium 2>/dev/null)" \
           "$(command -v google-chrome 2>/dev/null)"; do
    if [ -n "$c" ] && [ -x "$c" ]; then DCP_CHROMIUM="$c"; break; fi
  done
fi
export DCP_CHROMIUM
fail=0
node -e "const fs=require('fs');const m=fs.readFileSync('$P/dashcam-player.html','utf8').match(/<script\b[^>]*>([\s\S]*?)<\/script>/);fs.writeFileSync('$SP/full.js',m[1]);"
node --check "$SP/full.js" >/dev/null 2>&1 && echo "[ok]   page script syntax" || { echo "[FAIL] page script syntax"; fail=1; }
for t in xss2 hevcmsg panel del del2 delopen fisheye sidecar robust csp defaults reset tooltips stale groupdel alertpoint alertfolder clip marks scan scandirs sessionname splitsecs duration splitclock length rectify flat adjust marker locate wholesize delghost alertlabel pathline; do
  if node "$SP/t2/$t.js" >/dev/null 2>&1; then echo "[ok]   $t"; else echo "[FAIL] $t"; [ "$t" = csp ] && echo "       (run: python3 tools/repin-csp.py)"; fail=1; fi
done
# The MP4 parser, against real recordings. They are far too large to keep in
# the repository and are somebody's own footage besides, so a clone without
# them skips: DCP_SAMPLES names a folder of .mp4 files to read.
node "$SP/t2/parser.js" >/dev/null 2>&1; rc=$?
if   [ $rc -eq 0 ]; then echo "[ok]   parser"
elif [ $rc -eq 2 ]; then echo "[skip] parser (no sample recordings; set DCP_SAMPLES)"
else echo "[FAIL] parser"; fail=1
fi

python3 "$SP/layers.py" | tail -1 | grep -q 'all three layers hold' && echo "[ok]   injection layers" || { echo "[FAIL] injection layers"; fail=1; }
python3 "$SP/cmdparse.py" >/dev/null 2>&1 && echo "[ok]   cmd quoting model" || { echo "[FAIL] cmd quoting model"; fail=1; }

# Nothing here can run cmd, so these two stand in for it: a jump with no
# label stops a batch dead at run time, and a hardcoded hardware encoder
# makes the tools fail outright on a machine without that card.
python3 "$SP/batlabels.py" >/dev/null 2>&1 && echo "[ok]   batch labels resolve" || { echo "[FAIL] a batch jump has no label"; fail=1; }
"$SP/encoder.sh" >/dev/null 2>&1 && echo "[ok]   encoder is probed, not assumed" || { echo "[FAIL] a batch names a hardware encoder outright"; fail=1; }

# Run hidden from the player there is no console to press a key on, so a bare
# "pause" stops a tool dead where nobody can see it. That shipped: the fisheye
# finished its work and then sat waiting, and the player showed "working" for
# as long as it was left open.
python3 "$SP/nowait.py" >/dev/null 2>&1 && echo "[ok]   nothing waits for a keypress when run hidden" || { echo "[FAIL] a batch waits for a keypress the player cannot give"; fail=1; }

# The fisheye tool takes ONE view, and the crop offsets are run through real
# ffmpeg against a frame with four different-coloured quadrants: a wrong
# offset succeeds, plays, and is simply the wrong camera.
if "$SP/rectify.sh" >/dev/null 2>&1; then
  echo "[ok]   rectify takes one view, from the right place"
else
  echo "[FAIL] rectify: $("$SP/rectify.sh" 2>&1 | head -1)"; fail=1
fi

# The recorder that encodes a tall frame as columns. Three of its four
# cameras are split across two columns, so the fixture is rastered the way the
# recorder rasters one and the cameras are read back as pixels.
if [ -n "$DCP_CHROMIUM" ] && [ -x "$DCP_CHROMIUM" ]; then
  aout=$(node "$SP/openavm.js" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then
    echo "[ok]   a frame encoded as columns is put back together"
  elif [ $rc -eq 2 ]; then
    echo "[skip] the column layout (no ffmpeg to build a fixture with)"
  else
    echo "[FAIL] column layout: $(printf '%s' "$aout" | grep FAIL | head -1)"; fail=1
  fi
fi

# The bitrate and frame rate beside the file name. The frame rate is read out
# of the file's own index, and a recording with sound has a second media
# header and a second sample table in it - so the fixtures are real files made
# at known rates, some of them with the audio track written FIRST.
fsout=$(node "$SP/filestats.js" 2>&1); rc=$?
if [ $rc -eq 0 ]; then
  echo "[ok]   the bitrate and frame rate are read from the file"
elif [ $rc -eq 2 ]; then
  echo "[skip] the file figures (no ffmpeg to build fixtures with)"
else
  echo "[FAIL] file figures: $(printf '%s' "$fsout" | grep FAIL | head -1)"; fail=1
fi

# Exporting a camera that is folded across two columns. The tools are sent the
# rectangles, splice them into a filter and never pick them apart - so the
# strings and the loops come out of the batch files and a real ffmpeg runs
# them against a rastered fixture.
eout=$("$SP/avmexport.sh" 2>&1); rc=$?
if [ $rc -eq 0 ]; then
  echo "[ok]   a camera folded across columns exports whole"
elif [ $rc -eq 2 ]; then
  echo "[skip] the folded export (no ffmpeg to build a fixture with)"
else
  echo "[FAIL] folded export: $(printf '%s' "$eout" | grep FAIL | head -1)"; fail=1
fi

# The clock the tools burn into the picture. The filter has to survive cmd
# and two of ffmpeg's own parsers, nothing here runs cmd, and a mistake does
# not draw the wrong time - it stops the export. So the line is taken out of
# the batch, cmd's rules are applied to it, and a real ffmpeg draws with it.
cout=$("$SP/clockfilter.sh" 2>&1)
if [ $? -eq 0 ]; then
  echo "[ok]   the burned-in clock survives cmd and draws what it is given"
else
  echo "[FAIL] clock: $(printf '%s' "$cout" | grep FAIL | head -1)"; fail=1
fi

# The three export quality levels, encoded for real and measured. A level
# that silently falls through to another is invisible otherwise: every file
# still plays, it is just worse than it was asked to be.
qout=$("$SP/quality.sh" 2>&1)
if [ $? -eq 0 ]; then
  echo "[ok]   the quality levels differ, and none pins a bitrate"
else
  echo "[FAIL] quality: $(printf '%s' "$qout" | grep FAIL | head -1)"; fail=1
fi

# PowerShell parse check. Caught a real break in Run-Tool.ps1 that every other
# test here would have sailed past, because none of them execute PowerShell.
if [ -x /opt/ps/pwsh ]; then
  pfail=0
  for f in "$P"/*.ps1; do
    if /opt/ps/pwsh -NoProfile -Command "\$e=\$null;\$null=[System.Management.Automation.Language.Parser]::ParseFile('$f',[ref]\$null,[ref]\$e); exit \$e.Count" >/dev/null 2>&1; then
      :
    else
      echo "[FAIL] parse $(basename "$f")"; fail=1; pfail=1
    fi
  done
  # Its own counter. Keyed off $fail, this result vanished whenever anything
  # earlier had failed - so the run that most needed it said nothing at all.
  [ "${pfail:-0}" -eq 0 ] && echo "[ok]   powershell parses"
fi


# A local that merely shares a name with a parameter IS that parameter in
# PowerShell. That silently erased an argument for the life of this project
# and no parse check, syntax check or test could see it.
if [ -x /opt/ps/pwsh ]; then
  if /opt/ps/pwsh -NoProfile -File "$SP/paramcheck.ps1" >/dev/null 2>&1; then
    echo "[ok]   no parameter shadowing"
  else
    echo "[FAIL] parameter shadowed by a local"; fail=1
  fi
fi

# "-Encoding UTF8" writes a BOM on PowerShell 5.1 and none on 7. Everything
# here runs under 7; every user runs 5.1. That gap shipped a broken feature
# that passed every test, so it is now a test of its own.
if "$SP/bomcheck.sh" >/dev/null 2>&1; then
  echo "[ok]   no BOM on machine-read files"
else
  echo "[FAIL] a machine-read file may be written with a BOM"; fail=1
fi

# Changing the crop must not move the control bar. Same reasoning as below:
# measured in a browser, because it is a layout question.
if [ -n "$DCP_CHROMIUM" ] && [ -x "$DCP_CHROMIUM" ]; then
  out=$(node "$SP/bartest.js" 2>&1)
  if [ $? -eq 0 ]; then echo "[ok]   the control bar holds still"
  else echo "[FAIL] the control bar moves: $(printf '%s' "$out" | grep FAIL | head -1)"; fail=1; fi
fi

# Ticking a box must not move the list. This one is measured in a real
# browser: it is a layout question, and only a layout engine can answer it.
if [ -n "$DCP_CHROMIUM" ] && [ -x "$DCP_CHROMIUM" ]; then
  out=$(node "$SP/footer-test.js" 2>&1)
  if [ $? -eq 0 ]; then echo "[ok]   the list holds still"
  else echo "[FAIL] the list moves: $(printf '%s' "$out" | grep FAIL | head -1)"; fail=1; fi
fi

# The file list must not scroll sideways. "overflow-y:auto" does not leave
# the other axis visible - CSS computes it to auto - so this was one over-wide
# row away at all times, and a wider monospace font supplied the row.
if [ -n "$DCP_CHROMIUM" ] && [ -x "$DCP_CHROMIUM" ]; then
  out=$(node "$SP/hscroll.js" 2>&1)
  if [ $? -eq 0 ]; then echo "[ok]   the list does not scroll sideways"
  else echo "[FAIL] the list scrolls sideways: $(printf '%s' "$out" | grep FAIL | head -1)"; fail=1; fi
fi

# The in and out pointers are dragged with a real mouse. Pointer capture and
# hit areas cannot be reasoned about from the source, and the arithmetic has
# to survive the readout beside the timeline changing width as the mark moves.
if [ -n "$DCP_CHROMIUM" ] && [ -x "$DCP_CHROMIUM" ]; then
  out=$(node "$SP/dragtest.js" 2>&1)
  if [ $? -eq 0 ]; then echo "[ok]   the clip pointers drag"
  else echo "[FAIL] the clip pointers drag: $(printf '%s' "$out" | grep FAIL | head -1)"; fail=1; fi
fi

# The keyboard shortcuts, pressed after touching the control you reach them
# through. They worked from a standing start and failed in use.
if [ -n "$DCP_CHROMIUM" ] && [ -x "$DCP_CHROMIUM" ]; then
  out=$(node "$SP/keys.js" 2>&1)
  if [ $? -eq 0 ]; then echo "[ok]   the shortcuts work in use, not just in theory"
  else echo "[FAIL] a shortcut is dead after using a control: $(printf '%s' "$out" | grep FAIL | head -1)"; fail=1; fi
fi

# The play and pause button carries a drawn shape, not a word. Whether the
# right one is actually PAINTED, and whether the button keeps its width as it
# swaps, are both questions only a layout engine can answer.
if [ -n "$DCP_CHROMIUM" ] && [ -x "$DCP_CHROMIUM" ]; then
  out=$(node "$SP/playbtn.js" 2>&1)
  if [ $? -eq 0 ]; then echo "[ok]   the play and pause shapes swap over"
  else echo "[FAIL] the play button: $(printf '%s' "$out" | grep FAIL | head -1)"; fail=1; fi
fi

# The frame shown before an export runs. It has to be what the TOOL will
# write - not the player's trimmed, lens-corrected canvas - and nothing may
# start until the question is answered. Real video, real pixels read back.
if [ -n "$DCP_CHROMIUM" ] && [ -x "$DCP_CHROMIUM" ]; then
  out=$(node "$SP/exportpreview.js" 2>&1)
  rc=$?
  if [ $rc -eq 0 ]; then echo "[ok]   the export is previewed before it runs"
  elif [ $rc -eq 2 ]; then echo "[ok]   export preview (ffmpeg absent, not exercised)"
  else echo "[FAIL] the export preview: $(printf '%s' "$out" | grep FAIL | head -1)"; fail=1; fi
fi

# The day-group expander arrows: twice the size of the text, without growing
# the heading they sit in. A layout question, so measured in a browser.
if [ -n "$DCP_CHROMIUM" ] && [ -x "$DCP_CHROMIUM" ]; then
  out=$(node "$SP/caret.js" 2>&1)
  if [ $? -eq 0 ]; then echo "[ok]   the expander arrows are the size asked for"
  else echo "[FAIL] the expander arrows: $(printf '%s' "$out" | grep FAIL | head -1)"; fail=1; fi
fi

# The offer to install ffmpeg, driven in a browser against a stub helper.
if [ -n "$DCP_CHROMIUM" ] && [ -x "$DCP_CHROMIUM" ]; then
  out=$(node "$SP/ffmpegtest.js" 2>&1)
  if [ $? -eq 0 ]; then echo "[ok]   ffmpeg is offered when it is missing"
  else echo "[FAIL] the ffmpeg offer: $(printf '%s' "$out" | grep FAIL | head -1)"; fail=1; fi
fi

# Snapshot writes a file. The save dialog, the cancel and the download
# fallback are all browser machinery that jsdom does not have.
if [ -n "$DCP_CHROMIUM" ] && [ -x "$DCP_CHROMIUM" ]; then
  out=$(node "$SP/snaptest.js" 2>&1)
  if [ $? -eq 0 ]; then echo "[ok]   the snapshot is saved to a file"
  else echo "[FAIL] the snapshot is not saved: $(printf '%s' "$out" | grep FAIL | head -1)"; fail=1; fi
fi

# The helper builds an argument list and the launcher declares what it takes.
# Nothing else checks those agree - which is how half a removed feature gets
# left behind on one side of the wire.
if [ -x /opt/ps/pwsh ]; then
  if /opt/ps/pwsh -NoProfile -File "$SP/argmatch.ps1" >/dev/null 2>&1; then
    echo "[ok]   helper and launcher agree"
  else
    echo "[FAIL] helper and launcher disagree"; fail=1
  fi
fi

# Opening the output folder: the helper runs Explorer, so what it is willing
# to open matters more than most things here.
if [ -x /opt/ps/pwsh ]; then
  # ffmpeginstall RUNS the installer against a fake winget; ffmpegsrv checks
  # the contract the page, the helper and the installer all depend on; and
  # ffmpeglive starts the real helper with no ffmpeg on a sandboxed PATH and
  # watches the whole chain through to the endpoint the page reads.
  for t in reveal revealfile outdir clipargs progress findfile cancel headers ffmpegsrv ffmpeginstall ffmpeglive; do
    out=$(/opt/ps/pwsh -NoProfile -File "$SP/$t.ps1" 2>&1)
    if [ $? -eq 0 ]; then
      echo "[ok]   $t"
    else
      # Say WHY, not just which. A bare "[FAIL] ffmpeglive" meant running it
      # again by hand to find out, and a test that only fails under the load
      # of a full suite run does not fail again when you do.
      echo "[FAIL] $t: $(printf '%s' "$out" | grep -v '^$' | head -2 | tr '\n' ' ')"; fail=1
    fi
  done
fi

# The helper shuts itself down when the pings stop, and a backgrounded window
# pings far more slowly than it thinks it does. That combination killed the
# helper under the player's nose and reported only "Failed to fetch".
if "$SP/idle.sh" >/dev/null 2>&1; then
  echo "[ok]   the helper survives a backgrounded window"
else
  echo "[FAIL] the helper shuts down while the window is merely hidden"; fail=1
fi
if [ -n "$DCP_CHROMIUM" ] && [ -x "$DCP_CHROMIUM" ]; then
  if node "$SP/deadtest.js" >/dev/null 2>&1; then
    echo "[ok]   a stopped helper says so"
  else
    echo "[FAIL] a stopped helper is not reported usefully"; fail=1
  fi
fi

# A failure has to say what went wrong, not just that it did.
if [ -x /opt/ps/pwsh ]; then
  if /opt/ps/pwsh -NoProfile -File "$SP/reason.ps1" >/dev/null 2>&1; then
    echo "[ok]   failures report a reason"
  else
    echo "[FAIL] failures report a reason"; fail=1
  fi
fi

python3 "$SP/wxscheck.py" >/dev/null 2>&1 && echo "[ok]   installer GUIDs" || { echo "[FAIL] installer GUIDs"; fail=1; }

# The rows inside the built package. 1.34.0 shipped with one table's rows out
# of key order and Windows refused it outright - while every other check here,
# and msiinfo, msiextract and wine, read it back perfectly.
if python3 "$SP/msiorder.py" >/dev/null 2>&1; then
  echo "[ok]   MSI tables are in key order"
else
  echo "[FAIL] an MSI table's rows are out of key order - Windows will refuse the package"; fail=1
fi

echo; [ $fail -eq 0 ] && echo "ALL PASS" || echo "FAILURES PRESENT"
exit $fail
