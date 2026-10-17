# The percentage, measured by running the real script.
#
# Show-Progress.ps1 turns ffmpeg's -progress stream into a percentage by
# dividing by the recording's length, which the batch gets from ffprobe. For
# some recordings ffprobe cannot answer, and with nothing to divide by there
# was no percentage at all: the player showed "working" from the first frame
# to the last. The player knows the length - it has the file open - and now
# passes it down as a fallback.
#
# This feeds the script the lines ffmpeg really writes and reads back the file
# the player polls, rather than reasoning about the arithmetic.
$Src = if ($env:DCP_SRC) { $env:DCP_SRC } else { (Resolve-Path (Join-Path $PSScriptRoot '../src')).Path }
$script = Join-Path $Src 'Show-Progress.ps1'

$bad = 0
function Bad([string]$m) { $script:bad++; "  FAIL $m" }

# Its own LOCALAPPDATA, so a run here cannot read or write a real install's
# progress file.
$sandbox = Join-Path ([IO.Path]::GetTempPath()) ("dcp_prog_" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $sandbox -Force | Out-Null
$oldLocal = $env:LOCALAPPDATA
$oldSecs  = $env:DCP_SECS
$env:LOCALAPPDATA = $sandbox
$pctFile = Join-Path $sandbox 'DashcamPlayer\split-progress.txt'

# Ten seconds of a recording, reported the way ffmpeg reports it.
$feed = @()
foreach ($s in 1..10) {
  $feed += "frame=$($s * 25)"
  $feed += "out_time_us=$($s * 1000000)"
}
$feed += 'progress=end'

function Run([string]$seconds, [string]$hint) {
  Remove-Item $pctFile -ErrorAction SilentlyContinue
  $env:DCP_SECS = $hint
  $feed | & /opt/ps/pwsh -NoProfile -File $script -Seconds $seconds -Label 'test' | Out-Null
  if (Test-Path $pctFile) { (Get-Content $pctFile -Raw).Trim() } else { $null }
}

# 1. The ordinary case: ffprobe knew the length.
$r = Run '10' ''
if ($r -ne '100') { Bad "a measured recording did not reach 100%: got '$r'" }

# 2. ffprobe answered "N/A" - which is what started this - and the player's
#    own figure is there to fall back on.
$r = Run 'N/A' '10'
if ($r -ne '100') { Bad "the fallback length was not used when ffprobe said N/A: got '$r'" }

# 3. ffprobe answered zero, same thing.
$r = Run '0' '10'
if ($r -ne '100') { Bad "the fallback length was not used when ffprobe said 0: got '$r'" }

# 4. Neither: no percentage, and nothing invented.
$r = Run '0' ''
if ($null -ne $r) { Bad "a percentage was written with nothing to measure against: got '$r'" }

# 5. A clip measures the clip. The whole recording is 600s, the clip 10s, and
#    the hint must not drag the percentage down to 2%.
$r = Run '10' '600'
if ($r -ne '100') { Bad "the whole recording's length overrode the clip's: got '$r'" }

# 6. Part way through, the figure is the right one and not merely non-empty.
Remove-Item $pctFile -ErrorAction SilentlyContinue
$env:DCP_SECS = '20'
$half = @('out_time_us=5000000')
$half | & /opt/ps/pwsh -NoProfile -File $script -Seconds 'N/A' -Label 'test' | Out-Null
$r = if (Test-Path $pctFile) { (Get-Content $pctFile -Raw).Trim() } else { $null }
if ($r -ne '25') { Bad "five seconds into a twenty second recording read '$r', not 25" }

$env:LOCALAPPDATA = $oldLocal
$env:DCP_SECS = $oldSecs
Remove-Item $sandbox -Recurse -Force -ErrorAction SilentlyContinue

if ($bad) { "FAIL: $bad problem(s)"; exit 1 }
'the percentage is reported even when ffprobe cannot measure the recording'
exit 0
