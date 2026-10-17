# /reveal takes nothing from the page and opens only what the tool recorded.
# Exercised against the SHIPPED handler, with explorer.exe standing in for
# the real one so the call can be observed rather than assumed.
# Found from this script's own location, so the suite travels with the
# repository instead of pointing at one machine's folders.
$Src = if ($env:DCP_SRC) { $env:DCP_SRC } else { (Resolve-Path (Join-Path $PSScriptRoot '../src')).Path }

$src = Get-Content "$Src/dashcam-server.ps1" -Raw
$m = [regex]::Match($src, "(?ms)'/reveal'\s*\{(.*?)\n        \}")
if (-not $m.Success) { 'FAIL: the /reveal handler is not in the shipped file'; exit 1 }
$handler = $m.Groups[1].Value

# Explorer is started by full path now, not by name: a PATH lookup is a lookup
# in a list the user can write to. That path is worked out at the top of the
# server, outside the handler extracted above, so it is taken from the shipped
# source as well - this must exercise the helper's own resolution, not a copy
# of it written here. Off Windows there is no SystemRoot and it falls back to
# the bare name, which is what the assertions below allow for.
# Single quotes: in a double-quoted PowerShell string a bare $sysDir would be
# read as a variable to substitute, not as the text to search for.
$pre = [regex]::Match($src, '(?ms)^\$sysDir\s*=.*?\$explorer = ''explorer\.exe'' \}')
if (-not $pre.Success) { 'FAIL: the server no longer resolves the Explorer path'; exit 1 }
Invoke-Expression $pre.Value

$root = Join-Path ([IO.Path]::GetTempPath()) ("rv_" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path (Join-Path $root 'DashcamPlayer') -Force | Out-Null
$env:LOCALAPPDATA = $root
$sf = Join-Path $root 'DashcamPlayer\split-status.json'
$opened = Join-Path $root 'opened.txt'

# Stand in for Explorer and record what it was asked to open.
function Start-Process { param($FilePath,$ArgumentList)
  Add-Content -LiteralPath $script:opened -Value "$FilePath $ArgumentList" }

$bad = 0
function Try-Reveal {
  $type = ''; $body = ''
  Invoke-Expression $handler
  return $body
}
function Want([string]$what,[string]$got,[string]$expect) {
  if ($got -ne $expect) { $script:bad++; "  $what -> '$got', wanted '$expect'" }
}

# No status file at all.
Want 'no status file' (Try-Reveal) 'no folder'

# A real folder: opened, and the path handed over is exactly that folder.
$real = Join-Path $root 'Recordings\split'
New-Item -ItemType Directory -Path $real -Force | Out-Null
[IO.File]::WriteAllText($sf, (@{ state='done'; outdir=$real } | ConvertTo-Json -Compress))
Want 'a real folder' (Try-Reveal) 'ok'
$log = (Get-Content -LiteralPath $opened -Raw).Trim()
if ($log -notlike "*explorer.exe*`"$real`"*") { $bad++; "  opened the wrong thing: $log" }

# A folder that is not there any more.
[IO.File]::WriteAllText($sf, (@{ state='done'; outdir=(Join-Path $root 'gone') } | ConvertTo-Json -Compress))
Want 'a folder that is gone' (Try-Reveal) 'no folder'

# A file rather than a folder.
$plain = Join-Path $root 'afile.txt'; 'x' | Set-Content -LiteralPath $plain
[IO.File]::WriteAllText($sf, (@{ state='done'; outdir=$plain } | ConvertTo-Json -Compress))
Want 'a file, not a folder' (Try-Reveal) 'no folder'

# No outdir recorded, as an older tool would leave it.
[IO.File]::WriteAllText($sf, '{"state":"done"}')
Want 'no outdir recorded' (Try-Reveal) 'no folder'

# Nonsense in the status file must not throw out of the handler.
[IO.File]::WriteAllText($sf, 'not json at all')
Want 'unreadable status' (Try-Reveal) 'no folder'

# Nothing was opened by any of the failing cases - only the one real folder.
$n = @(Get-Content -LiteralPath $opened).Count
if ($n -ne 1) { $bad++; "  explorer was called $n times, expected 1" }

# And the handler must not read anything from the request.
foreach ($t in '$query','$pair','$name','Substring') {
  if ($handler -like "*$t*") { $bad++; "  the handler reads $t from the request" }
}

Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
if ($bad) { "FAIL: $bad problem(s)"; exit 1 }
'reveal opens only a real folder the tool recorded, and reads nothing from the page'
exit 0
