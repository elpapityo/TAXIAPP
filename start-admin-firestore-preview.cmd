@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
rem TAXIAPP development preview: loopback-only. Never touches main deployment.
rem Requires a local Python installation, but does not install packages.
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import http.server" >nul 2>nul
  if not errorlevel 1 goto with_py
)
where python >nul 2>nul
if not errorlevel 1 (
  python -c "import http.server" >nul 2>nul
  if not errorlevel 1 goto with_python
)
where node >nul 2>nul
if not errorlevel 1 (
  node -e "require('node:http')" >nul 2>nul
  if not errorlevel 1 goto with_node
)
echo.
echo TAXIAPP local preview requires Python 3 or Node.js.
echo Neither runtime was found. No Firebase or Google data has been modified.
echo See docs for manual setup instructions.
pause
exit /b 1
:with_py
start "TAXIAPP Local Preview (close to stop)" cmd /k py -3 -m http.server 8787 --bind 127.0.0.1
goto launch
:with_python
start "TAXIAPP Local Preview (close to stop)" cmd /k python -m http.server 8787 --bind 127.0.0.1
:with_node
start "TAXIAPP Local Preview (close to stop)" cmd /k node start-admin-firestore-preview-server.js
goto launch
:launch
timeout /t 2 /nobreak >nul
start "" "http://localhost:8787/?adminFirestorePreview=1"
echo.
echo TAXIAPP development preview opened: http://localhost:8787/?adminFirestorePreview=1
echo This server is available only on this PC. Close its console window to stop.
echo The real owner's Firebase sign-in must still be verified in the browser.
exit /b 0
