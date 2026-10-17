# Where the files land is read out of the batch file rather than written down
# a second time here. The documentation invites people to edit "set OUT=" at
# the top of those scripts, and a path the player offers to open had better be
# the one the files actually went to.
# Found from this script's own location, so the suite travels with the
# repository instead of pointing at one machine's folders.
$Src = if ($env:DCP_SRC) { $env:DCP_SRC } else { (Resolve-Path (Join-Path $PSScriptRoot '../src')).Path }

$P = $Src
$src = Get-Content "$P/Run-Tool.ps1" -Raw
Invoke-Expression ([regex]::Match($src,'(?ms)^function Get-OutDirName.*?^\}').Value)

$bad = 0
function Want([string]$what,[string]$got,[string]$expect) {
  if ($got -ne $expect) { $script:bad++; "  $what -> '$got', wanted '$expect'" }
}

Want 'split-views.bat'   (Get-OutDirName "$P/split-views.bat")     'split'
Want 'rectify-fisheye.bat'(Get-OutDirName "$P/rectify-fisheye.bat") 'rectified'

# Missing files fall back by name, and quietly - no error on the console.
$err = $null
try { $r = Get-OutDirName '/no/such/split-views.bat' -ErrorVariable err 2>&1 } catch { $r = 'THREW' }
Want 'missing split'     $r 'split'
Want 'missing rectify'   (Get-OutDirName '/no/such/rectify-fisheye.bat') 'rectified'

# An edited batch is the whole reason this reads the file at all.
$t = Join-Path ([IO.Path]::GetTempPath()) ('ob_' + [guid]::NewGuid().ToString('N').Substring(0,6) + '.bat')
$q = [char]34
Set-Content -LiteralPath $t -Value @('@echo off', "set ${q}OUT=my clips${q}", 'rem end')
Want 'an edited batch'   (Get-OutDirName $t) 'my clips'

# A batch with no OUT line at all.
Set-Content -LiteralPath $t -Value @('@echo off','rem nothing here')
Want 'no OUT line'       (Get-OutDirName $t) 'split'
Remove-Item -LiteralPath $t -Force -ErrorAction SilentlyContinue

# --- and where that folder hangs off ---------------------------------------
# Exports go to one folder at the top of whatever was opened, not beside the
# recordings. The top is worked out by taking the relative path the page sent
# back off the folder the recording was found in - so a card opened at its
# root puts the exports at the root, however deep the recording sat.
$fn = [regex]::Match($src, '(?ms)^\$EXPORTS = .*?^\$script:outDir = \$exportRoot[^\r\n]+').Value
if (-not $fn) { $script:bad++; '  the export folder is not worked out at all' }
else {
  function Where-Exports([string]$workDir, [string]$Dir, [string]$leaf) {
    $bat = 'x'
    # The real lines, run with the two inputs they depend on.
    Invoke-Expression ($fn -replace '\(Get-OutDirName \$bat\)', "'$leaf'")
    return $script:outDir
  }
  $E = 'Dashcam and Sentry exports'
  Want 'card opened at its root' `
    (Where-Exports 'F:\DCIM\EVCam_Video' 'DCIM/EVCam_Video' 'split') "F:\$E\split"
  Want 'one folder down' `
    (Where-Exports 'D:\cards\oct\DCIM\EVCam_Video' 'DCIM/EVCam_Video' 'split') "D:\cards\oct\$E\split"
  Want 'the recordings folder itself opened' `
    (Where-Exports 'F:\DCIM\EVCam_Video' '' 'split') "F:\DCIM\EVCam_Video\$E\split"
  Want 'rectify, same place' `
    (Where-Exports 'F:\DCIM\EVCam_Video' 'DCIM/EVCam_Video' 'rectified') "F:\$E\rectified"
  # A relative path that does not match where the file was found is a hint
  # that was wrong; writing somewhere unrelated would be worse than writing
  # beside the recordings.
  Want 'a hint that does not fit' `
    (Where-Exports 'F:\Movies' 'DCIM/EVCam_Video' 'split') "F:\Movies\$E\split"
}

# The batch has to accept it, or none of the above reaches ffmpeg.
foreach ($b in 'split-views.bat','rectify-fisheye.bat') {
  $t = Get-Content "$P/$b" -Raw
  if ($t -notmatch 'if defined DCP_OUT set "OUT=%DCP_OUT%"') {
    $script:bad++; "  $b ignores the folder it is given"
  }
}
if ($src -notmatch '\$env:DCP_OUT = \$script:outDir') { $script:bad++; '  the launcher never passes the folder on' }
if ($src -notmatch "(?s)finally \{.*?DCP_OUT\s*=\s*''") { $script:bad++; '  DCP_OUT is left set after the run' }

if ($bad) { "FAIL: $bad problem(s)"; exit 1 }
'the output folder is read from the batch, and hangs off the top of what was opened'
exit 0
