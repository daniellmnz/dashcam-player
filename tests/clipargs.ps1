# The clip's start and length travel page -> helper -> launcher -> batch and
# end up on an ffmpeg command line, so the helper's vetting of them is the
# fence. Patterns are read out of the SHIPPED files.
# Found from this script's own location, so the suite travels with the
# repository instead of pointing at one machine's folders.
$Src = if ($env:DCP_SRC) { $env:DCP_SRC } else { (Resolve-Path (Join-Path $PSScriptRoot '../src')).Path }

$srv = Get-Content "$Src/dashcam-server.ps1" -Raw
$run = Get-Content "$Src/Run-Tool.ps1" -Raw
$bat = Get-Content "$Src/split-views.bat" -Raw
$page = Get-Content "$Src/dashcam-player.html" -Raw

$bad = 0
function Bad([string]$m) { $script:bad++; "  $m" }

# --- the helper only lets numbers through -----------------------------------
$m = [regex]::Match($srv, "\`$cstart -notmatch '([^']+)'")
if (-not $m.Success) { Bad 'the helper does not validate start'; }
else {
  $pat = $m.Groups[1].Value
  foreach ($good in '0','12','12.5','123.456','999999') {
    if ($good -notmatch $pat) { Bad "start '$good' rejected but should pass" }
  }
  foreach ($evil in '12 & calc','-1','1e3','12;x','','12.5678','abc',"12`n", '"12"', '../x') {
    if ($evil -match $pat) { Bad "start '$evil' accepted but should not be" }
  }
}

# --- both or neither --------------------------------------------------------
if ($srv -notmatch "if \(-not \(\`$cstart -and \`$cdur\)\) \{ \`$cstart = ''; \`$cdur = '' \}") {
  Bad 'the helper would pass a start with no length, which runs to the end of the recording'
}
if ($srv -notmatch "\[double\]\`$\('0' \+ \`$cdur\) -le 0") {
  Bad 'the helper would accept a zero-length clip'
}

# --- the launcher declares them, and the batch is told through the env ------
if ($run -notmatch '\[string\]\$Start') { Bad 'Run-Tool has no -Start' }
if ($run -notmatch '\[string\]\$Dur')   { Bad 'Run-Tool has no -Dur' }
if ($run -notmatch 'if \(\$Start -and \$Dur\)') { Bad 'Run-Tool would set one without the other' }
foreach ($v in 'DCP_START','DCP_DUR') {
  if ($run -notmatch "env:$v")  { Bad "Run-Tool never sets $v" }
  if ($bat -notmatch "DCP_START") { Bad 'the batch never reads the clip from the environment'; break }
}

# --- the batch -------------------------------------------------------------
if ($bat -notmatch 'if defined START set "RANGE=-ss %START%"') { Bad 'the batch does not seek to the start' }
if ($bat -notmatch 'if defined DUR set "RANGE=%RANGE% -t %DUR%"') { Bad 'the batch does not limit the length' }
if ($bat -notmatch 'if defined DUR set "SECS=%DUR%"') {
  Bad 'the progress bar would count the whole recording rather than the clip'
}
# A clip must not overwrite a whole recording of the same camera.
if ($bat -notmatch '\!NAME\!_\!VLAB\!\!CLIP\!\.mp4') { Bad 'a clip would be written over the full file' }
# And the suffix must stay word-characters only: the player recognises a
# single-camera file by the view name plus at most one more "_word", so a
# decimal point in the name turns it back into a presumed four-camera grid.
if ($bat -notmatch 'for /f "delims=\." %%a in \("%START%"\) do set "CLIP=_clip%%a"') {
  Bad 'the clip suffix is not reduced to whole seconds'
}

# --- which tool runs -------------------------------------------------------
# The page now asks for one of two scripts by name. It names a program to
# start, so the helper matches it exactly against the two it knows rather
# than filtering what it does not like: anything else becomes the default.
if ($srv -notmatch "if \(\`$ctool -ne 'rectify'\) \{ \`$ctool = 'split' \}") {
  Bad 'the helper does not pin the tool name to one of the two it knows'
}
if ($srv -notmatch "'-Tool',\`$ctool") { Bad 'the chosen tool never reaches the launcher' }
# The launcher must only accept tools it knows about: -Tool decides which
# script runs. Read as a set, so adding one is a deliberate act rather than
# something a test rewrite waves through.
$m = [regex]::Match($run, "ValidateSet\(([^)]*)\)\]\[string\]\`$Tool")
if (-not $m.Success) { Bad 'the launcher does not restrict -Tool at all' }
else {
  $tools = @($m.Groups[1].Value -split ',' | ForEach-Object { $_.Trim().Trim("'") })
  foreach ($t in 'split','rectify') {
    if ($tools -notcontains $t) { Bad "-Tool no longer accepts '$t'" }
  }
  foreach ($t in $tools) {
    if ('split','rectify','locate','pick' -notcontains $t) { Bad "-Tool accepts an unknown tool '$t'" }
  }
}
# --- the quality setting travels the whole way ------------------------------
# Page -> query string -> server -> launcher -> environment -> batch. Five
# hand-offs, and a setting that is dropped at any one of them still exports
# perfectly happily, just not at the quality that was asked for. Each link is
# checked, and so is the validation at each link: this ends up as ffmpeg
# arguments, so an unrecognised value must be dropped rather than passed on.
if ($page -notmatch '&quality=') { Bad 'the page never sends the export quality' }
if ($srv -notmatch "quality=") { Bad 'the helper does not read the quality out of the request' }
if ($srv -notmatch "'standard','high','maximum'") {
  Bad 'the helper does not restrict the quality to the three the tools know'
}
if ($srv -notmatch "'-Quality'") { Bad 'the chosen quality never reaches the launcher' }
$mq = [regex]::Match($run, "ValidateSet\(([^)]*)\)\]\[string\]\`$Quality")
if (-not $mq.Success) { Bad 'the launcher does not restrict -Quality at all' }
else {
  $qs = @($mq.Groups[1].Value -split ',' | ForEach-Object { $_.Trim().Trim("'") })
  foreach ($q in 'standard','high','maximum') {
    if ($qs -notcontains $q) { Bad "-Quality no longer accepts '$q'" }
  }
}
if ($run -notmatch '\$env:DCP_QUALITY = \$Quality') {
  Bad 'the launcher never puts the quality where the batch can read it'
}
foreach ($bf in 'split-views.bat','rectify-fisheye.bat') {
  $txt = Get-Content "$Src/$bf" -Raw
  if ($txt -notmatch 'if defined DCP_QUALITY set "QUALITY=%DCP_QUALITY%"') {
    Bad "$bf ignores the quality the launcher sets"
  }
}

