# IdleSeconds is deliberately generous. The page pings every five seconds,
# but a browser throttles timers in a window that is hidden or minimised to
# roughly one a minute - so at 25 seconds the helper shut itself down while
# the player was merely in the background, and the next click on it reported
# nothing more useful than "Failed to fetch". Three minutes leaves room for
# two missed pings and still closes the helper soon after the window goes.
param([int]$Port = 8777, [int]$IdleSeconds = 180, [switch]$Persist)

# ---------------------------------------------------------------
#  Serves Dashcam Player on http://localhost:<port> so Edge can
#  install it as an app. Chromium only makes folder permissions
#  permanent for installed apps, and a file:// page can never be
#  installed.
#
#  The page sends a heartbeat every few seconds. When it stops -
#  because you closed the window - this server shuts itself down.
#  -Persist keeps it running instead, which is how the optional
#  start-with-Windows entry runs it.
#
#  Run "Dashcam Player.cmd" rather than this file directly.
# ---------------------------------------------------------------

# Kept in step with the page and the installer. This process is long-lived
# and holds whatever code it started with, so after an upgrade it can be
# older than the page it is serving. It tells the page its version and the
# page says so plainly; otherwise an old helper silently drops parameters a
# new page sends and the failure looks like a missing recording.
$ServerVersion = '1.59.1'

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$page = Join-Path $root 'dashcam-player.html'

# --- ffmpeg, and getting hold of it ---------------------------------------
# A process keeps the PATH it was started with. winget writes its new folder
# into the PATH in the registry and tells the desktop about it, which serves
# programs started afterwards - but not this one, nor the tools it launches,
# which inherit this process's copy. Reading the PATH back out of the
# registry is what lets ffmpeg be installed and used without closing the
# player, and is why nobody has to reboot or sign out.
function Sync-EnvPath {
  try {
    $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $u = [Environment]::GetEnvironmentVariable('Path', 'User')
    $joined = (@($m, $u) | Where-Object { $_ }) -join ';'
    if ($joined) { $env:Path = $joined }
  } catch { }
}
$ffmpegState = Join-Path $env:LOCALAPPDATA 'DashcamPlayer\ffmpeg-install.json'

# The PowerShell this helper is itself running under, rather than whatever
# "powershell.exe" happens to resolve to - or fails to resolve to, on a
# machine where it is not on the PATH, which is a silent nothing-happens.
$psExe = try { (Get-Process -Id $PID).Path } catch { $null }
if (-not $psExe) { $psExe = 'powershell.exe' }

