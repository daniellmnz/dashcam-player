# ---------------------------------------------------------------
#  Points every Dashcam Player shortcut at the installed icon file.
#
#  Why this is needed: a shortcut created from an MSI icon table
#  resolves to a folder named after the product code, and that
#  changes with every release. Copies you made yourself - on the
#  desktop, pinned to the taskbar - are private files no installer
#  touches, so they end up pointing at an icon that is gone.
#
#  The installed DashcamPlayer.ico never moves, so pointing at it
#  directly survives every upgrade.
#
#  Runs automatically at the end of an install, detached, so that
#  nothing it does can hold the installer up. Safe to run again.
# ---------------------------------------------------------------

$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$icon = Join-Path $here 'DashcamPlayer.ico'
$ps1  = Join-Path $here 'DashcamPlayer.ps1'
if (-not (Test-Path $icon)) { exit 0 }

$places = @(
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Dashcam Player'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\StartMenu')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

$sh = New-Object -ComObject WScript.Shell
$fixed = 0

foreach ($dir in $places) {
  Get-ChildItem -Path $dir -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
    # Skip cloud placeholders. Opening one asks OneDrive to fetch the file,
    # which can block for as long as it likes - and this runs during an
    # install. 0x400000 is FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS.
    if (([int]$_.Attributes -band 0x400000) -ne 0) { return }
    try {
      $lnk = $sh.CreateShortcut($_.FullName)
      $isOurs = ($lnk.Arguments -like '*DashcamPlayer.ps1*') -or
                ($lnk.TargetPath -like '*DashcamPlayer*') -or
                ($_.BaseName -like 'Dashcam Player*')
      if ($isOurs) {
        $lnk.IconLocation = "$icon,0"
        if ($lnk.Arguments -like '*DashcamPlayer.ps1*' -and (Test-Path $ps1)) {
          $lnk.WorkingDirectory = $here
        }
        $lnk.Save()
        $fixed++
      }
    } catch { }
  }
}

Write-Host "Updated $fixed shortcut(s) to use $icon"
