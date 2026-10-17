param(
  # 'locate' does no work: it finds the folder the page has marked and
  # remembers it, so that the first real export does not have to stop and ask.
  [ValidateSet('split','rectify','locate','pick')][string]$Tool = 'split',
  # Validated here as well as in the server, so the batch file is not relying
  # on whoever happened to call this. The batch expands these into a command
  # line, and cmd's metacharacters - & ^ % ! ( ) - must never reach it.
  # \A and \z rather than ^ and $: .NET lets "$" match before a trailing
  # newline, which would admit a name ending in an encoded %0A.
  [ValidatePattern('\A([A-Za-z0-9 ._-]{1,150})?\z')][string]$Name = '',
  [ValidatePattern('\A(all|[1-4](,[1-4])*)?\z')][string]$Views = '',
  [ValidatePattern('\A([A-Za-z0-9 ._/-]{1,200})?\z')][string]$Dir = '',
  # The NAME of the folder the player has open. Only ever compared against
  # directory names, never placed on a command line, so this rejects what
  # would make it a path or a wildcard rather than allowlisting letters -
  # a strict list threw away ordinary folder names like "Clips (new)".
  [ValidatePattern('\A[^\\/:*?"<>|\x00-\x1F]{0,100}\z')][string]$Root = '',
  # A clip rather than the whole recording: where to start, and how long for,
  # both in seconds. Numeric and bounded - they go on an ffmpeg command line.
  [ValidatePattern('\A(\d{1,6}(\.\d{1,3})?)?\z')][string]$Start = '',
  [ValidatePattern('\A(\d{1,6}(\.\d{1,3})?)?\z')][string]$Dur   = '',
  # How long the recording runs, as the player measured it. Only ever used to
  # work out a percentage: the tool asks ffprobe first, and some recorders
  # write files it cannot get a duration out of, which left the progress
  # reading "working" from start to finish.
  [ValidatePattern('\A(\d{1,6}(\.\d{1,3})?)?\z')][string]$Secs  = '',
  # How hard the encoder should try. A set, not a pattern: it reaches the
  # batch through the environment, and the batch turns it into ffmpeg
  # arguments, so only the three names it knows may get that far.
  [ValidateSet('','standard','high','maximum')][string]$Quality = '',
  # Whether the vehicle status strip is stacked under the exported view.
  # Empty leaves the batch's own setting alone, which is what running it by
  # hand should do.
  #
  # StatusStrip, not Strip. A -Strip existed once, as part of a feature that
  # pushed the PLAYER's trim, lens and strip settings into the export, and
  # that was removed on the principle that a way of looking at a recording
  # does not reach the file. This is a different thing - a property of the
  # file being asked for - and tests/argmatch.ps1 checks the old name has
  # stayed gone, so sharing it would be both confusing and wrong.
  [ValidateSet('','0','1')][string]$StatusStrip = '',
  # Percentages off the top and bottom of a STRAIGHTENED picture, when the
  # export question asked for them. Empty means none, which is what every
  # export did before and what running the tool by hand still does.
  [ValidatePattern('\A([0-9]|[1-3][0-9]|4[0-5])?\z')][string]$TrimTop = '',
  [ValidatePattern('\A([0-9]|[1-3][0-9]|4[0-5])?\z')][string]$TrimBottom = '',
  # The wall-clock instant of the first exported frame, as a plain epoch
  # second, so the tool can draw the real time of day onto the picture rather
  # than a stopwatch. Only the player can know it - it reads the recording's
  # start from the name or the sidecar - so empty means no clock, which is
  # what running the tool by hand does.
  #
  # ClockAt, not Clock, for the reason -StatusStrip is not -Strip: a -Clock
  # existed once, as part of the feature that pushed the PLAYER's settings
  # into the export, and it meant "burn the clock as it is drawn on screen".
  # This is a different thing - an instant, not a yes or no - and
  # tests/argmatch.ps1 checks the old name has stayed gone.
  #
  # Nine digits at least, so this cannot be a short number that happens to
  # parse; eleven at most. It reaches a batch file and ends up inside an
  # ffmpeg filter expression, so it is digits and nothing else.
  [ValidatePattern('\A(\d{9,11})?\z')][string]$ClockAt = '',
  # Where each camera sits in a frame that is not a grid.
  #
  # One recorder folds its four cameras into columns, so a camera is not a
  # rectangle in the file and the tools cannot work one out from the frame's
  # shape the way they do for every other recording. The player reads the
  # sidecar and sends the rectangles: x:y:w:h, the pieces of one camera joined
  # by commas, cameras by semicolons.
  #
  # Checked here as well as in the server, because these are spliced into an
  # ffmpeg filter graph and the batch does no arithmetic on them at all - what
  # arrives is what runs.
  [ValidatePattern('\A(\d{1,5}:\d{1,5}:\d{1,5}:\d{1,5}(,\d{1,5}:\d{1,5}:\d{1,5}:\d{1,5}){0,7}(;\d{1,5}:\d{1,5}:\d{1,5}:\d{1,5}(,\d{1,5}:\d{1,5}:\d{1,5}:\d{1,5}){0,7}){0,7})?\z')][string]$Lanes = '',
  # The vehicle status strip in the same terms, when the recording has one.
  [ValidatePattern('\A(\d{1,5}:\d{1,5}:\d{1,5}:\d{1,5}(,\d{1,5}:\d{1,5}:\d{1,5}:\d{1,5}){0,7})?\z')][string]$StripAt = '',
  # The number the page wrote into the folder it has open. Hex, short, and
  # never placed on a command line - it is only ever compared against the
  # contents of a file.
  [ValidatePattern('\A[0-9a-f]{0,32}\z')][string]$Token = '',
  [switch]$Quiet            # launched hidden: nothing may wait for a keypress
)
# ValidatePattern cannot express "must not start with a dash", which the
# launcher would read as a parameter name.
if ($Name -match '^-' -or $Dir -match '^-' -or $Root -match '^-') {
  throw 'Name, Dir and Root may not start with a dash.'
}
# Nothing below assigns to a parameter. A local that merely shares a name with
# one IS that parameter - see the note at $workDir - so sanitising goes into a
# variable of its own.
$rootHint = $Root
if ($rootHint -eq '.' -or $rootHint -eq '..') { $rootHint = '' }


