@echo off
REM Stramark Fulfillment Watcher — Daemon mode
REM Schedule this via Windows Task Scheduler or run with PM2
REM Usage: stramark_fulfillment_watcher.bat [--once] [--dry-run]

cd /d D:\Stramark_ver2
python sync\stramark\fulfillment_watcher.py --interval 5 %*
