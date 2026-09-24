param([string]$ReleaseRoot = (Join-Path $PSScriptRoot 'releases'))
. (Join-Path $PSScriptRoot 'Common.ps1')
$name='bkn-release-check-'+[guid]::NewGuid().ToString('N')
$tempRoot=[IO.Path]::GetTempPath()
$stage=Safe-Child $tempRoot $name
[IO.Directory]::CreateDirectory($stage) | Out-Null
try {
    $pointer=Read-Json (Join-Path $ReleaseRoot 'latest.json')
    if ($pointer.version -notmatch '^\d+(\.\d+){1,3}$') { throw 'Invalid version.' }
    $dir=Safe-Child $ReleaseRoot $pointer.version
    $metadata=Join-Path $dir 'release.json'
    if ((Get-FileHash -LiteralPath $metadata -Algorithm SHA256).Hash -ne $pointer.metadataSha256) { throw 'Metadata checksum failed.' }
    $release=Read-Json $metadata
    $zip=Join-Path $dir 'extension.zip'
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $release.sha256) { throw 'ZIP checksum failed.' }
    Expand-Safe $zip $stage
    $manifest=Assert-Package $stage $release
    Write-Host "Verified $($manifest.version): $(@($release.files).Count) files. No installed extension was changed."
} finally { Remove-Owned $tempRoot $name }
