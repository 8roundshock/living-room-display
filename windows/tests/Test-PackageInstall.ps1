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

    # ---- mocks for external boundaries -------------------------------------
    function Reset-Mocks {
        $script:starts = 0; $script:stops = 0; $script:portBusy = $false; $script:portBusyAfterStop = $false
        $script:runtimeVersion = 'v24.19.0'; $script:freeBytes = [int64]100GB
        $script:healthResults = New-Object 'Collections.Generic.Queue[bool]'; $script:serverRunning = $false
        $script:restartHealthy = $true; $script:faults = @{}; $script:snapshotCalls = 0
        $script:operationLockTimeoutMs = 300
        $script:controlScriptPath = $controlScript
        $script:PackageArchive = $null; $script:PackageSha256 = $null; $script:AllowDowngrade = $false; $script:RemoveData = $false
        if (Test-Path -LiteralPath $logFile) { Remove-Item -LiteralPath $logFile -Force }
    }
    function Start-App { $script:starts++; $script:serverRunning = $true }
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
        param([string]$Version = '0.2.0', [string]$NodeVersion = '24.19.0', [string]$Tamper, [string]$Extra, [string]$Drop, [string]$UnsafeName, [string]$ManifestOnlyPath)
        $spec = New-PackageSpec $Version $NodeVersion
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
    function Assert-NoStaging { foreach ($name in @('package.next','runtime.next','app.next')) { Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot $name))) "$name was left behind." } }

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

    # ---- explicit InstallRoot and archive placement (real -File runs) -------
    Reset-Root; Reset-Mocks
    $package = New-TestPackage
    $shell = (Get-Process -Id $PID).Path
    function Invoke-ChildScript([string]$Arguments) {
        $launch = New-Object Diagnostics.ProcessStartInfo
        $launch.FileName = $shell
        $launch.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $controlScript + '" ' + $Arguments
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
    }
    Reset-Root; Reset-Mocks
    $script:healthResults.Enqueue($false)
    $code = Invoke-Package (New-TestPackage)
    Assert-True ($code -eq 16 -and (Test-Path -LiteralPath (Join-Path $InstallRoot 'app.failed')) -and -not (Test-Path -LiteralPath $app)) "A fresh install that cannot start returned $code or left app in place."
    Complete-Check 'health rollback'

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
    foreach ($leftover in @('app.previous','app.failed','package.next','runtime.next','run','edge-profile','runtime.previous','backups\data-before-0.1.0-20260101T000000000Z')) { $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot $leftover) -Force }
    $null = New-Item -ItemType Directory -Path $data -Force
    [IO.File]::WriteAllText((Join-Path $data 'state.json'), '{"synthetic":true}')
    $dataBefore = Get-TreeState $data
    $FromInstaller = $true
    Uninstall-App | Out-Null
    foreach ($gone in @('app','app.previous','app.failed','package.next','runtime.next','runtime','run','edge-profile','runtime.previous')) { Assert-True (-not (Test-Path -LiteralPath (Join-Path $InstallRoot $gone))) "Uninstall left $gone." }
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

    # ---- the new marker is readable by the previous control script ----------
    Reset-Root; Reset-Mocks
    Assert-True ((Invoke-Package (New-TestPackage)) -eq 0) 'Install before old-reader check failed.'
    $oldScript = Join-Path $PSScriptRoot 'fixtures\LivingRoomDisplay-bedca44.ps1'
    Assert-True ((Get-Sha256 $oldScript) -eq 'b00bc5d716962643052d63fa8d7eb05c948e8043e469c05db2e44d99ee8d8542') 'The bedca44 control script fixture was edited.'
    $launch = New-Object Diagnostics.ProcessStartInfo
    $launch.FileName = $shell
    $launch.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "& { $r = & ''' + $oldScript + ''' Status -InstallRoot ''' + $testRoot + '''; if ($r.InstallRoot -ne ''' + $testRoot + ''' -or $r.SourceRevision -ne ''' + ('a' * 40) + ''' -or $r.SourceState -ne ''clean'') { exit 3 }; . ''' + $oldScript + ''' -InstallRoot ''' + $testRoot + ''' -FunctionsOnly; Assert-Installed; exit 0 }"'
    $launch.UseShellExecute = $false; $launch.CreateNoWindow = $true; $launch.RedirectStandardError = $true; $launch.RedirectStandardOutput = $true
    $process = [Diagnostics.Process]::Start($launch)
    try {
        $stderr = $process.StandardError.ReadToEndAsync(); $null = $process.StandardOutput.ReadToEndAsync()
        Assert-True ($process.WaitForExit(60000)) 'Old reader check timed out.'
        $process.WaitForExit()
        Assert-True ($process.ExitCode -eq 0) "The previous script could not read the new marker: exit $($process.ExitCode) $($stderr.Result)"
    } finally { if (-not $process.HasExited) { $process.Kill() }; $process.Dispose() }
    $status = Get-InstallStatus
    Assert-True ($status.Channel -eq 'package' -and $status.Version -eq '0.2.0' -and $status.RuntimeVersion -eq '24.19.0' -and $status.PackageSha256 -match '^[0-9a-f]{64}$' -and $status.ServerRunning) 'Status did not report the package fields.'
    Write-Json $marker @{product='living-room-display';state='installed'}
    $status = Get-InstallStatus
    Assert-True ($status.Channel -eq 'source' -and $null -eq $status.Version) 'A marker without channel is not reported as source.'
    Complete-Check 'previous reader and status'

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
