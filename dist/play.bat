@echo off
cd /d "%~dp0game"
echo Starting Kronkel: The Coffeeshop Game...
echo.
where python >nul 2>&1
if %errorlevel%==0 (
  start "" http://localhost:8787
  python -m http.server 8787
  goto done
)
where python3 >nul 2>&1
if %errorlevel%==0 (
  start "" http://localhost:8787
  python3 -m http.server 8787
  goto done
)
where node >nul 2>&1
if %errorlevel%==0 (
  start "" http://localhost:8787
  npx --yes serve -l 8787 .
  goto done
)
echo Neither Python nor Node.js found.
echo Install Python from https://python.org then run this file again.
pause
:done
