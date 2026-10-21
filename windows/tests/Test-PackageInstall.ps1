Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# InstallPackage transaction tests. Synthetic packages are built here; the real
# control script runs its file transactions inside a scratch folder under .local.
# Start/Stop, idle, the port probe, runtime version, disk space and health are
# mocked: no listener, registry write, capture, kiosk or real install is used.
$windowsDirectory = Split-Path $PSScriptRoot -Parent
$repository = Split-Path $windowsDirectory -Parent
$controlScript = Join-Path $windowsDirectory 'LivingRoomDisplay.ps1'
$scratchRoot = Join-Path $repository ('.local\package-install-' + [Guid]::NewGuid().ToString('N'))
$testRoot = Join-Path $scratchRoot 'install\Living Room'
$packages = Join-Path $scratchRoot 'packages'
$outside = Join-Path $scratchRoot 'outside'
$logFile = Join-Path $scratchRoot 'logs\setup-helper.log'
$junctions = New-Object 'Collections.Generic.List[string]'
$script:checks = 0
$null = New-Item -ItemType Directory -Path $packages,$outside,(Split-Path $logFile -Parent),(Split-Path $testRoot -Parent) -Force
[IO.File]::WriteAllText((Join-Path $outside 'keep.txt'),'outside the install root')

function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw "FAILED: $Message" } }
function Complete-Check([string]$Name) { $script:checks++ }

