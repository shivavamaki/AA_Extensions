param(
    [string]$Source = (Join-Path (Split-Path $PSScriptRoot -Parent) 'BKNPharmacyPortal'),
    [string]$ReleaseRoot = (Join-Path $PSScriptRoot 'releases')
)
. (Join-Path $PSScriptRoot 'Common.ps1')
$Source = [IO.Path]::GetFullPath($Source)
$ReleaseRoot = [IO.Path]::GetFullPath($ReleaseRoot)
[IO.Directory]::CreateDirectory($ReleaseRoot) | Out-Null
Assert-NoLinks $ReleaseRoot
$lock = [IO.File]::Open((Join-Path $ReleaseRoot 'publish.lock'),'OpenOrCreate','ReadWrite','None')
$workName='build-'+[guid]::NewGuid().ToString('N')
$work=Safe-Child $ReleaseRoot $workName
try {
    Assert-NoLinks $Source
    $manifest=Assert-Manifest $Source
    $version=$manifest.version
    $destination=Safe-Child $ReleaseRoot $version
    if (Test-Path -LiteralPath $destination) { throw "Version $version already published. Bump manifest version before publishing again." }
    $payload=Join-Path $work 'payload'
    [IO.Directory]::CreateDirectory($payload) | Out-Null
    $skipDirs=@('.git','node_modules','test','tests','reports','screenshots','docs','__pycache__','.signing-keys')
    $skipExtensions=@('.pem','.key','.crx','.zip','.log','.bat','.cmd','.ps1','.py','.md','.map')
    foreach ($file in Get-ChildItem -LiteralPath $Source -Recurse -File -Force) {
        $relative=$file.FullName.Substring($Source.TrimEnd('\').Length+1)
        $parts=$relative -split '[/\\]'
        if (@($parts | Where-Object { $_ -in $skipDirs -or $_.StartsWith('.') }).Count -or $file.Extension.ToLowerInvariant() -in $skipExtensions) { continue }
        $target=Safe-Child $payload $relative
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $target
    }
    $stagedManifest=Assert-Manifest $payload
    if ($stagedManifest.version -ne $version) { throw 'Source version changed while building.' }
    $files=Get-Inventory $payload
    foreach ($file in $files) {
        if ((Get-FileHash -LiteralPath (Safe-Child $Source $file.path) -Algorithm SHA256).Hash -ne $file.sha256) { throw "Source changed during publication: $($file.path). Retry after editing finishes." }
    }
    $zip=Join-Path $work 'extension.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($payload,$zip,[IO.Compression.CompressionLevel]::Optimal,$false)
    $release=[ordered]@{schema=1;version=$version;publishedAt=[DateTime]::UtcNow.ToString('o');sha256=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash;files=$files}
    Write-Json (Join-Path $work 'release.json') $release
    $null=Assert-Package $payload $release
    Remove-Owned $work 'payload'
    Move-Item -LiteralPath $work -Destination $destination
    $pointer=Join-Path $ReleaseRoot 'latest.new.json'
    Write-Json $pointer @{schema=1;version=$version;metadataSha256=(Get-FileHash -LiteralPath (Join-Path $destination 'release.json') -Algorithm SHA256).Hash}
    $latest=Join-Path $ReleaseRoot 'latest.json'
    if (Test-Path -LiteralPath $latest) { [IO.File]::Replace($pointer,$latest,(Join-Path $ReleaseRoot 'latest.previous.json')) } else { [IO.File]::Move($pointer,$latest) }
    Write-Host "Published $version. Users can run Update BKN Pharmacy."
} finally {
    Remove-Owned $ReleaseRoot $workName
    $lock.Dispose()
}
