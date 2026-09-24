$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$testName='bkn-deployment-test-'+[guid]::NewGuid().ToString('N')
$root=Join-Path ([IO.Path]::GetTempPath()) $testName
[IO.Directory]::CreateDirectory($root) | Out-Null
$source=Join-Path $root 'source'
$releases=Join-Path $root 'releases'
$local=Join-Path $root 'local'
[IO.Directory]::CreateDirectory($source) | Out-Null
$global:BknDeployTestChromeOpen=$false
# Mock only the process query; all package, copy, checksum and rename operations are real.
function Get-Process {
    param([string]$Name,[int]$Id)
    if ($Id -or $global:BknDeployTestChromeOpen) { [pscustomobject]@{SessionId=99} }
}
function Check($Condition,$Message) { if (!$Condition) { throw "FAIL: $Message" }; Write-Host "PASS: $Message" }
function Must-Fail([scriptblock]$Action,$Message) {
    $failed=$false
    try { & $Action } catch { $failed=$true; Write-Host "Expected: $($_.Exception.Message)" }
    Check $failed $Message
}
function Make-Source($Version) {
    Write-Json (Join-Path $source 'manifest.json') @{manifest_version=3;name='BKN Pharmacy Portal';version=$Version;key='test-stable-key';background=@{service_worker='app.js'}}
    [IO.File]::WriteAllText((Join-Path $source 'app.js'),"// $Version")
}
function Installed-Version { (Read-Json (Join-Path $local 'Extension\manifest.json')).version }
try {
    Make-Source '1.0.0'
    & (Join-Path $PSScriptRoot 'Publish.ps1') -Source $source -ReleaseRoot $releases
    & (Join-Path $PSScriptRoot 'Update.ps1') -InstallRoot $local -ReleaseRoot $releases -NoShortcut
    Check ((Installed-Version) -eq '1.0.0') 'first local installation'
    & (Join-Path $PSScriptRoot 'Update.ps1') -InstallRoot $local -ReleaseRoot $releases -NoShortcut
    Check (!(Test-Path (Join-Path $local 'Previous'))) 'same version is a no-op'
    Must-Fail { & (Join-Path $PSScriptRoot 'Publish.ps1') -Source $source -ReleaseRoot $releases } 'published versions cannot be overwritten'
    Make-Source '1.0.1'
    & (Join-Path $PSScriptRoot 'Publish.ps1') -Source $source -ReleaseRoot $releases
    $global:BknDeployTestChromeOpen=$true
    Must-Fail { & (Join-Path $PSScriptRoot 'Update.ps1') -InstallRoot $local -ReleaseRoot $releases -NoShortcut } 'Chrome-open refusal'
    Check ((Installed-Version) -eq '1.0.0') 'Chrome-open leaves current files intact'
    $global:BknDeployTestChromeOpen=$false
    $zip=Join-Path $releases '1.0.1\extension.zip'
    $bytes=[IO.File]::ReadAllBytes($zip)
    [IO.File]::WriteAllText($zip,'corrupt')
    Must-Fail { & (Join-Path $PSScriptRoot 'Update.ps1') -InstallRoot $local -ReleaseRoot $releases -NoShortcut } 'damaged package rejected'
    Check ((Installed-Version) -eq '1.0.0') 'damaged download preserves working version'
    [IO.File]::WriteAllBytes($zip,$bytes)
    & (Join-Path $PSScriptRoot 'Update.ps1') -InstallRoot $local -ReleaseRoot $releases -NoShortcut
    Check ((Installed-Version) -eq '1.0.1') 'version upgrade'
    Check ((Read-Json (Join-Path $local 'Previous\manifest.json')).version -eq '1.0.0') 'previous version retained'
    & (Join-Path $PSScriptRoot 'Update.ps1') -InstallRoot $local -Rollback -NoShortcut
    Check ((Installed-Version) -eq '1.0.0') 'offline rollback'
    Must-Fail { & (Join-Path $PSScriptRoot 'Update.ps1') -InstallRoot $local -ReleaseRoot (Join-Path $root 'offline') -NoShortcut } 'unavailable share'
    Check ((Installed-Version) -eq '1.0.0') 'offline keeps installed version'
    Must-Fail { Safe-Child $root '..\escape' } 'path traversal rejected'
    Move-Item -LiteralPath (Join-Path $local 'Extension') -Destination (Join-Path $root 'interrupted')
    Must-Fail { & (Join-Path $PSScriptRoot 'Update.ps1') -InstallRoot $local -ReleaseRoot (Join-Path $root 'offline') -NoShortcut } 'offline after interrupted switch'
    Check ((Installed-Version) -eq '1.0.1') 'interrupted switch recovers previous folder'
    [IO.File]::WriteAllText((Join-Path $local 'Extension\app.js'),'broken')
    & (Join-Path $PSScriptRoot 'Update.ps1') -InstallRoot $local -ReleaseRoot $releases -NoShortcut
    Check ((Get-Content (Join-Path $local 'Extension\app.js') -Raw) -eq '// 1.0.1') 'same-version damaged file repaired'
    $badZip=Join-Path $root 'bad.zip'
    $archive=[IO.Compression.ZipFile]::Open($badZip,'Create')
    try { $null=$archive.CreateEntry('../outside.txt') } finally { $archive.Dispose() }
    Must-Fail { Expand-Safe $badZip (Join-Path $root 'extract') } 'ZIP traversal rejected'
    Check (!(Test-Path (Join-Path $root 'outside.txt'))) 'ZIP cannot write outside staging'
    Make-Source '1.0.2'
    $identity=Read-Json (Join-Path $source 'manifest.json')
    $identity.key='different-key'
    Write-Json (Join-Path $source 'manifest.json') $identity
    & (Join-Path $PSScriptRoot 'Publish.ps1') -Source $source -ReleaseRoot $releases
    Must-Fail { & (Join-Path $PSScriptRoot 'Update.ps1') -InstallRoot $local -ReleaseRoot $releases -NoShortcut } 'changed extension identity refused'
    Check ((Installed-Version) -eq '1.0.1') 'identity refusal preserves current version'
    Make-Source '1.0.3'
    & (Join-Path $PSScriptRoot 'Publish.ps1') -Source $source -ReleaseRoot $releases
    function Move-Item {
        param($LiteralPath,$Destination)
        if ($LiteralPath -like '*\payload' -and $Destination -like '*\Extension') { throw 'Simulated activation failure' }
        Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
    }
    try {
        Must-Fail { & (Join-Path $PSScriptRoot 'Update.ps1') -InstallRoot $local -ReleaseRoot $releases -NoShortcut } 'activation failure'
        Check ((Installed-Version) -eq '1.0.1') 'activation failure restores old folder'
    } finally { Remove-Item Function:\Move-Item }
    $oldMetadata=Join-Path $releases '1.0.0\release.json'
    Write-Json (Join-Path $releases 'latest.json') @{schema=1;version='1.0.0';metadataSha256=(Get-FileHash -LiteralPath $oldMetadata -Algorithm SHA256).Hash}
    Must-Fail { & (Join-Path $PSScriptRoot 'Update.ps1') -InstallRoot $local -ReleaseRoot $releases -NoShortcut } 'automatic downgrade refused'
    $held=[IO.File]::Open((Join-Path $local 'update.lock'),'OpenOrCreate','ReadWrite','None')
    try { Must-Fail { & (Join-Path $PSScriptRoot 'Update.ps1') -InstallRoot $local -ReleaseRoot $releases -NoShortcut } 'concurrent updater blocked' }
    finally { $held.Dispose() }
} finally {
    Remove-Owned ([IO.Path]::GetTempPath()) $testName
}