# Which of ffmpeg's lines is the one worth repeating.
#
# Two kinds of line are not: the hardware probes that -hwaccel auto always
# leaves behind whether or not anything went wrong, and the summary ffmpeg
# signs off with, which restates the error without the part that identifies
# it - "Error parsing global options: Option not found" where the line above
# said which option, and in which filter. ffmpeg states the cause first and
# the conclusion last, so the first line that is neither noise nor a summary
# is the useful one.
function Select-ErrorLine {
  param([string[]]$Lines)
  $noise   = 'AVHWDeviceContext|Device creation failed|Cannot load lib|' +
             'Could not dynamically load|Instance creation failure|deprecated'
  $summary = '^Error (opening output file|parsing global options|while filtering|' +
             'opening output files)|^Conversion failed|Error initializing a simple filtergraph'
  $all  = @($Lines | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
  $real = @($all | Where-Object { $_ -notmatch $noise })
  $best = @($real | Where-Object { $_ -notmatch $summary })
  if ($best.Count) { return $best[0] }
  if ($real.Count) { return $real[-1] }
  # Nothing survived the filters - and that is NOT a reason to say nothing.
  #
  # The noise list exists to skip the boilerplate in FRONT of a real message.
  # When a hardware encoder fails to initialise, boilerplate is all there is:
  # "Could not dynamically load CUDA", "Device creation failed", "Cannot load
  # lib..." - three lines, every one of them on the list, and the filter threw
  # the lot away and left the player showing "exit 1". A noisy reason beats no
  # reason, every time, so the last line it had is used rather than nothing.
  if ($all.Count) { return $all[-1] }
  return ''
}

# What to tell the person when a run fails. An exit code on its own says only
# that something went wrong; ffmpeg has usually already said what, and that
# line is worth far more than the number. Kept to one line and trimmed: this
# is going into a small panel, not a log file.
function Get-FailureReason {
  param([string]$ErrFile,[int]$Code)
  if ($Code -eq 0) { return "exit 0" }
  try {
    if ($ErrFile -and (Test-Path -LiteralPath $ErrFile)) {
      $msg = Select-ErrorLine @(Get-Content -LiteralPath $ErrFile -ErrorAction Stop)
      if ($msg) {
        if ($msg.Length -gt 300) { $msg = $msg.Substring(0,300) + '...' }
        return "$msg (exit $Code)"
      }
    }
  } catch { }
  return "exit $Code"
}

# Somewhere to put a scratch file. $env:TEMP is what this normally resolves
# to, but it is an environment variable like any other and can be absent;
# GetTempPath falls back on its own rather than handing back a null path that
# only fails three calls later.
function Get-TempDir {
  if ($env:TEMP -and (Test-Path -LiteralPath $env:TEMP)) { return $env:TEMP }
  return [IO.Path]::GetTempPath()
}



# Which ffmpeg this is. Worth saying out loud whenever a graph is refused:
# the same graph works on one build and not another, and without the version
# that difference is invisible from the outside.
function Get-FfmpegVersion {
  try {
    $line = (& ffmpeg -hide_banner -version 2>&1 | Select-Object -First 1)
    $m = [regex]::Match([string]$line,'ffmpeg version (\S+)')
    if ($m.Success) { return $m.Groups[1].Value }
  } catch { }
  return 'unknown'
}


# ---------------------------------------------------------------
#  Runs one of the ffmpeg scripts. Splitting always works on a
#  single recording; the fisheye tool still offers a whole folder.
#
#  Run from the player it is hidden (-Quiet) and reports through the
#  status file. Run from the Start menu it has a console: a run that
#  works closes on its own, one that fails waits so it can be read.
#
#  -Name, -Views and -Dir are passed by the player's split button. The
#  page cannot know a file's full path - the File System Access API
#  never reveals it - but it does know the path relative to the folder
#  that was opened, which is enough to find the file without asking.
#  The dialog only appears when that fails.
# ---------------------------------------------------------------

$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$batName = if ($Tool -eq 'rectify') { 'rectify-fisheye.bat' } else { 'split-views.bat' }
$bat     = Join-Path $here $batName
$what = if ($Tool -eq 'rectify') { 'Rectify fisheye view' } else { 'Single view into separate file' }
$memo = Join-Path $env:LOCALAPPDATA 'DashcamPlayer\lastfolder.txt'
$stat = Join-Path $env:LOCALAPPDATA 'DashcamPlayer\split-status.json'

# The player polls this file so it can pull the new files into its list the
# moment the run ends. Every exit path writes one, or the page would wait
# for a result that is never coming.
function Hold-Open {
  if ($Quiet) { return }        # a hidden window would wait for ever
  Read-Host "`nPress Enter to close" | Out-Null
}

# The name of the folder the batch writes into, read from the batch itself
# rather than written down twice. Someone editing "set OUT=" at the top of
# the script - which the documentation invites - would otherwise be sent to a
# folder that does not exist.
function Get-OutDirName([string]$BatFile) {
  try {
    # -ErrorAction Stop so a missing file lands in the catch below instead of
    # printing a red page of its own and then carrying on anyway.
    $m = [regex]::Match((Get-Content -LiteralPath $BatFile -Raw -ErrorAction Stop),
                        '(?m)^set "OUT=([^"]+)"')
    if ($m.Success) { return $m.Groups[1].Value }
  } catch { }
  if ($BatFile -like '*rectify*') { return 'rectified' }
  return 'split'
}
$script:outDir = ''

function Write-SplitStatus([string]$State, [string]$Detail) {
  try {
    $statDir = Split-Path -Parent $stat      # not $workDir: that is the chosen folder
    if (-not (Test-Path $statDir)) { New-Item -ItemType Directory -Path $statDir -Force | Out-Null }
    $leaf = ''
    if ($file) { $leaf = Split-Path -Leaf $file }
    # Where the files went, so the player can offer to open it. The page can
    # never work this out for itself - it is only ever told a file's name,
    # never its path - so if the tool does not say, nobody knows.
    # The process id, so a run can be stopped. The page never sends one and
    # never could: it is read back from the file the tool itself wrote, the
    # same rule the output folder follows. A page that could name a process
    # to kill would be a page that could kill any process.
    $o = [ordered]@{ state = $State; tool = $Tool; file = $leaf; views = $Views
                     detail = $Detail; outdir = $script:outDir
                     pid = $PID
                     at = (Get-Date).ToString('o') }
    # Written without a byte order mark: Set-Content -Encoding UTF8 adds one on
    # PowerShell 5.1, and a leading BOM makes JSON.parse throw in the page.
    [IO.File]::WriteAllText($stat, ($o | ConvertTo-Json -Compress),
                            (New-Object Text.UTF8Encoding($false)))
  } catch { }
}

Write-Host ""
Write-Host "  $what"

if (-not (Test-Path $bat)) {
  Write-Host "  $batName was not found next to this script." -ForegroundColor Red
  Write-SplitStatus 'failed' "$batName is missing"
  Hold-Open; exit 1
}
foreach ($exe in 'ffmpeg','ffprobe') {
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "  $exe was not found on your PATH." -ForegroundColor Yellow
    Write-Host "  Install it from the player - the Install ffmpeg button beside Export single view clip -"
    Write-Host "  or by hand with:  winget install --id Gyan.FFmpeg.Essentials -e"
    Write-SplitStatus 'failed' "$exe is not on PATH"
    Hold-Open; exit 1
  }
}

