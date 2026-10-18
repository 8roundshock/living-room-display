[CmdletBinding()]
param(
    # Default: the repository's ignored .local\installer folder.
    [string]$OutputDirectory,
    # ISCC.exe; found in the usual Inno Setup 6 locations when omitted.
    [string]$IsccPath,
    # Build and verify payload.zip + release.json only (no Inno Setup needed).
    [switch]$PayloadOnly,
    # Local experiments only: build from the working tree's tracked changes.
    # Refused in CI, and recorded as sourceState 'dirty'.
    [switch]$AllowDirty,
    # Optional signing command; {file} is replaced by the quoted file path.
    [string]$SignCommand,
    [switch]$KeepWork
)
# Reproducible build of LivingRoomDisplaySetup-<version>.exe from a clean commit:
# git archive -> npm ci/build -> app/ payload + pinned, checksum-verified Node
# runtime -> release.json manifest -> stored payload.zip -> Inno Setup compile.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$installerDirectory = $PSScriptRoot
$windowsDirectory = Split-Path $installerDirectory -Parent
$repository = Split-Path $windowsDirectory -Parent
function Resolve-UserPath([string]$Path) { return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path) }
function Write-Step([string]$Message) { Write-Host "==> $Message" }
function Invoke-Checked([string]$FilePath, [string[]]$Arguments, [string]$Description) {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Description failed with exit code $LASTEXITCODE." }
}
function Get-Sha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Get-ScriptNodeVersion([string]$ScriptPath) {
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$errors)
    $parameter = $ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'NodeVersion' }
    if (-not $parameter -or -not $parameter.DefaultValue) { throw 'The control script has no NodeVersion default.' }
    return [string]$parameter.DefaultValue.Value
}

function Get-InnoVersion([string]$Compiler) {
    # Inno's binaries carry no numeric file version, so ask the preprocessor:
    # Ver is the packed compiler version and DecodeVer formats it as x.y.z.
    $probe = Join-Path ([IO.Path]::GetTempPath()) ('lrd-inno-version-' + [Guid]::NewGuid().ToString('N') + '.iss')
    try {
        [IO.File]::WriteAllText($probe, "#pragma message `"LRD-INNO-VERSION=`" + DecodeVer(Ver)`n", (New-Object Text.UTF8Encoding($false)))
        $launch = New-Object Diagnostics.ProcessStartInfo
        $launch.FileName = $Compiler
        $launch.Arguments = '"' + $probe + '"'
        $launch.UseShellExecute = $false; $launch.CreateNoWindow = $true
        $launch.RedirectStandardOutput = $true; $launch.RedirectStandardError = $true
        $process = [Diagnostics.Process]::Start($launch)
        try {
            $stderr = $process.StandardError.ReadToEndAsync()
            $output = $process.StandardOutput.ReadToEnd() + $stderr.Result
            $process.WaitForExit()
        } finally { $process.Dispose() }
        $match = [regex]::Match($output, 'LRD-INNO-VERSION=(\d+)\.(\d+)\.(\d+)')
        if ($match.Success) { return New-Object Version ([int]$match.Groups[1].Value), ([int]$match.Groups[2].Value), ([int]$match.Groups[3].Value) }
        Write-Warning "Could not read the Inno Setup version: $output"
        return $null
    } finally { Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue }
}

if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repository '.local\installer' }
$OutputDirectory = Resolve-UserPath $OutputDirectory
$runtimePin = (Get-Content -LiteralPath (Join-Path $installerDirectory 'runtime.json') -Raw | ConvertFrom-Json).node
$innoPin = Get-Content -LiteralPath (Join-Path $installerDirectory 'inno.json') -Raw | ConvertFrom-Json
if ((Get-ScriptNodeVersion (Join-Path $windowsDirectory 'LivingRoomDisplay.ps1')) -ne $runtimePin.version) { throw 'runtime.json node.version must equal the control script NodeVersion default.' }
if ($runtimePin.archive -ne "node-v$($runtimePin.version)-win-x64.zip" -or $runtimePin.sha256 -notmatch '^[0-9a-f]{64}$') { throw 'runtime.json is inconsistent.' }

