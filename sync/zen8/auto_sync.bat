@echo off
echo [%date% %time%] ZEN8 Auto Sync Starting...
"C:\Users\Admin\AppData\Local\Programs\Python\Python312\python.exe" "C:\Users\Admin\Desktop\Agentic-AI-Levelup\sync\zen8\zen8_sync.py" --orders --ads --days 1
echo [%date% %time%] ZEN8 Auto Sync Done.
