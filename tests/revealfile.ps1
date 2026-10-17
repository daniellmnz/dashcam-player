# Showing one recording in Explorer, from the path under the picture.
#
# /reveal, next door, takes NOTHING from the page: a page that can name a
# folder to open can name any folder. This one has to be told which file, so
# it keeps to the same principle a different way - the page sends a name and a
# folder RELATIVE to the one the helper located for itself, and the base comes
# from the helper's own memo. The page has no path to send and this must not
# accept one.
#
# Run against the SHIPPED handler, with explorer.exe stood in for so the call
# can be watched rather than assumed, the way tests/reveal.ps1 does it.
$Src = if ($env:DCP_SRC) { $env:DCP_SRC } else { (Resolve-Path (Join-Path $PSScriptRoot '../src')).Path }

$src = Get-Content "$Src/dashcam-server.ps1" -Raw
$m = [regex]::Match($src, "(?ms)'/reveal-file'\s*\{(.*?)\n        \}")
if (-not $m.Success) { 'FAIL: the /reveal-file handler is not in the shipped file'; exit 1 }
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

$bad = 0
function Bad([string]$msg) { $script:bad++; "  $msg" }

# --- guarded like the rest ---------------------------------------------------
$tk = [regex]::Match($src, "\`$needsToken = @\(([^)]*)\)")
if (-not $tk.Success) { Bad 'there is no list of routes that require the token' }
elseif ($tk.Groups[1].Value -notmatch "'/reveal-file'") {
  Bad 'revealing a file does not require the token, so any page could ask for it'
}

