# The helper's half of the ffmpeg offer, read out of the SHIPPED files.
#
# Nothing here can run a Windows HTTP listener, so what is checked is the
# contract the page and the installer both depend on: the route names, who is
# allowed to ask, and the two things that decide whether a restart is needed.
$Src  = if ($env:DCP_SRC) { $env:DCP_SRC } else { (Resolve-Path (Join-Path $PSScriptRoot '../src')).Path }
$Inst = if ($env:DCP_INSTALLER) { $env:DCP_INSTALLER } else { (Resolve-Path (Join-Path $PSScriptRoot '../installer')).Path }

$srv  = Get-Content "$Src/dashcam-server.ps1" -Raw
$page = Get-Content "$Src/dashcam-player.html" -Raw
$ins  = Get-Content "$Src/Install-FFmpeg.ps1" -Raw
$wxs  = Get-Content "$Inst/DashcamPlayer.wxs" -Raw

$bad = 0
function Bad([string]$m) { $script:bad++; "  $m" }

# --- the routes exist, and the page asks for those names --------------------
foreach ($r in "'/ffmpeg'", "'/install-ffmpeg'") {
  if ($srv -notmatch [regex]::Escape($r)) { Bad "the helper has no $r route" }
}
foreach ($r in '/ffmpeg', '/install-ffmpeg') {
  if ($page -notmatch [regex]::Escape("localFetch(`"$r`"")) { Bad "the page never asks for $r" }
}

# --- anything that starts a process needs the token -------------------------
# Without it, any web page you had open could install software on your PC or
# set a search running on your drives. Checked as a SET rather than against
# one fixed line: the list grows, and a check that pins its exact wording
# just gets rewritten each time instead of being thought about.
$m = [regex]::Match($srv, "\`$needsToken = @\(([^)]*)\)")
if (-not $m.Success) { Bad 'there is no list of routes that require the token' }
else {
  $guarded = @($m.Groups[1].Value -split ',' | ForEach-Object { $_.Trim().Trim("'") })
  # Every route that launches something must be in it. Found by looking for
  # the launches rather than from a list written down twice.
  $starts = @()
  foreach ($r in [regex]::Matches($srv, "(?ms)^\s*'(/[a-z-]+)'\s*\{(.*?)^\s*\}")) {
    if ($r.Groups[2].Value -match 'Start-Process') { $starts += $r.Groups[1].Value }
  }
  if (-not $starts.Count) { Bad 'no route appears to start anything, which cannot be right' }
  foreach ($r in $starts) {
    if ($guarded -notcontains $r) { Bad "$r starts a process without requiring the token" }
  }
}

# --- no restart: both the check and the install re-read the PATH ------------
# A process keeps the PATH it started with. If the helper does not read the
# registry back, ffmpeg stays invisible until the player is restarted - which
# is the whole thing this feature is meant to avoid.
foreach ($f in @{n='the helper';t=$srv}, @{n='the installer';t=$ins}) {
  if ($f.t -notmatch "GetEnvironmentVariable\('Path', 'Machine'\)" -or
      $f.t -notmatch "GetEnvironmentVariable\('Path', 'User'\)") {
    Bad "$($f.n) does not read the PATH back out of the registry"
  }
  # Get-Command caches its first answer, so it cannot see a PATH that has
  # just changed. This was the whole reason for Find-OnPath.
  if ($f.t -match 'Get-Command\s+\$exe') { Bad "$($f.n) looks for ffmpeg with Get-Command, which caches" }
}
if ($srv -notmatch '(?s)/ffmpeg.{0,400}Sync-EnvPath') { Bad 'the helper reports on ffmpeg without refreshing the PATH first' }

# --- checked at every start, not only at install time ----------------------
# The install-time fetch runs once. ffmpeg can be removed afterwards, and an
# upgrade installed while it was still present has nothing to notice - which
# is exactly how a machine ends up with the player and no ffmpeg.
if ($srv -notmatch 'function Start-FfmpegInstall') { Bad 'the helper has no way to fetch ffmpeg itself' }
if ($srv -notmatch '(?m)^\$null = Start-FfmpegInstall') {
  Bad 'the helper never checks for ffmpeg when it starts'
}
# The button and the startup check must be the same code, or one of them
# will quietly grow a condition the other does not have.
if ($srv -notmatch "(?s)'/install-ffmpeg'\s*\{[^}]*Start-FfmpegInstall") {
  Bad 'the button does not go through Start-FfmpegInstall'
}
# Two winget runs over one package would fight, and the page would read one
# run's result while the other wrote it.
if ($srv -notmatch '\$j\.state -eq ''running''') {
  Bad 'nothing stops a second install starting while one is already running'
}
# ... but a "running" left behind by a run that died with its session must
# not block every future attempt for ever.
if ($srv -notmatch 'TotalMinutes -lt 15') { Bad 'a stale "running" status would block all later attempts' }

# --- what winget is asked for ----------------------------------------------
# "FFmpeg (Essentials Build)" is Gyan.FFmpeg.Essentials; the plain id is the
# fallback, because the manifest has been published under both.
if ($ins -notmatch "@\('Gyan\.FFmpeg\.Essentials', 'Gyan\.FFmpeg'\)") {
  Bad 'the installer does not ask for the Essentials build first'
}
foreach ($flag in '--exact', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity') {
  if ($ins -notmatch [regex]::Escape($flag)) { Bad "winget is run without $flag" }
}
# It must never ask for elevation: the package is a zip into the user's own
# AppData, and a prompt nobody is watching would hang the install.
if ($ins -match 'RunAs' -or $ins -match '--scope\s+machine') { Bad 'the installer asks for administrator rights' }

# --- the status file both sides read ---------------------------------------
if ($ins -notmatch 'ffmpeg-install\.json' -or $srv -notmatch 'ffmpeg-install\.json') {
  Bad 'the helper and the installer do not agree on the status file'
}
# Written without a byte order mark, or ConvertFrom-Json in the helper and
# JSON.parse in the page both refuse it.
if ($ins -notmatch 'UTF8Encoding\(\$false\)') { Bad 'the status file may be written with a byte order mark' }

# --- it ships, and it is cleaned up ----------------------------------------
if ($wxs -notmatch 'Install-FFmpeg\.ps1') { Bad 'Install-FFmpeg.ps1 is not in the installer' }
if ($wxs -notmatch 'ComponentRef Id="C_InstallFfmpeg"') { Bad 'the component is defined but never referenced, so nothing installs' }
foreach ($f in 'ffmpeg-install.json', 'ffmpeg-install.log') {
  if ($wxs -notmatch [regex]::Escape("Name=`"$f`"")) { Bad "$f is left behind on uninstall" }
}

if ($bad) { "FAIL: $bad problem(s)"; exit 1 }
'the ffmpeg offer is token-gated, asks winget for the right package, and needs no restart'
exit 0
