Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$windowsDirectory = Split-Path $PSScriptRoot -Parent
$repository = Split-Path $windowsDirectory -Parent
$scratchRoot = Join-Path $repository ('.local\install-lifecycle-' + [Guid]::NewGuid().ToString('N'))
$testInstallRoot = Join-Path $scratchRoot 'install'
$testSourceRoot = Join-Path $scratchRoot 'source'
$null = New-Item -ItemType Directory -Path $testInstallRoot,$testSourceRoot -Force
try {
    . (Join-Path $windowsDirectory 'LivingRoomDisplay.ps1') -InstallRoot $testInstallRoot -SourceRoot $testSourceRoot -NoBrowser -FunctionsOnly
    # Exercise the real file transaction/ownership guards while replacing only
    # external build/runtime/process/native boundaries with deterministic fakes.
    $script:starts = 0
    $script:failBuild = $false
    function Set-Idle { param($Enabled) }
    function Stop-App { }
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
    $null = New-Item -ItemType Directory -Path $data,$app,$runtime,(Join-Path $testSourceRoot 'src') -Force
    [IO.File]::WriteAllText((Join-Path $testSourceRoot 'package-lock.json'),'{}')
    [IO.File]::WriteAllText((Join-Path $testSourceRoot 'package.json'),'{"version":"0.1.0"}')
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
    $markerHash = (Get-FileHash -LiteralPath $marker).Hash
    $script:fixtureRevision = 'c' * 40
    $script:failBuild = $true
    $failed = $false
    try { Install-App | Out-Null } catch { $failed = $true }
    if (-not $failed -or (Test-Path -LiteralPath (Join-Path $InstallRoot 'app.next')) -or -not (Test-Path -LiteralPath (Join-Path $app 'dist\server\index.js')) -or (Get-FileHash -LiteralPath $stateFile).Hash -ne $stateHash -or (Get-FileHash -LiteralPath $marker).Hash -ne $markerHash) { throw 'Failed update replaced app/data/provenance or leaked its candidate.' }
} finally {
    $full = [IO.Path]::GetFullPath($scratchRoot)
    $allowed = [IO.Path]::GetFullPath((Join-Path $repository '.local')).TrimEnd('\') + '\'
    if (-not $full.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { throw 'Lifecycle test cleanup escaped .local.' }
    Remove-Item -LiteralPath $full -Recurse -Force
}
Write-Output 'Retain-data uninstall/reinstall and failed update passed using real file transactions; external build/process/native boundaries were mocked.'