# --- and so does the status-strip choice ------------------------------------
if ($page -notmatch '&strip=') { Bad 'the page never says whether to keep the status strip' }
if ($srv -notmatch "strip=") { Bad 'the helper does not read the strip choice out of the request' }
if ($srv -notmatch "'0','1' -notcontains \`$cstrip") {
  Bad 'the helper does not restrict the strip choice to 0 or 1'
}
if ($srv -notmatch "'-StatusStrip'") { Bad 'the strip choice never reaches the launcher' }
if ($run -notmatch '\$env:DCP_STATUSSTRIP = \$StatusStrip') {
  Bad 'the launcher never puts the strip choice where the batch can read it'
}
foreach ($bf in 'split-views.bat','rectify-fisheye.bat') {
  $txt = Get-Content "$Src/$bf" -Raw
  if ($txt -notmatch 'if "%DCP_STATUSSTRIP%"=="0" set "APPENDSTRIP=0"') {
    Bad "$bf never leaves the status strip off when it is told to"
  }
  # Both directions, or an export could only ever turn it off.
  if ($txt -notmatch 'if "%DCP_STATUSSTRIP%"=="1" set "APPENDSTRIP=1"') {
    Bad "$bf cannot be told to KEEP the status strip"
  }
}

# --- and the trim, which only the fisheye tool can apply ---------------------
if ($page -notmatch '&trimtop=') { Bad 'the page never sends the trim' }
if ($srv -notmatch "trimtop=") { Bad 'the helper does not read the trim out of the request' }
if ($srv -notmatch "'-TrimTop'") { Bad 'the trim never reaches the launcher' }
if ($run -notmatch '\$env:DCP_TRIMTOP = \$TrimTop') {
  Bad 'the launcher never puts the trim where the batch can read it'
}
$rect = Get-Content "$Src/rectify-fisheye.bat" -Raw
if ($rect -notmatch 'if defined DCP_TRIMTOP set "TRIMTOP=%DCP_TRIMTOP%"') {
  Bad 'the fisheye tool ignores the trim the launcher sets'
}
# AFTER the v360, not before. Cropping the fisheye circle first feeds the
# correction a different picture from the one it was measured for, and bends
# what is left - the output would be subtly wrong rather than obviously so.
if ($rect -notmatch 'set "V=!V!,crop=') {
  Bad 'the trim is not appended to the correction, so it is cropping the wrong picture'
}
# The split tool must not pretend to take one: it has no idea where a trim
# measured against a straightened frame would land on an uncorrected one.
$sp = Get-Content "$Src/split-views.bat" -Raw
if ($sp -match 'DCP_TRIMTOP') { Bad 'the split tool reads a trim it cannot correctly apply' }

# Both tools take a range now, so the fisheye batch has to read the same two
# variables the split one does and turn them into an ffmpeg range - and give
# the result its own name, or clipping a recording would overwrite the whole
# one beside it.
$dw = Get-Content "$Src/rectify-fisheye.bat" -Raw
foreach ($v in 'DCP_START','DCP_DUR') {
  if ($dw -notmatch [regex]::Escape($v)) { Bad "the fisheye tool ignores $v, so a clip would be lost" }
}
if ($dw -notmatch '-ss %START%') { Bad 'the fisheye tool never passes a start to ffmpeg' }
if ($dw -notmatch '-t %DUR%')    { Bad 'the fisheye tool never passes a length to ffmpeg' }
if ($dw -notmatch 'CLIP=_clip')  { Bad 'a fisheye clip would overwrite the whole recording beside it' }
if ($dw -notmatch 'Show-Progress\.ps1') { Bad 'the fisheye tool reports no percentage' }

if ($bad) { "FAIL: $bad problem(s)"; exit 1 }
'the clip is vetted as numbers, reaches ffmpeg as a range, and the tool name is pinned'
exit 0
