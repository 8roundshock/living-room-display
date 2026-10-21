Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$windowsDirectory = Split-Path $PSScriptRoot -Parent
$repository = Split-Path $windowsDirectory -Parent
$scratchRoot = Join-Path $repository ('.local\install-lifecycle-' + [Guid]::NewGuid().ToString('N'))
$testInstallRoot = Join-Path $scratchRoot 'install'
$testSourceRoot = Join-Path $scratchRoot 'source'
$null = New-Item -ItemType Directory -Path $testInstallRoot,$testSourceRoot -Force
$held = $null
try {
    . (Join-Path $windowsDirectory 'LivingRoomDisplay.ps1') -InstallRoot $testInstallRoot -SourceRoot $testSourceRoot -NoBrowser -FunctionsOnly
    # Exercise the real file transaction/ownership guards while replacing only
    # external build/runtime/process/native boundaries with deterministic fakes.
    $script:starts = 0
    $script:stops = 0
    $script:failBuild = $false
    $script:moveRetryDelayMs = 10
    function Set-Idle { param($Enabled) }
    function Stop-App { $script:stops++ }
    function Start-App { $script:starts++ }
    function Install-Runtime { $null = New-Item -ItemType Directory -Path $runtime -Force }
    $script:fixtureRevision = 'b' * 40
    function Get-SourceProvenance { param($Source) [pscustomobject]@{sourceRevision=$script:fixtureRevision;sourceState='clean'} }
    function Build-InstallCandidate {
        param($Source,$Next)
        $null = New-Item -ItemType Directory -Path (Join-Path $Next 'dist\server'),(Join-Path $Next 'dist\client') -Force
        if ($script:failBuild) { throw 'Synthetic build failure before replacement.' }
        [IO.File]::WriteAllText((Join-Path $Next 'dist\server\index.js'),'synthetic server')
        [IO.File]::WriteAllText((Join-Path $Next 'dist\client\index.html'),'synthetic client')
        Copy-Item -LiteralPath (Join-Path $Source 'package.json') -Destination $Next
    }
    function Get-Tree([string]$Path) {
        if (-not (Test-Path -LiteralPath $Path)) { return '<absent>' }
        return ((Get-ChildItem -LiteralPath $Path -Recurse -Force | Sort-Object FullName | ForEach-Object { $_.FullName.Substring($Path.Length) + $(if ($_.PSIsContainer) { '/' } else { '|' + (Get-FileHash -LiteralPath $_.FullName).Hash }) }) -join "`n")
    }
    function Get-RemovalCount { return @(Get-AsideDirectories @('removing')).Count }
    function Open-Held([string]$Path) { return [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None) }
    function Get-Failure([scriptblock]$Action) { try { & $Action | Out-Null; return $null } catch { return $_.Exception.Message } }
    $null = New-Item -ItemType Directory -Path $data,$app,$runtime,(Join-Path $testSourceRoot 'src') -Force
    [IO.File]::WriteAllText((Join-Path $testSourceRoot 'package-lock.json'),'{}')
    [IO.File]::WriteAllText((Join-Path $testSourceRoot 'package.json'),'{"name":"living-room-display","version":"0.1.0"}')
    $stateFile = Join-Path $data 'state.json'
    $saveFile = Join-Path $InstallRoot 'screensaver-before.json'
    [IO.File]::WriteAllText($stateFile,'{"syntheticSettings":"preserve","reminders":["synthetic reminder"]}')
    [IO.File]::WriteAllText($saveFile,'{"syntheticPreviousSaver":"preserve"}')
    Write-Json $marker @{product='living-room-display';state='installed';sourceRevision=('a' * 40);sourceState='clean'}
    $stateHash = (Get-FileHash -LiteralPath $stateFile).Hash
    $saveHash = (Get-FileHash -LiteralPath $saveFile).Hash
    Uninstall-App | Out-Null
    if ((Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).state -ne 'uninstalled' -or (Test-Path -LiteralPath $app)) { throw 'Uninstall did not retain its reinstall ownership marker or remove app files.' }
    if ((Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).sourceRevision -ne ('a' * 40)) { throw 'Uninstall lost the retained provenance.' }
    Install-App | Out-Null
    if ((Get-FileHash -LiteralPath $stateFile).Hash -ne $stateHash -or (Get-FileHash -LiteralPath $saveFile).Hash -ne $saveHash) { throw 'Uninstall/reinstall changed retained settings/reminders/screensaver backup.' }
    if ((Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).state -ne 'installed' -or $script:starts -ne 1 -or -not (Test-Path -LiteralPath (Join-Path $app 'dist\server\index.js'))) { throw 'Reinstall did not publish its staged app and installed marker.' }
    if ((Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).sourceRevision -ne $script:fixtureRevision) { throw 'Successful install did not refresh provenance.' }
    if ((Test-Path -LiteralPath ($marker + '.tmp')) -or (Get-RemovalCount)) { throw 'A marker write or a removal left a temporary file or a removal folder.' }
    $markerHash = (Get-FileHash -LiteralPath $marker).Hash
    $script:fixtureRevision = 'c' * 40
    $script:failBuild = $true
    $failed = $false
    try { Install-App | Out-Null } catch { $failed = $true }
    if (-not $failed -or (Test-Path -LiteralPath (Join-Path $InstallRoot 'app.next')) -or -not (Test-Path -LiteralPath (Join-Path $app 'dist\server\index.js')) -or (Get-FileHash -LiteralPath $stateFile).Hash -ne $stateHash -or (Get-FileHash -LiteralPath $marker).Hash -ne $markerHash) { throw 'Failed update replaced app/data/provenance or leaked its candidate.' }
    $script:failBuild = $false

    # Update with a file held in the older app.previous (#200): it goes aside by a
    # whole-folder rename before Stop, so Update stops with nothing stopped or
    # replaced, and succeeds once the file is released.
    Install-App | Out-Null
    $previous = Join-Path $InstallRoot 'app.previous'
    if (-not (Test-Path -LiteralPath (Join-Path $previous 'dist\server\index.js'))) { throw 'The setup update did not keep app.previous.' }
    $appTree = Get-Tree $app; $previousTree = Get-Tree $previous; $markerHash = (Get-FileHash -LiteralPath $marker).Hash
    $script:stops = 0
    $held = Open-Held (Join-Path $previous 'dist\server\index.js')
    $failure = Get-Failure { Install-App }
    $held.Dispose(); $held = $null
    if ($failure -notmatch 'Update stopped before stopping or replacing anything: A file in .*app\.previous is in use') { throw "Update with a held app.previous did not stop with the folder named: $failure" }
    if ($script:stops -ne 0 -or (Get-Tree $app) -ne $appTree -or (Get-Tree $previous) -ne $previousTree -or (Get-FileHash -LiteralPath $marker).Hash -ne $markerHash -or (Test-Path -LiteralPath (Join-Path $InstallRoot 'app.next')) -or (Get-RemovalCount)) { throw 'Update with a held app.previous stopped the app, changed app, app.previous or the marker, or left its candidate or a removal folder.' }
    Install-App | Out-Null
    if ((Get-Tree $previous) -ne $appTree -or (Get-RemovalCount) -or $script:stops -ne 1) { throw 'Update after releasing app.previous did not keep the replaced app as app.previous, or left a removal folder.' }

    # Update over a damaged or missing installation.json in this app's own folder
    # (#199): rebuilt from app\package.json, written durably, and the update runs.
    foreach ($damage in @('NUL-filled','missing')) {
        if ($damage -eq 'missing') { Remove-Item -LiteralPath $marker -Force } else { [IO.File]::WriteAllBytes($marker, (New-Object byte[] 128)) }
        $failure = Get-Failure { Install-App 3>$null }
        $installed = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
        if ($failure -or $installed.product -ne 'living-room-display' -or $installed.state -ne 'installed' -or $installed.version -ne '0.1.0' -or $installed.sourceRevision -ne $script:fixtureRevision -or (Get-FileHash -LiteralPath $stateFile).Hash -ne $stateHash) { throw "Update over a $damage marker failed or wrote the wrong marker: $failure" }
    }
    $failure = Get-Failure { [IO.File]::WriteAllBytes($marker, (New-Object byte[] 16)); Assert-Installed }
    if ($failure -notmatch 'is damaged') { throw "The CLI did not name a damaged marker: $failure" }
    Write-Json $marker @{product='living-room-display';state='installed';version='0.1.0';sourceRevision=$script:fixtureRevision;sourceState='clean'}

    # Uninstall renames every folder aside, app first, before it deletes any
    # (#207). A held file stops it with every folder in place; a re-run finishes.
    [IO.File]::WriteAllText((Join-Path $runtime 'node.exe'), 'synthetic node')
    $null = New-Item -ItemType Directory -Path (Join-Path $InstallRoot 'edge-profile\Default') -Force
    foreach ($heldFile in @((Join-Path $app 'dist\server\index.js'), (Join-Path $runtime 'node.exe'))) {
        $appTree = Get-Tree $app; $runtimeTree = Get-Tree $runtime; $previousTree = Get-Tree $previous; $markerHash = (Get-FileHash -LiteralPath $marker).Hash
        $held = Open-Held $heldFile
        $failure = Get-Failure { Uninstall-App }
        $held.Dispose(); $held = $null
        if ($failure -notmatch 'Uninstall stopped and left the app in place: A file in ') { throw "Uninstall with a held $heldFile did not stop: $failure" }
        if ((Get-Tree $app) -ne $appTree -or (Get-Tree $runtime) -ne $runtimeTree -or (Get-Tree $previous) -ne $previousTree -or (Get-FileHash -LiteralPath $marker).Hash -ne $markerHash -or (Get-FileHash -LiteralPath $stateFile).Hash -ne $stateHash -or (Get-RemovalCount)) { throw "Uninstall with a held $heldFile did not leave every folder, the marker and data in place." }
    }
    # A removal folder that can't be deleted yet doesn't stop the uninstall; the next one removes it.
    $leftover = Join-Path $InstallRoot 'removing'
    $null = New-Item -ItemType Directory -Path $leftover -Force
    [IO.File]::WriteAllText((Join-Path $leftover 'held.txt'), 'held')
    $held = Open-Held (Join-Path $leftover 'held.txt')
    $output = @(Uninstall-App) -join ' '
    $held.Dispose(); $held = $null
    if ($output -notmatch 'Some files were still in use' -or (Test-Path -LiteralPath $app) -or (Test-Path -LiteralPath $runtime) -or (Test-Path -LiteralPath $previous) -or (Test-Path -LiteralPath (Join-Path $InstallRoot 'edge-profile')) -or -not (Test-Path -LiteralPath $leftover) -or (Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).state -ne 'uninstalled' -or (Get-FileHash -LiteralPath $stateFile).Hash -ne $stateHash) { throw "Uninstall next to a held removal folder did not finish, or removed data: $output" }
    Uninstall-App | Out-Null
    if ((Get-RemovalCount) -or (Get-FileHash -LiteralPath $stateFile).Hash -ne $stateHash) { throw 'A later Uninstall did not remove the leftover removal folder, or changed data.' }
    # With -RemoveData the data goes aside too: a held file in it stops the
    # uninstall with the app and the data in place.
    Install-App | Out-Null
    $RemoveData = $true
    $appTree = Get-Tree $app; $dataTree = Get-Tree $data
    $held = Open-Held $stateFile
    $failure = Get-Failure { Uninstall-App }
    $held.Dispose(); $held = $null
    if ($failure -notmatch 'left the app in place: A file in .*\\data is in use' -or (Get-Tree $app) -ne $appTree -or (Get-Tree $data) -ne $dataTree -or (Get-RemovalCount)) { throw "Uninstall -RemoveData with a held data file did not leave app and data in place: $failure" }
    Uninstall-App | Out-Null
    $RemoveData = $false
    if ((Test-Path -LiteralPath $data) -or (Test-Path -LiteralPath $app) -or (Get-RemovalCount) -or -not (Test-Path -LiteralPath $marker)) { throw 'Uninstall -RemoveData did not remove app and data, or lost the marker.' }

    # A damaged marker in a folder that isn't this app's stays refused.
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
    $null = New-Item -ItemType Directory -Path $InstallRoot
    [IO.File]::WriteAllText((Join-Path $InstallRoot 'someone-else.txt'), 'unrelated')
    [IO.File]::WriteAllBytes($marker, (New-Object byte[] 32))
    $failure = Get-Failure { Install-App }
    if ($failure -notmatch "is damaged and the folder doesn't hold Living Room Display files" -or (Test-Path -LiteralPath $app) -or @(Get-ChildItem -LiteralPath $InstallRoot -Force).Count -ne 2) { throw "Update over a damaged marker in a foreign folder was not refused unchanged: $failure" }
} finally {
    if ($held) { $held.Dispose() }
    $full = [IO.Path]::GetFullPath($scratchRoot)
    $allowed = [IO.Path]::GetFullPath((Join-Path $repository '.local')).TrimEnd('\') + '\'
    if (-not $full.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { throw 'Lifecycle test cleanup escaped .local.' }
    Remove-Item -LiteralPath $full -Recurse -Force
}
Write-Output 'Retain-data uninstall/reinstall, failed update, held app.previous, damaged marker and held-file uninstall passed using real file transactions; external build/process/native boundaries were mocked.'
