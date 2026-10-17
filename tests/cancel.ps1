# Stopping a run that is under way.
#
# The dangerous part of this is not the stopping, it is WHERE the process id
# comes from. The page must never be able to name a process to kill, because
# a page that can name one can name any of them - the same rule /reveal
# follows for the folder it opens. So the id is read back out of the status
# file that the tool itself wrote, and this checks that is the only source.
#
# The rest is the chain: the launcher has to record the id in the first place,
# the whole process tree has to go rather than just the launcher (ffmpeg is a
# grandchild of it, by way of cmd), and the state the page reads afterwards
# has to say so - the tool cannot say anything itself, having been killed.
$Src = if ($env:DCP_SRC) { $env:DCP_SRC } else { (Resolve-Path (Join-Path $PSScriptRoot '../src')).Path }
$srv = Get-Content "$Src/dashcam-server.ps1" -Raw
$run = Get-Content "$Src/Run-Tool.ps1" -Raw

$bad = 0
function Bad([string]$m) { $script:bad++; "  $m" }

# --- the launcher records it -------------------------------------------------
if ($run -notmatch '(?m)^\s*pid\s*=\s*\$PID') {
  Bad 'the launcher does not record its process id, so nothing can stop it'
}

# --- the route exists and is guarded -----------------------------------------
$m = [regex]::Match($srv, "\`$needsToken = @\(([^)]*)\)")
if (-not $m.Success) { Bad 'there is no list of routes that require the token' }
elseif ($m.Groups[1].Value -notmatch "'/cancel-split'") {
  Bad 'cancelling does not require the token, so any page could stop a run'
}

# --- the id comes from the FILE, never the request ---------------------------
$blockM = [regex]::Match($srv, "(?s)'/cancel-split'\s*\{(.*?)\n        '")
if (-not $blockM.Success) { Bad 'the cancel route could not be read' }
else {
  # Comments stripped before anything is searched for: this block EXPLAINS
  # why it does not use Stop-Process, and a check that cannot tell an
  # explanation from the thing it warns against is worse than no check.
  $block = ($blockM.Groups[1].Value -split "`n" |
            Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
  if ($block -notmatch 'split-status\.json') {
    Bad 'the cancel route does not read the status file the tool wrote'
  }
  # Anything that looks like it is taking a value out of the request is
  # exactly what must not be here.
  foreach ($bannedPattern in '\$query', '\$pairs', 'UnescapeDataString', '\$path\.Substring') {
    if ($block -match $bannedPattern) {
      Bad "the cancel route reads '$bannedPattern' from the request - the page must not name a process"
    }
  }
  # The whole tree, not just the launcher.
  if ($block -notmatch 'taskkill') {
    Bad 'the cancel route does not use taskkill, so ffmpeg would outlive the launcher'
  }
  if ($block -notmatch "'/T'") {
    Bad 'the kill is not applied to the process tree, so ffmpeg keeps running'
  }
  # Stop-Process would kill the launcher and leave the encode orphaned.
  if ($block -match 'Stop-Process') {
    Bad 'the cancel route uses Stop-Process, which does not take the children with it'
  }
  # Only a run that is actually going.
  if ($block -notmatch "running" -or $block -notmatch "starting") {
    Bad 'the cancel route does not check the run is under way before killing anything'
  }
  # And only a process that is really the tool. Windows reuses process ids,
  # and a tool killed with its session leaves "running" in the file for ever,
  # so the id alone can name something else by the time anyone presses the
  # button - and what follows is taskkill /T /F on a whole process tree.
  # When the process started settles it: the tool wrote that line after
  # starting, so its own process cannot have begun after it.
  if ($block -notmatch 'StartTime') {
    Bad 'the cancel route does not check when the process started, so a reused id could be killed'
  }
  if ($block -notmatch 'ProcessName') {
    Bad 'the cancel route does not check what the process is before killing its tree'
  }
  if ($block -notmatch 'Get-Process') {
    Bad 'the cancel route never looks the process up, so it cannot tell whose id it has'
  }
  # And it must say what happened, since the tool cannot.
  if ($block -notmatch "'cancelled'") {
    Bad 'nothing records that the run was cancelled, so the page waits for ever'
  }
}

# --- the page offers it, and asks for nothing more than the action -----------
$page = Get-Content "$Src/dashcam-player.html" -Raw
if ($page -notmatch 'id="splitCancel"') {
  Bad 'there is no Cancel while a clip is being written'
}
if ($page -notmatch '/cancel-split') {
  Bad 'the Cancel button does not ask the helper to stop anything'
}
# No id, no file, no path - the request carries nothing but its own name.
if ($page -match '/cancel-split\?') {
  Bad 'the page sends arguments with the cancel, and it has none to send'
}

# --- a stopped run must not block the next one -------------------------------
# A killed encode leaves a part-written file. Both tools treat "the output is
# already there" as "nothing to do", so without a check that it is USABLE the
# recording could never be written again.
# The two tools word it differently - one skips, the other marks the view as
# missing so it gets redone - so what is checked is the thing they must have
# in common: the output's name appears in an "if exist" AND in an ffprobe.
foreach ($b in 'split-views.bat','rectify-fisheye.bat') {
  $txt = (Get-Content "$Src/$b" -Raw) -replace "`r", ''
  $existLines = @($txt -split "`n" | Where-Object { $_ -match 'if (not )?exist "%OUT%' })
  if ($existLines.Count -lt 1) { Bad "$b never checks whether the output is already there"; continue }
  # The ffprobe has to be IN the skip check, not merely somewhere in the file:
  # both tools probe the file they have just written, and finding that one
  # proves nothing about a file left over from a run that was stopped. So the
  # window searched is the few lines following the existence test.
  $lines = @($txt -split "`n")
  $ok = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -notmatch 'if (not )?exist "%OUT%') { continue }
    $window = ($lines[$i..([Math]::Min($i + 8, $lines.Count - 1))]) -join "`n"
    if ($window -match 'ffprobe') { $ok = $true; break }
  }
  if (-not $ok) {
    Bad "$b decides an existing output is done without asking ffprobe, so a part-written file blocks the retry for ever"
  }
}

if ($bad) { "FAIL: $bad problem(s)"; exit 1 }
'a run can be stopped, the id comes only from the tool''s own status file, and nothing is left blocking a retry'
exit 0
