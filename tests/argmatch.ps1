# The helper builds an argument list; the launcher declares what it accepts.
# Nothing checks that those two agree, and after taking a feature out it is
# exactly the kind of thing left half-removed - the helper still passing
# -Lane, the launcher no longer knowing it, and every split failing.
# Found from this script's own location, so the suite travels with the
# repository instead of pointing at one machine's folders.
$Src = if ($env:DCP_SRC) { $env:DCP_SRC } else { (Resolve-Path (Join-Path $PSScriptRoot '../src')).Path }

$P = $Src

$ast = [System.Management.Automation.Language.Parser]::ParseFile(
         "$P/Run-Tool.ps1", [ref]$null, [ref]$null)
$declared = @($ast.ParamBlock.Parameters |
              ForEach-Object { $_.Name.VariablePath.UserPath })
"launcher accepts: $($declared -join ', ')"

$srv = Get-Content "$P/dashcam-server.ps1" -Raw
$passed = @([regex]::Matches($srv, "\`$pargs \+= @\('-(\w+)'") |
            ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
"helper passes:    $($passed -join ', ')"

$bad = 0
foreach ($a in $passed) {
  if ($declared -notcontains $a) { "  FAIL: the helper passes -$a, which the launcher does not accept"; $bad++ }
}
# And the removed feature must be gone from both sides, not just one.
foreach ($gone in 'Lane','Trim','Lens','Strip','Clock') {
  if ($declared -contains $gone) { "  FAIL: -$gone is still declared"; $bad++ }
  if ($passed   -contains $gone) { "  FAIL: the helper still passes -$gone"; $bad++ }
}
foreach ($f in 'dashcam-player.html','dashcam-server.ps1','Run-Tool.ps1','split-views.bat') {
  $t = Get-Content "$P/$f" -Raw
  foreach ($token in 'asShown','DCP_FCSCRIPT','DCP_FCOPT','Build-AdjustedFilter','asshown') {
    if ($t -match [regex]::Escape($token)) { "  FAIL: $f still mentions $token"; $bad++ }
  }
}
if ($bad) { "FAIL: $bad problem(s)"; exit 1 }
'the helper and the launcher agree, and the removed feature is gone from both'
exit 0
