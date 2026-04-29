@echo off
REM ============================================================
REM  T1 Fulfillment Auto-Sync
REM  Runs fulfillment_automation.py to sync POS → euShipments
REM  Meant to be triggered by Windows Task Scheduler every 5 min
REM ============================================================

set PROJECT_DIR=c:\Users\admin\Desktop\Agentic-AI-Levelup
set PYTHON=python
set LOG_DIR=%PROJECT_DIR%\logs
set LOG_FILE=%LOG_DIR%\fulfillment_%date:~0,4%%date:~5,2%%date:~8,2%.log

REM Create logs dir if not exists
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo [%date% %time%] Starting fulfillment sync... >> "%LOG_FILE%"

cd /d "%PROJECT_DIR%"
%PYTHON% sync/t1/fulfillment_automation.py >> "%LOG_FILE%" 2>&1

echo [%date% %time%] Sync completed (exit code: %ERRORLEVEL%) >> "%LOG_FILE%"