Add-Type -AssemblyName System.Windows.Forms | Out-Null

$lastDir = $null
try { if (Test-Path $memo) { $lastDir = (Get-Content $memo -First 1).Trim() } } catch { }
# Where the next run starts looking. Written by every path that learns a
# folder, including the locate pass, which is the whole point of that pass.
# What the search found, and where it looked. Written where the helper can
# serve it back to the page.
$script:LookedIn = @(); $script:Scanned = 0; $script:Capped = $false
$script:LastScanCapped = $false
function Write-LocateStatus($found) {
  try {
    $md = Split-Path -Parent $memo
    if (-not (Test-Path $md)) { New-Item -ItemType Directory -Path $md -Force | Out-Null }
    $o = [ordered]@{
      state   = $(if ($found) { 'found' } else { 'missing' })
      dir     = [string]$found
      lookedIn = @($script:LookedIn)
      # Every drive Windows says is ready, whether or not it was searched -
      # the two lists differing is itself the answer.
      drives  = @(try { [IO.DriveInfo]::GetDrives() | ForEach-Object {
                    '{0} {1} ready={2}' -f $_.Name, $_.DriveType, $_.IsReady } } catch { @() })
      scanned = $script:Scanned
      # True when the walk ran out of budget rather than finishing. Without
      # this, "not found" hides two quite different problems.
      capped  = $script:Capped
      asked   = "root=$rootHint dir=$Dir"
      at      = (Get-Date).ToString('s')
    }
    $json = $o | ConvertTo-Json -Compress
    [IO.File]::WriteAllText((Join-Path $md 'locate.json'), $json)
  } catch { }
}

