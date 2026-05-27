# clean-temp-reports.ps1
# Keeps only the newest file per report ID in the temp-reports folder.
# File naming pattern: RT_COMMON_<ID>_<YYYYMMDD>_<HHMMSS>.xls
#
# Usage:
#   .\clean-temp-reports.ps1              # dry run (shows what would be deleted)
#   .\clean-temp-reports.ps1 -Force       # actually deletes
#   .\clean-temp-reports.ps1 -Force -Quiet  # delete silently (for scheduled tasks)

param(
    [switch]$Force,
    [switch]$Quiet
)

$DIR = "\\10.134.10.5\BKNinfo\24 Pharmacy\EXT\pharmacy_server\data\temp-reports"

function Clean-TempReports {
    param([string]$Path, [bool]$DryRun, [bool]$Silent)

    if (-not (Test-Path $Path)) {
        Write-Host "ERROR: Path not found: $Path" -ForegroundColor Red
        return
    }

    $files = Get-ChildItem $Path -Filter "RT_COMMON_*.xls" -File
    if ($files.Count -eq 0) {
        if (-not $Silent) { Write-Host "No RT_COMMON_*.xls files found. Nothing to clean." }
        return
    }

    # Group by the report ID portion (digits between RT_COMMON_ and the date)
    $groups = $files | Group-Object {
        if ($_.Name -match '^RT_COMMON_(\d+)_') { $Matches[1] } else { $_.Name }
    }

    $deleted = 0
    $kept    = 0

    foreach ($g in $groups) {
        # Sort descending by datetime string (YYYYMMDD_HHMMSS — lexicographic = chronological)
        $sorted = $g.Group | Sort-Object {
            if ($_.Name -match '^RT_COMMON_\d+_(.+)\.xls$') { $Matches[1] } else { $_.Name }
        } -Descending

        $newest = $sorted[0]
        $older  = @($sorted | Select-Object -Skip 1)

        if (-not $Silent) {
            Write-Host "  KEEP  [$($g.Name)]  $($newest.Name)" -ForegroundColor Green
        }

        foreach ($f in $older) {
            if ($DryRun) {
                if (-not $Silent) {
                    Write-Host "  DEL   [$($g.Name)]  $($f.Name)" -ForegroundColor Yellow
                }
            } else {
                Remove-Item $f.FullName -Force
                $deleted++
                if (-not $Silent) {
                    Write-Host "  DEL   [$($g.Name)]  $($f.Name)" -ForegroundColor Red
                }
            }
        }
        $kept++
    }

    if (-not $Silent) {
        Write-Host ""
        if ($DryRun) {
            $total = ($files.Count - $kept)
            Write-Host "DRY RUN - would delete $total files, keep $kept. Run with -Force to apply." -ForegroundColor Cyan
        } else {
            Write-Host "Done - deleted $deleted files, kept $kept." -ForegroundColor Cyan
        }
    }
}

Clean-TempReports -Path $DIR -DryRun:(-not $Force) -Silent:$Quiet.IsPresent