# The Windows programs this starts, by full path rather than by name.
#
# Sync-EnvPath deliberately re-reads the PATH out of the registry, including
# the USER half, which does not need administrator rights to change. Starting
# taskkill or explorer by bare name would resolve them through that list. The
# same reasoning already applies to PowerShell above, which is why $psExe
# exists; these are the two it had not been extended to.
# Built by hand rather than with Join-Path and Test-Path: both of those go
# through PowerShell's provider machinery and want the drive to exist, which
# throws where it does not. These are plain file paths and want none of that.
$sysDir   = if ($env:SystemRoot) { $env:SystemRoot.TrimEnd('\') } else { 'C:\Windows' }
$taskKill = "$sysDir\System32\taskkill.exe"
$explorer = "$sysDir\explorer.exe"
if (-not [IO.File]::Exists($taskKill)) { $taskKill = 'taskkill.exe' }
if (-not [IO.File]::Exists($explorer)) { $explorer = 'explorer.exe' }

# By hand, not Get-Command: that caches its first answer, and this is asked
# again precisely because the PATH has just changed underneath it.
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

# Fetch ffmpeg, unless it is here or already being fetched. The installer
# does this once, when the app is installed; this is what covers everything
# afterwards - ffmpeg uninstalled since, an upgrade installed while it was
# still present, a machine where the install-time attempt could not run.
# Called when this helper starts, and again behind the button on the page.
function Start-FfmpegInstall {
  Sync-EnvPath
  if ((Find-OnPath 'ffmpeg') -and (Find-OnPath 'ffprobe')) { return 'already' }
  $tool = Join-Path $root 'Install-FFmpeg.ps1'
  if (-not (Test-Path $tool)) { return 'missing-script' }
  try {
    # One at a time. Two winget runs over the same package would fight, and
    # the page would be reading one run's result while the other wrote it.
    if (Test-Path $ffmpegState) {
      $j = [IO.File]::ReadAllText($ffmpegState).TrimStart([char]0xFEFF) | ConvertFrom-Json
      if ($j.state -eq 'running') {
        # Unless nobody is there any more: a run killed with its session
        # leaves "running" behind for ever, and the page would wait for it.
        $when = $null
        try { $when = [datetime]$j.at } catch { }
        if ($when -and ((Get-Date) - $when).TotalMinutes -lt 15) { return 'running' }
      }
      # Cleared, so the page cannot read the last run's result as this one's.
      Remove-Item -LiteralPath $ffmpegState -Force -ErrorAction SilentlyContinue
    }
    $a = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$tool`"")
    try {
      Start-Process -FilePath $psExe -ArgumentList (@('-WindowStyle','Hidden') + $a) `
                    -WorkingDirectory $root -WindowStyle Hidden
    } catch {
      # -WindowStyle is not offered by every edition of PowerShell. With no
      # window to hide there is nothing to hide, so run it plainly rather
      # than not at all.
      Start-Process -FilePath $psExe -ArgumentList $a -WorkingDirectory $root
    }
    return 'started'
  } catch {
    # Nothing silently: a fetch that could not even be started must say so,
    # or the page waits for a process that was never there.
    try {
      $o = [ordered]@{ state = 'failed'
                       detail = "The installer could not be started: $($_.Exception.Message)"
                       at = (Get-Date).ToString('o') }
      [IO.File]::WriteAllText($ffmpegState, ($o | ConvertTo-Json -Compress),
                              (New-Object Text.UTF8Encoding($false)))
    } catch { }
    return 'error'
  }
}

if (-not (Test-Path $page)) {
  Write-Host "dashcam-player.html was not found next to this script." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

$manifest = @'
{"name":"Dashcam Player","short_name":"Dashcam","start_url":"/","scope":"/",
"display":"standalone","background_color":"#11161b","theme_color":"#11161b",
"icons":[{"src":"/icon.svg","sizes":"any","type":"image/svg+xml","purpose":"any"}]}
'@

$icon = @'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="#11161b"/><g fill="none" stroke="#63aede" stroke-width="3"><rect x="10" y="10" width="20" height="20"/><rect x="34" y="10" width="20" height="20"/><rect x="10" y="34" width="20" height="20"/><rect x="34" y="34" width="20" height="20"/></g></svg>
'@

# A fresh random token per run, substituted into the page as it is served.
# The page sends it back on every request; anything that cannot read the page
# source cannot produce it. See the long note by DCP_TOKEN in the page: the
# listener is on loopback, but "loopback" does not mean "only us" - every
# website the browser has open can reach it, and with a correct Host header.
$tokenBytes = New-Object byte[] 32
try {
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($tokenBytes)
} catch {
  # Should not happen on any supported Windows, but a predictable token would
  # be worse than refusing to start.
  Write-Host "Could not generate a session token - refusing to start." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}
$token = -join ($tokenBytes | ForEach-Object { $_.ToString('x2') })

# Reading a line with a limit on how long it may be.
#
# StreamReader.ReadLine() will buffer whatever it is sent until a newline
# arrives, so a local page could hold the connection open for the read
# timeout and send megabytes on one line - all of it allocated here, before
# anything has checked a token. A request line and a header line are both
# small; anything longer is not a request this serves.
function Read-CappedLine($reader, [int]$max) {
  $sb = New-Object System.Text.StringBuilder
  while ($true) {
    $ch = $reader.Read()
    if ($ch -lt 0) { if ($sb.Length -eq 0) { return $null } else { break } }
    if ($ch -eq 10) { break }                      # LF ends the line
    if ($ch -ne 13) { [void]$sb.Append([char]$ch) }  # CR is not part of it
    if ($sb.Length -gt $max) { return $null }      # too long: not ours
  }
  return $sb.ToString()
}

# Sent on every reply, including the refusals.
#
# frame-ancestors cannot come from the page's own meta tag - browsers ignore
# that directive there - so it has to be a header, and without it any website
# may put this page in an invisible frame and trick a click onto a button
# that deletes recordings. X-Frame-Options says the same to anything that
# predates frame-ancestors. nosniff stops a browser second-guessing the
# content type of a status reply, and no-referrer keeps the local address off
# any link the page opens.
$secHeaders = "X-Content-Type-Options: nosniff`r`n" +
              "X-Frame-Options: DENY`r`n" +
              "Content-Security-Policy: frame-ancestors 'none'`r`n" +
              "Referrer-Policy: no-referrer`r`n"

$ip = [System.Net.IPAddress]::Loopback
$listener = New-Object System.Net.Sockets.TcpListener($ip, $Port)
try { $listener.Start() }
catch {
  Write-Host "Could not listen on port $Port - something else may be using it." -ForegroundColor Red
  Write-Host "Try a different port:  powershell -File dashcam-server.ps1 -Port 8790"
  Read-Host "Press Enter to close"
  exit 1
}

# Leave the process id where the installer can find it. Killing by window
# title cannot work: the launcher starts this hidden and untitled, so an
# upgrade would otherwise replace files underneath a running server.
$pidFile = Join-Path $env:LOCALAPPDATA 'DashcamPlayer\server.pid'
try {
  $pidDir = Split-Path -Parent $pidFile
  if (-not (Test-Path $pidDir)) { New-Item -ItemType Directory -Path $pidDir -Force | Out-Null }
  Set-Content -Path $pidFile -Value $PID -Encoding ASCII
} catch { }

Write-Host ""
Write-Host "  Dashcam Player is served at http://localhost:$Port/"
if ($Persist) {
  Write-Host "  Running in the background; it stays up until you sign out."
} else {
  Write-Host "  This window closes on its own once you close the app."
}
Write-Host ""

# Checked at every start, not only when the app is installed: ffmpeg can be
# removed afterwards, and an upgrade installed while it was still there has
# nothing to notice. Costs a PATH lookup when it is present.
$null = Start-FfmpegInstall

$seen = $false
$last = Get-Date
$started = Get-Date
$grace = (Get-Date).AddSeconds(45)

while ($true) {
  if ($listener.Pending()) {
    $client = $null
    try {
      $client = $listener.AcceptTcpClient()
      $client.ReceiveTimeout = 2000
      $stream = $client.GetStream()
      $stream.ReadTimeout = 2000
      $reader = New-Object System.IO.StreamReader($stream)

      # Browsers open speculative sockets that never send a request.
      # The timeout above turns those into an exception instead of a
      # permanent block, which is what used to leave this window open.
      $request = Read-CappedLine $reader 2048
      if ([string]::IsNullOrWhiteSpace($request)) { $client.Close(); continue }

      # The headers, which this server used to ignore entirely - it read the
      # request line and nothing else, which is precisely why it could not
      # tell its own page from any other site the browser had open.
      # Bounded: a client that never sends a blank line must not hang the loop.
      $headers = @{}
      $hLines = 0
      while ($true) {
        $line = Read-CappedLine $reader 2048
        if ($null -eq $line -or $line -eq '') { break }
        $hLines++
        if ($hLines -gt 60) { break }
        $ci = $line.IndexOf(':')
        if ($ci -gt 0) {
          $hk = $line.Substring(0, $ci).Trim().ToLowerInvariant()
          $hv = $line.Substring($ci + 1).Trim()
          if (-not $headers.ContainsKey($hk)) { $headers[$hk] = $hv }
        }
      }
      $hdrHost = if ($headers.ContainsKey('host')) { $headers['host'].ToLowerInvariant() } else { '' }
      $hdrTok  = if ($headers.ContainsKey('x-dashcam-token')) { $headers['x-dashcam-token'] } else { '' }
      $hdrSite = if ($headers.ContainsKey('sec-fetch-site')) { $headers['sec-fetch-site'].ToLowerInvariant() } else { '' }

      $target = '/'
      if ($request -match '^\S+\s+(\S+)') { $target = $Matches[1] }
      $path  = $target
      $query = ''
      if ($path.Contains('?')) {
        $parts = $path.Split('?', 2)
        $path  = $parts[0]
        $query = $parts[1]
      }

      $seen = $true
      $last = Get-Date

      # --- who is allowed to ask ---------------------------------------
      # Host: this does not stop a remote page - a fetch to
      # http://localhost:8777/ carries exactly the right Host - but it does
      # foreclose DNS rebinding, where an attacker's name resolves to
      # 127.0.0.1 and the browser sends their host name instead. Worth having
      # if the bind address is ever widened beyond loopback.
      $allowedHosts = @("localhost:$Port", "127.0.0.1:$Port", "[::1]:$Port")
      $hostOk = ($hdrHost -ne '') -and ($allowedHosts -contains $hdrHost)

      # Anything with a side effect needs the token. GET / does not: that is
      # the browser fetching the page, before it can possibly know the token.
      $needsToken = @('/split','/install-ffmpeg','/locate','/reveal','/reveal-file','/pick-folder','/cancel-split')
      $tokenOk = ($hdrTok -ne '') -and ($hdrTok -eq $token)
      # Browsers label a request from another site. Belt and braces: a
      # cross-site request should never have got this far, having no token.
      $siteOk = ($hdrSite -eq '') -or ($hdrSite -eq 'same-origin') -or ($hdrSite -eq 'none')

      $deny = ''
      if (-not $hostOk) { $deny = 'bad host' }
      elseif (($needsToken -contains $path) -and -not $tokenOk) { $deny = 'bad or missing token' }
      elseif (($needsToken -contains $path) -and -not $siteOk)   { $deny = 'cross-site request' }

      if ($deny -ne '') {
        # No CORS headers here or anywhere else, deliberately: their absence
        # is what stops a remote page reading any of these replies.
        $body   = "forbidden ($deny)"
        $type   = 'text/plain'
        $status = '403 Forbidden'
        $bytes  = [Text.Encoding]::UTF8.GetBytes($body)
        $header = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`n${secHeaders}Connection: close`r`n`r`n"
        $hb = [Text.Encoding]::ASCII.GetBytes($header)
        $stream.Write($hb, 0, $hb.Length)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
        $client.Close()
        continue
      }

      $status = '200 OK'
      switch ($path) {
        '/ping'          { $body = '';          $type = 'text/plain' }
        '/split'         {
          # The page cannot know a file's full path - the File System
          # Access API never reveals it - so it sends just the name and
          # the tool opens its file dialog pre-filled with it.
          $name = ''
          $views = ''
          $reldir = ''
          $rootname = ''
          $cstart = ''
          $cdur = ''
          $csecs = ''
          $ctool = 'split'
          $cqual = ''
          $cstrip = ''
          $ctrimt = ''
          $ctrimb = ''
          $cclock = ''
          $clanes = ''
          $cstriprect = ''
          $ctoken = ''
          foreach ($pair in $query.Split('&')) {
            if ($pair -like 'name=*')  { $name   = [Uri]::UnescapeDataString($pair.Substring(5)) }
            if ($pair -like 'views=*') { $views  = [Uri]::UnescapeDataString($pair.Substring(6)) }
            if ($pair -like 'dir=*')   { $reldir = [Uri]::UnescapeDataString($pair.Substring(4)) }
            if ($pair -like 'root=*')  { $rootname = [Uri]::UnescapeDataString($pair.Substring(5)) }
            if ($pair -like 'start=*') { $cstart = [Uri]::UnescapeDataString($pair.Substring(6)) }
            if ($pair -like 'dur=*')   { $cdur   = [Uri]::UnescapeDataString($pair.Substring(4)) }
            if ($pair -like 'secs=*')  { $csecs  = [Uri]::UnescapeDataString($pair.Substring(5)) }
            if ($pair -like 'tool=*')  { $ctool  = [Uri]::UnescapeDataString($pair.Substring(5)) }
            if ($pair -like 'quality=*') { $cqual = [Uri]::UnescapeDataString($pair.Substring(8)) }
            if ($pair -like 'strip=*')   { $cstrip = [Uri]::UnescapeDataString($pair.Substring(6)) }
            if ($pair -like 'trimtop=*') { $ctrimt = [Uri]::UnescapeDataString($pair.Substring(8)) }
            if ($pair -like 'trimbot=*') { $ctrimb = [Uri]::UnescapeDataString($pair.Substring(8)) }
            if ($pair -like 'clock=*')   { $cclock = [Uri]::UnescapeDataString($pair.Substring(6)) }
            if ($pair -like 'lanes=*')   { $clanes = [Uri]::UnescapeDataString($pair.Substring(6)) }
            if ($pair -like 'striprect=*') { $cstriprect = [Uri]::UnescapeDataString($pair.Substring(10)) }
            if ($pair -like 'token=*') { $ctoken = [Uri]::UnescapeDataString($pair.Substring(6)) }
          }
          # Which of the two export tools. An exact match against a list of
          # two, not a pattern: this names a script to run, so anything that
          # is not one of them is the default rather than a near miss.
          if ($ctool -ne 'rectify') { $ctool = 'split' }
          # The number the page wrote into the folder it has open. Hex only:
          # it is compared against the contents of a file and never goes on a
          # command line, but it does reach a launcher parameter.
          if ($ctoken -notmatch '\A[0-9a-f]{8,32}\z') { $ctoken = '' }
          # A path relative to the folder the page has open, so the tool can
          # find the file without asking. Relative only - no drive, no '..'.
          if ($reldir -match '\.\.' -or $reldir -match '[:\\*?"<>|]' -or $reldir.Length -gt 200) { $reldir = '' }
          if ($name) { $name = Split-Path -Leaf $name }   # never a path, only a name
          # An allowlist, not a denylist. The old filter rejected path
          # characters but let cmd's own metacharacters through - & ^ % ! ( )
          # - and the batch file expanded %NAME% before scanning for them, so
          # a file called "a&calc.mp4" ran a command. Recording file names are
          # dates, view names and underscores, so nothing legitimate is lost.
          #
          # \A and \z, not ^ and $: in .NET "$" also matches immediately
          # before a trailing newline, and UnescapeDataString turns %0A into
          # one, so "name=good%0A" would otherwise have been accepted whole.
          if ($name -notmatch '\A[A-Za-z0-9 ._-]{1,150}\z') { $name = '' }
          # A leading dash would be read as a parameter name by the launcher.
          if ($name -match '\A-') { $name = '' }
          if ($reldir -and $reldir -notmatch '\A[A-Za-z0-9 ._/-]{1,200}\z') { $reldir = '' }
          if ($reldir -match '\A-') { $reldir = '' }
          # The opened folder's name. Unlike the file name this is never put
          # on a command line - it is only ever compared against directory
          # names while searching - so it does not need the strict allowlist,
          # and must not have one: real folder names contain brackets,
          # ampersands and the like, and the strict list silently discarded
          # them, which left the tool with nothing to go on. Reject only what
          # could make it a path or a wildcard.
          if ($rootname) { $rootname = $rootname -replace '[\\/]', '' }
          if ($rootname -match '[:*?"<>|]' -or $rootname -match '[\x00-\x1F]') { $rootname = '' }
          if ($rootname.Length -gt 100) { $rootname = '' }
          if ($rootname -match '\A[-.]') { $rootname = '' }
          if ($views -notmatch '\A(all|[1-4](,[1-4])*)\z') { $views = '' }
          # A clip's start and length. Seconds, nothing else: these end up on
          # an ffmpeg command line. Both or neither - a start on its own would
          # run to the end of the recording rather than to the out point.
          if ($cstart -notmatch '\A\d{1,6}(\.\d{1,3})?\z') { $cstart = '' }
          if ($cdur   -notmatch '\A\d{1,6}(\.\d{1,3})?\z') { $cdur   = '' }
          if ([double]$('0' + $cdur) -le 0) { $cdur = '' }
          if (-not ($cstart -and $cdur)) { $cstart = ''; $cdur = '' }
          # How long the whole recording runs, as the player measured it. Used
          # only to work out a percentage when ffprobe cannot read a duration
          # out of the file, so the same shape as the two above.
          if ($csecs -notmatch '\A\d{1,6}(\.\d{1,3})?\z') { $csecs = '' }
          if ([double]$('0' + $csecs) -le 0) { $csecs = '' }
          # How hard the encoder should try. Matched against the three names
          # exactly, like the tool above: this ends up in the environment of a
          # process, so anything unrecognised is dropped rather than passed on
          # and left for the batch to puzzle over.
          if ('standard','high','maximum' -notcontains $cqual) { $cqual = '' }
          # Whether to stack the vehicle status strip under the view. One of
          # two characters or nothing at all - it ends up in a process's
          # environment, so it is matched, not pattern-checked.
          if ('0','1' -notcontains $cstrip) { $cstrip = '' }
          # Percentages off the top and bottom of a straightened picture.
          # Whole numbers 0-45, the same limit the player's own sliders have;
          # anything else is dropped rather than argued with.
          if ($ctrimt -notmatch '\A([0-9]|[1-3][0-9]|4[0-5])\z') { $ctrimt = '' }
          if ($ctrimb -notmatch '\A([0-9]|[1-3][0-9]|4[0-5])\z') { $ctrimb = '' }
          # When the first exported frame was recorded, as an epoch second, so
          # the tool can draw the time of day onto the picture. Digits only and
          # a plausible length: it ends up inside an ffmpeg filter expression,
          # where a stray character would not be a wrong time but a failed run.
          if ($cclock -notmatch '\A\d{9,11}\z') { $cclock = '' }
          # Where each camera sits in a frame that is not a grid. Rectangles
          # and two separators, nothing else: these are spliced straight into
          # an ffmpeg filter graph, so the shape is checked exactly rather than
          # merely cleaned. x:y:w:h, pieces of one camera joined by commas,
          # cameras by semicolons - at most eight of each, which is far more
          # than any recorder here has and still a bounded string.
          $rect = '\d{1,5}:\d{1,5}:\d{1,5}:\d{1,5}'
          $pieces = "$rect(,$rect){0,7}"
          if ($clanes -notmatch "\A$pieces(;$pieces){0,7}\z") { $clanes = '' }
          if ($cstriprect -notmatch "\A$pieces\z") { $cstriprect = '' }
          # The strip belongs to the lanes: without them there is no frame
          # being described and nothing for it to sit under.
          if (-not $clanes) { $cstriprect = '' }
          $tool = Join-Path $root 'Run-Tool.ps1'
          $pargs = @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden',
                     '-File',"`"$tool`"",'-Tool',$ctool,'-Quiet')
          if ($name)  { $pargs += @('-Name',"`"$name`"") }
          if ($views)  { $pargs += @('-Views',$views) }
          if ($reldir) { $pargs += @('-Dir',"`"$reldir`"") }
          if ($rootname) { $pargs += @('-Root',"`"$rootname`"") }
          if ($cstart) { $pargs += @('-Start',$cstart) }
          if ($cdur)   { $pargs += @('-Dur',$cdur) }
          if ($csecs)  { $pargs += @('-Secs',$csecs) }
          if ($cqual)  { $pargs += @('-Quality',$cqual) }
          if ($cstrip) { $pargs += @('-StatusStrip',$cstrip) }
          if ($ctrimt) { $pargs += @('-TrimTop',$ctrimt) }
          if ($ctrimb) { $pargs += @('-TrimBottom',$ctrimb) }
          if ($cclock) { $pargs += @('-ClockAt',$cclock) }
          if ($clanes) { $pargs += @('-Lanes',$clanes) }
          if ($cstriprect) { $pargs += @('-StripAt',$cstriprect) }
          if ($ctoken) { $pargs += @('-Token',$ctoken) }
          try {
            # Hidden: the player shows the progress and the result now. Nothing
            # in the tool may wait for a keypress in this mode - see -Quiet.
            Start-Process -FilePath $psExe -ArgumentList $pargs `
                          -WorkingDirectory $root -WindowStyle Hidden
            $body = 'started'
          } catch {
            $status = '500 Internal Server Error'
            $body   = 'could not start the split tool'
          }
          $type = 'text/plain'
        }
        # The page has just opened a folder and left a mark in it. Go and
        # find that mark now, while nobody is waiting, so the first export
        # does not have to stop and ask where the recordings are.
        '/locate'        {
          $ltok = ''; $lroot = ''
          foreach ($pair in $query.Split('&')) {
            if ($pair -like 'token=*') { $ltok  = [Uri]::UnescapeDataString($pair.Substring(6)) }
            if ($pair -like 'root=*')  { $lroot = [Uri]::UnescapeDataString($pair.Substring(5)) }
          }
          if ($ltok -notmatch '\A[0-9a-f]{8,32}\z') { $ltok = '' }
          # Same handling as the split route: a folder NAME, never a path.
          if ($lroot) { $lroot = $lroot -replace '[\\/]', '' }
          if ($lroot -match '[:*?"<>|]' -or $lroot -match '[\x00-\x1F]') { $lroot = '' }
          if ($lroot.Length -gt 100 -or $lroot -match '\A[-.]') { $lroot = '' }
          $type = 'text/plain'; $body = 'no token'
          if ($ltok) {
            # Clear the last answer first: without this the page can read the
            # previous run's result and believe the new folder was found.
            try { Remove-Item (Join-Path $env:LOCALAPPDATA 'DashcamPlayer\locate.json') -ErrorAction SilentlyContinue } catch { }
            $tool = Join-Path $root 'Run-Tool.ps1'
            $pargs = @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden',
                       '-File',"`"$tool`"",'-Tool','locate','-Quiet','-Token',$ltok)
            if ($lroot) { $pargs += @('-Root',"`"$lroot`"") }
            try {
              try   { Start-Process -FilePath $psExe -ArgumentList $pargs -WindowStyle Hidden | Out-Null }
              catch { Start-Process -FilePath $psExe -ArgumentList $pargs | Out-Null }
              $body = 'looking'
            } catch { $body = 'could not start the search' }
          }
        }
        # What the search made of the mark. Read by the page so that a
        # failure to find the folder is said out loud rather than discovered
        # when an export stops and asks.
        # The search could not find it and the page is asking outright. A
        # folder dialog, visible, started now - not hidden, or it would open
        # behind everything with no taskbar entry.
        '/pick-folder'   {
          $type = 'text/plain'; $body = 'asking'
          try { Remove-Item (Join-Path $env:LOCALAPPDATA 'DashcamPlayer\locate.json') -ErrorAction SilentlyContinue } catch { }
          $tool = Join-Path $root 'Run-Tool.ps1'
          try {
            Start-Process -FilePath $psExe `
              -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$tool`"",'-Tool','pick') `
              -WorkingDirectory $root
          } catch { $status = '500 Internal Server Error'; $body = 'could not open the folder dialog' }
        }
        '/locate-status' {
          $lf = Join-Path $env:LOCALAPPDATA 'DashcamPlayer\locate.json'
          $body = '{"state":"looking"}'
          try { if (Test-Path $lf) { $body = [IO.File]::ReadAllText($lf).TrimStart([char]0xFEFF) } } catch { }
          if ([string]::IsNullOrWhiteSpace($body)) { $body = '{"state":"looking"}' }
          $type = 'application/json'
        }
        '/split-status'  {
          # Written by Run-Tool.ps1 at every exit path. Missing means the tool
          # has been launched but has not reported yet.
          $sf = Join-Path $env:LOCALAPPDATA 'DashcamPlayer\split-status.json'
          $body = '{"state":"starting"}'
          try { if (Test-Path $sf) { $body = [IO.File]::ReadAllText($sf).TrimStart([char]0xFEFF) } } catch { }
          if ([string]::IsNullOrWhiteSpace($body)) { $body = '{"state":"starting"}' }
          # Splice in how far along it is. Show-Progress.ps1 writes that
          # separately, as it is a different process from the one that
          # records the result.
          $pf = Join-Path $env:LOCALAPPDATA 'DashcamPlayer\split-progress.txt'
          try {
            $t = $body.TrimEnd()
            # Longer than "{}", or there is nothing to add the figure to and
            # the result would be '{,"percent":5}'. And exactly ONE closing
            # brace comes off: TrimEnd('}') removes every one it finds, so a
            # status that ever nested an object would be truncated into
            # something the page cannot parse at all.
            if ((Test-Path $pf) -and $t.Length -gt 2 -and $t.EndsWith('}')) {
              $raw = (Get-Content $pf -First 1)
              $n = 0
              if ([int]::TryParse(($raw -replace '[^0-9]',''), [ref]$n)) {
                if ($n -lt 0) { $n = 0 }
                if ($n -gt 100) { $n = 100 }
                $body = $t.Substring(0, $t.Length - 1) + ',"percent":' + $n + '}'
              }
            }
          } catch { }
          $type = 'application/json'
        }
        # Open the folder the last run wrote into.
        #
        # The page sends nothing: no path, no parameters. It could not supply
        # one if it wanted to - it is never told where a file lives - and
        # taking a path from a web page and handing it to Explorer is not a
        # trade worth making for a convenience. The folder is read back out
        # of the status file the tool itself wrote, and opened only if it is
        # a directory that really exists.
        # Stop a run that is under way. The process id comes from the status
        # file the TOOL wrote - never from the page, which has no business
        # naming a process to kill and is never asked to. Same rule as
        # /reveal, and for the same reason: a page that could name one could
        # name any of them.
        #
        # The whole tree goes, not just the launcher: ffmpeg is a grandchild
        # of it, by way of cmd, and killing the parent alone would leave the
        # encode running with nothing watching it.
        '/cancel-split'  {
          $type = 'text/plain'; $body = 'nothing running'
          try {
            $sf = Join-Path $env:LOCALAPPDATA 'DashcamPlayer\split-status.json'
            if (Test-Path $sf) {
              $j = [IO.File]::ReadAllText($sf).TrimStart([char]0xFEFF) | ConvertFrom-Json
              $st = [string]$j.state
              $procId = 0
              # -as [int] rather than a cast: a missing or junk value gives
              # $null instead of throwing, and 0 is never a process worth
              # killing anyway.
              if ($j.pid) { $procId = ($j.pid -as [int]) }
              # The id in that file names a process that was alive when the
              # tool wrote it. Windows reuses process ids, and a tool killed
              # with its session leaves "running" behind for ever - so an id
              # read from a stale file can name something else entirely by
              # now, and this kills a whole process TREE with /T /F.
              #
              # What settles it is when the process started. The tool wrote
              # its status after starting, so its own process must have begun
              # BEFORE that line was written; anything that started after it
              # has merely inherited the number. A few seconds of slack for
              # clocks, and the name has to be a PowerShell host besides.
              $sane = $false
              if ($procId -gt 0) {
                try {
                  $when = [datetime]$j.at
                  $proc = Get-Process -Id $procId -ErrorAction Stop
                  $sane = ($proc.StartTime -le $when.AddSeconds(5)) -and
                          ($proc.ProcessName -in @('powershell','pwsh'))
                } catch { $sane = $false }
              }
              if (($st -eq 'running' -or $st -eq 'starting') -and $sane) {
                # Not Stop-Process: it does not take the children with it.
                Start-Process -FilePath $taskKill `
                  -ArgumentList @('/PID', "$procId", '/T', '/F') `
                  -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
                # The tool cannot say so itself - it is gone - so this does.
                $o = [ordered]@{ state = 'cancelled'; tool = [string]$j.tool
                                 file = [string]$j.file; views = [string]$j.views
                                 detail = 'stopped at your request'
                                 outdir = [string]$j.outdir
                                 at = (Get-Date).ToString('o') }
                [IO.File]::WriteAllText($sf, ($o | ConvertTo-Json -Compress),
                                        (New-Object Text.UTF8Encoding($false)))
                $body = 'ok'
              }
            }
          } catch { $body = 'nothing running' }
        }
        '/reveal'        {
          $type = 'text/plain'; $body = 'no folder'
          try {
            $sf = Join-Path $env:LOCALAPPDATA 'DashcamPlayer\split-status.json'
            if (Test-Path $sf) {
              $j = [IO.File]::ReadAllText($sf).TrimStart([char]0xFEFF) | ConvertFrom-Json
              $d = [string]$j.outdir
              if ($d -and (Test-Path -LiteralPath $d -PathType Container)) {
                Start-Process -FilePath $explorer -ArgumentList "`"$d`"" | Out-Null
                $body = 'ok'
              }
            }
          } catch { $body = 'no folder' }
        }
        # Show one recording in File Explorer, from the path shown under the
        # picture.
        #
        # /reveal above takes NOTHING from the request, on the principle that
        # a page which can name a folder to open can name any folder. This one
        # has to be told which file, so it is written to that same principle a
        # different way: the page sends a name and a folder RELATIVE to the
        # one the helper located for itself, and the base comes from the
        # helper's own memo, never from the request. The page could not send a
        # path if it wanted to - it has none - and this will not accept one.
        #
        # It is the same pair of values /split already takes, checked the same
        # way, and /split does a great deal more with them than open a window.
        '/reveal-file'   {
          $type = 'text/plain'; $body = 'not found'
          $rname = ''; $rdir = ''; $dirSent = $false
          foreach ($pair in $query.Split('&')) {
            if ($pair -like 'name=*') { $rname = [Uri]::UnescapeDataString($pair.Substring(5)) }
            if ($pair -like 'dir=*')  { $rdir  = [Uri]::UnescapeDataString($pair.Substring(4)); $dirSent = $true }
          }
          # The same allowlists the split route uses, and for the same reason:
          # an allowlist rather than a list of forbidden characters, \A and \z
          # rather than ^ and $ because .NET lets "$" match before a trailing
          # newline that %0A would have put there.
          if ($rname) { $rname = Split-Path -Leaf $rname }
          if ($rname -notmatch '\A[A-Za-z0-9 ._-]{1,150}\z') { $rname = '' }
          # A leading dash, refused exactly as the split route refuses it.
          # It is harmless in the one call below - the path handed over is
          # absolute and quoted - but a field checked one way in one route and
          # another way in the next is how a gap gets left later. No recorder
          # writes such a name.
          if ($rname -match '\A-') { $rname = '' }
          if ($rdir -match '\.\.' -or $rdir -match '[:\\*?"<>|]' -or $rdir.Length -gt 200) { $rdir = '' }
          if ($rdir -and $rdir -notmatch '\A[A-Za-z0-9 ._/-]{1,200}\z') { $rdir = '' }
          # A folder that was asked for and did not survive those checks ends
          # the request. Elsewhere a rejected hint is simply dropped, because
          # the tool has other ways to find the file; here dropping it would
          # resolve the name against the TOP of the located folder instead -
          # so asking for a file in a folder that is refused would open a
          # different file of the same name, and look as though it had worked.
          if ($dirSent -and -not $rdir) { $rname = '' }
          # Where the folder the page has open actually is. Written by the
          # locate tool after it found the page's own mark - this is the one
          # value here that says anything about the disk, and the request has
          # no say in it.
          $base = ''
          try {
            $memo = Join-Path $env:LOCALAPPDATA 'DashcamPlayer\lastfolder.txt'
            if (Test-Path $memo) { $base = (Get-Content $memo -First 1).Trim() }
          } catch { $base = '' }
          if ($rname -and $base -and (Test-Path -LiteralPath $base -PathType Container)) {
            try {
              # The separator asked for by name rather than spelled out. It is
              # a backslash on Windows, which is the only place this ever
              # runs; writing it that way instead lets the containment check
              # below be exercised by the test suite, which does not run on
              # Windows and could otherwise only read it.
              $sep = [IO.Path]::DirectorySeparatorChar
              $full = $base
              if ($rdir) { $full = Join-Path $full ($rdir -replace '/', $sep) }
              $full = Join-Path $full $rname
              # Canonicalised and then checked to be still inside the base.
              # The allowlists above already refuse "..", a drive letter and a
              # backslash; this is the belt to their braces, and it is cheap.
              $fp = [IO.Path]::GetFullPath($full)
              $bp = [IO.Path]::GetFullPath($base)
              if (-not $bp.EndsWith($sep)) { $bp = $bp + $sep }
              if ($fp.StartsWith($bp, [StringComparison]::OrdinalIgnoreCase) -and
                  (Test-Path -LiteralPath $fp -PathType Leaf)) {
                # /select, so the file is highlighted rather than the folder
                # merely opened. Start-Process with -ArgumentList does not go
                # through cmd, so nothing in the name can be read as a command.
                Start-Process -FilePath $explorer -ArgumentList "/select,`"$fp`"" | Out-Null
                $body = 'ok'
              }
            } catch { $body = 'not found' }
          }
        }
        # Is ffmpeg here, and could we fetch it? Read fresh each time: the
        # answer changes under this process the moment winget finishes.
        '/ffmpeg'        {
          Sync-EnvPath
          $have = [bool]((Find-OnPath 'ffmpeg') -and (Find-OnPath 'ffprobe'))
          $st = 'idle'; $detail = ''
          try {
            if (Test-Path $ffmpegState) {
              $j = [IO.File]::ReadAllText($ffmpegState).TrimStart([char]0xFEFF) | ConvertFrom-Json
              if ($j.state)  { $st = [string]$j.state }
              if ($j.detail) { $detail = [string]$j.detail }
            }
          } catch { }
          # What is on the PATH now settles it. A status file saying "running"
          # from an install that died with the last session would otherwise
          # leave the page waiting for a process that is not there.
          if ($have -and $st -ne 'running') { $st = 'done' }
          $o = [ordered]@{ ffmpeg = $have
                           winget = [bool](Find-OnPath 'winget')
                           state  = $st
                           detail = $detail }
          $body = ($o | ConvertTo-Json -Compress); $type = 'application/json'
        }
        # Fetch it. The work happens in its own process, so this loop stays
        # free to answer the page while winget runs for a minute or two.
        '/install-ffmpeg' {
          $type = 'text/plain'
          $body = Start-FfmpegInstall
          if ($body -eq 'missing-script') {
            $status = '500 Internal Server Error'; $body = 'the install script is missing'
          } elseif ($body -eq 'error') {
            $status = '500 Internal Server Error'; $body = 'could not start the installer'
          }
        }
        # So the launcher can ask what is holding the port before reusing it.
        # A helper older than this returns the whole page here instead, which
        # is why the launcher only accepts a bare version number.
        '/version'       { $body = $ServerVersion; $type = 'text/plain' }
        '/manifest.json' { $body = $manifest;   $type = 'application/manifest+json' }
        '/icon.svg'      { $body = $icon;       $type = 'image/svg+xml' }
        '/favicon.ico'   { $body = $icon;       $type = 'image/svg+xml' }
        default          {
          # The token goes in as the page is served, so it never sits on disk.
          # The version goes in beside it, so the page can tell whether this
          # process is older than the file it just served.
          $body = ([IO.File]::ReadAllText($page)).
                    Replace('__DCP_TOKEN__', $token).
                    Replace('__DCP_SRVVER__', $ServerVersion)
          $type = 'text/html; charset=utf-8'
        }
      }

      $bytes  = [Text.Encoding]::UTF8.GetBytes($body)
      $header = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`n${secHeaders}Connection: close`r`n`r`n"
      $hb = [Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($hb, 0, $hb.Length)
      if ($bytes.Length -gt 0) { $stream.Write($bytes, 0, $bytes.Length) }
      $stream.Flush()
      $client.Close()
    } catch {
      if ($client) { try { $client.Close() } catch {} }
    }
  } else {
    Start-Sleep -Milliseconds 200
  }

  # Nothing ever connected - the browser failed to open, or the window
  # was closed before the page loaded. Do not wait forever.
  if (-not $Persist -and -not $seen -and ((Get-Date) - $started).TotalSeconds -gt 180) {
    Write-Host "  No page connected - shutting down."
    break
  }

  if (-not $Persist -and $seen -and (Get-Date) -gt $grace) {
    if (((Get-Date) - $last).TotalSeconds -gt $IdleSeconds) {
      Write-Host "  App closed - shutting down."
      break
    }
  }
}

$listener.Stop()
try { if (Test-Path $pidFile) { Remove-Item $pidFile -Force -ErrorAction SilentlyContinue } } catch { }