function Save-LastDir([string]$dir) {
  if (-not $dir) { return }
  try {
    $md = Split-Path -Parent $memo
    if (-not (Test-Path $md)) { New-Item -ItemType Directory -Path $md -Force | Out-Null }
    Set-Content -Path $memo -Value $dir -Encoding ASCII
  } catch { }
}

# $workDir, NOT $dir. PowerShell variable names are case-insensitive, so a
# local called $dir IS the $Dir parameter above - the same variable. This line
# therefore used to erase the -Dir argument before anything could read it, so
# the relative-path lookup never once ran; and once $Dir carried a
# ValidatePattern, assigning a real path like "F:\DCIM\EVCam_Video" to $dir
# further down failed validation and left it empty, which surfaced as "that
# location could not be used". One name collision, two different symptoms.
$workDir = $null; $file = $null
$wholeFolder = $false

# Nothing worth descending into while hunting for a folder of recordings.
# Keeps a sweep of the system drive cheap.
$script:SkipDirs = @('Windows','Program Files','Program Files (x86)','ProgramData',
                     '$Recycle.Bin','System Volume Information','Users','AppData',
                     'Recovery','PerfLogs','node_modules')
$script:MaxDirsScanned = 20000

function Get-DriveRoots {
  $roots = @()
  foreach ($d in [IO.DriveInfo]::GetDrives()) {
    if (-not $d.IsReady) { continue }
    $roots += $d.RootDirectory.FullName
  }
  return $roots
}

