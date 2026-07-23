@echo off
setlocal
cd /d "%~dp0"

echo Building Agent Homestead...
call npm.cmd run build
if errorlevel 1 (
  echo.
  echo Build failed. Check the messages above.
  pause
  exit /b 1
)

echo Starting the local Codex bridge...
start "" "http://127.0.0.1:4174"
node server.mjs

endlocal
