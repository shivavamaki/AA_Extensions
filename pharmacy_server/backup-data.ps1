# backup-data.ps1
# Mirrors the pharmacy server's production data to a local backup drive.
#
# WHY: everything under pharmacy_server/data/ lives in exactly one place. It is
# deliberately NOT in git — patients/, hmr/, hmq/, opd-queue/, temp-reports/ and
# logs/ hold identifiable patient records (HN, name, ward) and auth/ holds
# password hashes, none of which may go to a hosted remote. med-images/ is
# 290 MB of binaries that git handles badly — and 1960 of them were lost once
# already when a commit removed them from the working tree.
#
# So the data is protected by file-level backup instead, kept inside the
# hospital network.
#
# Usage (on the server):
#   powershell -ExecutionPolicy Bypass -File pharmacy_server\backup-data.ps1
#
# Schedule it daily:
#   schtasks /Create /TN "BKN Pharmacy Data Backup" /TR ^
#     "powershell -ExecutionPolicy Bypass -File C:\path\to\backup-data.ps1" ^
#     /SC DAILY /ST 22:00 /RL HIGHEST

param(
    [string]$Source = "\\10.134.10.70\Pharmacy\EXT\pharmacy_server\data",
    [string]$Dest   = "D:\PharmacyBackup\data"
)

$ErrorActionPreference = 'Continue'
$started = Get-Date

Write-Host "=== BKN Pharmacy data backup ===" -ForegroundColor Cyan
Write-Host "Source: $Source"
Write-Host "Dest  : $Dest"
Write-Host ""

if (-not (Test-Path $Source)) {
    Write-Host "ERROR: source not reachable - is the share mounted?" -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path $Dest | Out-Null

# Keep the previous run's log so a silent failure is noticeable.
$logDir = Join-Path $Dest '_backup-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("backup-{0}.log" -f $started.ToString('yyyyMMdd-HHmmss'))

# /MIR mirrors (deletions propagate, so the backup matches the live folder).
# report-cache/ and temp-reports/ are regenerable scratch - skipping them keeps
# the backup ~100 MB smaller and much faster.
# /R:2 /W:5 - a share hiccup should not stall the whole run.
robocopy $Source $Dest /MIR /XD report-cache temp-reports /R:2 /W:5 /NP /LOG:$log | Out-Null
$code = $LASTEXITCODE

# robocopy: 0-7 success (bit flags), 8+ real failure. NOT plain errorlevel.
if ($code -ge 8) {
    Write-Host "BACKUP FAILED (robocopy code $code) - see $log" -ForegroundColor Red
    exit 1
}

$files = (Get-ChildItem $Dest -Recurse -File -ErrorAction SilentlyContinue).Count
$mb    = [math]::Round(((Get-ChildItem $Dest -Recurse -File -ErrorAction SilentlyContinue) |
                        Measure-Object Length -Sum).Sum / 1MB, 1)
$mins  = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)

Write-Host "OK - $files files, $mb MB, ${mins} min (robocopy code $code)" -ForegroundColor Green
Write-Host "Log: $log"

# Prune logs older than 30 days so the folder does not grow forever.
Get-ChildItem $logDir -Filter 'backup-*.log' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

exit 0
