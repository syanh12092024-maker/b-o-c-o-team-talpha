@echo off
REM ============================================================
REM  FFM Sync Daily Runner
REM  Runs EU Shipment sync to BigQuery
REM  Scheduled: Daily at 6:00 AM (SE Asia Standard Time / VN)
REM ============================================================

cd /d D:\Stramark_ver2

REM Log start time
echo [%date% %time%] Starting FFM Sync >> logs\scheduler.log

REM Run the sync in incremental mode (V2 fix: terminal status now detected correctly)
python sync\stramark\eu_shipment_sync.py >> logs\scheduler.log 2>&1

REM Log completion
echo [%date% %time%] FFM Sync completed (exit code: %ERRORLEVEL%) >> logs\scheduler.log
echo. >> logs\scheduler.log
