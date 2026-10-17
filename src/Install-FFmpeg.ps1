<#
  Installs ffmpeg with winget, on behalf of the player.

  The export tools are the only part of Dashcam Player that needs ffmpeg, and
  the only thing most people have to install by hand. Started by the local
  helper when you accept the offer; it reports through a status file in the
  same way the split tool does, so the page can follow along and the helper
  stays free to answer requests while this runs.

  Nothing here needs administrator rights: the package is a zip, and winget
  unpacks it under the user's own AppData and puts its link folder on the
  user's PATH.
#>
[CmdletBinding()]
param()

$dataDir = Join-Path $env:LOCALAPPDATA 'DashcamPlayer'
$stat    = Join-Path $dataDir 'ffmpeg-install.json'
$log     = Join-Path $dataDir 'ffmpeg-install.log'

function Write-State([string]$State, [string]$Detail) {
  try {
    if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
    $o = [ordered]@{ state = $State; detail = $Detail; at = (Get-Date).ToString('o') }
    # Written without a byte order mark. Set-Content -Encoding UTF8 adds one
    # on PowerShell 5.1 - which is what every user has - and the page's
    # JSON.parse refuses the file outright when it is there.
    [IO.File]::WriteAllText($stat, ($o | ConvertTo-Json -Compress),
                            (New-Object Text.UTF8Encoding($false)))
  } catch { }
}

function Add-Log([string]$Text) {
  # The folder may not exist yet: nothing else has had to write here if the
  # export tools have never been run on this machine.
  try {
    if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
    Add-Content -LiteralPath $log -Value $Text -Encoding Unicode
  } catch { }
}

# The PATH this process started with is a snapshot. winget changes the one in
# the registry, so that is where to look afterwards.
function Sync-EnvPath {
  try {
    $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $u = [Environment]::GetEnvironmentVariable('Path', 'User')
    $joined = (@($m, $u) | Where-Object { $_ }) -join ';'
    if ($joined) { $env:Path = $joined }
  } catch { }
}

# Looked up by hand rather than with Get-Command, which caches what it found
# the first time: this process asks before and after the PATH changes, and
# the second answer must not be the first one repeated.
function Find-OnPath([string]$exe) {
  foreach ($d in ($env:Path -split ';')) {
    if (-not $d) { continue }
    try {
      $p = Join-Path $d ($exe + '.exe')
      if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
    } catch { }
  }
  return $null
}

try { Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue } catch { }
Add-Log ("Dashcam Player - installing ffmpeg - " + (Get-Date).ToString('o'))

Write-State 'running' 'Starting'
Sync-EnvPath

if ((Find-OnPath 'ffmpeg') -and (Find-OnPath 'ffprobe')) {
  Write-State 'done' 'ffmpeg was already installed.'
  exit 0
}

$wg = Find-OnPath 'winget'
if (-not $wg) {
  Add-Log 'winget was not found on the PATH.'
  Write-State 'failed' 'winget is not available on this PC. Install "App Installer" from the Microsoft Store, or download ffmpeg from ffmpeg.org and put it on your PATH.'
  exit 1
}

# "FFmpeg (Essentials Build)" - the small build that carries everything these
# tools use. Two identifiers because the manifest has been published under
# both; the second is only reached if the first is not in the catalogue.
$ids = @('Gyan.FFmpeg.Essentials', 'Gyan.FFmpeg')
$installed = $false
$lastDetail = ''

foreach ($id in $ids) {
  Write-State 'running' "Installing $id with winget. This takes a minute or two."
  Add-Log "> winget install --id $id --exact"
  $out = ''
  $code = 1
  try {
    # --disable-interactivity so it can never sit waiting for an answer
    # nobody is there to give: this runs with no window.
    $out = (& $wg install --id $id --exact --source winget `
                 --accept-package-agreements --accept-source-agreements `
                 --disable-interactivity 2>&1 | Out-String)
    $code = $LASTEXITCODE
  } catch {
    $out = $_.Exception.Message
    $code = 1
  }
  Add-Log $out
  Add-Log "exit code: $code"

  # 0x8A15002B is winget's "already installed", which is the outcome we want.
  if ($code -eq 0 -or $code -eq -1978335189) { $installed = $true; break }

  if ($out -match 'No package found') { $lastDetail = "winget has no package called $id."; continue }
  $lastDetail = (($out -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 1) -join '').Trim()
  if (-not $lastDetail) { $lastDetail = "winget stopped with code $code." }
  break
}

if (-not $installed) {
  Write-State 'failed' ("ffmpeg could not be installed. " + $lastDetail)
  exit 1
}

# winget has put its link folder on the PATH in the registry. Read it back,
# so this process can confirm what the helper is about to inherit.
Sync-EnvPath
if ((Find-OnPath 'ffmpeg') -and (Find-OnPath 'ffprobe')) {
  Write-State 'done' 'ffmpeg is installed and ready.'
  exit 0
}

Add-Log 'Installed, but ffmpeg is still not on the PATH.'
Write-State 'failed' 'ffmpeg installed, but it has not appeared on your PATH. Close the player and start it again.'
exit 1
