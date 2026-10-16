@echo off
setlocal
cd /d "%~dp0"

where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 18 or newer, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Installing Moa dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo Could not install dependencies. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

curl.exe -fsS "http://localhost:5173/" -o nul >nul 2>nul
if errorlevel 1 (
  start "Moa Notes Server" /min cmd /c "cd /d ""%~dp0"" && npm.cmd start"
  for /l %%I in (1,1,20) do (
    curl.exe -fsS "http://localhost:5173/" -o nul >nul 2>nul && goto :open_app
    timeout /t 1 /nobreak >nul
  )
  echo Could not start the Moa server. Check that port 5173 is available.
  pause
  exit /b 1
)

:open_app
start "" "http://localhost:5173"
exit /b 0
