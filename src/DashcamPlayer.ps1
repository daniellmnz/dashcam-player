param([int]$Port = 8777)

# ---------------------------------------------------------------
#  Dashcam Player launcher.
#  Starts the local server if nothing is already answering, then
#  opens the player in its own window. Runs hidden, so there is no
#  console flash.
# ---------------------------------------------------------------

$here = Split-Path -Parent $MyInvocation.MyCommand.Definition

function Test-Port([int]$p) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', $p, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(300, $false)
    if ($ok) { $c.EndConnect($iar) }
    $c.Close()
    return $ok
  } catch { return $false }
}

$server = Join-Path $here 'dashcam-server.ps1'

# The version the helper WOULD be if started now. Read from the script itself,
# so there is no third place to keep in step.
function Get-ExpectedVersion {
  try {
    $m = [regex]::Match((Get-Content $server -Raw), "ServerVersion\s*=\s*'([0-9.]+)'")
    if ($m.Success) { return $m.Groups[1].Value }
  } catch { }
  return ''
}

# What the helper currently holding the port says it is. Anything that is not
# a bare version number means it predates /version - so it is old.
function Get-RunningVersion([int]$p) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:$p/version"
    $v = ($r.Content | Out-String).Trim()
    if ($v -match '\A[0-9]+(\.[0-9]+){1,3}\z') { return $v }
  } catch { }
  return ''
}

# By pid file first, then by whoever actually holds the port - the pid file
# can be stale, and the port is the thing that matters.
function Stop-Helper([int]$p) {
  $pidFile = Join-Path $env:LOCALAPPDATA 'DashcamPlayer\server.pid'
  try {
    if (Test-Path $pidFile) {
      $old = (Get-Content $pidFile -First 1).Trim()
      if ($old -match '\A[0-9]+\z') {
        $proc = Get-Process -Id ([int]$old) -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -match 'powershell|pwsh') {
          Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
      }
    }
  } catch { }
  try {
    foreach ($c in (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop)) {
      $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
      if ($proc -and $proc.ProcessName -match 'powershell|pwsh') {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      }
    }
  } catch { }
  for ($i = 0; $i -lt 30 -and (Test-Port $p); $i++) { Start-Sleep -Milliseconds 100 }
}

# A helper is a long-running process: it keeps the code it started with, while
# the page and the tools are read from disk every time. Reusing whatever
# happens to answer on the port meant that once an old helper survived an
# upgrade it was reused for ever, serving a new page with old logic - which
# failed in ways that looked nothing like a version mismatch. So: check first.
if (Test-Port $Port) {
  $expected = Get-ExpectedVersion
  $running  = Get-RunningVersion $Port
  if ($expected -and $running -ne $expected) { Stop-Helper $Port }
}

if (-not (Test-Port $Port)) {
  Start-Process -WindowStyle Hidden -FilePath 'powershell' -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$server`"",'-Port',"$Port")
  for ($i = 0; $i -lt 50 -and -not (Test-Port $Port); $i++) { Start-Sleep -Milliseconds 100 }
}

$candidates = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles          'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles          'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)}   'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LocalAppData          'Google\Chrome\Application\chrome.exe')
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if ($browser) {
  Start-Process -FilePath $browser -ArgumentList @("--app=http://localhost:$Port/", '--window-size=1700,1050')
} else {
  Start-Process "http://localhost:$Port/"
}
