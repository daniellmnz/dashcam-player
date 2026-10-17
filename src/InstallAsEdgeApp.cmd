@echo off
setlocal

rem ================================================================
rem  Run once to install Dashcam Player as a Windows app in Edge.
rem
rem  Why bother: Edge only makes folder permissions PERMANENT for
rem  installed apps. Without this you re-authorise the recording
rem  folder each session. App windows have no address bar, so this
rem  opens a normal browser window where the button appears.
rem ================================================================

set "PORT=8777"
set "HERE=%~dp0"

curl.exe -s -m 2 -o nul "http://localhost:%PORT%/ping" 2>nul
if errorlevel 1 (
  start "Dashcam Player server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%dashcam-server.ps1" -Port %PORT%
  ping -n 2 127.0.0.1 >nul
)

call "%HERE%find-browser.cmd"

echo.
echo   A browser window is opening at http://localhost:%PORT%/
echo.
echo   In that window, at the right-hand end of the address bar:
echo      click the "App available" button, then Install
echo.
echo   Then choose your recording folder and pick
echo   "Allow on every visit" so it reopens by itself.
echo.

if defined BROWSER (
  start "" "%BROWSER%" "http://localhost:%PORT%/"
) else (
  start "" "http://localhost:%PORT%/"
)
pause
exit /b 0
