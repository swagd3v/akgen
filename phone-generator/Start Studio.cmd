@echo off
setlocal
cd /d "%~dp0"
set "POCKET_NODE="
for /f "delims=" %%N in ('where.exe node.exe 2^>nul') do if not defined POCKET_NODE set "POCKET_NODE=%%N"
if defined POCKET_NODE goto launch
if exist "%ProgramFiles%\nodejs\node.exe" set "POCKET_NODE=%ProgramFiles%\nodejs\node.exe"
if defined POCKET_NODE goto launch
if exist "%LocalAppData%\Programs\nodejs\node.exe" set "POCKET_NODE=%LocalAppData%\Programs\nodejs\node.exe"
if defined POCKET_NODE goto launch
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "POCKET_NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if defined POCKET_NODE goto launch
echo Pocket Studio could not find Node.js.
echo Install Node.js, then reopen this launcher.
echo The launcher checks PATH and the standard Node.js installation folders.
pause
exit /b 1

:launch
echo Starting Pocket Studio...
echo Keep this window open while using the studio.
echo.
"%POCKET_NODE%" scripts\serve.mjs --open
if errorlevel 1 (
  echo.
  echo If the address is already in use, open http://127.0.0.1:4317 in your browser.
  pause
)
