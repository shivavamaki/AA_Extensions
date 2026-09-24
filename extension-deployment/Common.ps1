$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Read-Json($Path) { Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
function Write-Json($Path, $Value) { [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 30), (New-Object Text.UTF8Encoding($false))) }
function Safe-Child($Root, $Relative) {
    if (!$Relative -or $Relative -match '(^[/\\]|:|(^|[/\\])\.\.([/\\]|$))') { throw "Unsafe path: $Relative" }
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $target = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if (!$target.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw "Path escapes root: $Relative" }
    return $target
}
function Assert-NoLinks($Path) {
    $item = Get-Item -LiteralPath $Path -Force
    while ($item) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked paths are not supported: $($item.FullName)" }
        $item = $item.Parent
    }
    foreach ($entry in Get-ChildItem -LiteralPath $Path -Force -Recurse) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked paths are not supported: $($entry.FullName)" }
    }
}
function Remove-Owned($Root, $Name) {
    $path = Safe-Child $Root $Name
    if (Test-Path -LiteralPath $path) { Assert-NoLinks $path; Remove-Item -LiteralPath $path -Recurse -Force }
}
function Get-Inventory($Root) {
    @(Get-ChildItem -LiteralPath $Root -File -Recurse | Sort-Object FullName | ForEach-Object {
        [pscustomobject]@{path=$_.FullName.Substring($Root.TrimEnd('\').Length+1).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash; size=$_.Length}
    })
}
function Assert-Manifest($Root) {
    $m = Read-Json (Join-Path $Root 'manifest.json')
    if ($m.manifest_version -ne 3 -or $m.name -ne 'BKN Pharmacy Portal' -or !$m.key -or $m.version -notmatch '^\d+(\.\d+){1,3}$') { throw 'Invalid Portal manifest or missing stable extension key.' }
    $refs = @($m.background.service_worker, $m.action.default_popup, $m.options_page, $m.options_ui.page)
    if ($m.icons) { $refs += @($m.icons.psobject.Properties.Value) }
    foreach ($c in $m.content_scripts) { $refs += @($c.js) + @($c.css) }
    foreach ($r in $m.web_accessible_resources) { $refs += @($r.resources) }
    foreach ($ref in $refs) {
        if (!$ref) { continue }
        $path = Safe-Child $Root ($ref.Replace('*','_').Replace('?','_'))
        if ($ref.Contains('*')) {
            if (!(Test-Path -Path (Join-Path $Root $ref))) { throw "Missing manifest resource: $ref" }
        } elseif (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing manifest resource: $ref" }
    }
    return $m
}
function Assert-Package($Root, $Release) {
    Assert-NoLinks $Root
    $seen = @{}
    foreach ($file in $Release.files) {
        $path = Safe-Child $Root $file.path
        if ($seen.ContainsKey($file.path)) { throw "Duplicate package path: $($file.path)" }
        $seen[$file.path] = $true
        if (!(Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -ne $file.size -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256) { throw "File verification failed: $($file.path)" }
    }
    if (@(Get-ChildItem -LiteralPath $Root -File -Recurse).Count -ne $seen.Count -or !$seen.ContainsKey('manifest.json')) { throw 'Unexpected or missing package files.' }
    $manifest = Assert-Manifest $Root
    if ($manifest.version -ne $Release.version) { throw 'Package version mismatch.' }
    return $manifest
}
function Expand-Safe($Zip, $Destination) {
    $archive = [IO.Compression.ZipFile]::OpenRead($Zip)
    try {
        $seen=@{}
        foreach ($entry in $archive.Entries) {
            $path=Safe-Child $Destination $entry.FullName
            if ($seen.ContainsKey($path)) { throw 'Duplicate ZIP entry.' }
            $seen[$path]=$true
            if (!$entry.Name) { [IO.Directory]::CreateDirectory($path) | Out-Null; continue }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($path)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$path,$false)
        }
    } finally { $archive.Dispose() }
}
