@echo off
setlocal
cd /d "%~dp0"
title TAXIAPP v0.3.127 PR119 local preview

echo =========================================================
echo TAXIAPP v0.3.127 - Development PR119 local launch
 echo =========================================================
echo.
echo This window MUST remain open while using the local app.
echo Press a key to start. Do not close this window.
echo.
pause
if not exist "index.html" goto missing
if not exist "start-admin-firestore-preview.ps1" goto missing
where powershell.exe >nul 2>nul
if errorlevel 1 goto no_powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-admin-firestore-preview.ps1"
echo.
echo Local server ended or failed. See the error shown ABOVE.
echo You can also send a photo of this still-open window.
goto done
:missing
echo ERROR: ZIP was not fully extracted or a server file is missing.
goto done
:no_powershell
echo ERROR: Windows PowerShell is not available on this PC.
goto done
:done
echo.
echo Press a key to close this window.
pause
exit /b 0
