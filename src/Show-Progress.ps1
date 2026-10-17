param(
  [string]$Seconds = '0',
  [string]$Label   = ''
)

# ---------------------------------------------------------------
#  Turns ffmpeg's -progress stream into a single percentage.
#
#  ffmpeg is run as:  ffmpeg ... -nostats -progress pipe:1 ... | this
#  so its progress key=value lines arrive on standard input while
#  any real error still goes straight to the console on stderr.
#
#  Note that ffmpeg writes "progress=end" whether it succeeded or
#  failed, so this says nothing about the outcome - split-views.bat
#  checks the output files themselves.
# ---------------------------------------------------------------

# The player polls for this, so the percentage reaches the main window as
# well as this console.
$pctFile = Join-Path $env:LOCALAPPDATA 'DashcamPlayer\split-progress.txt'
try {
  $pctDir = Split-Path -Parent $pctFile
  if (-not (Test-Path $pctDir)) { New-Item -ItemType Directory -Path $pctDir -Force | Out-Null }
} catch { }

$inv   = [Globalization.CultureInfo]::InvariantCulture
$style = [Globalization.NumberStyles]::Float

$total = 0.0
[void][double]::TryParse($Seconds, $style, $inv, [ref]$total)
# ffprobe cannot get a duration out of every recording - it answers "N/A" for
# some, and a recorder that writes its files differently is enough to produce
# one. With nothing to divide by there was no percentage at all, and the
# player sat on "working" for the whole run with no sign of progress. The
# player knows how long the recording is, because it has been playing it, and
# passes that down as a fallback. Only a fallback: a clip's own length, which
# the tool does know, must win over the length of the whole recording.
if ($total -le 0 -and $env:DCP_SECS) {
  $hint = 0.0
  if ([double]::TryParse($env:DCP_SECS, $style, $inv, [ref]$hint) -and $hint -gt 0) { $total = $hint }
}
$totalUs = $total * 1000000.0

$pad  = '   ' + $Label + '    '
$last = -1

$line = [Console]::In.ReadLine()
while ($null -ne $line) {
  # out_time_us is microseconds. Older builds only have out_time_ms,
  # which despite the name is also microseconds.
  $v = $null
  if     ($line.StartsWith('out_time_us=')) { $v = $line.Substring(12) }
  elseif ($line.StartsWith('out_time_ms=')) { $v = $line.Substring(12) }

  if ($v -and $totalUs -gt 0) {
    $us = 0.0
    if ([double]::TryParse($v, $style, $inv, [ref]$us)) {
      # Rounded, not floored: the last frame of a long recording sits a
      # frame short of the duration and would otherwise stop at 99%.
      $pct = [int][Math]::Round($us * 100.0 / $totalUs)
      if ($pct -lt 0)   { $pct = 0 }
      if ($pct -gt 100) { $pct = 100 }
      if ($pct -ne $last) {
        $last = $pct
        Write-Host -NoNewline ("`r{0}{1,3}% " -f $pad, $pct)
        try { [IO.File]::WriteAllText($pctFile, [string]$pct) } catch { }
      }
    }
  }
  $line = [Console]::In.ReadLine()
}

if ($last -ge 0) { Write-Host '' }
