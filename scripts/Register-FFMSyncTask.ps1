# Register-FFMSyncTask.ps1
# Creates a Windows Scheduled Task to run FFM sync daily at 6:00 AM VN time

$taskName = "Stramark_FFM_Sync_Daily"
$batPath  = "D:\Stramark_ver2\scripts\ffm_sync_daily.bat"
$workDir  = "D:\Stramark_ver2"

# Remove existing task if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Create task components
$action   = New-ScheduledTaskAction -Execute $batPath -WorkingDirectory $workDir
$trigger  = New-ScheduledTaskTrigger -Daily -At "06:00AM"
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# Register the task
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Daily FFM sync: EU Shipment API -> BigQuery (6AM VN)" `
    -Force

Write-Host ""
Write-Host "Task '$taskName' registered successfully!" -ForegroundColor Green
Write-Host "  Schedule : Daily at 6:00 AM (SE Asia Standard Time)"
Write-Host "  Script   : $batPath"
Write-Host ""

# Show task info
Get-ScheduledTask -TaskName $taskName | Format-List TaskName, State, Description
Get-ScheduledTaskInfo -TaskName $taskName | Format-List LastRunTime, NextRunTime
