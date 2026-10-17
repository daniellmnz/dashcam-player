# Install-FFmpeg.ps1, actually run.
#
# The decisions worth testing are all ones a pattern match cannot see: does it
# try the second package identifier when the first is not in the catalogue,
# does it stop without calling winget when ffmpeg is already there, and does
# it say something useful when winget fails. So the script is executed, with a
# fake winget on a fake PATH standing in for the real one.
#
# Found from this script's own location, so the suite travels with the
# repository instead of pointing at one machine's folders.
$Src = if ($env:DCP_SRC) { $env:DCP_SRC } else { (Resolve-Path (Join-Path $PSScriptRoot '../src')).Path }
$tool = Join-Path $Src 'Install-FFmpeg.ps1'

$bad = 0
function Bad([string]$m) { $script:bad++; "  $m" }

if (-not (Test-Path $tool)) { Bad 'Install-FFmpeg.ps1 is missing'; "FAIL: $bad problem(s)"; exit 1 }

$work = Join-Path ([IO.Path]::GetTempPath()) ("dcp-ffmpeg-" + [guid]::NewGuid().ToString('N').Substring(0,8))

function New-Sandbox([string]$Mode, [switch]$NoWinget, [switch]$HaveFfmpeg) {
  $bin  = Join-Path $work 'bin'
  $data = Join-Path $work 'data'
  foreach ($d in $work, $bin, $data) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null } }
  Get-ChildItem $bin -ErrorAction SilentlyContinue | Remove-Item -Force -Recurse
  Get-ChildItem $data -ErrorAction SilentlyContinue | Remove-Item -Force -Recurse

  if (-not $NoWinget) {
    # A stand-in winget: records that it was called, and behaves as told.
    $fake = @"
#!/usr/bin/env bash
id=""
while [ `$# -gt 0 ]; do case "`$1" in --id) id="`$2"; shift;; esac; shift; done
echo "`$id" >> "$bin/called.txt"
case "$Mode" in
  ok)    echo "Successfully installed"; : > "$bin/ffmpeg.exe"; : > "$bin/ffprobe.exe"; exit 0;;
  nopkg) if [ "`$id" = "Gyan.FFmpeg.Essentials" ]; then
           echo "No package found matching input criteria."; exit 1
         fi
         echo "Successfully installed"; : > "$bin/ffmpeg.exe"; : > "$bin/ffprobe.exe"; exit 0;;
  empty) echo "Successfully installed"; exit 0;;
  *)     echo "Installer failed with exit code: 1603"; exit 1;;
esac
"@
    $p = Join-Path $bin 'winget.exe'
    [IO.File]::WriteAllText($p, ($fake -replace "`r`n", "`n"))
    if ($IsLinux -or $IsMacOS) { & chmod +x $p }
  }
  if ($HaveFfmpeg) { '' | Set-Content (Join-Path $bin 'ffmpeg.exe'); '' | Set-Content (Join-Path $bin 'ffprobe.exe') }
  return @{ bin = $bin; data = $data }
}

function Run-Tool($box) {
  # The script reads the PATH the Windows way, so the sandbox is handed to it
  # the Windows way too.
  $env:PATH_SAVE = $env:PATH
  $env:LOCALAPPDATA = $box.data
  $env:Path = $box.bin
  try { & $tool | Out-Null } catch { }
  $code = $LASTEXITCODE
  $env:Path = $env:PATH_SAVE
  $f = Join-Path (Join-Path $box.data 'DashcamPlayer') 'ffmpeg-install.json'
  $j = $null
  if (Test-Path $f) {
    $raw = [IO.File]::ReadAllText($f)
    if ($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF) { Bad 'the status file was written with a byte order mark' }
    try { $j = $raw | ConvertFrom-Json } catch { Bad "the status file is not JSON: $raw" }
  } else { Bad 'the installer wrote no status at all, so the page would wait for ever' }
  $state = ''; $detail = ''
  if ($j) { $state = [string]$j.state; $detail = [string]$j.detail }
  $called = @()
  $cf = Join-Path $box.bin 'called.txt'
  if (Test-Path $cf) { $called = @(Get-Content $cf) }
  # The log is what a person is left with when the detail is not enough.
  $logFile = Join-Path (Join-Path $box.data 'DashcamPlayer') 'ffmpeg-install.log'
  return @{ code = $code; state = $state; detail = $detail; called = $called
            log = (Test-Path $logFile) }
}

try {
  # --- already installed: say so, and do not call winget -------------------
  $r = Run-Tool (New-Sandbox -Mode ok -HaveFfmpeg)
  if ($r.state -ne 'done') { Bad "ffmpeg already present but the state was '$($r.state)'" }
  if ($r.called.Count -ne 0) { Bad 'winget was run even though ffmpeg was already installed' }

  # --- the ordinary case ---------------------------------------------------
  $r = Run-Tool (New-Sandbox -Mode ok)
  if ($r.state -ne 'done') { Bad "a successful install reported '$($r.state)': $($r.detail)" }
  if ($r.called.Count -lt 1 -or $r.called[0] -ne 'Gyan.FFmpeg.Essentials') {
    Bad "the Essentials build was not asked for first: $($r.called -join ', ')"
  }
  if ($r.detail -notmatch 'ready') { Bad "a finished install does not say it is ready: $($r.detail)" }

  # --- the first identifier is not in the catalogue ------------------------
  $r = Run-Tool (New-Sandbox -Mode nopkg)
  if ($r.state -ne 'done') { Bad "the fallback identifier was not used: '$($r.state)' $($r.detail)" }
  if ($r.called.Count -ne 2) { Bad "expected two attempts, got: $($r.called -join ', ')" }

  # --- winget fails --------------------------------------------------------
  $r = Run-Tool (New-Sandbox -Mode fail)
  if ($r.state -ne 'failed') { Bad "a failed install reported '$($r.state)'" }
  if (-not $r.detail) { Bad 'a failed install says nothing about why' }
  if (-not $r.log) { Bad 'nothing was written to the log, so there is nothing to look at' }

  # --- winget claims success but nothing appears ---------------------------
  # The one case that would otherwise look fine and leave the player telling
  # the user ffmpeg is ready when it is not.
  $r = Run-Tool (New-Sandbox -Mode empty)
  if ($r.state -ne 'failed') { Bad "ffmpeg never appeared, yet the state was '$($r.state)'" }

  # --- no winget at all ----------------------------------------------------
  $r = Run-Tool (New-Sandbox -Mode ok -NoWinget)
  if ($r.state -ne 'failed') { Bad "without winget the state was '$($r.state)'" }
  if ($r.detail -notmatch 'winget') { Bad "without winget the reason does not mention it: $($r.detail)" }
}
finally {
  if (Test-Path $work) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}

if ($bad) { "FAIL: $bad problem(s)"; exit 1 }
'the installer tries both packages, stops early when ffmpeg is there, and admits failure'
exit 0
