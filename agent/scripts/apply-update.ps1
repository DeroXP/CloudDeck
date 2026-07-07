# Apply a downloaded agent update.
#
# Invoked by the running agent right before it exits. Once the agent process
# is gone we:
#   1. Wait briefly for the lock to release
#   2. Extract the new zip over the target directory
#   3. Relaunch the agent
#
# The agent runs as a Scheduled Task at logon (not a Windows service), so we
# restart it via Start-ScheduledTask, falling back to spawning node directly.
#
# Usage: powershell -File apply-update.ps1 -Zip C:\path\to\agent-x.y.z.zip -Target C:\CloudDeck\agent

param(
    [Parameter(Mandatory = $true)] [string]$Zip,
    [Parameter(Mandatory = $true)] [string]$Target
)

Start-Sleep -Seconds 3

try {
    Write-Host "[apply-update] extracting $Zip -> $Target"
    Expand-Archive -Path $Zip -DestinationPath $Target -Force
} catch {
    Write-Error "[apply-update] extract failed: $_"
    exit 1
}

try {
    Write-Host "[apply-update] restarting agent via scheduled task"
    Start-ScheduledTask -TaskName "CloudDeck Agent" -ErrorAction Stop
} catch {
    Write-Warning "[apply-update] scheduled-task restart failed; launching node directly"
    try {
        Start-Process -FilePath "node" -ArgumentList "`"$Target\index.js`"" -WorkingDirectory $Target -WindowStyle Hidden
    } catch {
        Write-Warning "[apply-update] direct launch failed; agent will start at next logon"
    }
}

Remove-Item -Path $Zip -ErrorAction SilentlyContinue
Write-Host "[apply-update] done"
