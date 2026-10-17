# A failed run must say WHY. It reported "exit 1" once and that told nobody
# anything - the real message was sitting in ffmpeg's stderr with nowhere to go.
# Found from this script's own location, so the suite travels with the
# repository instead of pointing at one machine's folders.
$Src = if ($env:DCP_SRC) { $env:DCP_SRC } else { (Resolve-Path (Join-Path $PSScriptRoot '../src')).Path }

# $launcher, not $src: PowerShell variable names are case-insensitive, so
# $src IS $Src - and assigning the file's CONTENTS to it silently destroyed
# the source PATH two lines above. Everything that read $Src afterwards got
# a wall of PowerShell instead of a directory, found nothing, and said so.
$launcher = Get-Content "$Src/Run-Tool.ps1" -Raw
foreach ($fn in 'Select-ErrorLine','Get-FailureReason') {
  Invoke-Expression ([regex]::Match($launcher,"(?ms)^function $fn.*?^\}").Value)
}

$tmp = [IO.Path]::GetTempFileName()
$bad = 0
function Want([string]$what,[string]$got,[string]$expect) {
  if ($got -notlike $expect) { $script:bad++; "  $what -> '$got', wanted like '$expect'" }
}

# The real failure this was built for.
@(
 '[AVHWDeviceContext @ 0x1] Cannot load libcuda.so.1'
 'Device creation failed: -1.'
 "[AVFilterGraph @ 0x2] No such filter: '" + [char]0xFEFF + "color'"
 "Failed to set value 'f.txt' for option 'filter_complex_script': Filter not found"
) | Set-Content -LiteralPath $tmp
# The line that NAMES the problem, not the hardware probes above it nor the
# summary below it that drops the name.
Want 'names the filter' (Get-FailureReason $tmp 1) "*No such filter*(exit 1)*"

@(
 '[AVHWDeviceContext @ 0x1] Cannot load libcuda.so.1'
 'Device creation failed: -1.'
 "Error applying option 'fill' to filter 'remap': Option not found"
 '[vost#0:0/wrapped_avframe @ 0x2] Error initializing a simple filtergraph'
 'Error opening output file -.'
 'Error opening output files: Option not found'
) | Set-Content -LiteralPath $tmp
Want 'names the option' (Get-FailureReason $tmp 1) "*'fill' to filter 'remap'*"

# Nothing but noise and summaries: say something rather than nothing.
@('Device creation failed: -1.','Error parsing global options: Option not found') |
  Set-Content -LiteralPath $tmp
Want 'noise only' (Get-FailureReason $tmp 1) '*Option not found*(exit 1)*'

# Success never carries a reason.
Want 'success' (Get-FailureReason $tmp 0) 'exit 0'

# Nothing to read: fall back to the code rather than an empty panel.
Set-Content -LiteralPath $tmp -Value @('','   ','')
Want 'blank file' (Get-FailureReason $tmp 1) 'exit 1'
Want 'missing file' (Get-FailureReason "$tmp.nope" 3) 'exit 3'
Want 'no file named' (Get-FailureReason '' 3) 'exit 3'

# A wall of text must not become the panel.
Set-Content -LiteralPath $tmp -Value ('x' * 900)
$long = Get-FailureReason $tmp 1
if ($long.Length -gt 330) { $bad++; "  long line not trimmed: $($long.Length) chars" }
Want 'long line' $long '*...*(exit 1)'

# --- boilerplate is still a reason -----------------------------------------
# The noise list exists to skip the lines in FRONT of a real message. When a
# hardware encoder fails to come up, boilerplate is all there is - three lines,
# every one of them on the list - and the filter threw the lot away and left
# the panel saying "exit 1" and nothing else. That is the failure this whole
# file exists to prevent, arrived at from the other direction.
$allNoise = @(
 '[AVHWDeviceContext @ 000001f] Could not dynamically load CUDA',
 '[AVHWDeviceContext @ 000001f] Device creation failed: -1313558101.',
 '[h264_nvenc @ 000002a] Cannot load libcuda.so.1'
)
$got = Select-ErrorLine $allNoise
if (-not $got) { $bad++; '  every line was noise, so nothing was reported at all' }
Want 'all-noise' $got '*Cannot load*'
Set-Content -LiteralPath $tmp -Value $allNoise
Want 'all-noise reason' (Get-FailureReason $tmp 1) '*Cannot load*(exit 1)*'

# A real message still wins over the boilerplate around it.
Want 'real beats noise' (Select-ErrorLine @(
 '[AVHWDeviceContext @ 1] Could not dynamically load CUDA',
 '[h264_nvenc @ 2] InitializeEncoder failed: invalid param (8)',
 'Conversion failed!')) '*InitializeEncoder failed*'

# And genuinely nothing is still nothing - no inventing a reason.
if (Select-ErrorLine @()) { $bad++; '  a reason was invented from an empty log' }
if (Select-ErrorLine @('', '   ')) { $bad++; '  blank lines were reported as a reason' }

Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue

# --- and the tools must actually PUT something there ------------------------
# The launcher reads a file the batch is supposed to have written. Everything
# above tests the reading. Neither half is any use alone, and for a long time
# only one of the two tools wrote anything: the fisheye tool sent ffmpeg's
# stderr to a console that does not exist when the player runs it hidden, so
# a failed rectify could only ever report "exit 1". BOTH are checked here.
foreach ($batch in 'split-views.bat','rectify-fisheye.bat') {
  $txt = Get-Content "$Src/$batch" -Raw
  if ($txt -notmatch '(?m)^set "ERRF=%DCP_ERRFILE%"') {
    $bad++; "  $batch does not take the error file the launcher names"
  }
  # Before the pipe, not after: only stdout goes to the progress reader, and
  # a redirect on the wrong side of the pipe captures nothing.
  if ($txt -notmatch '2>"!ERRF!"\s*\|') {
    $bad++; "  $batch does not send ffmpeg's stderr to that file ahead of the pipe"
  }
  # Written down is not the same as said. A run from the Start menu has a
  # console, and the words belong on it too.
  if ($txt -notmatch 'if exist "!ERRF!" type "!ERRF!"') {
    $bad++; "  $batch never repeats what ffmpeg said when the run fails"
  }
  # Which encoder, with its exact options. The quality levels differ only in
  # numbers for most encoders, so "it fails at one and not another" cannot be
  # acted on without knowing what was actually handed to ffmpeg.
  if ($txt -notmatch '>>"!ERRF!" echo encoder %ENC%') {
    $bad++; "  $batch does not record which encoder it used when the run fails"
  }
}

if ($bad) { "FAIL: $bad problem(s)"; exit 1 }
'a failed run reports what ffmpeg said, not just the exit code, from either tool'
exit 0
