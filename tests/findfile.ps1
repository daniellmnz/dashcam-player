# Finding the recording the page asked for.
#
# The page can never send a path - the File System Access API does not expose
# one - so it sends a file name, the folder within whatever was opened, and
# the opened folder's name. Everything else is a search, and when the search
# comes up empty the tool has to stop and ask, which is the one moment this
# feature feels broken.
#
# The walk skips "Users" on purpose: a profile holds tens of thousands of
# folders. That also meant recordings copied off a card into Videos or
# OneDrive - which is where they are on a laptop - could never be found, and
# the first export always had to ask. The named profile folders are the fix,
# and this runs the real functions over a real tree to check it.
$Src = if ($env:DCP_SRC) { $env:DCP_SRC } else { (Resolve-Path (Join-Path $PSScriptRoot '../src')).Path }
$text = Get-Content "$Src/Run-Tool.ps1" -Raw

# The real code, lifted out of the script: it has a param block and runs top
# to bottom, so it cannot simply be dot-sourced.
foreach ($fn in 'Get-DriveRoots','Get-SearchRoots','Find-DirNamed','Select-UniquePaths','Find-MarkedFolder','Resolve-Recording') {
  $m = [regex]::Match($text, "(?ms)^function $fn.*?^\}")
  if (-not $m.Success) { "  could not find $fn in Run-Tool.ps1"; exit 1 }
  Invoke-Expression $m.Value
}
$script:SkipDirs = @('Windows','Program Files','Program Files (x86)','ProgramData',
                     '$Recycle.Bin','System Volume Information','Users','AppData',
                     'Recovery','PerfLogs','node_modules')
$script:MaxDirsScanned = 20000
$lastDir = $null

$bad = 0
function Bad([string]$m) { $script:bad++; "  FAIL $m" }

# A card, and a laptop profile with a copy of the same recordings in it.
$root = Join-Path ([IO.Path]::GetTempPath()) ("dcp_find_" + [guid]::NewGuid().ToString('N').Substring(0,8))
$card    = Join-Path $root 'card'
$lap = Join-Path $root 'profile'
$sep = [IO.Path]::DirectorySeparatorChar
New-Item -ItemType Directory -Force -Path (Join-Path $card 'Movies') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $lap ('Videos' + $sep + 'Dashcam' + $sep + 'Movies')) | Out-Null
$onCard = Join-Path (Join-Path $card 'Movies') 'a_surround.mp4'
$onDisk = Join-Path (Join-Path $lap ('Videos' + $sep + 'Dashcam' + $sep + 'Movies')) 'b_surround.mp4'
Set-Content -LiteralPath $onCard -Value 'x'
Set-Content -LiteralPath $onDisk -Value 'x'

# --- the card, which always worked -----------------------------------------
$got = Resolve-Recording 'a_surround.mp4' 'Movies' 'card' @($card)
if ($got -ne $onCard) { Bad "a recording on the card was not found: got '$got'" }

# --- the laptop copy, which did not ----------------------------------------
# The page opened the Dashcam folder, so it can say the file sits in Movies
# inside a folder called Dashcam - and nothing else.
$got = Resolve-Recording 'b_surround.mp4' 'Movies' 'Dashcam' @((Join-Path $lap 'Videos'))
if ($got -ne $onDisk) { Bad "a recording copied into the profile was not found: got '$got'" }

# --- the same folder reached twice is still one answer ---------------------
# OneDrive arrives both by its own variable and from the profile. Counting
# that as two made the search call it ambiguous and give up - the worst
# outcome, because the file was right there both times.
$twice = @((Join-Path $lap 'Videos'), (Join-Path $lap ('Videos' + $sep + '.')))
$got = Resolve-Recording 'b_surround.mp4' 'Movies' 'Dashcam' $twice
if (-not $got) { Bad 'one folder listed twice was read as two different answers' }

# --- two genuinely different copies stay ambiguous -------------------------
# Guessing here would export from the wrong card.
$other = Join-Path $root 'card2'
New-Item -ItemType Directory -Force -Path (Join-Path $other 'Movies') | Out-Null
Set-Content -LiteralPath (Join-Path (Join-Path $other 'Movies') 'a_surround.mp4') -Value 'x'
$got = Resolve-Recording 'a_surround.mp4' 'Movies' 'card' @($card, $other)
if ($got) { Bad "two different copies should be ambiguous, but it chose '$got'" }