$nodeVersion = (& node --version) 2>$null
if ($LASTEXITCODE -ne 0 -or [string]$nodeVersion -notmatch '^v24\.') { throw "Node 24 must be first on PATH (found '$nodeVersion')." }
$git = (Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$revision = (& $git -C $repository rev-parse --verify HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[0-9a-f]{40}$') { throw 'Could not read the source revision.' }
$changes = @(& $git -C $repository status --porcelain --untracked-files=normal)
$dirty = $changes.Count -gt 0
if ($dirty) {
    if ($env:GITHUB_ACTIONS -eq 'true') { throw 'CI builds the installer only from a clean checkout.' }
    if (-not $AllowDirty) { throw 'The working tree has changes. Commit them, or pass -AllowDirty for a local experiment.' }
    Write-Warning 'Building from uncommitted tracked changes; release.json records sourceState dirty. Untracked files are not included.'
}
$commitTime = [DateTimeOffset]::Parse((& $git -C $repository show -s --format=%cI HEAD).Trim()).ToUniversalTime()
$builtAt = $commitTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")

$iscc = $null; $isccVersion = $null
if (-not $PayloadOnly) {
    $candidates = @()
    if ($IsccPath) { $candidates += (Resolve-UserPath $IsccPath) }
    $candidates += @((Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'), (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'))
    $iscc = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not $iscc) { throw 'ISCC.exe (Inno Setup 6) was not found. Pass -IsccPath, or use -PayloadOnly.' }
    $isccVersion = Get-InnoVersion $iscc
    if (-not $isccVersion -or $isccVersion -lt [Version]$innoPin.minimumVersion -or $isccVersion.Major -ne 6) { throw "Inno Setup $isccVersion is not supported; install 6.x >= $($innoPin.minimumVersion) (tested $($innoPin.testedVersion))." }
    Write-Step "Using Inno Setup $isccVersion at $iscc"
}

$localRoot = [IO.Path]::GetFullPath((Join-Path $repository '.local'))
$work = Join-Path $localRoot ('installer-build-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$source = Join-Path $work 'src'
$payload = Join-Path $work 'payload'
$appPayload = Join-Path $payload 'app'
$null = New-Item -ItemType Directory -Path $source, $appPayload -Force
$oldPath = $env:PATH
try {
    Write-Step "Exporting $revision"
    $tree = 'HEAD'
    if ($dirty) { $stashTree = (& $git -C $repository stash create).Trim(); if ($stashTree) { $tree = $stashTree } }
    $sourceZip = Join-Path $work 'source.zip'
    Invoke-Checked $git @('-C', $repository, 'archive', '--format=zip', '-o', $sourceZip, $tree) 'git archive'
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($sourceZip, $source)
    $version = [string](Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json).version
    if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "package.json version '$version' must be x.y.z for a release." }

    Write-Step 'Building the web app (npm ci, npm run build)'
    Push-Location $source
    try {
        Invoke-Checked 'npm.cmd' @('ci', '--no-audit', '--no-fund') 'npm ci'
        Invoke-Checked 'npm.cmd' @('run', 'build') 'npm run build'
    } finally { Pop-Location }

    Write-Step 'Rendering installer art'
    $art = & (Join-Path $source 'windows\installer\New-InstallerArt.ps1') -OutputDirectory (Join-Path $work 'art')

    Write-Step 'Assembling app/'
    Copy-Item -LiteralPath (Join-Path $source 'dist') -Destination $appPayload -Recurse
    if (Test-Path -LiteralPath (Join-Path $appPayload 'dist\windows')) { Remove-Item -LiteralPath (Join-Path $appPayload 'dist\windows') -Recurse -Force }
    Copy-Item -LiteralPath (Join-Path $source 'package.json'), (Join-Path $source 'package-lock.json') -Destination $appPayload
    $appWindows = Join-Path $appPayload 'windows'
    $null = New-Item -ItemType Directory -Path $appWindows
    Copy-Item -LiteralPath (Join-Path $source 'windows\LivingRoomDisplay.ps1') -Destination $appWindows
    $null = & (Join-Path $source 'windows\Build-Host.ps1') -OutputDirectory $appWindows -IconFile $art.Icon -Version $version
    Push-Location $appPayload
    try { Invoke-Checked 'npm.cmd' @('ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund') 'production npm ci' } finally { Pop-Location }

    Write-Step 'Writing THIRD-PARTY-NOTICES.txt'
    $notices = New-Object Text.StringBuilder
    $null = $notices.AppendLine('Living Room Display - third-party notices').AppendLine('')
    $null = $notices.AppendLine("Node.js $($runtimePin.version) (runtime\node.exe and npm): see runtime\LICENSE, which includes the licenses of its bundled components.").AppendLine('')
    $null = $notices.AppendLine('The Setup program is built with Inno Setup (https://jrsoftware.org/isinfo.php), Copyright (C) 1997-2026 Jordan Russell and Martijn Laan; see https://jrsoftware.org/files/is/license.txt.').AppendLine('')
    $packageDirectories = @(Get-ChildItem -LiteralPath (Join-Path $appPayload 'node_modules') -Directory -Force | Where-Object { $_.Name -ne '.bin' } | ForEach-Object { if ($_.Name.StartsWith('@')) { Get-ChildItem -LiteralPath $_.FullName -Directory -Force } else { $_ } })
    foreach ($directory in ($packageDirectories | Sort-Object { $_.FullName.Substring($appPayload.Length) })) {
        $manifestFile = Join-Path $directory.FullName 'package.json'
        if (-not (Test-Path -LiteralPath $manifestFile)) { continue }
        $package = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
        $license = if ($package.PSObject.Properties['license']) { [string]$package.license } else { 'see package' }
        $null = $notices.AppendLine(('=' * 72)).AppendLine("$($package.name) $($package.version) - $license").AppendLine(('=' * 72))
        $licenseFile = Get-ChildItem -LiteralPath $directory.FullName -File -Force | Where-Object { $_.Name -match '^(LICEN[CS]E|COPYING)(\..*)?$' } | Select-Object -First 1
        if ($licenseFile) { $null = $notices.AppendLine((Get-Content -LiteralPath $licenseFile.FullName -Raw).TrimEnd()) } else { $null = $notices.AppendLine('No license file is included in this package.') }
        $null = $notices.AppendLine('')
    }
    [IO.File]::WriteAllText((Join-Path $appPayload 'THIRD-PARTY-NOTICES.txt'), $notices.ToString().Replace("`r`n", "`n"), (New-Object Text.UTF8Encoding($false)))

    Write-Step "Adding the pinned Node $($runtimePin.version) runtime"
    $cache = Join-Path $localRoot 'installer-cache'
    $null = New-Item -ItemType Directory -Path $cache -Force
    $nodeZip = Join-Path $cache $runtimePin.archive
    if ((Test-Path -LiteralPath $nodeZip) -and (Get-Sha256 $nodeZip) -ne $runtimePin.sha256) { Remove-Item -LiteralPath $nodeZip -Force }
    if (-not (Test-Path -LiteralPath $nodeZip)) {
        $partial = $nodeZip + '.download'
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $runtimePin.url -OutFile $partial -UseBasicParsing
        if ((Get-Sha256 $partial) -ne $runtimePin.sha256) { Remove-Item -LiteralPath $partial -Force; throw 'The downloaded Node archive does not match runtime.json.' }
        Move-Item -LiteralPath $partial -Destination $nodeZip
    }
    if ((Get-Sha256 $nodeZip) -ne $runtimePin.sha256) { throw 'The cached Node archive does not match runtime.json.' }
    $nodeExtract = Join-Path $work 'node'
    [IO.Compression.ZipFile]::ExtractToDirectory($nodeZip, $nodeExtract)
    Move-Item -LiteralPath (Join-Path $nodeExtract "node-v$($runtimePin.version)-win-x64") -Destination (Join-Path $payload 'runtime')
    $nodeExe = Join-Path $payload 'runtime\node.exe'
    $signature = Get-AuthenticodeSignature -LiteralPath $nodeExe
    if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch 'OpenJS Foundation') { throw "node.exe does not carry a valid OpenJS Foundation signature ($($signature.Status))." }
    $reported = (& $nodeExe --version).Trim()
    if ($reported -ne "v$($runtimePin.version)") { throw "The packaged node.exe reports $reported." }

    if ($SignCommand) {
        Write-Step 'Signing the helper'
        $helper = Join-Path $appWindows 'LivingRoomDisplay.scr'
        Invoke-Checked $env:ComSpec @('/d', '/c', $SignCommand.Replace('{file}', '"' + $helper + '"')) 'Helper signing'
    }

    Write-Step 'Writing release.json'
    $files = New-Object 'Collections.Generic.List[object]'
    foreach ($item in (Get-ChildItem -LiteralPath $payload -Recurse -Force)) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "The payload contains a reparse point: $($item.FullName)" }
        if ($item.PSIsContainer) { continue }
        $files.Add([ordered]@{path=$item.FullName.Substring($payload.Length + 1).Replace('\', '/');size=[int64]$item.Length;sha256=(Get-Sha256 $item.FullName)})
    }
    # Ordinal path order keeps release.json and the zip byte-for-byte repeatable.
    $ordinal = New-Object 'Collections.Generic.List[object]'
    $byPath = @{}; foreach ($file in $files) { $byPath[$file.path] = $file }
    $paths = [string[]]@($files | ForEach-Object { $_.path })
    [Array]::Sort($paths, [StringComparer]::Ordinal)
    foreach ($path in $paths) { $ordinal.Add($byPath[$path]) }
    $manifest = [ordered]@{
        product='living-room-display'; schema=1; version=$version; sourceRevision=$revision
        sourceState=$(if ($dirty) { 'dirty' } else { 'clean' }); builtAt=$builtAt
        node=[ordered]@{version=$runtimePin.version;archive=$runtimePin.archive;sha256=$runtimePin.sha256}
        inno=[ordered]@{version=$(if ($isccVersion) { $isccVersion.ToString() } else { [string]$innoPin.testedVersion })}
        files=$ordinal.ToArray()
    }
    $releaseJson = Join-Path $work 'release.json'
    [IO.File]::WriteAllText($releaseJson, (($manifest | ConvertTo-Json -Depth 6) -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding($false)))

    Write-Step 'Creating payload.zip (stored, forward-slash entries, fixed timestamps)'
    $payloadZip = Join-Path $work 'payload.zip'
    $entries = @(@{Name='release.json';Path=$releaseJson}) + @(foreach ($path in $paths) { @{Name=$path;Path=(Join-Path $payload $path.Replace('/', '\'))} })
    $stream = [IO.File]::Open($payloadZip, [IO.FileMode]::CreateNew)
    try {
        $zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($entry in $entries) {
                $zipEntry = $zip.CreateEntry($entry.Name, [IO.Compression.CompressionLevel]::NoCompression)
                $zipEntry.LastWriteTime = $commitTime
                $writer = $zipEntry.Open()
                $reader = [IO.File]::OpenRead($entry.Path)
                try { $reader.CopyTo($writer) } finally { $reader.Dispose(); $writer.Dispose() }
            }
        } finally { $zip.Dispose() }
    } finally { $stream.Dispose() }
    $payloadSha = Get-Sha256 $payloadZip

    Write-Step 'Checking the payload'
    & (Join-Path $installerDirectory 'tests\Test-InstallerPayload.ps1') -PayloadDirectory $payload -ArchivePath $payloadZip -ReleaseJson $releaseJson

    $null = New-Item -ItemType Directory -Path $OutputDirectory -Force
    Copy-Item -LiteralPath $payloadZip, $releaseJson -Destination $OutputDirectory -Force
    if ($PayloadOnly) {
        $payloadOut = Join-Path $OutputDirectory 'payload'
        if (Test-Path -LiteralPath $payloadOut) { Remove-Item -LiteralPath $payloadOut -Recurse -Force }
        Move-Item -LiteralPath $payload -Destination $payloadOut
        Write-Step "Payload $version ready: $(Join-Path $OutputDirectory 'payload.zip') (sha256 $payloadSha)"
        return
    }

    Write-Step 'Compiling Setup with Inno Setup'
    $baseName = "LivingRoomDisplaySetup-$version"
    $uninstallSize = [int64]0; foreach ($file in $ordinal) { $uninstallSize += [int64]$file.size }
    $isccArguments = @('/Qp', "/O$OutputDirectory", "/F$baseName", "/DAppVersion=$version", "/DPayloadZip=$payloadZip", "/DPayloadSha256=$payloadSha",
        "/DControlScript=$(Join-Path $appWindows 'LivingRoomDisplay.ps1')", "/DSetupIconFile=$($art.Icon)",
        "/DWizardSmallImages=$($art.WizardSmall -join ',')", "/DWizardImages=$($art.WizardLarge -join ',')", "/DUninstallSize=$uninstallSize")
    if ($SignCommand) { $isccArguments += @('/DSignToolName=lrdsign', ('/Slrdsign=' + $SignCommand.Replace('{file}', '$f'))) }
    $isccArguments += (Join-Path $source 'windows\installer\LivingRoomDisplay.iss')
    Invoke-Checked $iscc $isccArguments 'Inno Setup compilation'
    $setup = Join-Path $OutputDirectory "$baseName.exe"
    if (-not (Test-Path -LiteralPath $setup)) { throw 'Inno Setup did not produce the expected setup file.' }
    $setupSha = Get-Sha256 $setup
    [IO.File]::WriteAllText("$setup.sha256", "$setupSha  $baseName.exe`n", (New-Object Text.UTF8Encoding($false)))
    $megabytes = [Math]::Round((Get-Item -LiteralPath $setup).Length / 1MB, 1)
    Write-Step "Setup ready: $setup ($megabytes MB, sha256 $setupSha; payload $payloadSha)"
    if ($megabytes -lt 25 -or $megabytes -gt 50) { Write-Warning "Setup size $megabytes MB is outside the expected 33-38 MB range; review the payload." }
} finally {
    $env:PATH = $oldPath
    if ($KeepWork) { Write-Step "Work folder kept: $work" }
    elseif (Test-Path -LiteralPath $work) {
        if (-not ([IO.Path]::GetFullPath($work)).StartsWith($localRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to remove a work folder outside .local.' }
        Remove-Item -LiteralPath $work -Recurse -Force
    }
}
