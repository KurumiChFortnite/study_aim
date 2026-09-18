@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  start "STUDY AIM local server" cmd /k "cd /d ""%~dp0"" && py -m http.server 8000 --bind 127.0.0.1"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo Python was not found. Install Python 3 and try again.
    pause
    exit /b 1
  )
  start "STUDY AIM local server" cmd /k "cd /d ""%~dp0"" && python -m http.server 8000 --bind 127.0.0.1"
)

timeout /t 1 /nobreak >nul
start "" "http://localhost:8000/"
endlocal
