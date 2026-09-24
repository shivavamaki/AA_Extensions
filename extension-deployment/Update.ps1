param(
    [string]$ReleaseRoot = '\\10.134.10.70\Pharmacy\EXT\extension-deployment\releases',
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'BKNPharmacy'),
    [switch]$Rollback,
    [switch]$NoShortcut
)
. (Join-Path $PSScriptRoot 'Common.ps1')
$InstallRoot=[IO.Path]::GetFullPath($InstallRoot)
if ($InstallRoot.StartsWith('\\') -or [IO.Path]::GetPathRoot($InstallRoot) -eq $InstallRoot) { throw 'Installation must use a dedicated local folder.' }
[IO.Directory]::CreateDirectory($InstallRoot) | Out-Null
Assert-NoLinks $InstallRoot
$lock=[IO.File]::Open((Join-Path $InstallRoot 'update.lock'),'OpenOrCreate','ReadWrite','None')
$current=Join-Path $InstallRoot 'Extension'
$previous=Join-Path $InstallRoot 'Previous'
$stageName='stage-'+[guid]::NewGuid().ToString('N')
$stage=Safe-Child $InstallRoot $stageName
function Assert-ChromeClosed {
    if (Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq (Get-Process -Id $PID).SessionId }) {
        throw 'Close Chrome completely, including background Chrome, then run this updater again. No browser was forcibly closed.'
    }
}
function Install-Updater {
    $tools=Join-Path $InstallRoot 'Updater'
    [IO.Directory]::CreateDirectory($tools) | Out-Null
    foreach ($name in @('Common.ps1','Update.ps1','Install-or-Update.bat','Rollback.bat')) {
        $src=Join-Path $PSScriptRoot $name
        $dst=Join-Path $tools $name
        if ([IO.Path]::GetFullPath($src) -ne [IO.Path]::GetFullPath($dst)) { Copy-Item -LiteralPath $src -Destination $dst -Force }
    }
    if (!$NoShortcut) {
        try {
            $shell=New-Object -ComObject WScript.Shell
            $shortcut=$shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Update BKN Pharmacy.lnk'))
            $shortcut.TargetPath=Join-Path $tools 'Install-or-Update.bat'
            $shortcut.WorkingDirectory=$tools
            $shortcut.Description='Update the local BKN Pharmacy extension from the pharmacy release share'
            $shortcut.Save()
        } catch { Write-Warning "Installed, but could not create the Desktop shortcut: $_" }
    }
}
try {
    if (!(Test-Path -LiteralPath $current) -and (Test-Path -LiteralPath $previous)) {
        Assert-ChromeClosed
        Move-Item -LiteralPath $previous -Destination $current
        Write-Host 'Recovered the previous local installation.'
    }
    if ($Rollback) {
        if (!(Test-Path -LiteralPath $previous)) { throw 'No previous version is available.' }
        $null=Assert-Manifest $previous
        Assert-ChromeClosed
        Move-Item -LiteralPath $current -Destination $stage
        try { Move-Item -LiteralPath $previous -Destination $current }
        catch { Move-Item -LiteralPath $stage -Destination $current; throw }
        Move-Item -LiteralPath $stage -Destination $previous
        Write-Host 'Previous version restored. You can reopen Chrome.'
        return
    }
    Write-Host 'Checking the shared release folder...'
    $pointer=Read-Json (Join-Path $ReleaseRoot 'latest.json')
    if ($pointer.schema -ne 1 -or $pointer.version -notmatch '^\d+(\.\d+){1,3}$') { throw 'Invalid release pointer.' }
    $releaseDir=Safe-Child $ReleaseRoot $pointer.version
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    $metadata=Join-Path $stage 'release.json'
    Copy-Item -LiteralPath (Join-Path $releaseDir 'release.json') -Destination $metadata
    if ((Get-FileHash -LiteralPath $metadata -Algorithm SHA256).Hash -ne $pointer.metadataSha256) { throw 'Release metadata verification failed.' }
    $release=Read-Json $metadata
    if ($release.schema -ne 1 -or $release.version -ne $pointer.version -or !$release.files) { throw 'Invalid release metadata.' }
    if (Test-Path -LiteralPath $current) {
        $installed=Read-Json (Join-Path $current 'manifest.json')
        if ([version]$installed.version -gt [version]$release.version) { throw 'Server release is older. Automatic downgrade refused; use Rollback for the retained local version.' }
        if ($installed.version -eq $release.version) {
            try { $null=Assert-Package $current $release; Write-Host "Already up to date: $($release.version)."; Install-Updater; return }
            catch { Write-Host 'Local files differ; repairing from the verified release.' }
        }
    }
    $zip=Join-Path $stage 'extension.zip'
    Copy-Item -LiteralPath (Join-Path $releaseDir 'extension.zip') -Destination $zip
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $release.sha256) { throw 'Package checksum failed. Current installation was not replaced.' }
    $payload=Join-Path $stage 'payload'
    [IO.Directory]::CreateDirectory($payload) | Out-Null
    Expand-Safe $zip $payload
    $newManifest=Assert-Package $payload $release
    if ((Test-Path -LiteralPath $current) -and (Read-Json (Join-Path $current 'manifest.json')).key -ne $newManifest.key) { throw 'Extension identity changed; update refused.' }
    Assert-ChromeClosed
    if (Test-Path -LiteralPath $previous) { Remove-Owned $InstallRoot 'Previous' }
    $hadCurrent=Test-Path -LiteralPath $current
    if ($hadCurrent) { Move-Item -LiteralPath $current -Destination $previous }
    try { Move-Item -LiteralPath $payload -Destination $current }
    catch { if ($hadCurrent) { Move-Item -LiteralPath $previous -Destination $current }; throw }
    Write-Host "Installed version $($release.version)."
    Write-Host "Chrome Load unpacked folder: $current"
    Write-Host 'First installation: open chrome://extensions, enable Developer mode, and select this LOCAL folder.'
    Write-Host 'Existing local installation: reopen Chrome. Use Reload in chrome://extensions if needed.'
    Install-Updater
} finally {
    Remove-Owned $InstallRoot $stageName
    $lock.Dispose()
}
