# The whole chain, actually run.
#
# Starts the REAL helper with a sandboxed PATH holding a fake winget, and
# watches what it does about a missing ffmpeg. Nothing here is a pattern
# match: the helper runs, it decides for itself that ffmpeg is absent, the
# script it launches runs, and the endpoint the page reads is asked what
# happened.
#
# This caught the helper launching nothing at all, twice: once because it
# named powershell.exe rather than the PowerShell it was already running
# under, and once because Start-Process refused an option and the failure
# went nowhere. Both looked perfectly correct in the source.
#
# Found from this script's own location, so the suite travels with the
# repository rather than pointing at one machine's folders.
$Src = if ($env:DCP_SRC) { $env:DCP_SRC } else { (Resolve-Path (Join-Path $PSScriptRoot '../src')).Path }
$work = Join-Path ([IO.Path]::GetTempPath()) ("dcp-live-" + [guid]::NewGuid().ToString('N').Substring(0,8))
$bin  = Join-Path $work 'bin'; $data = Join-Path $work 'data'
New-Item -ItemType Directory -Path $bin, $data -Force | Out-Null
$fake = @"
#!/usr/bin/env bash
echo installed >> "$bin/called.txt"
: > "$bin/ffmpeg.exe"; : > "$bin/ffprobe.exe"
echo "Successfully installed"
exit 0
"@
[IO.File]::WriteAllText((Join-Path $bin 'winget.exe'), ($fake -replace "`r`n","`n"))
& chmod +x (Join-Path $bin 'winget.exe')

$port = 8805
$env:LOCALAPPDATA = $data
$env:Path = $bin
$proc = Start-Process -FilePath (Get-Process -Id $PID).Path `
          -ArgumentList @('-NoProfile','-File', (Join-Path $Src 'dashcam-server.ps1'), '-Port', $port) `
          -PassThru -RedirectStandardOutput (Join-Path $work 'out.txt') -RedirectStandardError (Join-Path $work 'err.txt')
$bad = 0
try {
  # Generous, and deliberately so. The install here is a fake winget that
  # returns at once, so a passing run takes a second or two and never feels
  # this ceiling. It exists for the loaded machine, where the helper's own
  # startup can take longer than the whole budget used to be - which is how
  # this test failed once in a suite run and then passed four times alone.
  # A timeout that only trips under load is a worse test than a slow one.
  $state = $null
  foreach ($i in 1..120) {
    Start-Sleep -Milliseconds 500
    $f = Join-Path $data 'DashcamPlayer\ffmpeg-install.json'
    if (Test-Path $f) {
      $state = [IO.File]::ReadAllText($f) | ConvertFrom-Json
      if ($state.state -ne 'running') { break }
    }
  }
  if (-not $state) { "  the helper never started an install within 60s"; $bad++ }
  elseif ($state.state -ne 'done') { "  install finished as '$($state.state)': $($state.detail)"; $bad++ }
  if (-not (Test-Path (Join-Path $bin 'called.txt'))) { "  winget was never run"; $bad++ }
  # And the endpoint the page reads must now say it is there.
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/ffmpeg" -UseBasicParsing -TimeoutSec 5
    $j = $r.Content | ConvertFrom-Json
    if (-not $j.ffmpeg) { "  /ffmpeg still says it is missing: $($r.Content)"; $bad++ }
  } catch { "  /ffmpeg could not be reached: $_"; $bad++ }
} finally {
  try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
if ($bad) { "FAIL: $bad problem(s)"; exit 1 }
'the helper fetches ffmpeg when it starts without it, and then reports it present'
exit 0
