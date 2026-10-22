@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 goto invalid_folder

echo ==========================================
echo TAXIAPP v0.3.126 - 開発検証版 PR #119
echo ==========================================
echo.
echo 開発サーバーが起動したら、自動でブラウザを開きます。
echo この黒いウィンドウは検証中ずっと開いたままにしてください。
echo.
if not exist "index.html" goto incomplete_zip

rem Never silently reuse another ZIP's http://localhost:8787 server.
netstat -ano | findstr /C:":8787 " | findstr /I "LISTENING" >nul
if not errorlevel 1 goto already_running

rem Use a single foreground process. Both servers launch the browser
rem ONLY after port 8787 is listening; errors remain in this window.
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys; assert sys.version_info >= (3, 9)" >nul 2>nul
  if not errorlevel 1 goto python_launcher
)
where python >nul 2>nul
if not errorlevel 1 (
  python -c "import sys; assert sys.version_info >= (3, 9)" >nul 2>nul
  if not errorlevel 1 goto python_launcher_path
)
where node >nul 2>nul
if not errorlevel 1 (
  node -e "require('node:http')" >nul 2>nul
  if not errorlevel 1 goto node_launcher
)
echo エラー：Python 3.9以降またはNode.jsが見つかりません。
echo 何もインストール・変更せず終了します。
goto failed

:python_launcher
echo Pythonを使って起動します。
py -3 "start-admin-firestore-preview-server.py"
goto finished

:python_launcher_path
echo Pythonを使って起動します。
python "start-admin-firestore-preview-server.py"
goto finished

:node_launcher
echo Node.jsを使って起動します。
node "start-admin-firestore-preview-server.js"
goto finished

:already_running
echo エラー：8787番ポートが使用中です。
echo 以前のTAXIAPP検証用の黒いウィンドウを閉じてください。
echo 古いZIPを誤表示しないため、今回のブラウザ起動を中止しました。
goto failed

:incomplete_zip
echo エラー：このBATと同じフォルダにindex.htmlがありません。
echo ZIPをすべて展開してからBATを起動してください。
goto failed

:invalid_folder
echo エラー：展開先のフォルダを開けません。
goto failed

:finished
echo.
echo 検証用サーバーが終了しました。エラーが出ていれば上の内容を確認してください。
echo 本番の日報・Google保存先・Firebase設定は変更していません。
pause
exit /b %ERRORLEVEL%

:failed
echo.
echo 原因が分かるよう、この画面を閉じずに停止しています。
pause
exit /b 1
