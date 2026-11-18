@echo off
setlocal
cd /d "%~dp0"
set "AK_GH=C:\Program Files\GitHub CLI\gh.exe"
if exist "%AK_GH%" goto cli_ready
set "AK_GH=gh"
where gh >nul 2>nul
if errorlevel 1 (
  echo GitHub CLI was not found. Install it, then run this file again.
  goto failed
)
:cli_ready
"%AK_GH%" auth status --hostname github.com
if errorlevel 1 (
  echo Sign in to GitHub to continue.
  "%AK_GH%" auth login --hostname github.com --git-protocol https --web
  if errorlevel 1 goto failed
)
"%AK_GH%" api user --jq .login > "%TEMP%\ak-studio-github-account.txt"
if errorlevel 1 goto failed
set /p AK_ACCOUNT=<"%TEMP%\ak-studio-github-account.txt"
if /i not "%AK_ACCOUNT%"=="swagd3v" (
  echo Expected the swagd3v account. Switch GitHub CLI accounts and try again.
  goto failed
)
"%AK_GH%" auth setup-git --hostname github.com
if errorlevel 1 goto failed
"%AK_GH%" repo view swagd3v/ak-studio >nul 2>nul
if errorlevel 1 (
  "%AK_GH%" repo create swagd3v/ak-studio --private --source . --remote origin --push
  if errorlevel 1 goto failed
  goto finished
)
git remote get-url origin > "%TEMP%\ak-studio-github-origin.txt" 2>nul
if errorlevel 1 (
  git remote add origin https://github.com/swagd3v/ak-studio.git
  if errorlevel 1 goto failed
) else (
  findstr /x /c:"https://github.com/swagd3v/ak-studio.git" /c:"https://github.com/swagd3v/ak-studio" /c:"git@github.com:swagd3v/ak-studio.git" "%TEMP%\ak-studio-github-origin.txt" >nul
  if errorlevel 1 (
    echo This folder has a different origin remote. No push was attempted.
    goto failed
  )
)
git push -u origin main
if errorlevel 1 goto failed
:finished
echo.
echo Uploaded successfully: https://github.com/swagd3v/ak-studio
pause
exit /b 0
:failed
echo.
echo Upload did not finish. Keep this window open and share the error above.
pause
exit /b 1