# --- a tree to work in -------------------------------------------------------
$root = Join-Path ([IO.Path]::GetTempPath()) ("rf_" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path (Join-Path $root 'DashcamPlayer') -Force | Out-Null
$env:LOCALAPPDATA = $root
# Written at the path the handler reads, backslash and all: on Windows that
# is the ordinary one, and here it is simply a file with an odd name, which
# is what makes the handler's own path expression the thing under test rather
# than a tidied-up copy of it.
$memo = Join-Path $root 'DashcamPlayer\lastfolder.txt'
$opened = Join-Path $root 'opened.txt'

# The folder the helper located, with a recording in it and one a level down.
$card = Join-Path $root 'card'
New-Item -ItemType Directory -Path $card -Force | Out-Null
'v' | Set-Content -LiteralPath (Join-Path $card 'a_surround.mp4')
New-Item -ItemType Directory -Path (Join-Path $card 'Movies') -Force | Out-Null
'v' | Set-Content -LiteralPath (Join-Path $card 'Movies/b_surround.mp4')
New-Item -ItemType Directory -Path (Join-Path $card 'folder.mp4') -Force | Out-Null
# Two levels down, so the handler's turning of the page's forward slashes
# into this platform's separator is watched rather than read.
New-Item -ItemType Directory -Path (Join-Path $card 'A/B') -Force | Out-Null
'v' | Set-Content -LiteralPath (Join-Path $card 'A/B/c_surround.mp4')

# And something OUTSIDE it that must stay out of reach, in a folder of its
# own as well as beside the memo: a climb out of the located folder has to
# fail because it is refused, not because there happened to be nothing there.
'secret' | Set-Content -LiteralPath (Join-Path $root 'secret.mp4')
New-Item -ItemType Directory -Path (Join-Path $root 'other') -Force | Out-Null
'secret' | Set-Content -LiteralPath (Join-Path $root 'other/x_surround.mp4')

# Files whose names the allowlist exists to refuse - CREATED, so that what
# refuses them is the allowlist and not the disk. Without them every one of
# these requests would be turned away for the uninteresting reason that no
# such file is there, and taking the allowlist out would change nothing that
# this test could see.
foreach ($n in 'a&calc.mp4', 'a"b.mp4', 'a%TEMP%.mp4', '-rf.mp4', 'a;b.mp4', 'a$x.mp4') {
  'v' | Set-Content -LiteralPath (Join-Path $card $n)
}
$long = ('n' * 200) + '.mp4'
'v' | Set-Content -LiteralPath (Join-Path $card $long)

function Start-Process { param($FilePath,$ArgumentList)
  Add-Content -LiteralPath $script:opened -Value "$FilePath $ArgumentList" }

function Try-Reveal([string]$q) {
  $script:query = $q
  $query = $q
  $type = ''; $body = ''
  Invoke-Expression $handler
  return $body
}
function Want([string]$what,[string]$got,[string]$expect) {
  if ($got -ne $expect) { Bad "$what -> '$got', wanted '$expect'" }
}
function LastOpened() {
  if (-not (Test-Path -LiteralPath $opened)) { return '' }
  return (@(Get-Content -LiteralPath $opened))[-1]
}
function OpenCount() {
  if (-not (Test-Path -LiteralPath $opened)) { return 0 }
  return @(Get-Content -LiteralPath $opened).Count
}

# --- with nothing located, nothing can be shown ------------------------------
Want 'no memo at all' (Try-Reveal 'name=a_surround.mp4') 'not found'

Set-Content -LiteralPath $memo -Value $card

# --- the ordinary case -------------------------------------------------------
Want 'a recording in the opened folder' (Try-Reveal 'name=a_surround.mp4') 'ok'
$log = LastOpened
if ($log -notlike '*explorer.exe*') { Bad "explorer was not what was called: $log" }
if ($log -notlike '*/select,*')     { Bad "the file is not selected, only its folder opened: $log" }
if ($log -notlike "*$card*a_surround.mp4*") { Bad "the wrong file was shown: $log" }

Want 'a recording a folder down' (Try-Reveal 'name=b_surround.mp4&dir=Movies') 'ok'
if ((LastOpened) -notlike '*Movies*b_surround.mp4*') { Bad "the subfolder was dropped: $(LastOpened)" }

# The forward slashes the page sends become the separators the platform wants.
Want 'a recording two folders down' (Try-Reveal 'name=c_surround.mp4&dir=A/B') 'ok'
$want = 'A' + [IO.Path]::DirectorySeparatorChar + 'B'
if ((LastOpened) -notlike "*$want*c_surround.mp4*") { Bad "the separators were not converted: $(LastOpened)" }

$sofar = OpenCount

# --- everything that must NOT open -------------------------------------------
# Each of these must come back 'not found' AND must not have called explorer.
$refuse = @(
  @{ what = 'a name that climbs out';        q = 'name=../secret.mp4' },
  @{ what = 'a name that climbs out twice';  q = 'name=../../etc/passwd' },
  @{ what = 'a folder that climbs out';      q = 'name=secret.mp4&dir=..' },
  @{ what = 'a folder that climbs out deep'; q = 'name=secret.mp4&dir=Movies/../..' },
  @{ what = 'a climb into a real folder';    q = 'name=x_surround.mp4&dir=../other' },
  @{ what = 'a drive of its own';            q = 'name=a_surround.mp4&dir=C:/Windows' },
  @{ what = 'a UNC path';                    q = 'name=a_surround.mp4&dir=//server/share' },
  @{ what = 'a backslash in the folder';     q = 'name=a_surround.mp4&dir=..\..' },
  @{ what = 'a wildcard';                    q = 'name=*.mp4' },
  @{ what = 'a command in the name';         q = 'name=a%26calc.mp4' },
  @{ what = 'a quote in the name';           q = 'name=a%22b.mp4' },
  @{ what = 'a per cent in the name';        q = 'name=a%25TEMP%25.mp4' },
  @{ what = 'a semicolon in the name';       q = 'name=a%3Bb.mp4' },
  @{ what = 'a variable in the name';        q = 'name=a%24x.mp4' },
  @{ what = 'a newline on the end';          q = 'name=a_surround.mp4%0A' },
  @{ what = 'a leading dash';                q = 'name=-rf.mp4' },
  @{ what = 'a name longer than the limit';  q = ('name=' + ('n' * 200) + '.mp4') },
  @{ what = 'nothing at all';                q = '' },
  @{ what = 'a file that is not there';      q = 'name=nosuch.mp4' },
  @{ what = 'a folder, not a file';          q = 'name=folder.mp4' }
)
foreach ($r in $refuse) { Want $r.what (Try-Reveal $r.q) 'not found' }
if ((OpenCount) -ne $sofar) {
  Bad "explorer was called $((OpenCount) - $sofar) time(s) by a request that should have been refused: $(LastOpened)"
}

# A memo pointing somewhere that has gone.
Set-Content -LiteralPath $memo -Value (Join-Path $root 'gone')
Want 'the located folder has gone' (Try-Reveal 'name=a_surround.mp4') 'not found'

# Nonsense in the memo must not throw out of the handler.
Set-Content -LiteralPath $memo -Value '????'
Want 'an unreadable memo' (Try-Reveal 'name=a_surround.mp4') 'not found'

# --- and the base is never the page's to choose ------------------------------
# The request supplies a name and a folder WITHIN the located one; where that
# one is comes from the memo the helper wrote. Comments stripped first: this
# block explains the rule it follows, and a check that cannot tell an
# explanation from a breach is worse than no check.
$code = ($handler -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
if ($code -notmatch 'lastfolder\.txt') {
  Bad 'the base folder does not come from the memo the helper wrote'
}
if ($code -notmatch 'GetFullPath' -or $code -notmatch 'StartsWith') {
  Bad 'nothing checks that the file resolved is still inside the located folder'
}
if ($code -notmatch 'PathType Leaf') {
  Bad 'a folder would be handed to explorer as though it were the recording'
}
# Only two things may be read out of the request, and they are the two the
# split route already takes.
$reads = [regex]::Matches($code, "\`$pair -like '(\w+)=") | ForEach-Object { $_.Groups[1].Value }
foreach ($r in $reads) {
  if ($r -notin @('name','dir')) { Bad "the handler reads '$r' from the request as well" }
}

Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
if ($bad) { "FAIL: $bad problem(s)"; exit 1 }
'one recording is shown in Explorer, inside the folder the helper located and nowhere else'
exit 0
