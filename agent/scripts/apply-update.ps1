# Apply a downloaded agent update.
#
# Invoked by the running agent right before it exits. Once the agent process
# is gone we:
#   1. Wait briefly for the lock to release
#   2. Extract the new zip over the target directory
#   3. Restart the CloudDeck Agent Windows service
#
# Usage: powershell -File apply-update.ps1 -Zip C:\path\to\agent-x.y.z.zip -Target C:\CloudDeck\agent

param(
    [Parameter(Mandatory = $true)] [string]$Zip,
    [Parameter(Mandatory = $true)] [string]$Target
)

Start-Sleep -Seconds 3

try {
    Write-Host "[apply-update] extracting $Zip → $Target"
    Expand-Archive -Path $Zip -DestinationPath $Target -Force
} catch {
    Write-Error "[apply-update] extract failed: $_"
    exit 1
}

try {
    Write-Host "[apply-update] restarting service"
    Restart-Service -Name "CloudDeck Agent" -ErrorAction Stop
} catch {
    Write-Warning "[apply-update] service restart failed; you may need to start it manually"
}

Remove-Item -Path $Zip -ErrorAction SilentlyContinue
Write-Host "[apply-update] done"
