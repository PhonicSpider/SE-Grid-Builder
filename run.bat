@echo off
REM Starts SE Grid Builder as a desktop app (development mode).
REM The first launch compiles the Rust part and can take a few minutes;
REM later launches take seconds. Close the app window to stop it.

REM Always work from the folder this file is in, wherever it was started from.
cd /d "%~dp0"

REM Install the web dependencies the first time (or if node_modules was deleted).
if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed. Is Node.js installed?
        pause
        exit /b 1
    )
)

REM The app's development server needs port 1420. If an older one is still
REM running (for example from a previous session) the app cannot start, so
REM say so clearly instead of showing a confusing error.
netstat -ano | findstr /R /C:":1420 .*LISTENING" >nul
if not errorlevel 1 (
    echo.
    echo Port 1420 is already in use, probably by an older SE Grid Builder
    echo development server. Close that window, or find and stop it with:
    echo.
    echo     netstat -ano ^| findstr :1420
    echo     taskkill /PID ^<the number at the end of that line^> /F
    echo.
    pause
    exit /b 1
)

echo Starting SE Grid Builder...
call npm run tauri dev

REM Keep the window open so any error stays readable.
echo.
echo SE Grid Builder has stopped.
pause