# --- the profile folders are actually in the list --------------------------
# Named one by one, because the walk skips Users outright. If that list ever
# loses them, the laptop case silently goes back to asking every time.
$env:USERPROFILE = $lap
$roots = @(Get-SearchRoots)
foreach ($n in 'Videos','Documents','Downloads','Desktop','Pictures') {
  New-Item -ItemType Directory -Force -Path (Join-Path $lap $n) | Out-Null
}
$roots = @(Get-SearchRoots)
foreach ($n in 'Videos','Documents','Downloads') {
  $want = Join-Path $lap $n
  if (-not ($roots | Where-Object { $_.TrimEnd('\','/') -ieq $want.TrimEnd('\','/') })) {
    Bad "$n is not among the places searched, so a laptop copy there is never found"
  }
}
# And the profile itself. A folder sitting straight in the home directory was
# reachable from nowhere at all: the walk of the system drive skips Users, and
# naming the folders below the profile does not cover their parent. That is
# exactly where one real install kept its recordings.
if (-not ($roots | Where-Object { $_.TrimEnd('\','/') -ieq $lap.TrimEnd('\','/') })) {
  Bad 'the home directory itself is not searched, so a folder sitting in it is never found'
}
# And no duplicates, for the reason above.
$dupes = @($roots | Group-Object { $_.ToLowerInvariant().TrimEnd('\','/') } | Where-Object Count -gt 1)
if ($dupes.Count) { Bad "the same place is searched more than once: $($dupes[0].Name)" }

# --- the mark the page leaves when a folder is chosen ----------------------
# The surest thing available: a name can be shared by two folders, a number
# written into one of them cannot. This is what stops the first export
# having to ask.
$script:MarkerDir  = 'Dashcam and Sentry exports'
$script:MarkerFile = '.dcp-folder'
$mk = {
  param($where, $tok)
  $d = Join-Path $where $script:MarkerDir
  New-Item -ItemType Directory -Force -Path $d | Out-Null
  Set-Content -LiteralPath (Join-Path $d $script:MarkerFile) -Value $tok
}
& $mk $card 'abc123def456'

# Found at the top of the folder that was opened, without any walking.
$got = Find-MarkedFolder 'abc123def456' @($card)
if ($got -ne $card) { Bad "the mark at the top of a card was not found: got '$got'" }

# And found from a drive root, a level or two down.
$got = Find-MarkedFolder 'abc123def456' @($root)
if ($got -ne $card) { Bad "the mark was not found from above: got '$got'" }

# A different number is a different folder. This is the whole point: two
# cards with the same folder name no longer make the search give up, and
# more importantly the wrong one is never chosen.
& $mk $other 'ffff0000ffff'
$got = Find-MarkedFolder 'ffff0000ffff' @($root)
if ($got -ne $other) { Bad "the second card's mark led to '$got'" }
$got = Find-MarkedFolder 'abc123def456' @($root)
if ($got -ne $card) { Bad "two marked cards confused the search: got '$got'" }

# The name of the folder that was opened makes the hunt far smaller: one
# named folder rather than every exports folder on a disk. The mark still
# decides, so a folder of the right name without the right number is passed
# over rather than seized on.
New-Item -ItemType Directory -Force -Path (Join-Path $root 'decoy\Dashcam') | Out-Null
& $mk (Join-Path $root 'decoy\Dashcam') 'aaaabbbbcccc'
$here = Join-Path $root 'Dashcam'
New-Item -ItemType Directory -Force -Path $here | Out-Null
& $mk $here 'abc123def456'
$got = Find-MarkedFolder 'abc123def456' @($root) 'Dashcam'
if ($got -ne $here) { Bad "the named folder was not preferred: got '$got'" }
$got = Find-MarkedFolder 'aaaabbbbcccc' @($root) 'Dashcam'
if ($got -ne (Join-Path $root 'decoy\Dashcam')) {
  Bad "a folder of the right name with the wrong number was taken: got '$got'"
}
# A name that is not there must not stop the search finding it another way.
$got = Find-MarkedFolder 'abc123def456' @($root) 'NoSuchFolder'
if ($got -ne $here -and $got -ne $card) { Bad "a wrong name broke the search: got '$got'" }

# A number nobody wrote finds nothing, rather than the nearest folder.
$got = Find-MarkedFolder '0123456789ab' @($root)
if ($got) { Bad "an unknown number matched '$got'" }
$got = Find-MarkedFolder '' @($root)
if ($got) { Bad "an empty number matched '$got'" }

# --- and the whole locate pass, run for real -------------------------------
# The search runs hidden with nobody watching, so when it fails it fails
# silently and the first export stops to ask with nothing to go on. It writes
# down what it found and where it looked; the page reads that back.
$exe = (Get-Process -Id $PID).Path
if ($exe) {
  $app = Join-Path $root 'appdata'
  $lj  = Join-Path $app 'DashcamPlayer\locate.json'
  $old = @{ LOCALAPPDATA = $env:LOCALAPPDATA; USERPROFILE = $env:USERPROFILE }
  $env:LOCALAPPDATA = $app
  $env:USERPROFILE  = $lap
  foreach ($case in @(@{ tok = 'abc123def456'; want = 'found' },
                      @{ tok = 'ffffffffffff'; want = 'missing' })) {
    Remove-Item -LiteralPath $lj -ErrorAction SilentlyContinue
    & $exe -NoProfile -File (Join-Path $Src 'Run-Tool.ps1') -Tool locate -Token $case.tok -Quiet *> $null
    if (-not (Test-Path -LiteralPath $lj)) {
      Bad "the locate pass wrote nothing down for the '$($case.want)' case"
      continue
    }
    $j = Get-Content $lj -Raw | ConvertFrom-Json
    if ($j.state -ne $case.want) { Bad "locate reported '$($j.state)', wanted '$($case.want)'" }
    if (-not $j.lookedIn -or $j.lookedIn.Count -eq 0) {
      Bad 'locate does not record where it looked, which is the one thing needed when it fails'
    }
    if ($case.want -eq 'found' -and -not $j.dir) { Bad 'locate found the folder but did not say which' }
  }
  foreach ($k in $old.Keys) { Set-Item "env:$k" $old[$k] -ErrorAction SilentlyContinue }
}

Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
if ($bad) { "FAIL: $bad problem(s)"; exit 1 }
'a recording is found on a card or in the profile, and the marked folder is found by its mark'
exit 0