# Where to look, in order. The drives first, because that is where a card is -
# then the handful of folders under this account where recordings copied off a
# card actually end up.
#
# Those have to be named one by one. The walk below skips "Users" outright,
# deliberately: a profile holds tens of thousands of folders and walking one
# to find a video would take longer than anyone will wait. That skip also
# meant a folder of recordings sitting in Videos or on OneDrive could never be
# found, and the first export from a laptop - where that is exactly where they
# are - always had to stop and ask. Naming the few likely folders costs five
# more starting points rather than a whole profile.
function Get-SearchRoots {
  $roots = @(Get-DriveRoots)
  # Not $home: that is one of PowerShell's own read-only variables and
  # assigning to it throws, which stopped this function before it had added
  # anything - the very folders it exists to add.
  $profileDir = $env:USERPROFILE
  if ($profileDir) {
    # The profile ITSELF, not only the five folders below it. A folder of
    # recordings sitting straight in the home directory - C:\Users\you\Dashcam
    # - was reachable from nowhere: the walk of C:\ skips "Users" outright,
    # and naming Videos, Documents and the rest does not cover their parent.
    # AppData is skipped inside it, so this stays bounded, and the walk has
    # its own counter besides.
    if (Test-Path -LiteralPath $profileDir) { $roots += $profileDir }
    foreach ($n in 'Videos','Documents','Downloads','Desktop','Pictures','Movies') {
      $p = Join-Path $profileDir $n
      if (Test-Path -LiteralPath $p) { $roots += $p }
    }
  }
  foreach ($v in 'OneDrive','OneDriveConsumer','OneDriveCommercial') {
    $p = [Environment]::GetEnvironmentVariable($v)
    if ($p -and (Test-Path -LiteralPath $p)) { $roots += $p }
  }
  # One entry per place. The same folder can arrive twice - OneDrive is often
  # reachable both by its own variable and from the profile - and a duplicate
  # root turns one answer into two, which reads as ambiguous and gives up.
  $seen = @{}; $out = @()
  foreach ($r in $roots) {
    try { $full = [IO.Path]::GetFullPath($r) } catch { continue }
    $k = $full.TrimEnd('\','/').ToLowerInvariant()
    if ($seen.ContainsKey($k)) { continue }
    $seen[$k] = $true; $out += $full
  }
  return $out
}

# Breadth-first and bounded. A recording folder sits near the top of a card,
# so a few levels is plenty and the cap stops a pathological tree.
function Find-DirNamed([string]$from, [string]$name, [int]$maxDepth) {
  $out = @(); $seen = 0
  $script:LastScanCapped = $false
  $level = @($from)
  for ($depth = 0; $depth -lt $maxDepth -and $level.Count -gt 0; $depth++) {
    $next = @()
    foreach ($d in $level) {
      try { $kids = [IO.Directory]::GetDirectories($d) } catch { continue }
      foreach ($k in $kids) {
        if (++$seen -gt $script:MaxDirsScanned) { $script:LastScanCapped = $true; $script:Scanned += $seen; return $out }
        $leafName = Split-Path -Leaf $k
        if ($script:SkipDirs -contains $leafName) { continue }
        if ($leafName -ieq $name) { $out += $k }
        $next += $k
      }
    }
    $level = $next
  }
  $script:Scanned += $seen
  return $out
}

# Work out where the recording is without troubling anyone for it. The page
# can never know a full path - the File System Access API does not expose one
# - so it sends the file name, the path relative to the folder that was
# opened, and that folder's NAME. The name is what rescues the ordinary case:
# opening the folder the recordings are actually in leaves no relative path
# at all, and before this the tool had nothing whatsoever to go on.
# $roots is a parameter so the search can be tested against a known tree.
# Two paths that lead to the same recording are one answer, not two. Compared
# as resolved full paths, case-insensitively, because Windows is.
function Select-UniquePaths([string[]]$paths) {
  $seen = @{}; $out = @()
  foreach ($p in $paths) {
    if (-not $p) { continue }
    try { $full = [IO.Path]::GetFullPath($p) } catch { $full = $p }
    $k = $full.ToLowerInvariant()
    if ($seen.ContainsKey($k)) { continue }
    $seen[$k] = $true; $out += $full
  }
  return $out
}

# The folder the page has marked, found by reading the mark rather than by
# trusting a name. Two cards can both have a folder called DCIM; only one has
# this number in it.
$script:MarkerDir  = 'Dashcam and Sentry exports'
$script:MarkerFile = '.dcp-folder'
function Find-MarkedFolder([string]$token, [string[]]$roots, [string]$named) {
  if (-not $token) { return $null }
  if (-not $roots -or $roots.Count -eq 0) { $roots = Get-SearchRoots }
  $script:LookedIn = @(); $script:Scanned = 0; $script:Capped = $false
  $check = {
    param($dir)
    $f = Join-Path (Join-Path $dir $script:MarkerDir) $script:MarkerFile
    try { return ((Test-Path -LiteralPath $f) -and ((Get-Content $f -First 1 -ErrorAction Stop).Trim() -eq $token)) }
    catch { return $false }
  }
  # The folder the page says was opened, by name. One named folder is a much
  # smaller thing to hunt for than every "Dashcam and Sentry exports" on a
  # disk, and the mark inside it still settles which one it is.
  if ($named) {
    foreach ($r in $roots) {
      $script:LookedIn += "$r (looking for '$named')"
      if (& $check (Join-Path $r $named)) { return (Join-Path $r $named) }
      foreach ($d in (Find-DirNamed $r $named 6)) {
        if ($script:LastScanCapped) { $script:Capped = $true }
        if (& $check $d) { return $d }
      }
    }
  }
  foreach ($r in $roots) {
    $script:LookedIn += $r
    # The mark sits at the top of the folder that was opened, so the folder
    # itself is the first thing worth testing - no walk at all in the common
    # case where a card was opened at its root.
    $here = Join-Path (Join-Path $r $script:MarkerDir) $script:MarkerFile
    try { if ((Test-Path -LiteralPath $here) -and ((Get-Content $here -First 1 -ErrorAction Stop).Trim() -eq $token)) { return $r } } catch { }
    # Six, not four. A card opened at its root puts the mark one level down,
    # but a folder of recordings filed away on a disk can sit a good deal
    # deeper than that, and the walk is bounded by its own counter anyway.
    foreach ($d in (Find-DirNamed $r $script:MarkerDir 6)) {
      if ($script:LastScanCapped) { $script:Capped = $true }
      $f = Join-Path $d $script:MarkerFile
      try {
        if ((Test-Path -LiteralPath $f) -and ((Get-Content $f -First 1 -ErrorAction Stop).Trim() -eq $token)) {
          return (Split-Path -Parent $d)
        }
      } catch { }
    }
  }
  return $null
}

function Resolve-Recording([string]$leaf, [string]$relDir, [string]$rootName, [string[]]$roots) {
  if (-not $leaf) { return $null }
  if (-not $roots -or $roots.Count -eq 0) { $roots = Get-SearchRoots }
  $sep = [IO.Path]::DirectorySeparatorChar
  # A single separator. In a -replace the replacement is not an escape
  # sequence - '\\' there produces TWO backslashes - so this used to build
  # "DCIM\\Movie" and every path below inherited the doubled separator.
  $rel = ($relDir -replace '/', $sep).Trim($sep)

  # 1. The folder the last run used, with and without the relative part.
  if ($lastDir) {
    $try = @((Join-Path $lastDir $leaf))
    if ($rel) { $try += (Join-Path (Join-Path $lastDir $rel) $leaf) }
    foreach ($p in $try) { if (Test-Path -LiteralPath $p) { return $p } }
  }

  # 2. The same relative path under each place worth looking.
  if ($rel) {
    $hits = @()
    foreach ($r in $roots) {
      $p = Join-Path (Join-Path $r $rel) $leaf
      if (Test-Path -LiteralPath $p) { $hits += $p }
    }
    $hits = @(Select-UniquePaths $hits)
    # One answer only. Two drives holding the same path is ambiguous, and
    # guessing would split the wrong card.
    if ($hits.Count -eq 1) { return $hits[0] }
    if ($hits.Count -gt 1) { return $null }
  }

  # 3. Hunt for the opened folder by name, then look inside it.
  if ($rootName) {
    $hits = @()
    foreach ($r in $roots) {
      foreach ($d in (Find-DirNamed $r $rootName 5)) {
        $p = if ($rel) { Join-Path (Join-Path $d $rel) $leaf } else { Join-Path $d $leaf }
        if (Test-Path -LiteralPath $p) { $hits += $p }
      }
    }
    $hits = @(Select-UniquePaths $hits)
    if ($hits.Count -eq 1) { return $hits[0] }
  }
  return $null
}

# Both tools are now started from the page as well as from the Start menu, and
# the page can only ever supply a name and some hints - so both need the same
# search. This used to run for the split alone, and a rectify asked for from the
# page would have gone looking for a file it had not been told how to find.
# The mark the page left is the surest thing available: it names one folder
# and no other. Tried before the guesswork, and what it finds is remembered
# the same way, so the walk happens once rather than on every export.
if ($Token -and -not ($lastDir -and (Test-Path -LiteralPath $lastDir))) {
  $marked = Find-MarkedFolder $Token $null $rootHint
  if ($marked) { $lastDir = $marked; Save-LastDir $marked }
}

# Nothing to export: the page has just opened a folder and is saying where it
# is, so that the first real export finds it without stopping to ask.
# Searching has failed and the page is asking outright. One folder dialog,
# at a moment the person chose, instead of one that interrupts an export.
# Deterministic: nothing is guessed, and it is asked once.
if ($Tool -eq 'pick') {
  Add-Type -AssemblyName System.Windows.Forms | Out-Null
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = 'Where are the recordings? Pick the same folder you opened in the player.'
  $dlg.ShowNewFolderButton = $false
  if ($lastDir -and (Test-Path -LiteralPath $lastDir)) { $dlg.SelectedPath = $lastDir }
  $ans = $dlg.ShowDialog()
  if ($ans -ne [System.Windows.Forms.DialogResult]::OK -or -not $dlg.SelectedPath) {
    Write-LocateStatus $null
    exit 0
  }
  Save-LastDir $dlg.SelectedPath
  $script:LookedIn = @('asked')
  Write-LocateStatus $dlg.SelectedPath
  Write-Host "  remembered: $($dlg.SelectedPath)"
  exit 0
}

if ($Tool -eq 'locate') {
  if (-not $Token) { exit 0 }
  $marked = Find-MarkedFolder $Token $null $rootHint
  # Say what happened, and where it looked. This runs hidden with nobody
  # watching, so a silent failure here is invisible until an export stops to
  # ask - and then there is nothing to go on. The page reads this back.
  Write-LocateStatus $marked
  if ($marked) { Save-LastDir $marked; Write-Host "  remembered: $marked"; exit 0 }
  Write-Host '  the marked folder was not found; the first export will ask'
  exit 0
}

if ($Name) {
  $found = Resolve-Recording $Name $Dir $rootHint
  if ($found) {
    $file = $found
    $workDir  = Split-Path -Parent $found
  }
  elseif ($Quiet) {
    # The page cannot send a full path - the File System Access API never
    # exposes one - so everything above is guesswork from the hints it can
    # give. When they come to nothing, do not dead-end: hand over to a
    # VISIBLE instance which can simply ask. The file is confirmed once, this
    # writes lastfolder.txt, and every later split finds it without asking.
    #
    # A dialog is not raised here because this process was started hidden,
    # and a dialog from it can end up behind everything with no taskbar entry.
    # The relaunched copy has no -Quiet, so it cannot come back round here.
    $where = @()
    if ($lastDir) { $where += $lastDir }
    if ($Dir)     { $where += "<drive>\$Dir" }
    if ($rootHint) { $where += "any folder named '$rootHint'" }
    $tried = if ($where.Count) { $where -join ', ' } else { 'nowhere - no usable location was supplied' }

    $self = $MyInvocation.MyCommand.Definition
    $again = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$self`"",'-Tool',$Tool)
    if ($Name)  { $again += @('-Name',"`"$Name`"") }
    if ($Views) { $again += @('-Views',$Views) }
    if ($Dir)   { $again += @('-Dir',"`"$Dir`"") }
    if ($rootHint)  { $again += @("-Root","`"$rootHint`"") }
    try {
      Write-SplitStatus 'running' "could not locate $Name automatically - confirm it in the window that has just opened"
      Start-Process -FilePath 'powershell.exe' -ArgumentList $again -WindowStyle Normal
      exit 0            # the visible copy owns the status from here
    } catch {
      Write-SplitStatus 'failed' ("could not find $Name, and could not open a window to ask. " +
        "Received name='$Name' dir='$Dir' root='$rootHint'. Looked in: $tried")
      exit 1
    }
  }
}

if ($Tool -eq 'rectify' -and -not $Name) {
  $answer = [System.Windows.Forms.MessageBox]::Show(
    "Work on a whole folder of recordings, or just one file?`r`n`r`n" +
    "Yes  -  every recording in a folder`r`n" +
    "No   -  one recording",
    $what,
    [System.Windows.Forms.MessageBoxButtons]::YesNoCancel,
    [System.Windows.Forms.MessageBoxIcon]::Question)
  if ($answer -eq [System.Windows.Forms.DialogResult]::Cancel) { exit 0 }
  $wholeFolder = ($answer -eq [System.Windows.Forms.DialogResult]::Yes)
}

if ($file) {
  # already located - nothing to ask
}
elseif ($wholeFolder) {
  $shell = New-Object -ComObject Shell.Application
  $pick  = $shell.BrowseForFolder(0, "Choose the folder of recordings", 0x211, 0)
  if (-not $pick) { Write-SplitStatus 'cancelled' ''; exit 0 }
  try { $workDir = $pick.Self.Path } catch { }
}
else {
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Title  = if ($Name) { "Confirm the recording to split" } else { "Choose the recording" }
  $dlg.Filter = "Recordings (*.mp4)|*.mp4|All files (*.*)|*.*"
  if ($Name)    { $dlg.FileName = $Name }
  if ($lastDir -and (Test-Path -LiteralPath $lastDir)) { $dlg.InitialDirectory = $lastDir }
  if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-SplitStatus 'cancelled' ''; exit 0
  }
  $file = $dlg.FileName
  $workDir  = Split-Path -Parent $file
}

# -LiteralPath, to match how the file itself was located above. Without it
# this is a wildcard match, so a folder found perfectly well by Resolve-
# Recording could still be rejected here - which is how a successful lookup
# ended in "that location could not be used".
if (-not $workDir -or -not (Test-Path -LiteralPath $workDir)) {
  Write-Host "  That location could not be used: '$workDir'" -ForegroundColor Red
  # The path goes in the status too. The player is the only thing watching
  # when this runs hidden, and a bare "could not be used" says nothing about
  # which location was meant.
  Write-SplitStatus 'failed' "that location could not be used: $workDir"
  Hold-Open; exit 1
}

# Remember where we were, so the next confirmation opens in the right place.
Save-LastDir $workDir

if ($file) {
  Write-Host "  file:   $(Split-Path -Leaf $file)"
  if ($Views -and $Views -ne 'all') { Write-Host "  views:  $Views" }
}
else {
  $count = @(Get-ChildItem -LiteralPath $workDir -Filter *.mp4 -File -ErrorAction SilentlyContinue).Count
  Write-Host "  folder: $workDir"
  Write-Host "  files:  $count recording(s)"
  if ($count -eq 0) {
    Write-Host "  No .mp4 files there. Choose the folder holding the recordings." -ForegroundColor Yellow
    Write-SplitStatus 'failed' 'no .mp4 files in that folder'
    Hold-Open; exit 1
  }
}
Write-Host ""

if ($Quiet) { $env:DCP_QUIET = '1' }   # split-views.bat checks this
# Where the exports go: one folder at the top of whatever was opened, with a
# subfolder per tool. Everything the tools make from one card then sits in a
# single place, rather than a "split" folder appearing beside each day's
# recordings halfway down the tree.
#
# The top is the folder the recording was found in, less the relative path
# the page sent with it: open F:\ with the recording at
# F:\DCIM\EVCam_Video\x.mp4 and the exports go to F:\Dashcam and Sentry
# exports\. Picked by hand there is no relative path, so the folder that was
# picked is the top - which is what was chosen in that case too.
$EXPORTS = 'Dashcam and Sentry exports'
$exportRoot = $workDir
if ($Dir) {
  $rel = ($Dir -replace '/', '\').Trim('\')
  if ($rel -and $workDir.ToLowerInvariant().EndsWith('\' + $rel.ToLowerInvariant())) {
    $exportRoot = $workDir.Substring(0, $workDir.Length - $rel.Length - 1)
    # "F:" is not a folder; "F:\" is.
    if ($exportRoot -match '\A[A-Za-z]:\z') { $exportRoot += '\' }
  }
}
# Joined by hand. Join-Path resolves the drive qualifier and throws "Cannot
# find drive" for one that is not mounted, and [IO.Path]::Combine uses
# whatever separator the host prefers. This script only ever addresses
# Windows paths, so the separator is not in question.
$script:outDir = $exportRoot.TrimEnd('\') + '\' + $EXPORTS + '\' + (Get-OutDirName $bat)
Push-Location -LiteralPath $workDir
try {
  # An "as shown" split needs every piece: which view, where it sits, and the
  # adjustments. Without the lane rect there is nothing to warp, so it falls
  # back to the ordinary split rather than guessing.
  # Somewhere for ffmpeg's own words to go. Launched from the player there is
  # no console, so without this a failure reached the screen as "exit 1" and
  # nothing else - which is exactly as much as it sounds.
  $errFile = Join-Path (Get-TempDir) ("dcp_err_{0}.txt" -f ([guid]::NewGuid().ToString('N').Substring(0,8)))
  $env:DCP_ERRFILE = $errFile
  # Both or neither: a start with no length would run to the end of the
  # recording, which is not what a marked clip means.
  if ($Start -and $Dur) {
    $env:DCP_START = $Start
    $env:DCP_DUR   = $Dur
    Write-Host ("  clip:   {0}s for {1}s" -f $Start, $Dur)
  } else {
    $env:DCP_START = ''
    $env:DCP_DUR   = ''
  }
  # The fallback duration. Not used when ffprobe can answer, and never used
  # for a clip, whose own length is the thing being measured.
  $env:DCP_SECS = $Secs
  # Empty means "the batch decides", which is what it does: its own default.
  $env:DCP_QUALITY = $Quality
  $env:DCP_STATUSSTRIP = $StatusStrip
  $env:DCP_TRIMTOP = $TrimTop
  $env:DCP_TRIMBOT = $TrimBottom
  # The time of day on the picture. The batch builds the ffmpeg filter; what
  # travels from here is only the instant it starts from.
  $env:DCP_CLOCKAT = $ClockAt
  $env:DCP_LANES = $Lanes
  $env:DCP_STRIPAT = $(if ($Lanes) { $StripAt } else { '' })
  # The batch writes here rather than beside the recordings.
  $env:DCP_OUT = $script:outDir
  Write-Host "  output: $($script:outDir)"
  Write-SplitStatus 'running' ''
  try {
    if ($file -and $Views) { & $env:ComSpec /c $bat $file $Views }
    elseif ($file)          { & $env:ComSpec /c $bat $file }
    else                    { & $env:ComSpec /c $bat }
  } finally {
    $env:DCP_ERRFILE  = ''
    $env:DCP_START    = ''
    $env:DCP_DUR      = ''
    $env:DCP_SECS     = ''
    $env:DCP_QUALITY  = ''
    $env:DCP_STATUSSTRIP = ''
    $env:DCP_TRIMTOP  = ''
    $env:DCP_TRIMBOT  = ''
    $env:DCP_CLOCKAT  = ''
    $env:DCP_LANES    = ''
    $env:DCP_STRIPAT  = ''
    $env:DCP_OUT      = ''
  }
  Write-Host ""
  Write-Host "  exit code: $LASTEXITCODE"
  $state = 'done'
  if ($LASTEXITCODE -ne 0) { $state = 'failed' }
  $why = Get-FailureReason $errFile $LASTEXITCODE
  try { Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue } catch { }
  Write-SplitStatus $state $why
  if ($LASTEXITCODE -ne 0) { Hold-Open }
} catch {
  Write-Host "  The script could not be started: $($_.Exception.Message)" -ForegroundColor Red
  Write-SplitStatus 'failed' $_.Exception.Message
  Hold-Open
} finally { Pop-Location }