# Expected refusals also print their reason to stderr; keep the test output readable.
$originalError = [Console]::Error
[Console]::SetError([IO.TextWriter]::Null)
try {
    . $controlScript -InstallRoot $testRoot -LogPath $logFile -FunctionsOnly
    Initialize-ZipSupport
    $realScriptBytes = [IO.File]::ReadAllBytes($controlScript)
    $realStopApp = ${function:Stop-App}

    # ---- mocks for external boundaries -------------------------------------
    function Reset-Mocks {
        $script:starts = 0; $script:stops = 0; $script:portBusy = $false; $script:portBusyAfterStop = $false
        $script:runtimeVersion = 'v24.19.0'; $script:freeBytes = [int64]100GB
        $script:healthResults = New-Object 'Collections.Generic.Queue[bool]'; $script:serverRunning = $false
        $script:restartHealthy = $true; $script:faults = @{}; $script:snapshotCalls = 0; $script:startWritesData = $false
        $script:operationLockTimeoutMs = 300
        $script:moveRetryDelayMs = 10
        $script:controlScriptPath = $controlScript
        $script:PackageArchive = $null; $script:PackageSha256 = $null; $script:AllowDowngrade = $false; $script:RemoveData = $false
        if (Test-Path -LiteralPath $logFile) { Remove-Item -LiteralPath $logFile -Force }
    }
    function Start-App {
        $script:starts++; $script:serverRunning = $true
        # A server that writes its default settings before it fails its health check.
        if ($script:startWritesData) { $null = New-Item -ItemType Directory -Path $data -Force; [IO.File]::WriteAllText((Join-Path $data 'state.json'), '{"syntheticDefaults":true}') }
    }
    function Stop-App { $script:stops++; $script:serverRunning = $false; if ($script:portBusyAfterStop) { $script:portBusy = $true } }
    function Set-Idle { param($Enable) }
    function Get-OwnedServer { if ($script:serverRunning) { return [pscustomobject]@{Id=1} }; return $null }
    function Test-PortInUse { return $script:portBusy }
    function Get-RuntimeVersion { param($NodePath) return $script:runtimeVersion }
    function Get-FreeBytes { param($Path) return $script:freeBytes }
    function Test-PackageHealth { param($ExpectedVersion) if ($script:healthResults.Count) { return $script:healthResults.Dequeue() }; return $true }
    function Test-Server { return $script:restartHealthy }
    function Invoke-PackageFaultPoint { param($Name) if ($script:faults.ContainsKey($Name)) { & $script:faults[$Name] } }
    $realSaveDataSnapshot = ${function:Save-DataSnapshot}
    function Save-DataSnapshot { param($InstalledVersion) $script:snapshotCalls++; & $realSaveDataSnapshot $InstalledVersion }
    # A source Install/Update (Install-App): no download, build or browser.
    $NoBrowser = $true
    $script:sourceVersion = '0.2.5'
    function Install-Runtime { }
    function Get-SourceProvenance { param($Source, $HostDirectory) return [pscustomobject]@{sourceRevision=('e' * 40);sourceState='clean'} }
    function Build-InstallCandidate {
        param($Source, $Next)
        $null = New-Item -ItemType Directory -Path (Join-Path $Next 'dist\server'),(Join-Path $Next 'dist\client') -Force
        [IO.File]::WriteAllText((Join-Path $Next 'dist\server\index.js'), 'source server')
        [IO.File]::WriteAllText((Join-Path $Next 'dist\client\index.html'), 'source client')
        [IO.File]::WriteAllText((Join-Path $Next 'package.json'), ('{"version":"' + $script:sourceVersion + '"}'))
    }

    # ---- fixture helpers ---------------------------------------------------
    function Get-TreeState([string]$Path) {
        if (-not (Test-Path -LiteralPath $Path)) { return '<absent>' }
        $lines = foreach ($file in (Get-ChildItem -LiteralPath $Path -Recurse -Force -File | Sort-Object FullName)) { $file.FullName.Substring($Path.Length) + '|' + (Get-Sha256 $file.FullName) }
        $dirs = foreach ($dir in (Get-ChildItem -LiteralPath $Path -Recurse -Force -Directory | Sort-Object FullName)) { $dir.FullName.Substring($Path.Length) + '/' }
        return ((@($lines) + @($dirs)) -join "`n")
    }
    function Reset-Root {
        foreach ($link in @($junctions)) { if (Test-Path -LiteralPath $link) { [IO.Directory]::Delete($link, $false) } }
        $junctions.Clear()
        if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
    }
    function Get-Utf8([string]$Text) { return (New-Object Text.UTF8Encoding($false)).GetBytes($Text) }
    function New-PackageSpec([string]$Version, [string]$NodeVersion) {
        $spec = [ordered]@{}
        $spec['app/package.json'] = Get-Utf8 ('{"name":"living-room-display","version":"' + $Version + '"}')
        $spec['app/package-lock.json'] = Get-Utf8 '{}'
        $spec['app/dist/server/index.js'] = Get-Utf8 "synthetic server $Version"
        $spec['app/dist/client/index.html'] = Get-Utf8 "synthetic client $Version"
        $spec['app/node_modules/zod/package.json'] = Get-Utf8 '{"name":"zod"}'
        $spec['app/windows/LivingRoomDisplay.ps1'] = $realScriptBytes
        $spec['app/windows/LivingRoomDisplay.scr'] = Get-Utf8 "synthetic helper $Version"
        $spec['app/THIRD-PARTY-NOTICES.txt'] = Get-Utf8 'synthetic notices'
        $spec['runtime/node.exe'] = Get-Utf8 "synthetic node $NodeVersion"
        $spec['runtime/LICENSE'] = Get-Utf8 'synthetic runtime license'
        return $spec
    }
    function Get-BytesSha256([byte[]]$Bytes) {
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { return ([BitConverter]::ToString($hasher.ComputeHash($Bytes)) -replace '-','').ToLowerInvariant() } finally { $hasher.Dispose() }
    }
    function New-TestPackage {
        param([string]$Version = '0.2.0', [string]$NodeVersion = '24.19.0', [string]$Tamper, [string]$Extra, [string]$Drop, [string]$UnsafeName, [string]$ManifestOnlyPath, [string]$LongPath)
        $spec = New-PackageSpec $Version $NodeVersion
        if ($LongPath) { $spec[$LongPath] = Get-Utf8 'deep file' }
        $files = @(foreach ($name in $spec.Keys) { [ordered]@{path=$name;size=$spec[$name].Length;sha256=(Get-BytesSha256 $spec[$name])} })
        if ($ManifestOnlyPath) { $files += [ordered]@{path=$ManifestOnlyPath;size=1;sha256=('0' * 64)} }
        $manifest = [ordered]@{product='living-room-display';schema=1;version=$Version;sourceRevision=('a' * 40);sourceState='clean';builtAt='2026-10-18T00:00:00Z';node=[ordered]@{version=$NodeVersion;archive="node-v$NodeVersion-win-x64.zip";sha256=('b' * 64)};inno=[ordered]@{version='6.7.1'};files=$files}
        if ($Tamper) { $bytes = [byte[]]$spec[$Tamper].Clone(); $bytes[0] = [byte](($bytes[0] + 1) % 256); $spec[$Tamper] = $bytes }
        if ($Extra) { $spec[$Extra] = Get-Utf8 'unlisted' }
        if ($Drop) { $spec.Remove($Drop) }
        if ($UnsafeName) { $spec[$UnsafeName] = Get-Utf8 'unsafe' }
        $spec['release.json'] = Get-Utf8 ($manifest | ConvertTo-Json -Depth 6)
        $path = Join-Path $packages ([Guid]::NewGuid().ToString('N') + '.zip')
        $stream = [IO.File]::Open($path, [IO.FileMode]::CreateNew)
        try {
            $zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
            try {
                foreach ($name in $spec.Keys) {
                    $entry = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::NoCompression)
                    $writer = $entry.Open()
                    try { $writer.Write($spec[$name], 0, $spec[$name].Length) } finally { $writer.Dispose() }
                }
            } finally { $zip.Dispose() }
        } finally { $stream.Dispose() }
        return [pscustomobject]@{Path=$path;Sha256=(Get-Sha256 $path);Version=$Version}
    }
    function Invoke-Package($Package, [string]$Sha256) {
        $script:PackageArchive = $Package.Path
        $script:PackageSha256 = if ($Sha256) { $Sha256 } else { $Package.Sha256 }
        return (Invoke-PackageCommand)
    }
    function Get-Marker { return (Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json) }
    function New-SourceInstall([string]$AppVersion = '0.1.0', [string]$Channel) {
        $null = New-Item -ItemType Directory -Path (Join-Path $app 'dist\server'),(Join-Path $app 'windows'),$runtime,(Join-Path $data 'photos') -Force
        [IO.File]::WriteAllText((Join-Path $app 'package.json'), '{"version":"' + $AppVersion + '"}')
        [IO.File]::WriteAllText((Join-Path $app 'dist\server\index.js'), 'previous server')
        [IO.File]::WriteAllText((Join-Path $runtime 'node.exe'), 'previous node')
        [IO.File]::WriteAllText((Join-Path $data 'state.json'), '{"syntheticSettings":"preserve","reminders":["synthetic reminder"]}')
        [IO.File]::WriteAllText((Join-Path $data 'state.backup.json'), '{"syntheticSettings":"older"}')
        [IO.File]::WriteAllBytes((Join-Path $data 'photos\photo.png'), [byte[]](1..200 | ForEach-Object { [byte]$_ }))
        $fields = [ordered]@{product='living-room-display';state='installed';installedAt='2026-10-01T00:00:00.0000000Z';version=$AppVersion;sourceRevision=('c' * 40);sourceState='clean'}
        if ($Channel) { $fields.channel = $Channel; $fields.runtimeVersion = '24.19.0'; $fields.runtimePreviousOwner = $null; $fields.packageSha256 = ('d' * 64) }
        Write-Json $marker $fields
    }
    function Assert-NoStaging {
        foreach ($name in @('package.next','runtime.next','app.next')) { Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot $name))) "$name was left behind." }
        Assert-True (@(Get-AsideDirectories @('removing')).Count -eq 0 -and -not (Test-Path -LiteralPath ($marker + '.tmp')) -and -not (Test-Path -LiteralPath ($transaction + '.tmp'))) 'A removal folder or a temporary record or marker file was left behind.'
    }
    # A file held open without sharing, as a scanner or an open editor can do.
    function Open-Held([string]$Path) { return [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None) }

    # ---- 1. fresh install into a missing folder, then an empty folder -------
    foreach ($precreate in @($false,$true)) {
        Reset-Root; Reset-Mocks
        if ($precreate) { $null = New-Item -ItemType Directory -Path $testRoot }
        $package = New-TestPackage
        $code = Invoke-Package $package
        Assert-True ($code -eq 0) "Fresh install (precreated=$precreate) returned $code. Log: $(Get-Content -Raw $logFile)"
        $installed = Get-Marker
        Assert-True ($installed.product -eq 'living-room-display' -and $installed.state -eq 'installed' -and $installed.channel -eq 'package' -and $installed.version -eq '0.2.0') 'Fresh marker fields are wrong.'
        Assert-True ($installed.runtimeVersion -eq '24.19.0' -and $null -eq $installed.runtimePreviousOwner -and $installed.packageSha256 -eq $package.Sha256 -and $installed.sourceRevision -eq ('a' * 40)) 'Fresh marker runtime/package fields are wrong.'
        Assert-True ((Test-Path -LiteralPath (Join-Path $app 'release.json')) -and (Test-Path -LiteralPath (Join-Path $runtime 'node.exe')) -and (Test-Path -LiteralPath (Join-Path $app 'dist\server\index.js'))) 'Fresh install files are missing.'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot 'app.previous')) -and $script:starts -eq 1 -and $script:snapshotCalls -eq 0) 'Fresh install made a previous app or snapshot, or did not start once.'
        Assert-True ((Get-Content -Raw (Join-Path $app 'release.json') | ConvertFrom-Json).version -eq '0.2.0') 'app/release.json was not copied.'
        Assert-NoStaging
        Assert-True ((Get-Content -Raw $logFile) -match 'Result: exit 0') 'Helper log does not record success.'
    }
    Complete-Check 'fresh install'

    # ---- 2. adopting a source install --------------------------------------
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $script:serverRunning = $true
    $dataBefore = Get-TreeState $data
    $oldApp = Get-TreeState $app
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 0) "Source adoption returned $code. Log: $(Get-Content -Raw $logFile)"
    Assert-True ((Get-TreeState $data) -eq $dataBefore) 'Adoption changed data.'
    Assert-True ((Get-TreeState (Join-Path $InstallRoot 'app.previous')) -eq $oldApp) 'app.previous is not the old app.'
    $snapshots = @(Get-ChildItem -LiteralPath (Join-Path $InstallRoot 'backups') -Directory)
    Assert-True ($script:snapshotCalls -eq 1 -and $snapshots.Count -eq 1 -and $snapshots[0].Name -match '^data-before-0\.1\.0-\d{8}T\d{9}Z$') 'Adoption did not take exactly one named snapshot.'
    Assert-True ((Get-TreeState $snapshots[0].FullName) -eq $dataBefore) 'Snapshot is not hash-equal to data.'
    $installed = Get-Marker
    Assert-True ($installed.product -eq 'living-room-display' -and $installed.channel -eq 'package' -and $installed.runtimeVersion -eq '24.19.0') 'Adopted marker did not gain package fields.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $runtime 'node.exe')) -eq 'previous node') 'Same-version runtime was not kept.'
    Assert-True ($script:stops -ge 1 -and $script:starts -eq 1) 'Adoption did not stop and restart the app.'
    Assert-NoStaging
    Complete-Check 'source adoption with snapshot'

    # ---- 3/4/5. damaged packages leave everything unchanged -----------------
    $damaged = @(
        @{Name='wrong hash';Package={ New-TestPackage };Sha=('e' * 64)},
        @{Name='tampered file';Package={ New-TestPackage -Tamper 'app/dist/server/index.js' }},
        @{Name='extra file';Package={ New-TestPackage -Extra 'app/extra.txt' }},
        @{Name='missing file';Package={ New-TestPackage -Drop 'app/dist/client/index.html' }},
        @{Name='manifest lists absent file';Package={ New-TestPackage -ManifestOnlyPath 'app/absent.txt' }},
        @{Name='parent traversal';Package={ New-TestPackage -UnsafeName 'app/../../escaped.txt' }},
        @{Name='backslash traversal';Package={ New-TestPackage -UnsafeName 'app\..\..\escaped.txt' }},
        @{Name='absolute entry';Package={ New-TestPackage -UnsafeName '/escaped.txt' }},
        @{Name='drive letter';Package={ New-TestPackage -UnsafeName 'C:/escaped.txt' }},
        @{Name='outside app or runtime';Package={ New-TestPackage -UnsafeName 'data/state.json' }}
    )
    foreach ($case in $damaged) {
        Reset-Root; Reset-Mocks
        New-SourceInstall '0.1.0'
        $before = Get-TreeState $InstallRoot
        $package = & $case.Package
        $code = if ($case.ContainsKey('Sha')) { Invoke-Package $package $case.Sha } else { Invoke-Package $package }
        Assert-True ($code -eq 13) "$($case.Name) returned $code instead of 13."
        Assert-True ((Get-TreeState $InstallRoot) -eq $before) "$($case.Name) changed app, data or marker."
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $scratchRoot 'escaped.txt')) -and -not (Test-Path -LiteralPath (Join-Path (Split-Path $testRoot -Parent) 'escaped.txt'))) "$($case.Name) wrote outside staging."
        Assert-True ($script:stops -eq 0 -and $script:starts -eq 0) "$($case.Name) stopped or started the app."
    }
    Complete-Check 'damaged and unsafe packages'

    # ---- running script differs from the manifest copy ---------------------
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $before = Get-TreeState $InstallRoot
    $otherScript = Join-Path $scratchRoot 'other-script.ps1'
    [IO.File]::WriteAllText($otherScript, '# a different control script')
    $script:controlScriptPath = $otherScript
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 13 -and (Get-TreeState $InstallRoot) -eq $before) "A mismatched running script returned $code or changed files."
    Complete-Check 'script identity'

    # ---- install folder too long for the deepest package path --------------
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $before = Get-TreeState $InstallRoot
    $code = Invoke-Package (New-TestPackage -LongPath ('app/' + ('d' * 60) + '/' + ('e' * 60) + '/' + ('f' * 60) + '/' + ('g' * 40) + '.txt'))
    Assert-True ($code -eq 21 -and (Get-TreeState $InstallRoot) -eq $before -and (Get-Content -Raw $logFile) -match 'too long') "A too-long install path returned $code or changed files."
    Complete-Check 'path length preflight'

    # ---- explicit InstallRoot and archive placement (real -File runs) -------
    Reset-Root; Reset-Mocks
    $package = New-TestPackage
    $shell = (Get-Process -Id $PID).Path
    function Invoke-ChildScript([string]$Arguments) {
        $launch = New-Object Diagnostics.ProcessStartInfo
        $launch.FileName = $shell
        $launch.Arguments = '-NoProfile -NonInteractive -File "' + $controlScript + '" ' + $Arguments
        $launch.UseShellExecute = $false; $launch.CreateNoWindow = $true
        $launch.RedirectStandardError = $true; $launch.RedirectStandardOutput = $true
        $process = [Diagnostics.Process]::Start($launch)
        try {
            $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
            Assert-True ($process.WaitForExit(60000)) 'Child control script timed out.'
            $process.WaitForExit()
            return [pscustomobject]@{Code=$process.ExitCode;Out=$stdout.Result;Err=$stderr.Result}
        } finally { if (-not $process.HasExited) { $process.Kill() }; $process.Dispose() }
    }
    $childLog = Join-Path $scratchRoot 'logs\child.log'
    $result = Invoke-ChildScript ('InstallPackage -PackageArchive "' + $package.Path + '" -PackageSha256 ' + $package.Sha256 + ' -LogPath "' + $childLog + '"')
    Assert-True ($result.Code -eq 1 -and (Get-Content -Raw $childLog) -match 'explicit -InstallRoot') "Missing -InstallRoot was not refused: $($result.Code) $($result.Err)"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'LivingRoomDisplay\package.next'))) 'A default install root was touched.'
    $null = New-Item -ItemType Directory -Path $testRoot -Force
    $inside = Join-Path $testRoot 'payload.zip'
    Copy-Item -LiteralPath $package.Path -Destination $inside
    $script:PackageArchive = $inside; $script:PackageSha256 = $package.Sha256
    $code = Invoke-PackageCommand
    Assert-True ($code -eq 1 -and (Get-Content -Raw $logFile) -match 'must not be inside the install directory') "An archive inside InstallRoot returned $code."
    Reset-Root; Reset-Mocks
    $parentArchive = Join-Path (Split-Path $testRoot -Parent) 'payload.zip'
    Copy-Item -LiteralPath $package.Path -Destination $parentArchive
    $script:PackageArchive = $parentArchive; $script:PackageSha256 = $package.Sha256
    $code = Invoke-PackageCommand
    Remove-Item -LiteralPath $parentArchive -Force
    Assert-True ($code -eq 1 -and -not (Test-Path -LiteralPath $testRoot)) "An InstallRoot inside the archive folder returned $code or was created."
    Complete-Check 'explicit root and archive placement'

    # ---- 10: folder not ours ------------------------------------------------
    Reset-Root; Reset-Mocks
    $null = New-Item -ItemType Directory -Path $testRoot
    [IO.File]::WriteAllText((Join-Path $testRoot 'someone-else.txt'), 'unrelated')
    $before = Get-TreeState $testRoot
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 10 -and (Get-TreeState $testRoot) -eq $before) "A nonempty unmarked folder returned $code or changed."
    Reset-Root; Reset-Mocks
    $null = New-Item -ItemType Directory -Path $testRoot
    Write-Json $marker @{product='another-product'}
    $before = Get-TreeState $testRoot
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 10 -and (Get-TreeState $testRoot) -eq $before) "A foreign marker returned $code or changed."
    Complete-Check 'folder ownership'

    # ---- 11: port used by another program ----------------------------------
    Reset-Root; Reset-Mocks
    $script:portBusy = $true
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 11 -and -not (Test-Path -LiteralPath $testRoot)) "A non-owned listener returned $code or created files."
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $script:serverRunning = $true; $script:portBusyAfterStop = $true
    $before = Get-TreeState $InstallRoot
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 11 -and (Get-TreeState $InstallRoot) -eq $before) "A listener appearing after Stop returned $code or changed files."
    Complete-Check 'port preflight'

    # ---- 12: downgrade rules ------------------------------------------------
    Reset-Root; Reset-Mocks
    Assert-True ((Invoke-Package (New-TestPackage -Version '0.3.0')) -eq 0) 'Installing 0.3.0 failed.'
    Reset-Mocks
    $before = Get-TreeState $InstallRoot
    $code = Invoke-Package (New-TestPackage -Version '0.2.0')
    Assert-True ($code -eq 12 -and (Get-TreeState $InstallRoot) -eq $before) "A package downgrade returned $code or changed files."
    Reset-Mocks
    Assert-True ((Invoke-Package (New-TestPackage -Version '0.3.0')) -eq 0) 'A same-version repair failed.'
    Reset-Mocks
    $script:AllowDowngrade = $true
    $code = Invoke-Package (New-TestPackage -Version '0.2.0')
    Assert-True ($code -eq 0 -and (Get-Marker).version -eq '0.2.0') "AllowDowngrade returned $code."
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.3.0'
    $code = Invoke-Package (New-TestPackage -Version '0.2.0')
    Assert-True ($code -eq 0) "A source-channel marker with a newer version was refused ($code)."
    Complete-Check 'downgrade guard'

    # ---- runtime policy -----------------------------------------------------
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $script:runtimeVersion = 'v24.10.0'
    Assert-True ((Invoke-Package (New-TestPackage)) -eq 0) 'Runtime swap install failed.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $InstallRoot 'runtime.previous\node.exe')) -eq 'previous node' -and [IO.File]::ReadAllText((Join-Path $runtime 'node.exe')) -eq 'synthetic node 24.19.0') 'Newer packaged runtime was not swapped in.'
    Assert-True ((Get-Marker).runtimePreviousOwner -eq 'package' -and (Get-Marker).runtimeVersion -eq '24.19.0') 'Swap did not record package ownership.'
    # A later swap may replace the package-owned runtime.previous.
    Reset-Mocks
    $script:runtimeVersion = 'v24.18.0'
    Assert-True ((Invoke-Package (New-TestPackage)) -eq 0 -and [IO.File]::ReadAllText((Join-Path $InstallRoot 'runtime.previous\node.exe')) -eq 'synthetic node 24.19.0') 'A package-owned runtime.previous was not replaced by a later swap.'
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot 'runtime.previous')
    [IO.File]::WriteAllText((Join-Path $InstallRoot 'runtime.previous\node.exe'), 'user runtime backup')
    $script:runtimeVersion = 'v24.10.0'
    Assert-True ((Invoke-Package (New-TestPackage)) -eq 0) 'Install with a user runtime.previous failed.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $runtime 'node.exe')) -eq 'previous node' -and [IO.File]::ReadAllText((Join-Path $InstallRoot 'runtime.previous\node.exe')) -eq 'user runtime backup' -and $null -eq (Get-Marker).runtimePreviousOwner -and (Get-Marker).runtimeVersion -eq '24.10.0') 'A user runtime.previous was not preserved with the runtime kept.'
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $script:runtimeVersion = 'v24.30.0'
    Assert-True ((Invoke-Package (New-TestPackage)) -eq 0 -and [IO.File]::ReadAllText((Join-Path $runtime 'node.exe')) -eq 'previous node' -and (Get-Marker).runtimeVersion -eq '24.30.0') 'A newer existing runtime was not kept.'
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $script:runtimeVersion = 'v22.1.0'
    $before = Get-TreeState $InstallRoot
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 18 -and (Get-TreeState $InstallRoot) -eq $before) "A non-Node-24 runtime returned $code or changed files."
    Complete-Check 'runtime policy'

    # ---- injected failure after the swap, before the marker write ----------
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $script:serverRunning = $true
    $script:runtimeVersion = 'v24.10.0'
    $appBefore = Get-TreeState $app; $runtimeBefore = Get-TreeState $runtime; $markerBefore = Get-Sha256 $marker; $dataBefore = Get-TreeState $data
    $script:faults['after-swap'] = { throw 'synthetic failure after the swap' }
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 1) "Injected swap failure returned $code."
    Assert-True ((Get-TreeState $app) -eq $appBefore -and (Get-TreeState $runtime) -eq $runtimeBefore -and (Get-Sha256 $marker) -eq $markerBefore -and (Get-TreeState $data) -eq $dataBefore) 'Swap failure did not restore app, runtime, marker and data.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot 'runtime.previous')) -and -not (Test-Path -LiteralPath (Join-Path $InstallRoot 'app.previous')) -and $script:starts -eq 1) 'Swap failure left a moved runtime/app or did not restart the previous version.'
    Assert-NoStaging
    Complete-Check 'swap rollback'

    # ---- health failure: previous restored (15) or neither starts (16) ------
    foreach ($restartCase in @($true,$false)) {
        Reset-Root; Reset-Mocks
        New-SourceInstall '0.1.0'
        $script:serverRunning = $true; $script:runtimeVersion = 'v24.10.0'
        $script:healthResults.Enqueue($false); $script:restartHealthy = $restartCase
        $appBefore = Get-TreeState $app; $runtimeBefore = Get-TreeState $runtime; $markerBefore = Get-Sha256 $marker; $dataBefore = Get-TreeState $data
        $code = Invoke-Package (New-TestPackage)
        $expected = if ($restartCase) { 15 } else { 16 }
        Assert-True ($code -eq $expected) "Health failure (restart healthy=$restartCase) returned $code instead of $expected."
        Assert-True ((Get-TreeState $app) -eq $appBefore -and (Get-TreeState $runtime) -eq $runtimeBefore -and (Get-Sha256 $marker) -eq $markerBefore -and (Get-TreeState $data) -eq $dataBefore) 'Health failure did not restore the previous app/runtime/marker or changed data.'
        Assert-True ((Get-Content -Raw (Join-Path $InstallRoot 'app.failed\release.json') | ConvertFrom-Json).version -eq '0.2.0') 'The failed candidate was not kept as app.failed.'
        Assert-True ($script:starts -eq 2) 'The previous version was not restarted after the failed health check.'
        Assert-True (-not (Test-Path -LiteralPath $transaction) -and -not (Test-Path -LiteralPath (Join-Path $InstallRoot 'runtime.next')) -and -not (Test-Path -LiteralPath (Join-Path $InstallRoot 'runtime.previous'))) 'A completed rollback left its record or a set-aside runtime.'
    }
    Complete-Check 'health rollback'

    # ---- a failed or interrupted first install needs no manual cleanup (#179) --
    # A first install that can't start removes everything it added; the next
    # Setup run is a plain fresh install.
    Reset-Root; Reset-Mocks
    $script:healthResults.Enqueue($false)
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 16 -and -not (Test-Path -LiteralPath $testRoot)) "A fresh install that cannot start returned $code or left $testRoot behind."
    Assert-True ((Get-Content -Raw $logFile) -match 'Removed everything the failed first install added') 'The helper log does not say the failed first install was removed.'
    Reset-Mocks
    Assert-True ((Invoke-Package (New-TestPackage)) -eq 0 -and (Get-Marker).state -eq 'installed') 'A retry after a failed first install did not install.'
    # If the app wrote data before failing, only that data and the marker that
    # makes the folder ours stay; the retry keeps the data.
    Reset-Root; Reset-Mocks
    $script:healthResults.Enqueue($false); $script:startWritesData = $true
    $code = Invoke-Package (New-TestPackage)
    $left = @(Get-ChildItem -LiteralPath $testRoot -Force | ForEach-Object Name | Sort-Object)
    Assert-True ($code -eq 16 -and ($left -join ',') -eq 'data,installation.json' -and (Get-Marker).state -eq 'installing' -and -not (Test-Path -LiteralPath $transaction)) "A failed first install that wrote data returned $code or left: $($left -join ', ')"
    Assert-True ((Get-Content -Raw $logFile).Contains($script:firstInstallKeptDataNote)) 'The helper log does not say that only the data the app wrote was kept (#206).'
    $dataBefore = Get-TreeState $data
    Reset-Mocks
    Assert-True ((Invoke-Package (New-TestPackage)) -eq 0 -and (Get-Marker).state -eq 'installed' -and (Get-TreeState $data) -eq $dataBefore) 'A retry after a failed first install with data did not install or changed the data.'
    # A first install interrupted while staging (Setup killed, power cut) leaves
    # its marker and package.next; the older Setup also left runtime and
    # app.failed after a failed first install. The next run cleans up and installs.
    Reset-Root; Reset-Mocks
    $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot 'package.next\app\dist'),(Join-Path $InstallRoot 'app.failed\dist'),$runtime -Force
    [IO.File]::WriteAllText((Join-Path $runtime 'node.exe'), 'synthetic node 24.19.0')
    Write-Json $marker ([ordered]@{product='living-room-display';state='installing';createdFolder=$true})
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 0 -and (Get-Marker).state -eq 'installed' -and @(Get-AsideDirectories $script:asideNames).Count -eq 0 -and (Get-Content -Raw $logFile) -match 'earlier first install did not finish') "Setup after an interrupted first install returned $code or left set-aside folders. Log: $(Get-Content -Raw $logFile)"
    Assert-NoStaging
    # A staging failure on a first install leaves nothing behind.
    Reset-Root; Reset-Mocks
    $script:faults['extracted'] = { throw 'synthetic staging failure' }
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 13 -and -not (Test-Path -LiteralPath $testRoot)) "A failed first staging returned $code or left $testRoot behind."
    # A reinstall after "Keep my data" that can't start: the kept data, backups
    # and uninstalled marker stay exactly as they were; nothing else is left.
    Reset-Root; Reset-Mocks
    $null = New-Item -ItemType Directory -Path (Join-Path $data 'photos') -Force
    [IO.File]::WriteAllText((Join-Path $data 'state.json'), '{"syntheticSettings":"kept"}')
    Write-Json $marker ([ordered]@{product='living-room-display';state='uninstalled';version='0.1.0';channel='package';uninstalledAt='2026-10-02T00:00:00.0000000Z'})
    $dataBefore = Get-TreeState $data; $markerBefore = Get-Sha256 $marker
    $script:healthResults.Enqueue($false)
    $code = Invoke-Package (New-TestPackage)
    $left = @(Get-ChildItem -LiteralPath $testRoot -Force | ForEach-Object Name | Sort-Object)
    Assert-True ($code -eq 16 -and (Get-TreeState $data) -eq $dataBefore -and (Get-Sha256 $marker) -eq $markerBefore -and ($left -join ',') -eq 'backups,data,installation.json') "A failed kept-data reinstall returned $code, changed the kept data or left: $($left -join ', ')"
    Complete-Check 'failed and interrupted first install'

    # ---- an undo that fails is reported honestly and finished by the next run --
    # Review finding: a rename during rollback can fail (a dying process still
    # holds app). A brief failure is retried; a lasting one must give E20, keep
    # app.previous, and the next Setup run must put it back instead of deleting it.
    $transientFault = { if ($script:moveFailuresLeft -gt 0) { $script:moveFailuresLeft--; throw (New-Object IO.IOException 'The process cannot access the file because it is being used by another process.') } }
    $lastingFault = { throw (New-Object IO.IOException 'The process cannot access the file because it is being used by another process.') }
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $script:serverRunning = $true; $script:runtimeVersion = 'v24.10.0'
    $script:healthResults.Enqueue($false)
    $script:moveFailuresLeft = 1; $script:faults['move-app.failed'] = $transientFault
    $appBefore = Get-TreeState $app
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 15 -and (Get-TreeState $app) -eq $appBefore -and (Get-Content -Raw $logFile) -match 'attempt 1 of') "A rename that failed once was not retried into E15 ($code)."
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $script:serverRunning = $true; $script:runtimeVersion = 'v24.10.0'
    $script:healthResults.Enqueue($false)
    $script:faults['move-app.failed'] = $lastingFault
    $appBefore = Get-TreeState $app; $runtimeBefore = Get-TreeState $runtime; $dataBefore = Get-TreeState $data; $markerBefore = [IO.File]::ReadAllText($marker)
    $code = Invoke-Package (New-TestPackage)
    $log = Get-Content -Raw $logFile
    Assert-True ($code -eq 20) "A rollback that could not finish returned $code instead of 20. Log: $log"
    Assert-True ($log -match 'Failed \(exit 20\): LRD-E20: .*app\.previous' -and $log -notmatch 'previous version was restored') 'E20 does not say where the previous version is.'
    Assert-True ((Get-TreeState (Join-Path $InstallRoot 'app.previous')) -eq $appBefore -and (Get-TreeState $data) -eq $dataBefore -and (Test-Path -LiteralPath $transaction)) 'A failed rollback lost app.previous, changed data or dropped its record.'
    Assert-True ($script:starts -eq 1) 'A failed rollback started a half-restored install.'
    # The same failure on the next run: still E20, and nothing is lost.
    Reset-Mocks
    $script:faults['move-app.failed'] = $lastingFault
    $before = Get-TreeState $InstallRoot
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 20 -and (Get-TreeState $InstallRoot) -eq $before -and (Get-TreeState (Join-Path $InstallRoot 'app.previous')) -eq $appBefore) "A repeated failed resume returned $code or changed files."
    # A source Update must not replace app.previous meanwhile.
    $refused = $false
    try { Install-App } catch { $refused = $_.Exception.Message -match 'did not finish putting the previous version back' }
    Assert-True ($refused -and (Get-TreeState (Join-Path $InstallRoot 'app.previous')) -eq $appBefore) 'A source Update was not refused during an unfinished rollback.'
    # Once the folder is free, the next Setup finishes the rollback and then installs.
    Reset-Mocks
    $script:runtimeVersion = 'v24.10.0'
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 0) "Setup after an unfinished rollback returned $code. Log: $(Get-Content -Raw $logFile)"
    Assert-True ((Get-TreeState (Join-Path $InstallRoot 'app.previous')) -eq $appBefore -and (Get-TreeState $data) -eq $dataBefore) 'Finishing the rollback deleted the last working app or changed data.'
    Assert-True ((Get-Marker).version -eq '0.2.0' -and -not (Test-Path -LiteralPath $transaction) -and -not (Test-Path -LiteralPath (Join-Path $InstallRoot 'runtime.next')) -and -not (Test-Path -LiteralPath (Join-Path $InstallRoot 'app.next'))) 'The resumed install left its record or set-aside folders.'
    Assert-True ([IO.File]::ReadAllText((Join-Path $InstallRoot 'runtime.previous\node.exe')) -eq 'previous node' -and (Get-Content -Raw (Join-Path $app 'release.json') | ConvertFrom-Json).version -eq '0.2.0') 'The resumed install did not swap in the new app and runtime.'
    Assert-True ((Get-Content -Raw $logFile) -match 'did not finish') 'The helper log does not record the resumed rollback.'
    Complete-Check 'unfinished rollback'

    # ---- an old app.failed that can't be deleted never stops a rollback (#196) --
    # A scanner, an indexer or an open file can hold a file in an app.failed left
    # by an earlier failed update. The rollback only renames: the candidate gets
    # the next free name, so the result is E15 (never E20), on a health failure
    # and on a resumed rollback alike.
    function New-HeldFailedApp([string]$Name = 'app.failed') {
        $folder = Join-Path $InstallRoot $Name
        $null = New-Item -ItemType Directory -Path $folder -Force
        [IO.File]::WriteAllText((Join-Path $folder 'release.json'), '{"version":"0.0.9"}')
        return [IO.File]::Open((Join-Path $folder 'release.json'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    }
    function Get-FolderVersion([string]$Name) { return [string](Get-Content -Raw (Join-Path $InstallRoot "$Name\release.json") | ConvertFrom-Json).version }
    $held = $null
    try {
        Reset-Root; Reset-Mocks
        New-SourceInstall '0.1.0'
        $script:serverRunning = $true; $script:runtimeVersion = 'v24.10.0'
        $script:healthResults.Enqueue($false)
        $held = New-HeldFailedApp
        $appBefore = Get-TreeState $app; $runtimeBefore = Get-TreeState $runtime; $dataBefore = Get-TreeState $data; $markerBefore = Get-Sha256 $marker
        $code = Invoke-Package (New-TestPackage)
        $log = Get-Content -Raw $logFile
        Assert-True ($code -eq 15) "A held app.failed turned a health-failure rollback into $code instead of 15. Log: $log"
        Assert-True ((Get-TreeState $app) -eq $appBefore -and (Get-TreeState $runtime) -eq $runtimeBefore -and (Get-TreeState $data) -eq $dataBefore -and (Get-Sha256 $marker) -eq $markerBefore) 'The rollback next to a held app.failed did not restore app, runtime and marker, or changed data.'
        Assert-True ((Get-FolderVersion 'app.failed-2') -eq '0.2.0' -and -not (Test-Path -LiteralPath $transaction) -and $script:starts -eq 2) 'The candidate was not kept under the next free name, the record remained, or the previous version did not restart.'
        Assert-True ($log -match 'Could not remove .*app\.failed yet') 'The helper log does not say the old app.failed could not be removed yet.'
        Assert-NoStaging
        $held.Dispose(); $held = $null
        Assert-True ((Get-FolderVersion 'app.failed') -eq '0.0.9') 'The rollback deleted or replaced the old app.failed.'
        # The next Setup run removes both copies once nothing holds them.
        Reset-Mocks
        Assert-True ((Invoke-Package (New-TestPackage)) -eq 0 -and @(Get-AsideDirectories $script:asideNames).Count -eq 0) 'The next Setup did not remove the old set-aside copies.'

        # A resumed rollback (crash or power cut mid-swap) next to a held app.failed.
        Reset-Root; Reset-Mocks
        New-SourceInstall '0.1.0'
        $appBefore = Get-TreeState $app; $dataBefore = Get-TreeState $data; $oldMarker = [IO.File]::ReadAllText($marker)
        Move-Item -LiteralPath $app -Destination (Join-Path $InstallRoot 'app.previous')
        $null = New-Item -ItemType Directory -Path (Join-Path $app 'dist\server') -Force
        [IO.File]::WriteAllText((Join-Path $app 'release.json'), '{"version":"0.2.0"}')
        Write-Json $transaction ([ordered]@{product='living-room-display';schema=1;version='0.2.0';originalMarker=$oldMarker;appMoved=$true;newApp=$true;runtimeMoved=$false;newRuntime=$false})
        $held = New-HeldFailedApp
        $code = Invoke-Package (New-TestPackage)
        Assert-True ($code -eq 0) "A resumed rollback next to a held app.failed returned $code. Log: $(Get-Content -Raw $logFile)"
        Assert-True ((Get-TreeState (Join-Path $InstallRoot 'app.previous')) -eq $appBefore -and (Get-TreeState $data) -eq $dataBefore -and -not (Test-Path -LiteralPath $transaction)) 'The resumed rollback lost the last working app, changed data or kept its record.'
        Assert-True ((Get-FolderVersion 'app.failed-2') -eq '0.2.0') 'The resumed rollback did not keep the interrupted candidate under the next free name.'
    } finally { if ($held) { $held.Dispose() } }
    Complete-Check 'held app.failed during rollback'

    # ---- rare cases of the rollback record (#190) ----------------------------
    # The state an interrupted swap leaves: the old app in app.previous, the
    # candidate in app, and (optionally) the old runtime in runtime.previous.
    function New-InterruptedSwap([string]$Record, [switch]$RuntimeMoved) {
        New-SourceInstall '0.1.0'
        $before = [pscustomobject]@{App=(Get-TreeState $app);Data=(Get-TreeState $data);Marker=[IO.File]::ReadAllText($marker)}
        Move-Item -LiteralPath $app -Destination (Join-Path $InstallRoot 'app.previous')
        if ($RuntimeMoved) { Move-Item -LiteralPath $runtime -Destination (Join-Path $InstallRoot 'runtime.previous') }
        $null = New-Item -ItemType Directory -Path (Join-Path $app 'dist\server') -Force
        [IO.File]::WriteAllText((Join-Path $app 'release.json'), '{"version":"0.2.0"}')
        if (-not $PSBoundParameters.ContainsKey('Record')) { Write-Json $transaction ([ordered]@{product='living-room-display';schema=1;id=('1' * 32);version='0.2.0';originalMarker=$before.Marker;appMoved=$true;newApp=$true;runtimeMoved=[bool]$RuntimeMoved;newRuntime=$false}) }
        else { [IO.File]::WriteAllText($transaction, $Record) }
        return $before
    }
    # 1. A record left after a healthy install: removing it failed, but
    # installation.json names it as committed, so it is never rolled back.
    $realClear = ${function:Clear-PackageTransaction}
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    function Clear-PackageTransaction { Write-PackageLog 'Warning: synthetic failure to remove the record.' }
    try { $code = Invoke-Package (New-TestPackage) } finally { ${function:Clear-PackageTransaction} = $realClear }
    $journal = Read-PackageTransaction
    Assert-True ($code -eq 0 -and $journal -and $journal.id -match '^[0-9a-f]{32}$') "The synthetic leftover record was not left ($code)."
    Assert-True ((Get-Marker).committedTransaction -eq $journal.id -and (Test-PackageTransactionCommitted $journal) -and -not (Test-Path -LiteralPath ($transaction + '.tmp'))) 'installation.json does not name the leftover record as committed, or a record write left its temporary file.'
    Reset-Mocks
    $code = Invoke-Package (New-TestPackage -Version '0.3.0')
    $log = Get-Content -Raw $logFile
    Assert-True ($code -eq 0 -and $log -match 'left behind' -and -not $log.Contains($script:resumedRollbackNote)) "A committed leftover record was rolled back or refused ($code). Log: $log"
    Assert-True ((Get-FolderVersion 'app.previous') -eq '0.2.0' -and (Get-FolderVersion 'app') -eq '0.3.0' -and -not (Test-Path -LiteralPath $transaction)) 'A committed leftover record rolled the healthy install back.'
    # The same leftover does not block a source Update, while an uncommitted one does.
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    function Clear-PackageTransaction { }
    try { $code = Invoke-Package (New-TestPackage) } finally { ${function:Clear-PackageTransaction} = $realClear }
    Install-App | Out-Null
    Assert-True (-not (Test-Path -LiteralPath $transaction) -and (Get-FolderVersion 'app.previous') -eq '0.2.0' -and [string](Get-Content -Raw (Join-Path $app 'package.json') | ConvertFrom-Json).version -eq $script:sourceVersion) 'A committed leftover record blocked a source Update.'

    # 2. A refusal after a resumed rollback says what was done: the helper logs
    # the line Setup looks for, and the previous version is back in place.
    Reset-Root; Reset-Mocks
    $before = New-InterruptedSwap
    $script:portBusy = $true
    $code = Invoke-Package (New-TestPackage)
    $log = Get-Content -Raw $logFile
    Assert-True ($code -eq 11 -and $log.Contains($script:resumedRollbackNote)) "A refusal after a resumed rollback returned $code or did not log the resumed rollback. Log: $log"
    Assert-True ((Get-TreeState $app) -eq $before.App -and (Get-TreeState $data) -eq $before.Data -and [IO.File]::ReadAllText($marker) -eq $before.Marker -and -not (Test-Path -LiteralPath $transaction) -and (Get-FolderVersion 'app.failed') -eq '0.2.0') 'The resumed rollback before the refusal did not put the previous version back.'

    # 3. A damaged record: the steps are worked out from the folders.
    # A torn write with the candidate placed and the runtime moved.
    Reset-Root; Reset-Mocks
    $before = New-InterruptedSwap -Record ([string][char]0 * 6) -RuntimeMoved
    $script:runtimeVersion = 'v24.10.0'
    $code = Invoke-Package (New-TestPackage)
    $log = Get-Content -Raw $logFile
    Assert-True ($code -eq 0 -and $log -match 'record is damaged' -and $log -match 'previous app to put back: True; candidate in app: True; runtime to put back: True') "A damaged record with a placed candidate returned $code. Log: $log"
    Assert-True ((Get-TreeState (Join-Path $InstallRoot 'app.previous')) -eq $before.App -and (Get-TreeState $data) -eq $before.Data -and [IO.File]::ReadAllText((Join-Path $InstallRoot 'runtime.previous\node.exe')) -eq 'previous node') 'A damaged record lost the last working app or runtime.'
    Assert-True ((Get-FolderVersion 'app.failed') -eq '0.2.0' -and -not (Test-Path -LiteralPath $transaction)) 'A damaged record did not keep the candidate or was not removed.'
    # An empty record from before the first rename: nothing to put back.
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $appBefore = Get-TreeState $app
    $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot 'package.next\app\dist') -Force
    [IO.File]::WriteAllText($transaction, '')
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 0 -and (Get-TreeState (Join-Path $InstallRoot 'app.previous')) -eq $appBefore -and @(Get-AsideDirectories $script:asideNames).Count -eq 0) "An empty record before the first rename returned $code or moved the wrong app."
    # Unclear folders (app.previous, app and a staged app all present): untouched, E20.
    Reset-Root; Reset-Mocks
    $null = New-InterruptedSwap -Record '{"product":'
    $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot 'package.next\app\dist') -Force
    $before = Get-TreeState $InstallRoot
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 20 -and (Get-TreeState $InstallRoot) -eq $before -and (Get-Content -Raw $logFile) -match "folders don't show which app") "An unclear damaged record returned $code or moved folders."
    Complete-Check 'rollback record edge cases'

    # ---- a run that stopped mid-swap (crash or power cut) is undone first ----
    foreach ($candidatePlaced in @($true,$false)) {
        Reset-Root; Reset-Mocks
        New-SourceInstall '0.1.0'
        $appBefore = Get-TreeState $app; $dataBefore = Get-TreeState $data; $oldMarker = [IO.File]::ReadAllText($marker)
        Move-Item -LiteralPath $app -Destination (Join-Path $InstallRoot 'app.previous')
        if ($candidatePlaced) {
            $null = New-Item -ItemType Directory -Path (Join-Path $app 'dist\server') -Force
            [IO.File]::WriteAllText((Join-Path $app 'release.json'), '{"version":"0.2.0"}')
            [IO.File]::WriteAllText((Join-Path $app 'package.json'), '{"version":"0.2.0"}')
            Write-Json $marker ([ordered]@{product='living-room-display';state='installed';version='0.2.0';channel='package';runtimeVersion='24.19.0';runtimePreviousOwner=$null;packageSha256=('f' * 64)})
        }
        Write-Json $transaction ([ordered]@{product='living-room-display';schema=1;version='0.2.0';originalMarker=$oldMarker;appMoved=$true;newApp=$true;runtimeMoved=$false;newRuntime=$false})
        $code = Invoke-Package (New-TestPackage)
        Assert-True ($code -eq 0) "Setup after an interrupted swap (candidate placed=$candidatePlaced) returned $code. Log: $(Get-Content -Raw $logFile)"
        Assert-True ((Get-TreeState (Join-Path $InstallRoot 'app.previous')) -eq $appBefore -and (Get-TreeState $data) -eq $dataBefore -and -not (Test-Path -LiteralPath $transaction)) "An interrupted swap (candidate placed=$candidatePlaced) lost the last working app or changed data."
        Assert-True ((Test-Path -LiteralPath (Join-Path $InstallRoot 'app.failed')) -eq $candidatePlaced) 'The interrupted candidate was not kept as app.failed.'
        $snapshots = @(Get-ChildItem -LiteralPath (Join-Path $InstallRoot 'backups') -Directory)
        Assert-True ($snapshots.Count -eq 1 -and $snapshots[0].Name -match '^data-before-0\.1\.0-') 'The snapshot after an interrupted swap is not labelled with the restored version.'
    }
    Complete-Check 'interrupted swap'

    # ---- a damaged or missing installation.json in our own folder (#199) -----
    # An older, non-durable marker write cut short by a crash or a power cut can
    # leave the marker missing, empty, NUL-filled or torn. In a folder that is
    # clearly this app's, Setup rebuilds a minimal marker from the app's own
    # files and carries on; it writes it only once the run starts changing files.
    $damagedMarkers = [ordered]@{
        'empty' = { [IO.File]::WriteAllBytes($marker, [byte[]]@()) }
        'NUL-filled' = { [IO.File]::WriteAllBytes($marker, (New-Object byte[] 180)) }
        'torn' = { [IO.File]::WriteAllText($marker, '{"product":"living-room-disp') }
        'missing' = { Remove-Item -LiteralPath $marker -Force }
    }
    foreach ($name in $damagedMarkers.Keys) {
        Reset-Root; Reset-Mocks
        Assert-True ((Invoke-Package (New-TestPackage)) -eq 0) "Install before the $name marker case failed."
        Assert-True (-not (Test-Path -LiteralPath ($marker + '.tmp'))) 'A durable marker write left its temporary file.'
        $null = New-Item -ItemType Directory -Path $data -Force
        [IO.File]::WriteAllText((Join-Path $data 'state.json'), '{"syntheticSettings":"preserve"}')
        $appBefore = Get-TreeState $app; $dataBefore = Get-TreeState $data
        & $damagedMarkers[$name]
        Reset-Mocks
        $code = Invoke-Package (New-TestPackage)
        $log = Get-Content -Raw $logFile
        Assert-True ($code -eq 0 -and $log -match 'continuing with a rebuilt marker \(state installed, version 0\.2\.0 from the app' -and $log.Contains('Wrote the rebuilt installation.json')) "A $name marker in our folder returned $code or was not rebuilt. Log: $log"
        $installed = Get-Marker
        Assert-True ($installed.product -eq 'living-room-display' -and $installed.state -eq 'installed' -and $installed.channel -eq 'package' -and $installed.version -eq '0.2.0' -and $installed.committedTransaction -match '^[0-9a-f]{32}$') "The marker after a $name marker is wrong: $($installed | ConvertTo-Json -Compress)"
        Assert-True ((Get-TreeState (Join-Path $InstallRoot 'app.previous')) -eq $appBefore -and (Get-TreeState $data) -eq $dataBefore -and @(Get-ChildItem -LiteralPath (Join-Path $InstallRoot 'backups') -Directory).Count -eq 1) "The update over a $name marker lost the previous app, changed data or took no snapshot."
        Assert-NoStaging
    }
    # The rebuilt marker keeps the downgrade guard (app\release.json means Setup),
    # and a refusal leaves the damaged marker exactly as it was.
    Reset-Root; Reset-Mocks
    Assert-True ((Invoke-Package (New-TestPackage -Version '0.3.0')) -eq 0) 'Install 0.3.0 before the guard case failed.'
    [IO.File]::WriteAllBytes($marker, (New-Object byte[] 64))
    Reset-Mocks
    $before = Get-TreeState $InstallRoot
    $code = Invoke-Package (New-TestPackage -Version '0.2.0')
    Assert-True ($code -eq 12 -and (Get-TreeState $InstallRoot) -eq $before) "An older package over a damaged marker returned $code or changed files."
    $message = $null
    try { Assert-Installed } catch { $message = $_.Exception.Message }
    Assert-True ($message -match 'installation marker .* is damaged .*Run Setup again') "The CLI does not say that the marker is damaged: $message"
    # A source install (package.json names the app), an uninstall that kept the
    # data (no app), and an interrupted first install (only the marker).
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    [IO.File]::WriteAllText((Join-Path $app 'package.json'), '{"name":"living-room-display","version":"0.1.0"}')
    [IO.File]::WriteAllBytes($marker, (New-Object byte[] 64))
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 0 -and (Get-Content -Raw $logFile) -match 'rebuilt marker \(state installed, version 0\.1\.0' -and (Get-Marker).channel -eq 'package' -and @(Get-ChildItem -LiteralPath (Join-Path $InstallRoot 'backups') -Directory | Where-Object Name -like 'data-before-0.1.0-*').Count -eq 1) "A damaged marker beside a source app returned $code or was not rebuilt from package.json."
    Reset-Root; Reset-Mocks
    $null = New-Item -ItemType Directory -Path (Join-Path $data 'photos'),(Join-Path $InstallRoot 'backups\data-before-0.1.0-20260101T000000000Z') -Force
    [IO.File]::WriteAllText((Join-Path $data 'state.json'), '{"syntheticSettings":"kept"}')
    $dataBefore = Get-TreeState $data
    [IO.File]::WriteAllBytes($marker, (New-Object byte[] 64))
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 0 -and (Get-Content -Raw $logFile) -match 'rebuilt marker \(state uninstalled\)' -and (Get-Marker).state -eq 'installed' -and (Get-TreeState $data) -eq $dataBefore) "A damaged marker beside kept data returned $code or changed the data."
    Reset-Root; Reset-Mocks
    $null = New-Item -ItemType Directory -Path $testRoot
    [IO.File]::WriteAllBytes($marker, (New-Object byte[] 64))
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 0 -and (Get-Content -Raw $logFile) -match 'rebuilt marker \(state installing\)' -and (Get-Marker).state -eq 'installed') "A folder holding only a damaged marker returned $code."
    # A folder that is not clearly this app's stays refused, unchanged.
    $foreignCases = [ordered]@{
        'another file' = { [IO.File]::WriteAllText((Join-Path $testRoot 'someone-else.txt'), 'unrelated') }
        'another app' = { $null = New-Item -ItemType Directory -Path $app; [IO.File]::WriteAllText((Join-Path $app 'package.json'), '{"name":"another-product","version":"1.0.0"}') }
        'data beside another file' = { $null = New-Item -ItemType Directory -Path $data; [IO.File]::WriteAllText((Join-Path $data 'state.json'), '{}'); [IO.File]::WriteAllText((Join-Path $testRoot 'notes.txt'), 'unrelated') }
    }
    foreach ($name in $foreignCases.Keys) {
        foreach ($markerCase in @('NUL-filled','missing')) {
            Reset-Root; Reset-Mocks
            $null = New-Item -ItemType Directory -Path $testRoot
            & $foreignCases[$name]
            if ($markerCase -eq 'NUL-filled') { [IO.File]::WriteAllBytes($marker, (New-Object byte[] 64)) }
            $before = Get-TreeState $testRoot
            $code = Invoke-Package (New-TestPackage)
            Assert-True ($code -eq 10 -and (Get-TreeState $testRoot) -eq $before -and (Get-Content -Raw $logFile) -notmatch 'rebuilt marker') "A $markerCase marker in a folder with $name returned $code, changed files or was rebuilt."
        }
    }
    Complete-Check 'damaged marker rebuild'

    # ---- an older app.previous or runtime.previous that can't be removed (#200) --
    # Setup sets them aside by whole-folder renames before it stops the app. A
    # file held in one stops the run with E22 naming that folder, with nothing
    # changed (an earlier rename in the same step is put back), and the run
    # succeeds once the file is released.
    $held = $null
    try {
        Reset-Root; Reset-Mocks
        New-SourceInstall '0.1.0'
        Assert-True ((Invoke-Package (New-TestPackage)) -eq 0) 'Install before the held app.previous case failed.'
        Reset-Mocks
        $script:serverRunning = $true
        $before = Get-TreeState $InstallRoot
        $held = Open-Held (Join-Path $InstallRoot 'app.previous\package.json')
        $code = Invoke-Package (New-TestPackage -Version '0.3.0')
        $held.Dispose(); $held = $null
        $log = Get-Content -Raw $logFile
        Assert-True ($code -eq 22 -and $log -match 'Failed \(exit 22\): LRD-E22: A file in [^\r\n]*\\app\.previous is in use') "A held file in app.previous returned $code instead of 22 naming the folder. Log: $log"
        Assert-True ((Get-TreeState $InstallRoot) -eq $before -and $script:stops -eq 0 -and $script:snapshotCalls -eq 0 -and $script:serverRunning) 'E22 changed files, stopped the app or took a snapshot.'
        Reset-Mocks
        $code = Invoke-Package (New-TestPackage -Version '0.3.0')
        Assert-True ($code -eq 0 -and (Get-FolderVersion 'app.previous') -eq '0.2.0' -and (Get-FolderVersion 'app') -eq '0.3.0') "The update after releasing app.previous returned $code or swapped the wrong folders."
        Assert-NoStaging
        # A rename that fails once (a scanner's brief hold) is retried.
        Reset-Mocks
        $script:moveFailuresLeft = 1; $script:faults['move-removing'] = $transientFault
        $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot 'removing-3\dist') -Force
        $code = Invoke-Package (New-TestPackage -Version '0.3.0')
        Assert-True ($code -eq 0 -and (Get-Content -Raw $logFile) -match 'attempt 1 of') "A removal rename that failed once returned $code."
        Assert-NoStaging
        # A removal folder that can't be deleted yet is only logged; the next run removes it.
        Reset-Mocks
        $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot 'removing') -Force
        [IO.File]::WriteAllText((Join-Path $InstallRoot 'removing\held.txt'), 'held')
        $held = Open-Held (Join-Path $InstallRoot 'removing\held.txt')
        $code = Invoke-Package (New-TestPackage -Version '0.3.0')
        $held.Dispose(); $held = $null
        Assert-True ($code -eq 0 -and (Get-Content -Raw $logFile) -match 'Could not remove [^\r\n]*\\removing yet') "A removal folder that could not be deleted yet returned $code or was not logged."
        Reset-Mocks
        Assert-True ((Invoke-Package (New-TestPackage -Version '0.3.0')) -eq 0) 'The run after a leftover removal folder failed.'
        Assert-NoStaging

        # A Setup-made runtime.previous that this run would replace.
        Reset-Root; Reset-Mocks
        New-SourceInstall '0.1.0'
        $script:runtimeVersion = 'v24.10.0'
        Assert-True ((Invoke-Package (New-TestPackage)) -eq 0 -and (Get-Marker).runtimePreviousOwner -eq 'package') 'The swap before the held runtime.previous case failed.'
        Reset-Mocks
        $script:runtimeVersion = 'v24.18.0'
        $before = Get-TreeState $InstallRoot
        $held = Open-Held (Join-Path $InstallRoot 'runtime.previous\node.exe')
        $code = Invoke-Package (New-TestPackage -Version '0.3.0')
        $held.Dispose(); $held = $null
        $log = Get-Content -Raw $logFile
        Assert-True ($code -eq 22 -and $log -match 'LRD-E22: A file in [^\r\n]*\\runtime\.previous is in use' -and $log -match 'Set [^\r\n]*\\app\.previous aside as') "A held file in runtime.previous returned $code instead of 22 naming the folder. Log: $log"
        Assert-True ((Get-TreeState $InstallRoot) -eq $before -and $script:stops -eq 0) 'E22 for runtime.previous changed files (app.previous was not put back) or stopped the app.'
        Reset-Mocks
        $script:runtimeVersion = 'v24.18.0'
        $code = Invoke-Package (New-TestPackage -Version '0.3.0')
        Assert-True ($code -eq 0 -and [IO.File]::ReadAllText((Join-Path $InstallRoot 'runtime.previous\node.exe')) -eq 'synthetic node 24.19.0' -and (Get-FolderVersion 'app.previous') -eq '0.2.0') "The swap after releasing runtime.previous returned $code or kept the wrong copies."
        Assert-NoStaging
        # A user-made runtime.previous is never set aside: the runtime is kept instead.
        Reset-Root; Reset-Mocks
        New-SourceInstall '0.1.0'
        $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot 'runtime.previous') -Force
        [IO.File]::WriteAllText((Join-Path $InstallRoot 'runtime.previous\node.exe'), 'user runtime backup')
        $script:runtimeVersion = 'v24.10.0'
        $held = Open-Held (Join-Path $InstallRoot 'runtime.previous\node.exe')
        $code = Invoke-Package (New-TestPackage)
        $held.Dispose(); $held = $null
        Assert-True ($code -eq 0 -and [IO.File]::ReadAllText((Join-Path $InstallRoot 'runtime.previous\node.exe')) -eq 'user runtime backup') "A held user-made runtime.previous returned $code or was touched."
    } finally { if ($held) { $held.Dispose() } }
    Complete-Check 'held app.previous and runtime.previous'

    # ---- a record that can't be read moves nothing (#204) --------------------
    # Only a record that was read but doesn't parse is worked out from the
    # folders. One that another program holds without read sharing stops the run
    # with E20 and moves nothing, whether its update was committed or not.
    $held = $null
    try {
        Reset-Root; Reset-Mocks
        New-SourceInstall '0.1.0'
        function Clear-PackageTransaction { }
        try { $code = Invoke-Package (New-TestPackage) } finally { ${function:Clear-PackageTransaction} = $realClear }
        Assert-True ($code -eq 0 -and (Test-PackageTransactionCommitted (Read-PackageTransaction))) 'The committed leftover record was not left.'
        Reset-Mocks
        $script:serverRunning = $true
        $before = Get-TreeState $InstallRoot
        $held = Open-Held $transaction
        $code = Invoke-Package (New-TestPackage -Version '0.3.0')
        $log = Get-Content -Raw $logFile
        # A source Update refuses too, and changes nothing.
        $refused = $null
        try { Install-App } catch { $refused = $_.Exception.Message }
        $held.Dispose(); $held = $null
        Assert-True ($code -eq 20 -and $log -match "Failed \(exit 20\): LRD-E20: $([regex]::Escape($script:recordInUseNote))" -and $log -notmatch 'Worked out from the folders' -and -not $log.Contains($script:resumedRollbackNote)) "A held committed record returned $code or was worked out from the folders. Log: $log"
        Assert-True ((Get-TreeState $InstallRoot) -eq $before -and $script:stops -eq 0 -and $script:serverRunning) 'A held committed record moved a folder or stopped the app.'
        Assert-True ($refused -match "can't be read") "A source Update did not refuse a held record: $refused"
        Reset-Mocks
        $code = Invoke-Package (New-TestPackage -Version '0.3.0')
        $log = Get-Content -Raw $logFile
        Assert-True ($code -eq 0 -and $log -match 'left behind' -and -not $log.Contains($script:resumedRollbackNote) -and (Get-FolderVersion 'app.previous') -eq '0.2.0' -and (Get-FolderVersion 'app') -eq '0.3.0') "The released committed record was rolled back or refused ($code). Log: $log"
        # An uncommitted record (a swap that stopped part-way) held open: the same,
        # and once released the earlier rollback is finished first.
        Reset-Root; Reset-Mocks
        $prior = New-InterruptedSwap
        $before = Get-TreeState $InstallRoot
        $held = Open-Held $transaction
        $code = Invoke-Package (New-TestPackage)
        $held.Dispose(); $held = $null
        $log = Get-Content -Raw $logFile
        Assert-True ($code -eq 20 -and $log.Contains($script:recordInUseNote) -and (Get-TreeState $InstallRoot) -eq $before) "A held uncommitted record returned $code or moved folders. Log: $log"
        Reset-Mocks
        $code = Invoke-Package (New-TestPackage)
        Assert-True ($code -eq 0 -and (Get-Content -Raw $logFile).Contains($script:resumedRollbackNote) -and (Get-TreeState (Join-Path $InstallRoot 'app.previous')) -eq $prior.App -and (Get-FolderVersion 'app.failed') -eq '0.2.0') "The released uncommitted record was not finished first ($code)."
    } finally { if ($held) { $held.Dispose() } }
    # A damaged record beside a committed install (its version is the one in
    # app\release.json) is only removed.
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    function Clear-PackageTransaction { }
    try { $code = Invoke-Package (New-TestPackage) } finally { ${function:Clear-PackageTransaction} = $realClear }
    [IO.File]::WriteAllBytes($transaction, (New-Object byte[] 40))
    Reset-Mocks
    $code = Invoke-Package (New-TestPackage -Version '0.3.0')
    $log = Get-Content -Raw $logFile
    Assert-True ($code -eq 0 -and $log -match 'names a committed update' -and $log -notmatch 'Worked out from the folders' -and (Get-FolderVersion 'app.previous') -eq '0.2.0' -and (Get-FolderVersion 'app') -eq '0.3.0' -and -not (Test-Path -LiteralPath (Join-Path $InstallRoot 'app.failed'))) "A damaged record beside a committed install was rolled back ($code). Log: $log"
    # ...but not when app\release.json names another version: a later swap that
    # stopped part-way still goes back, and the committed app returns.
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    Assert-True ((Invoke-Package (New-TestPackage)) -eq 0) 'Install before the mid-swap damaged record case failed.'
    $committedApp = Get-TreeState $app
    Remove-OwnedDirectory (Join-Path $InstallRoot 'app.previous')
    Move-Item -LiteralPath $app -Destination (Join-Path $InstallRoot 'app.previous')
    $null = New-Item -ItemType Directory -Path (Join-Path $app 'dist\server') -Force
    [IO.File]::WriteAllText((Join-Path $app 'release.json'), '{"version":"0.3.0"}')
    [IO.File]::WriteAllText($transaction, '{"product":')
    Reset-Mocks
    $script:portBusy = $true
    $code = Invoke-Package (New-TestPackage -Version '0.3.0')
    Assert-True ($code -eq 11 -and (Get-Content -Raw $logFile) -match 'Worked out from the folders' -and (Get-TreeState $app) -eq $committedApp -and (Get-FolderVersion 'app.failed') -eq '0.3.0') "A damaged record mid-swap beside an older committed marker returned $code or was not rolled back."
    # After a rollback worked out from the folders, installation.json names the
    # restored version, not the candidate the damaged record left described.
    Reset-Root; Reset-Mocks
    $prior = New-InterruptedSwap -Record '{"product":'
    Write-Json $marker ([ordered]@{product='living-room-display';state='installed';version='0.2.0';channel='package';runtimeVersion='24.19.0';runtimePreviousOwner=$null;packageSha256=('f' * 64)})
    $script:portBusy = $true
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 11 -and (Get-Content -Raw $logFile) -match 'installation.json now names the restored version 0\.1\.0' -and (Get-Marker).version -eq '0.1.0' -and (Get-TreeState $app) -eq $prior.App) "The marker after an inferred rollback does not name the restored version ($code)."
    Complete-Check 'unreadable and damaged record'

    # ---- what a failed first install did is logged for Setup's message (#206) --
    # An interrupted first install had placed its candidate (marker installing).
    # The next run undoes it with no previous version to put back, and says so;
    # when its own retry then fails, it logs exactly what it removed.
    Reset-Root; Reset-Mocks
    $null = New-Item -ItemType Directory -Path (Join-Path $app 'dist\server') -Force
    [IO.File]::WriteAllText((Join-Path $app 'release.json'), '{"version":"0.2.0"}')
    $installingMarker = [ordered]@{product='living-room-display';state='installing';createdFolder=$true} | ConvertTo-Json
    [IO.File]::WriteAllText($marker, $installingMarker)
    Write-Json $transaction ([ordered]@{product='living-room-display';schema=1;id=('2' * 32);version='0.2.0';originalMarker=$installingMarker;appMoved=$false;newApp=$true;runtimeMoved=$false;newRuntime=$false})
    $script:healthResults.Enqueue($false)
    $code = Invoke-Package (New-TestPackage)
    $log = Get-Content -Raw $logFile
    Assert-True ($code -eq 16 -and $log.Contains($script:resumedUndoNote) -and -not $log.Contains($script:resumedRollbackNote) -and $log.Contains($script:firstInstallRemovedNote) -and $log -match 'there is no previous version to restore' -and -not (Test-Path -LiteralPath $testRoot)) "A failed retry of an interrupted first install returned $code or logged the wrong steps. Log: $log"
    # A set-aside copy that can't be removed yet: the log says what is left.
    Reset-Root; Reset-Mocks
    $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot 'runtime.next') -Force
    [IO.File]::WriteAllText((Join-Path $InstallRoot 'runtime.next\node.exe'), 'older set-aside runtime')
    Write-Json $marker ([ordered]@{product='living-room-display';state='installing';createdFolder=$true})
    $held = Open-Held (Join-Path $InstallRoot 'runtime.next\node.exe')
    try {
        $script:healthResults.Enqueue($false)
        $code = Invoke-Package (New-TestPackage)
    } finally { $held.Dispose(); $held = $null }
    $log = Get-Content -Raw $logFile
    Assert-True ($code -eq 16 -and $log -match "$([regex]::Escape($script:firstInstallLeftNote)) [^\r\n]*runtime\.next" -and -not $log.Contains($script:firstInstallRemovedNote) -and -not $log.Contains($script:firstInstallKeptDataNote)) "A failed first install next to a held copy returned $code or logged the wrong outcome. Log: $log"
    Reset-Mocks
    Assert-True ((Invoke-Package (New-TestPackage)) -eq 0) 'The retry after the held copy was released failed.'
    Assert-NoStaging
    Complete-Check 'first install outcome lines'

    # ---- stale staging, operation lock and reparse refusal -----------------
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    foreach ($stale in @('package.next','runtime.next','app.next')) { $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot "$stale\leftover") -Force }
    $ready = New-Object Threading.ManualResetEvent($false); $release = New-Object Threading.ManualResetEvent($false)
    $holder = [PowerShell]::Create()
    $null = $holder.AddScript({ param($name, $ready, $release) $mutex = New-Object Threading.Mutex($false, $name); $null = $mutex.WaitOne(); $null = $ready.Set(); $null = $release.WaitOne(60000); $mutex.ReleaseMutex(); $mutex.Dispose() }).AddArgument((Get-OperationLockName)).AddArgument($ready).AddArgument($release)
    $handle = $holder.BeginInvoke()
    try {
        Assert-True ($ready.WaitOne(10000)) 'The lock holder did not start.'
        $before = Get-TreeState $InstallRoot
        $code = Invoke-Package (New-TestPackage)
        Assert-True ($code -eq 14 -and (Get-TreeState $InstallRoot) -eq $before) "A held operation lock returned $code or cleaned staging without the lock."
    } finally { $null = $release.Set(); $null = $holder.EndInvoke($handle); $holder.Dispose() }
    Reset-Mocks
    Assert-True ((Invoke-Package (New-TestPackage)) -eq 0) 'Install after the lock was released failed.'
    Assert-NoStaging
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $link = Join-Path $InstallRoot 'package.next'
    $null = New-Item -ItemType Junction -Path $link -Target $outside
    $junctions.Add($link)
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 10 -and (Test-Path -LiteralPath (Join-Path $outside 'keep.txt'))) "A junction staging folder returned $code or its target changed."
    [IO.Directory]::Delete($link, $false); $junctions.Clear()
    Complete-Check 'staging and lock'

    # ---- disk and snapshot preflight ---------------------------------------
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $script:freeBytes = [int64]1000
    $before = Get-TreeState $InstallRoot
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 17 -and (Get-TreeState $InstallRoot) -eq $before) "Low disk space returned $code or changed files."
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $script:serverRunning = $true
    $appBefore = Get-TreeState $app; $dataBefore = Get-TreeState $data; $markerBefore = Get-Sha256 $marker
    $script:faults['snapshot-copied'] = { $copied = @(Get-ChildItem -LiteralPath (Join-Path $InstallRoot 'backups') -Recurse -File | Where-Object Name -eq 'state.json'); [IO.File]::WriteAllText($copied[0].FullName, '{"corrupted":true}') }
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 19) "Snapshot verification failure returned $code."
    Assert-True ((Get-TreeState $app) -eq $appBefore -and (Get-TreeState $data) -eq $dataBefore -and (Get-Sha256 $marker) -eq $markerBefore -and -not (Test-Path -LiteralPath (Join-Path $InstallRoot 'app.previous'))) 'Snapshot failure replaced app, data or marker.'
    Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $InstallRoot 'backups') -Force).Count -eq 0 -and $script:starts -eq 1) 'An incomplete snapshot was kept, or the previous version was not restarted.'
    Complete-Check 'disk and snapshot failure'

    # ---- snapshot retention keeps the newest three --------------------------
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    foreach ($stamp in @('20260101T000000000Z','20260102T000000000Z','20260103T000000000Z','20260104T000000000Z')) { $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot "backups\data-before-0.0.9-$stamp") -Force }
    $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot 'backups\owner-notes') -Force
    Assert-True ((Invoke-Package (New-TestPackage)) -eq 0) 'Install with existing snapshots failed.'
    $kept = @(Get-ChildItem -LiteralPath (Join-Path $InstallRoot 'backups') -Directory | Where-Object Name -like 'data-before-*' | ForEach-Object Name | Sort-Object)
    Assert-True ($kept.Count -eq 3 -and $kept -contains 'data-before-0.0.9-20260104T000000000Z' -and $kept -contains 'data-before-0.0.9-20260103T000000000Z' -and @($kept | Where-Object { $_ -like 'data-before-0.1.0-*' }).Count -eq 1) "Retention kept the wrong snapshots: $($kept -join ', ')"
    Assert-True (Test-Path -LiteralPath (Join-Path $InstallRoot 'backups\owner-notes')) 'Retention removed a folder it does not own.'
    Complete-Check 'snapshot retention'

    # ---- Uninstall -FromInstaller removal rules ------------------------------
    Reset-Root; Reset-Mocks
    Assert-True ((Invoke-Package (New-TestPackage)) -eq 0) 'Install before uninstall failed.'
    $owner = Get-Marker; $owner.runtimePreviousOwner = 'package'; Write-Json $marker $owner
    foreach ($leftover in @('app.previous','app.failed','app.failed-2','app.next','app.next-3','package.next','runtime.next','runtime.next-2','run','edge-profile','runtime.previous','backups\data-before-0.1.0-20260101T000000000Z')) { $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot $leftover) -Force }
    [IO.File]::WriteAllText($transaction, '{"product":"living-room-display","schema":1}')
    $null = New-Item -ItemType Directory -Path $data -Force
    [IO.File]::WriteAllText((Join-Path $data 'state.json'), '{"synthetic":true}')
    $dataBefore = Get-TreeState $data
    $FromInstaller = $true
    Uninstall-App | Out-Null
    foreach ($gone in @('app','app.previous','app.failed','app.failed-2','app.next','app.next-3','package.next','runtime.next','runtime.next-2','runtime','run','edge-profile','runtime.previous','package-transaction.json')) { Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot $gone))) "Uninstall left $gone." }
    Assert-True ((Get-TreeState $data) -eq $dataBefore -and (Test-Path -LiteralPath (Join-Path $InstallRoot 'backups\data-before-0.1.0-20260101T000000000Z'))) 'Default uninstall removed data or backups.'
    Assert-True ((Get-Marker).state -eq 'uninstalled' -and (Get-Marker).channel -eq 'package') 'Uninstall did not retain the marker.'
    # The runtime.previous above was package-owned; a user-made one is kept.
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot 'runtime.previous\keep') -Force
    $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot 'backups\data-before-0.1.0-20260101T000000000Z') -Force
    $script:RemoveData = $true
    Uninstall-App | Out-Null
    Assert-True ((Test-Path -LiteralPath (Join-Path $InstallRoot 'runtime.previous\keep')) -and -not (Test-Path -LiteralPath $data) -and -not (Test-Path -LiteralPath (Join-Path $InstallRoot 'backups')) -and (Test-Path -LiteralPath $marker)) 'RemoveData did not remove data and backups, kept a user runtime.previous, or lost the marker.'
    $script:RemoveData = $false
    Complete-Check 'uninstall removal rules'

    # ---- Stop waits only for Edge running with this install's own profile -----
    $edgeProfile = Join-Path $InstallRoot 'edge-profile'
    Assert-True (Test-OwnedBrowserCommandLine ('"msedge.exe" --kiosk "http://127.0.0.1:4318/display" --edge-kiosk-type=fullscreen --inprivate --user-data-dir="' + $edgeProfile + '"')) 'The display browser was not recognized.'
    Assert-True (Test-OwnedBrowserCommandLine ('"msedge.exe" --type=renderer --user-data-dir="' + $edgeProfile + '" --lang=en-US')) 'A display browser child process was not recognized.'
    Assert-True (Test-OwnedBrowserCommandLine ('msedge.exe --type=gpu-process --user-data-dir=' + $edgeProfile.ToUpperInvariant() + ' --field-trial-handle=1')) 'An unquoted or differently cased profile path was not recognized.'
    foreach ($other in @('"msedge.exe" --profile-directory=Default', ('"msedge.exe" --user-data-dir="' + $edgeProfile + '2"'), ('"msedge.exe" --user-data-dir="' + $edgeProfile + '\nested"'), ('"msedge.exe" --user-data-dir="' + (Join-Path $env:LOCALAPPDATA 'LivingRoomDisplay\edge-profile') + '"'), '')) {
        Assert-True (-not (Test-OwnedBrowserCommandLine $other)) "A browser that is not this install's display was matched: $other"
    }
    Complete-Check 'display browser ownership'

    # ---- Stop waits for every process it stops (review of d2dd04f) -----------
    # The real Stop-App against scripted processes. Stop-Process only starts
    # ending a process, so each stopped display, display browser and server is
    # waited for, and one that doesn't exit fails Stop instead of racing the
    # rename of app that follows. Only the scripted processes below are touched.
    $script:stopEvents = New-Object 'Collections.Generic.List[string]'
    function New-FakeProcess([int]$Id, [bool[]]$Waits) {
        $fake = [pscustomobject]@{Id=$Id;Waits=(New-Object 'Collections.Generic.Queue[bool]')}
        foreach ($wait in $Waits) { $fake.Waits.Enqueue($wait) }
        $fake | Add-Member -MemberType ScriptProperty -Name HasExited -Value { $false }
        $fake | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($Milliseconds) $script:stopEvents.Add("wait $($this.Id) $Milliseconds"); if ($this.Waits.Count) { return $this.Waits.Dequeue() }; return $true }
        return $fake
    }
    function Invoke-RealStop([hashtable]$Processes) {
        function Get-CimInstance {
            param([Parameter(Position=0)]$ClassName, $Filter)
            if ($Filter -eq "Name='LivingRoomDisplay.scr'") { return @([pscustomobject]@{ProcessId=11;ExecutablePath=$hostExe},[pscustomobject]@{ProcessId=98;ExecutablePath='C:\Other\LivingRoomDisplay.scr'}) }
            if ($Filter -eq "Name='msedge.exe'") { return @([pscustomobject]@{ProcessId=12;CommandLine=('"msedge.exe" --type=renderer --user-data-dir="' + (Join-Path $InstallRoot 'edge-profile') + '"')},[pscustomobject]@{ProcessId=99;CommandLine='"msedge.exe" --profile-directory=Default'}) }
            if ($Filter -eq "ParentProcessId=13 AND Name='conhost.exe'") { return [pscustomobject]@{ProcessId=14} }
            throw "Unexpected process query: $Filter"
        }
        function Get-Process { param($Id, $ErrorAction) if ($Processes.ContainsKey([int]$Id)) { return $Processes[[int]$Id] }; throw "Unexpected process lookup: $Id" }
        function Stop-Process { param([Parameter(ValueFromPipeline=$true)]$InputObject, [switch]$Force) process { $script:stopEvents.Add("kill $($InputObject.Id)") } }
        function Get-OwnedServer { return $Processes[13] }
        & $realStopApp
    }
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $script:stopEvents.Clear()
    Invoke-RealStop @{11=(New-FakeProcess 11 @($false,$true));12=(New-FakeProcess 12 @($true));13=(New-FakeProcess 13 @($true));14=(New-FakeProcess 14 @($true))}
    Assert-True (($script:stopEvents -join ', ') -eq 'wait 11 4000, kill 11, wait 11 10000, wait 12 10000, kill 13, wait 13 10000, wait 14 10000') "Stop did not wait for what it stopped: $($script:stopEvents -join ', ')"
    $script:stopEvents.Clear()
    Invoke-RealStop @{11=(New-FakeProcess 11 @($true));12=(New-FakeProcess 12 @($false,$true));13=(New-FakeProcess 13 @($true));14=(New-FakeProcess 14 @($true))}
    Assert-True (($script:stopEvents -join ', ') -eq 'wait 11 4000, wait 12 10000, kill 12, wait 12 10000, kill 13, wait 13 10000, wait 14 10000') "Stop did not end a lingering display browser: $($script:stopEvents -join ', ')"
    $stopFailure = $null
    try { Invoke-RealStop @{11=(New-FakeProcess 11 @($true));12=(New-FakeProcess 12 @($true));13=(New-FakeProcess 13 @($false));14=(New-FakeProcess 14 @($true))} } catch { $stopFailure = $_.Exception.Message }
    Assert-True ($stopFailure -match 'server \(process 13\) did not exit within 10 seconds') "Stop returned although the server had not exited: $stopFailure"
    Complete-Check 'stop waits for stopped processes'

    # ---- the new marker is readable by the previous control script ----------
    Reset-Root; Reset-Mocks
    Assert-True ((Invoke-Package (New-TestPackage)) -eq 0) 'Install before old-reader check failed.'
    $oldScript = Join-Path $PSScriptRoot 'fixtures\LivingRoomDisplay-bedca44.ps1'
    Assert-True ((Get-Sha256 $oldScript) -eq 'b00bc5d716962643052d63fa8d7eb05c948e8043e469c05db2e44d99ee8d8542') 'The bedca44 control script fixture was edited.'
    function Assert-OldReaderReads([string]$Revision) {
        $launch = New-Object Diagnostics.ProcessStartInfo
        $launch.FileName = $shell
        $launch.Arguments = '-NoProfile -NonInteractive -Command "& { $r = & ''' + $oldScript + ''' Status -InstallRoot ''' + $testRoot + '''; if ($r.InstallRoot -ne ''' + $testRoot + ''' -or $r.SourceRevision -ne ''' + $Revision + ''' -or $r.SourceState -ne ''clean'') { exit 3 }; . ''' + $oldScript + ''' -InstallRoot ''' + $testRoot + ''' -FunctionsOnly; Assert-Installed; exit 0 }"'
        $launch.UseShellExecute = $false; $launch.CreateNoWindow = $true; $launch.RedirectStandardError = $true; $launch.RedirectStandardOutput = $true
        $process = [Diagnostics.Process]::Start($launch)
        try {
            $stderr = $process.StandardError.ReadToEndAsync(); $null = $process.StandardOutput.ReadToEndAsync()
            Assert-True ($process.WaitForExit(60000)) 'Old reader check timed out.'
            $process.WaitForExit()
            Assert-True ($process.ExitCode -eq 0) "The previous script could not read the new marker: exit $($process.ExitCode) $($stderr.Result)"
        } finally { if (-not $process.HasExited) { $process.Kill() }; $process.Dispose() }
    }
    Assert-OldReaderReads ('a' * 40)
    $status = Get-InstallStatus
    Assert-True ($status.Channel -eq 'package' -and $status.Version -eq '0.2.0' -and $status.RuntimeVersion -eq '24.19.0' -and $status.PackageSha256 -match '^[0-9a-f]{64}$' -and $status.ServerRunning) 'Status did not report the package fields.'
    Write-Json $marker @{product='living-room-display';state='installed'}
    $status = Get-InstallStatus
    Assert-True ($status.Channel -eq 'source' -and $null -eq $status.Version) 'A marker without channel is not reported as source.'
    Complete-Check 'previous reader and status'

    # ---- a source Update keeps the Setup install's ownership facts (#159) -----
    Reset-Root; Reset-Mocks
    New-SourceInstall '0.1.0'
    $script:runtimeVersion = 'v24.10.0'
    Assert-True ((Invoke-Package (New-TestPackage)) -eq 0 -and (Get-Marker).runtimePreviousOwner -eq 'package') 'The Setup install with a runtime swap failed.'
    $script:runtimeVersion = 'v24.19.0'
    Install-App | Out-Null
    $installed = Get-Marker
    Assert-True ($installed.channel -eq 'source' -and $installed.lastPackageVersion -eq '0.2.0' -and $installed.runtimePreviousOwner -eq 'package' -and $installed.runtimeVersion -eq '24.19.0' -and $installed.version -eq $script:sourceVersion -and -not $installed.PSObject.Properties['packageSha256']) "A source Update dropped or kept the wrong Setup facts: $($installed | ConvertTo-Json -Compress)"
    Assert-True ((Get-InstallStatus).Channel -eq 'source') 'Status does not report the source channel after a source Update.'
    Assert-OldReaderReads ('e' * 40)
    # An older Setup is still refused against the last Setup version (E12).
    Reset-Mocks
    $before = Get-TreeState $InstallRoot
    $code = Invoke-Package (New-TestPackage -Version '0.1.5')
    Assert-True ($code -eq 12 -and (Get-TreeState $InstallRoot) -eq $before -and (Get-Content -Raw $logFile) -match '\(0\.2\.0\) was installed here by Setup before a source update') "An older Setup after a source Update returned $code or changed files."
    # A second source Update keeps the facts; a later Setup may then replace the
    # Setup-made runtime.previous, and uninstall removes it.
    Install-App | Out-Null
    Assert-True ((Get-Marker).lastPackageVersion -eq '0.2.0' -and (Get-Marker).runtimePreviousOwner -eq 'package') 'A second source Update lost the Setup facts.'
    Reset-Mocks
    $script:runtimeVersion = 'v24.18.0'
    Assert-True ((Invoke-Package (New-TestPackage)) -eq 0 -and [IO.File]::ReadAllText((Join-Path $InstallRoot 'runtime.previous\node.exe')) -eq 'synthetic node 24.19.0' -and (Get-Marker).channel -eq 'package') 'A later Setup did not replace the Setup-made runtime.previous after a source Update.'
    $script:runtimeVersion = 'v24.19.0'
    Install-App | Out-Null
    $FromInstaller = $true
    Uninstall-App | Out-Null
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot 'runtime.previous')) -and (Get-Marker).state -eq 'uninstalled') 'Uninstall kept a Setup-made runtime.previous after a source Update.'
    Complete-Check 'source update keeps Setup ownership'

    # ---- CLI Uninstall delegates to the Setup uninstaller without the lock --
    if (Test-Path -LiteralPath $script:UninstallKeyPath) {
        Write-Output 'Skipped the delegation check: this account has a real Setup registration.'
    } else {
        Reset-Root; Reset-Mocks
        Assert-True ((Invoke-Package (New-TestPackage)) -eq 0) 'Install before delegation check failed.'
        $uninstallDirectory = Join-Path $testRoot 'uninstall'
        $null = New-Item -ItemType Directory -Path $uninstallDirectory
        [IO.File]::WriteAllText((Join-Path $uninstallDirectory 'lockname.txt'), (Get-OperationLockName))
        $fakeSource = Join-Path $scratchRoot 'FakeUninstaller.cs'
        [IO.File]::WriteAllText($fakeSource, @'
using System; using System.IO; using System.Threading;
static class FakeUninstaller {
    static int Main(string[] args) {
        string directory = AppDomain.CurrentDomain.BaseDirectory;
        string name = File.ReadAllText(Path.Combine(directory, "lockname.txt"));
        bool free;
        using (Mutex mutex = new Mutex(false, name)) {
            try { free = mutex.WaitOne(0); if (free) mutex.ReleaseMutex(); } catch (AbandonedMutexException) { free = true; }
        }
        File.WriteAllText(Path.Combine(directory, "delegated.txt"), (free ? "free" : "held") + "|" + string.Join(" ", args));
        return 0;
    }
}
'@)
        $framework = if ([Environment]::Is64BitOperatingSystem) { 'Framework64' } else { 'Framework' }
        $compiler = Join-Path $env:WINDIR "Microsoft.NET\$framework\v4.0.30319\csc.exe"
        & $compiler /nologo /target:exe ("/out:" + (Join-Path $uninstallDirectory 'unins000.exe')) $fakeSource | Out-Null
        Assert-True ($LASTEXITCODE -eq 0) 'Fake uninstaller compilation failed.'
        $markerBefore = Get-Sha256 $marker
        $appBefore = Get-TreeState $app
        $result = Invoke-ChildScript ('Uninstall -InstallRoot "' + $testRoot + '" -RemoveData')
        Assert-True ($result.Code -eq 0) "Delegating Uninstall failed: $($result.Err)"
        $record = [IO.File]::ReadAllText((Join-Path $uninstallDirectory 'delegated.txt'))
        Assert-True ($record -eq 'free|/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /REMOVEDATA=1') "Delegation held the lock or passed the wrong switches: $record"
        Assert-True ((Get-Sha256 $marker) -eq $markerBefore -and (Get-TreeState $app) -eq $appBefore) 'The CLI removed files itself instead of delegating.'
    }
    Complete-Check 'uninstall delegation'
} finally {
    [Console]::SetError($originalError)
    foreach ($link in @($junctions)) {
        if (Test-Path -LiteralPath $link) {
            if (-not ((Get-Item -LiteralPath $link -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Expected test junction is no longer a reparse point; cleanup stopped.' }
            [IO.Directory]::Delete($link, $false)
        }
    }
    $full = [IO.Path]::GetFullPath($scratchRoot)
    $allowed = [IO.Path]::GetFullPath((Join-Path $repository '.local')).TrimEnd('\') + '\'
    if (-not $full.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { throw 'Package test cleanup escaped .local.' }
    if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
}
Write-Output "$($script:checks) InstallPackage transaction check groups passed with synthetic packages; start/stop, port, runtime, disk and health boundaries were mocked."
