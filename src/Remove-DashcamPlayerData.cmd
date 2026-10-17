@echo off
setlocal

rem ================================================================
rem  Removes everything Dashcam Player leaves behind outside its
rem  install folder: the small working folder, any start-with-Windows
rem  entry left by an older version, and a reminder of the two things
rem  only you can clear from the browser.
rem ================================================================

reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "DashcamPlayerServer" /f >nul 2>&1
rem The server's process id and the folder the tools last used.
rd /s /q "%LOCALAPPDATA%\DashcamPlayer" >nul 2>&1

echo.
echo   Removed the working folder, and the start-with-Windows entry
echo   left by an older version if there was one.
echo.
echo   Two things live inside the browser and must be cleared there:
echo.
echo     1. The installed app:  edge://apps  - remove "Dashcam Player"
echo     2. Saved settings and the remembered folder, held by the
echo        page itself. Clear site data for http://localhost:8777
echo        from edge://settings/content/all
echo.
pause
exit /b 0
