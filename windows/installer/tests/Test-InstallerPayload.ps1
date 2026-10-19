[CmdletBinding()]
param(
    # An assembled payload folder (app\ and runtime\). Optional with -ArchivePath.
    [string]$PayloadDirectory,
    # payload.zip; validated with the control script's own InstallPackage checks.
    [string]$ArchivePath,
    # The release.json written next to the archive (defaults to the zip's copy).
    [string]$ReleaseJson
)
# Without arguments: runs Build-Installer.ps1 -PayloadOnly into an ignored
# .local folder (needs network for the pinned Node ZIP), checks it, removes it.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$installerDirectory = Split-Path $PSScriptRoot -Parent
$windowsDirectory = Split-Path $installerDirectory -Parent
$repository = Split-Path $windowsDirectory -Parent
$localRoot = [IO.Path]::GetFullPath((Join-Path $repository '.local'))
function Resolve-UserPath([string]$Path) { return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path) }
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw "Payload check failed: $Message" } }
$scratch = Join-Path $localRoot ('installer-payload-test-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$checks = 0
try {
    if (-not $PayloadDirectory -and -not $ArchivePath) {
        $built = Join-Path $scratch 'build'
        & (Join-Path $installerDirectory 'Build-Installer.ps1') -PayloadOnly -OutputDirectory $built
        $PayloadDirectory = Join-Path $built 'payload'
        $ArchivePath = Join-Path $built 'payload.zip'
        $ReleaseJson = Join-Path $built 'release.json'
    }
    if ($ArchivePath) { $ArchivePath = Resolve-UserPath $ArchivePath }
    if ($ReleaseJson) { $ReleaseJson = Resolve-UserPath $ReleaseJson }

    # Reuse the production validation: the same functions InstallPackage runs.
    . (Join-Path $windowsDirectory 'LivingRoomDisplay.ps1') -InstallRoot (Join-Path $scratch 'unused-install-root') -FunctionsOnly
    if ($ArchivePath) {
        Assert-True (Test-Path -LiteralPath $ArchivePath -PathType Leaf) "archive not found: $ArchivePath"
        $manifest = Read-PackageArchive $ArchivePath
        Initialize-ZipSupport
        $zip = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
        try {
            foreach ($entry in $zip.Entries) {
                Assert-True (Test-SafePackageEntry $entry.FullName) "unsafe zip entry $($entry.FullName)"
                Assert-True ($entry.CompressedLength -eq $entry.Length) "zip entry is compressed (payload.zip must be stored): $($entry.FullName)"
            }
            $zipManifest = $zip.GetEntry('release.json')
            $memory = New-Object IO.MemoryStream
            $opened = $zipManifest.Open(); try { $opened.CopyTo($memory) } finally { $opened.Dispose() }
            $zipManifestBytes = $memory.ToArray()
            $manifestText = (New-Object Text.UTF8Encoding($false)).GetString($zipManifestBytes)
        } finally { $zip.Dispose() }
        if ($ReleaseJson) { Assert-True ((Get-Sha256 $ReleaseJson) -eq (([BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash($zipManifestBytes)) -replace '-','').ToLowerInvariant())) 'release.json next to the archive differs from the copy inside it' }
        if (-not $PayloadDirectory) {
            $PayloadDirectory = Join-Path $scratch 'extracted'
            Expand-PackageArchive $ArchivePath $PayloadDirectory $manifest
        }
        $checks++
    } else {
        Assert-True ([bool]$ReleaseJson) 'pass -ReleaseJson with a payload folder'
        $manifestText = [IO.File]::ReadAllText($ReleaseJson)
        $manifest = $manifestText | ConvertFrom-Json
    }
    $PayloadDirectory = (Resolve-UserPath $PayloadDirectory).TrimEnd('\')
    Assert-True (Test-Path -LiteralPath $PayloadDirectory -PathType Container) "payload folder not found: $PayloadDirectory"

    # Required files.
    foreach ($required in @('app/package.json','app/package-lock.json','app/dist/server/index.js','app/dist/client/index.html','app/windows/LivingRoomDisplay.ps1','app/windows/LivingRoomDisplay.scr','app/THIRD-PARTY-NOTICES.txt','app/node_modules/react/package.json','app/node_modules/react-dom/package.json','app/node_modules/zod/package.json','runtime/node.exe','runtime/npm.cmd','runtime/LICENSE')) {
        Assert-True (Test-Path -LiteralPath (Join-Path $PayloadDirectory $required.Replace('/','\')) -PathType Leaf) "missing $required"
    }
    $checks++

    # Nothing from development, source control or user data.
    $appDirectory = Join-Path $PayloadDirectory 'app'
    foreach ($forbidden in @('.git','.local','src','tests','data','edge-profile','run','backups','.github','windows\installer','windows\tests')) {
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $appDirectory $forbidden))) "app\$forbidden must not be packaged"
    }
    foreach ($item in (Get-ChildItem -LiteralPath $PayloadDirectory -Recurse -Force)) {
        Assert-True (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) "reparse point in payload: $($item.FullName)"
        Assert-True ($item.Name -notin @('.git','edge-profile','.env')) "forbidden item in payload: $($item.FullName)"
        if (-not $item.PSIsContainer -and $item.FullName.IndexOf('\node_modules\', [StringComparison]::OrdinalIgnoreCase) -lt 0) {
            Assert-True ($item.Name -notlike 'state*.json' -and $item.Name -notlike '*.log') "user data or log in payload: $($item.FullName)"
        }
    }
    $package = Get-Content -LiteralPath (Join-Path $appDirectory 'package.json') -Raw | ConvertFrom-Json
    foreach ($dev in @($package.devDependencies.PSObject.Properties.Name) + @('typescript','vite','@types')) {
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $appDirectory ('node_modules\' + $dev.Replace('/','\'))))) "development dependency packaged: $dev"
    }
    Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $appDirectory 'windows') -Force).Count -eq 2) 'app\windows must hold only the control script and the helper'
    $checks++

    # release.json is exact: every payload file, nothing else, matching hashes.
    $runtimePin = (Get-Content -LiteralPath (Join-Path $installerDirectory 'runtime.json') -Raw | ConvertFrom-Json).node
    Assert-True ($manifest.product -eq 'living-room-display' -and [string]$manifest.schema -eq '1') 'manifest product/schema'
    Assert-True ([string]$manifest.version -eq [string]$package.version -and [string]$manifest.version -match '^\d+\.\d+\.\d+$') 'manifest version must equal app/package.json'
    Assert-True ([string]$manifest.sourceRevision -match '^[0-9a-f]{40}$' -and @('clean','dirty') -contains [string]$manifest.sourceState) 'manifest provenance'
    # PowerShell 7 turns ISO strings into DateTime, so check the raw JSON text.
    Assert-True ($manifestText -match '"builtAt"\s*:\s*"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"') 'manifest builtAt'
    Assert-True ($manifest.node.version -eq $runtimePin.version -and $manifest.node.archive -eq $runtimePin.archive -and $manifest.node.sha256 -eq $runtimePin.sha256) 'manifest node pin'
    Assert-True ([string]$manifest.inno.version -match '^\d+\.\d+\.\d+$') 'manifest inno version'
    $actual = @{}
    foreach ($file in (Get-ChildItem -LiteralPath $PayloadDirectory -Recurse -Force -File)) {
        $relative = $file.FullName.Substring($PayloadDirectory.Length + 1).Replace('\','/')
        if ($relative -eq 'release.json') { continue }
        $actual[$relative] = $file
    }
    $listed = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($entry in @($manifest.files)) {
        $path = [string]$entry.path
        Assert-True ((Test-SafePackageEntry $path) -and $path -ne 'release.json') "unsafe manifest path $path"
        Assert-True ($listed.Add($path)) "duplicate manifest path $path"
        Assert-True ($actual.ContainsKey($path)) "manifest lists a missing file $path"
        Assert-True ([int64]$actual[$path].Length -eq [int64]$entry.size -and (Get-Sha256 $actual[$path].FullName) -eq [string]$entry.sha256) "size or hash mismatch for $path"
    }
    foreach ($path in $actual.Keys) { Assert-True ($listed.Contains($path)) "unlisted payload file $path" }
    # The deepest path stays within the budget the docs' folder limit comes from (#180).
    $deepest = @($manifest.files | Sort-Object { ([string]$_.path).Length } -Descending)[0].path
    Assert-True (([string]$deepest).Length -le $script:packagePathBudget) "the deepest payload path has $(([string]$deepest).Length) characters, over the $($script:packagePathBudget)-character budget: $deepest. Shorten it, or raise packagePathBudget in LivingRoomDisplay.ps1 and the folder limit in docs/install.md and docs/windows.md together."
    Write-Output "Deepest payload path: $(([string]$deepest).Length) of $($script:packagePathBudget) characters ($deepest); install folders up to $($script:installFolderLimit) characters fit."
    $scriptEntry = @($manifest.files | Where-Object { $_.path -eq 'app/windows/LivingRoomDisplay.ps1' })
    Assert-True ($scriptEntry.Count -eq 1 -and (Get-Sha256 (Join-Path $appDirectory 'windows\LivingRoomDisplay.ps1')) -eq $scriptEntry[0].sha256) 'control script copy differs from its manifest entry'
    $checks++

    # The packaged runtime is the pinned, OpenJS-signed Node.
    $nodeExe = Join-Path $PayloadDirectory 'runtime\node.exe'
    $signature = Get-AuthenticodeSignature -LiteralPath $nodeExe
    Assert-True ($signature.Status -eq 'Valid' -and $signature.SignerCertificate -and $signature.SignerCertificate.Subject -match 'OpenJS Foundation') "node.exe signature is $($signature.Status)"
    Assert-True ((& $nodeExe --version).Trim() -eq "v$($runtimePin.version)") 'node.exe version differs from runtime.json'
    $helperVersion = (Get-Item -LiteralPath (Join-Path $appDirectory 'windows\LivingRoomDisplay.scr')).VersionInfo
    Assert-True ($helperVersion.ProductName -eq 'Living Room Display' -and $helperVersion.FileVersion -eq "$($manifest.version).0") 'the helper lacks its product name or file version'
    $checks++
} finally {
    if (Test-Path -LiteralPath $scratch) {
        if (-not ([IO.Path]::GetFullPath($scratch)).StartsWith($localRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Payload test cleanup escaped .local.' }
        Remove-Item -LiteralPath $scratch -Recurse -Force
    }
}
Write-Output "$checks installer payload check groups passed (archive safety, required and forbidden files, exact manifest, signed pinned runtime)."
