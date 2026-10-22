@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ==============================================
echo TAXIAPP v0.3.126  [Development PR #119]
echo ==============================================
echo.
echo This is the startup window. Please keep it open.
echo No Firebase or Google production data will be changed.
echo.
echo Press any key to START. If this window closes
echo BEFORE this prompt, this file is not running correctly.
pause
if not exist "index.html" goto missing_index
if not exist "start-admin-firestore-preview-server.py" goto missing_server
where py >nul 2>nul
if errorlevel 1 goto try_python
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)" >nul 2>nul
if errorlevel 1 goto try_python
echo Starting local server with Python launcher...
py -3 "start-admin-firestore-preview-server.py"
goto server_stopped

:try_python
where python >nul 2>nul
if errorlevel 1 goto try_node
python -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)" >nul 2>nul
if errorlevel 1 goto try_node
echo Starting local server with Python...
python "start-admin-firestore-preview-server.py"
goto server_stopped

:try_node
where node >nul 2>nul
if errorlevel 1 goto missing_runtime
if not exist "start-admin-firestore-preview-server.js" goto missing_server
echo Starting local server with Node.js...
node "start-admin-firestore-preview-server.js"
goto server_stopped

:missing_index
echo ERROR: index.html is not in the same folder.
echo Extract the complete GitHub ZIP before running the CMD file.
goto failed

:missing_server
echo ERROR: the preview server file is missing from this ZIP.
goto failed

:missing_runtime
echo ERROR: Python 3.9 or newer, or Node.js, was not detected.
goto failed

:server_stopped
echo.
echo The local preview server ended or could not start.
echo Check the error lines above. Port 8787 may be used by an old server.
goto failed

:failed
echo.
echo Please take a screenshot of THIS WINDOW and send it to ChatGPT.
echo The window stays open until you press a key.
pause
exit /b 1
