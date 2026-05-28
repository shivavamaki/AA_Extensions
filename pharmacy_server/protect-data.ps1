# protect-data.ps1
# Run ONCE on this server to guarantee local production data is never
# overwritten by `git pull`.
#
# What this does:
#   1. Registers the "ours" merge driver (local always wins on conflict)
#   2. Marks every tracked production-data file as --skip-worktree
#      so git never replaces them during pull/checkout
#
# Usage (from the repo root):
#   powershell -ExecutionPolicy Bypass -File pharmacy_server\protect-data.ps1

$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot

Write-Host "=== Pharmacy Server Data Protection Setup ===" -ForegroundColor Cyan
Write-Host "Repo: $RepoRoot"
Write-Host ""

# ── 1. Register the 'ours' merge driver ──────────────────────────────────────
Write-Host "[1/2] Configuring merge.ours driver..." -ForegroundColor Yellow
git config merge.ours.driver true
if ($LASTEXITCODE -eq 0) {
    Write-Host "      OK: merge.ours.driver = true" -ForegroundColor Green
} else {
    Write-Host "      WARN: could not set merge driver" -ForegroundColor Red
}

# ── 2. Mark production files as skip-worktree ────────────────────────────────
Write-Host ""
Write-Host "[2/2] Marking production data files as --skip-worktree..." -ForegroundColor Yellow
Write-Host "      (git will NEVER replace these files during pull/checkout)"
Write-Host ""

# Files that are production-written and must never be overwritten
$ProductionPatterns = @(
    "pharmacy_server/data/auth/*.json",
    "pharmacy_server/data/kpi/*.json",
    "pharmacy_server/data/schedule/*.json"
)

$marked = 0
$notFound = 0

foreach ($pattern in $ProductionPatterns) {
    # Get actually-tracked files matching this pattern
    $tracked = git ls-files $pattern 2>$null
    if (-not $tracked) { continue }
    foreach ($file in $tracked -split "`n" | Where-Object { $_ -ne "" }) {
        git update-index --skip-worktree $file 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "      PROTECTED: $file" -ForegroundColor Green
            $marked++
        } else {
            Write-Host "      SKIP (not found): $file" -ForegroundColor DarkGray
            $notFound++
        }
    }
}

Write-Host ""
Write-Host "Done: $marked file(s) protected, $notFound skipped." -ForegroundColor Cyan
Write-Host ""
Write-Host "Summary of protections applied:" -ForegroundColor White
Write-Host "  .gitignore        -> new kpi/ and temp-reports/ files are never tracked"
Write-Host "  .gitattributes    -> local version wins on any git merge conflict"
Write-Host "  --skip-worktree   -> git pull/checkout will NEVER touch production files"
Write-Host ""
Write-Host "To check current protection status, run:" -ForegroundColor DarkGray
Write-Host "  git ls-files -v pharmacy_server/data/ | Where-Object { `$_ -match '^[Ss]' }"
Write-Host "  (lines starting with 'S' = skip-worktree protected)"
Write-Host ""
Write-Host "To manually protect a new file (e.g. after server creates it):" -ForegroundColor DarkGray
Write-Host "  git update-index --skip-worktree <path>"
