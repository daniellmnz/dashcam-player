# PowerShell variable names are case-insensitive, so a local named like a
# parameter IS that parameter. Assigning to it silently destroys the argument,
# and - if the parameter carries a validator - the assignment can fail outright.
# Neither shows up in a parse check or a syntax check.
# Found from this script's own location, so the suite travels with the
# repository instead of pointing at one machine's folders.
$Src = if ($env:DCP_SRC) { $env:DCP_SRC } else { (Resolve-Path (Join-Path $PSScriptRoot '../src')).Path }

$bad = 0
foreach ($f in (Get-ChildItem $Src -Filter *.ps1)) {
  $tokens = $null; $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile(
           $f.FullName, [ref]$tokens, [ref]$errors)
  # Parameters of the script itself (not of nested functions).
  $pb = $ast.ParamBlock
  if (-not $pb) { continue }
  $params = $pb.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }
  # Assignments at script scope, excluding anything inside a function.
  $assigns = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] }, $true) |
    Where-Object {
      $fn = $_
      $inFunction = $false
      $cur = $_.Parent
      while ($cur) {
        if ($cur -is [System.Management.Automation.Language.FunctionDefinitionAst]) { $inFunction = $true; break }
        $cur = $cur.Parent
      }
      -not $inFunction
    }
  foreach ($a in $assigns) {
    $l = $a.Left
    if ($l -is [System.Management.Automation.Language.VariableExpressionAst]) {
      $n = $l.VariablePath.UserPath
      foreach ($p in $params) {
        if ($n -ieq $p -and $n -cne '') {
          "FAIL {0}:{1}  assigns `${2}, which is the `${3} parameter (names are case-insensitive)" -f `
            $f.Name, $a.Extent.StartLineNumber, $n, $p
          $script:bad++
        }
      }
    }
  }
}
# And PowerShell's own read-only variables, anywhere in the file - functions
# included. $home reads so naturally as "the user's folder" that it was used
# for exactly that; assigning to it throws, the function stops where it stands,
# and what it was supposed to do simply never happens. No parse check or
# syntax check sees it, and the error only appears at run time on the line
# that would have fixed the problem.
# Determined by trying each one rather than from memory: several names that
# look untouchable are in fact writable, and "$null = Thing" is the ordinary
# way to discard output, so a list made by guessing would fail the suite over
# perfectly good code.
$readOnly = @('home','host','pid','true','false','executioncontext','shellid',
              'psversiontable','error')
foreach ($f in (Get-ChildItem $Src -Filter *.ps1)) {
  $ast = [System.Management.Automation.Language.Parser]::ParseFile(
           $f.FullName, [ref]$null, [ref]$null)
  foreach ($a in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] }, $true)) {
    $l = $a.Left
    if ($l -isnot [System.Management.Automation.Language.VariableExpressionAst]) { continue }
    $n = $l.VariablePath.UserPath
    # $env:X and $script:X are not the automatic variable of that name.
    if ($l.VariablePath.IsDriveQualified) { continue }
    if ($readOnly -contains $n.ToLowerInvariant()) {
      "FAIL {0}:{1}  assigns `${2}, which is one of PowerShell's own read-only variables" -f `
        $f.Name, $a.Extent.StartLineNumber, $n
      $script:bad++
    }
  }
}

if ($bad -eq 0) { "ok   nothing shadows a parameter or one of PowerShell's own variables" }
exit $bad
