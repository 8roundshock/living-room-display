[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SetupPath,
    [Parameter(Mandatory)][string]$ReleaseJson,
    # The CI-only rollback-test Setup (Build-Installer.ps1 -RollbackTestOutputDirectory)
    # and its release.json: same version, but its server fails the health check (#189).
    [Parameter(Mandatory)][string]$RollbackSetupPath,
    [Parameter(Mandatory)][string]$RollbackReleaseJson,
    # 'default' (%LOCALAPPDATA%\LivingRoomDisplay) or 'custom' (a RUNNER_TEMP
    # folder whose name has a space and a non-ASCII character).
    [ValidateSet('default','custom')][string]$DirectoryMode = 'default'
)
# End-to-end install/repair/uninstall smoke test of the real Setup. CI ONLY:
# it installs, starts a server on port 4318 and uninstalls. Never run it on a
# PC with a Living Room Display install, a listener on 4318, or the Setup
# registration. No native kiosk, capture or screensaver is ever started.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$appIdKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{838B4E42-F1FC-44A0-B108-53DE8DF4563C}_is1'
$defaultRoot = Join-Path $env:LOCALAPPDATA 'LivingRoomDisplay'
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw "SMOKE FAILED: $Message" } }
function Test-Port4318 {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $pending = $client.BeginConnect('127.0.0.1', 4318, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(1500)) { return $false }
        try { $client.EndConnect($pending); return $true } catch { return $false }
    } finally { $client.Close() }
}

# ---- hard guards -----------------------------------------------------------
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Refusing to run: this smoke test only runs on GitHub Actions runners.' }
if (Test-Path -LiteralPath (Join-Path $defaultRoot 'installation.json')) { throw 'Refusing to run: a Living Room Display installation.json already exists for this account.' }
if (Test-Port4318) { throw 'Refusing to run: something is listening on 127.0.0.1:4318.' }
if (Test-Path -LiteralPath $appIdKey) { throw 'Refusing to run: the Living Room Display Setup registration already exists.' }
if (-not $env:RUNNER_TEMP) { throw 'RUNNER_TEMP is not set.' }

$runnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\')
$work = Join-Path $runnerTemp ('lrd-smoke-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $work
$SetupPath = [IO.Path]::GetFullPath($SetupPath)
$ReleaseJson = [IO.Path]::GetFullPath($ReleaseJson)
$RollbackSetupPath = [IO.Path]::GetFullPath($RollbackSetupPath)
$RollbackReleaseJson = [IO.Path]::GetFullPath($RollbackReleaseJson)
$release = Get-Content -LiteralPath $ReleaseJson -Raw | ConvertFrom-Json
$expectedVersion = [string]$release.version
# U+00DC (U with diaeresis) keeps this file ASCII for Windows PowerShell 5.1.
$installRoot = if ($DirectoryMode -eq 'custom') { Join-Path $work ('Living Room ' + [char]0x00DC + 'nicode\LivingRoomDisplay') } else { $defaultRoot }
$data = Join-Path $installRoot 'data'
$marker = Join-Path $installRoot 'installation.json'
$scr = Join-Path $installRoot 'app\windows\LivingRoomDisplay.scr'
$programs = Join-Path ([Environment]::GetFolderPath('Programs')) ''
$desktop = [Environment]::GetFolderPath('Desktop')
$step = 0
function Write-Step([string]$Message) { $script:step++; Write-Host ("[{0:D2}] {1}" -f $script:step, $Message) }

function Invoke-Program([string]$File, [string]$Arguments, [int]$TimeoutSeconds = 600) {
    # Process.Start + WaitForExit, never the Start-Process cmdlet's wait switch:
    # on Windows PowerShell 5.1 that also waits for descendants such as the server.
    $launch = New-Object Diagnostics.ProcessStartInfo
    $launch.FileName = $File
    $launch.Arguments = $Arguments
    $launch.UseShellExecute = $false
    $process = [Diagnostics.Process]::Start($launch)
    try {
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) { $process.Kill(); throw "$File timed out." }
        return $process.ExitCode
    } finally { $process.Dispose() }
}
function Invoke-Setup([string]$Name, [string]$Extra, [string]$File = $SetupPath) {
    $log = Join-Path $work "$Name.log"
    # GitHub runners are always elevated with UAC on; Setup refuses that unless told.
    $arguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLOWELEVATED=1 /LOG="' + $log + '"'
    if ($DirectoryMode -eq 'custom') { $arguments += ' /DIR="' + $installRoot + '"' }
    if ($Extra) { $arguments += ' ' + $Extra }
    $code = Invoke-Program $File $arguments
    Write-Host "Setup ($Name) exit code $code"
    return [pscustomobject]@{Code=$code;Log=$log}
}
function Show-Log([string]$Path) { if (Test-Path -LiteralPath $Path) { Write-Host "----- $Path"; Get-Content -LiteralPath $Path | ForEach-Object { Write-Host $_ }; Write-Host '-----' } }
function Wait-Until([scriptblock]$Condition, [int]$Seconds, [string]$Message) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while (-not (& $Condition)) {
        if ([DateTime]::UtcNow -gt $deadline) { throw "SMOKE FAILED: timed out waiting: $Message" }
        Start-Sleep -Milliseconds 500
    }
}
function Get-TreeState([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return '<absent>' }
    $lines = foreach ($file in (Get-ChildItem -LiteralPath $Path -Recurse -Force -File | Sort-Object FullName)) { $file.FullName.Substring($Path.Length) + '|' + (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }
    return (@($lines) -join "`n")
}
function Get-Http([string]$Path) { return Invoke-WebRequest -Uri ('http://127.0.0.1:4318' + $Path) -UseBasicParsing -TimeoutSec 10 }
function Get-OwnedProcesses {
    $runtimeNode = Join-Path $installRoot 'runtime\node.exe'
    return @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -eq $runtimeNode -or $_.ExecutablePath -eq $scr) })
}
function Get-BeforeState {
    $desktopValues = Get-ItemProperty 'HKCU:\Control Panel\Desktop'
    $saver = foreach ($name in @('SCRNSAVE.EXE','ScreenSaveActive','ScreenSaveTimeOut','ScreenSaverIsSecure')) { $property = $desktopValues.PSObject.Properties[$name]; "$name=$(if ($property) { $property.Value } else { '<absent>' })" }
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $runValues = if (Test-Path $runKey) { (Get-ItemProperty $runKey).PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { "$($_.Name)=$($_.Value)" } } else { @() }
    $tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | ForEach-Object { $_.TaskPath + $_.TaskName } | Sort-Object)
    $firewall = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue | Where-Object { $_.Program -and $_.Program -like '*LivingRoomDisplay*' } | ForEach-Object Program)
    return [pscustomobject]@{Saver=(@($saver) -join ';');Run=(@($runValues | Sort-Object) -join ';');Tasks=($tasks -join ';');Firewall=($firewall -join ';')}
}
function Get-StartMenu { return @(Get-ChildItem -LiteralPath $programs -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Substring($programs.Length) } | Sort-Object) }
function Get-Shortcut([string]$Path) {
    $shell = New-Object -ComObject WScript.Shell
    try { $link = $shell.CreateShortcut($Path); return [pscustomobject]@{Target=$link.TargetPath;Arguments=$link.Arguments} } finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
}
function Stop-UninstallerPhases {
    # The uninstaller's second phase runs as %TEMP%\_iu*.tmp; end any left behind.
    foreach ($phase in @(Get-CimInstance Win32_Process | Where-Object { $_.Name -like '_iu*.tmp' })) { Stop-Process -Id $phase.ProcessId -Force -ErrorAction SilentlyContinue }
}
function Assert-Healthy([string]$When) {
    $health = (Get-Http '/api/health').Content | ConvertFrom-Json
    Assert-True ($health.status -eq 'ok' -and $health.version -eq $expectedVersion) "health $When`: $($health | ConvertTo-Json -Compress)"
}
function Invoke-Uninstall([string]$Extra) {
    $uninstaller = Join-Path $installRoot 'uninstall\unins000.exe'
    Assert-True (Test-Path -LiteralPath $uninstaller) 'the uninstaller is missing'
    $code = Invoke-Program $uninstaller ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART ' + $Extra).Trim()
    Write-Host "Uninstaller first phase exit code $code"
    # The first phase may exit before the temporary second phase finishes.
    Wait-Until { -not (Test-Path -LiteralPath $appIdKey) } 120 'uninstall registration removal'
    # The uninstaller deletes its own files after the registration is gone.
    Wait-Until { -not (Test-Path -LiteralPath $uninstaller) } 60 'uninstaller self-removal'
    Assert-True ($code -eq 0) "uninstaller exit code $code"
}

$listener = $null
try {
    Write-Step "Recording the before-state ($DirectoryMode directory: $installRoot)"
    $before = Get-BeforeState
    $startBefore = Get-StartMenu

    Write-Step 'Silent install'
    $result = Invoke-Setup 'install'
    if ($result.Code -ne 0) { Show-Log $result.Log; throw "SMOKE FAILED: install exit code $($result.Code)" }
    $setupLog = Get-Content -LiteralPath $result.Log -Raw
    Assert-True ($setupLog.Contains('--- Living Room Display helper log ---') -and $setupLog.Contains('Result: exit 0')) 'the helper log was not appended to the Setup log'
    $installed = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
    Assert-True ($installed.channel -eq 'package' -and $installed.version -eq $expectedVersion -and $installed.state -eq 'installed') "marker: $($installed | ConvertTo-Json -Compress)"
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $installRoot 'app\release.json')).Hash -eq (Get-FileHash -LiteralPath $ReleaseJson).Hash) 'app/release.json differs from the artifact'

    Write-Step 'Health, routes, helper check and loopback-only listener'
    $health = (Get-Http '/api/health').Content | ConvertFrom-Json
    Assert-True ($health.status -eq 'ok' -and $health.version -eq $expectedVersion) "health: $($health | ConvertTo-Json -Compress)"
    foreach ($route in @('/editor','/display')) { Assert-True ((Get-Http $route).StatusCode -eq 200) "$route did not return 200" }
    Assert-True ((Invoke-Program $scr '--check' 60) -eq 0) 'LivingRoomDisplay.scr --check failed'
    $listening = @(Get-NetTCPConnection -LocalPort 4318 -State Listen -ErrorAction Stop)
    Assert-True ($listening.Count -ge 1 -and @($listening | Where-Object { $_.LocalAddress -ne '127.0.0.1' }).Count -eq 0) "listener addresses: $(($listening | ForEach-Object LocalAddress) -join ',')"

    Write-Step 'Apps & Features registration and shortcuts'
    $key = Get-ItemProperty -LiteralPath $appIdKey
    Assert-True ($key.DisplayName -eq 'Living Room Display' -and $key.DisplayVersion -eq $expectedVersion -and $key.Publisher -eq 'Living Room Display project') 'uninstall key name/version/publisher'
    Assert-True ($key.InstallLocation.TrimEnd('\') -eq $installRoot -and $key.QuietUninstallString -match 'unins000\.exe' -and [int]$key.EstimatedSize -gt 0) "uninstall key location/quiet string/size: $($key.InstallLocation) $($key.QuietUninstallString) $($key.EstimatedSize)"
    $editorLink = Get-Shortcut (Join-Path $programs 'Living Room Display.lnk')
    $displayLink = Get-Shortcut (Join-Path $programs 'Living Room Display - Show display.lnk')
    Assert-True ($editorLink.Target -eq $scr -and $editorLink.Arguments -eq '--editor') "editor shortcut: $($editorLink.Target) $($editorLink.Arguments)"
    Assert-True ($displayLink.Target -eq $scr -and $displayLink.Arguments -eq '--display') "display shortcut: $($displayLink.Target) $($displayLink.Arguments)"
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $desktop 'Living Room Display.lnk'))) 'a desktop shortcut was created by default'
    $newEntries = @(Get-StartMenu | Where-Object { $startBefore -notcontains $_ })
    Assert-True ($newEntries.Count -eq 2) "unexpected Start menu changes: $($newEntries -join ', ')"
    $after = Get-BeforeState
    Assert-True ($after.Saver -eq $before.Saver -and $after.Run -eq $before.Run -and $after.Tasks -eq $before.Tasks -and $after.Firewall -eq $before.Firewall) 'screensaver, Run, scheduled task or firewall state changed'

    Write-Step 'Synthetic reminder, then repair keeps data and takes a snapshot'
    $reminder = Invoke-RestMethod -Uri 'http://127.0.0.1:4318/api/reminders' -Method Post -ContentType 'application/json' -Body '{"text":"Synthetic smoke reminder"}' -UseBasicParsing
    Assert-True ([bool]$reminder) 'creating a synthetic reminder failed'
    Start-Sleep -Seconds 1
    $dataHash = Get-TreeState $data
    Assert-True ($dataHash -ne '<absent>' -and $dataHash.Contains('state.json')) 'no data was written'
    $result = Invoke-Setup 'repair'
    if ($result.Code -ne 0) { Show-Log $result.Log; throw "SMOKE FAILED: repair exit code $($result.Code)" }
    Assert-True ((Get-Content -LiteralPath $result.Log -Raw).Contains('Step: backup')) 'the repair did not report its backup step'
    Assert-True ((Get-TreeState $data) -eq $dataHash) 'repair changed data'
    $snapshots = @(Get-ChildItem -LiteralPath (Join-Path $installRoot 'backups') -Directory -Filter 'data-before-*')
    Assert-True ($snapshots.Count -eq 1 -and (Get-TreeState $snapshots[0].FullName) -eq $dataHash) 'repair snapshot missing or different from data'
    Assert-True (Test-Path -LiteralPath (Join-Path $installRoot 'app.previous\release.json')) 'app.previous was not kept'
    $status = & (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -ExecutionPolicy Bypass -Command "& '$(Join-Path $installRoot 'app\windows\LivingRoomDisplay.ps1')' Status -InstallRoot '$installRoot' | ConvertTo-Json -Compress"
    $status = ($status -join '') | ConvertFrom-Json
    Assert-True ($status.ServerRunning -and $status.Channel -eq 'package' -and $status.Version -eq $expectedVersion -and $status.RuntimeVersion -eq $release.node.version) "Status: $($status | ConvertTo-Json -Compress)"

    Write-Step 'Automatic rollback on a real install: the new server fails its health check (#189)'
    # The rollback-test Setup differs only in app/package.json, so its server
    # reports another version. Setup must stop that real server, wait for it to
    # exit and rename app back; a Stop that returned early would race the rename.
    $appTree = Get-TreeState (Join-Path $installRoot 'app')
    $runtimeTree = Get-TreeState (Join-Path $installRoot 'runtime')
    $markerBefore = Get-Content -LiteralPath $marker -Raw
    $result = Invoke-Setup 'rollback' '' $RollbackSetupPath
    if ($result.Code -ne 7 -or -not (Get-Content -LiteralPath $result.Log -Raw).Contains('Helper exit code: 15')) { Show-Log $result.Log; throw "SMOKE FAILED: the rollback-test Setup exited $($result.Code); expected 7 with helper exit code 15" }
    Assert-True ((Get-TreeState (Join-Path $installRoot 'app')) -eq $appTree -and (Get-TreeState (Join-Path $installRoot 'runtime')) -eq $runtimeTree) 'the rollback did not put app and runtime back exactly'
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $installRoot 'app.failed\release.json')).Hash -eq (Get-FileHash -LiteralPath $RollbackReleaseJson).Hash) 'app.failed does not hold the rollback-test candidate'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $installRoot 'package-transaction.json')) -and (Get-Content -LiteralPath $marker -Raw) -eq $markerBefore) 'the rollback left its record or did not restore installation.json'
    Assert-Healthy 'after the rollback'
    Assert-True ((Get-TreeState $data) -eq $dataHash) 'the rollback changed data'
    $result = Invoke-Setup 'repair-after-rollback'
    if ($result.Code -ne 0) { Show-Log $result.Log; throw "SMOKE FAILED: repair after the rollback exit code $($result.Code)" }
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $installRoot 'app.failed'))) 'the next Setup run did not remove app.failed'
    Assert-Healthy 'after the repair that followed the rollback'
    Assert-True ((Get-TreeState $data) -eq $dataHash) 'the repair after the rollback changed data'

    Write-Step 'A failed uninstall keeps the registration, and a repair then works (#158)'
    # Hold one app file open without sharing: Uninstall stops the server, then
    # can't remove app, so the uninstaller must abort with the registration kept.
    $uninstaller = Join-Path $installRoot 'uninstall\unins000.exe'
    $uninstallLog = Join-Path $work 'uninstall-failure.log'
    $held = [IO.File]::Open((Join-Path $installRoot 'app\package.json'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    try {
        # /SUPPRESSMSGBOXES suppresses the error box (Inno's ShowExceptionMsg is
        # suppressible); the timeout and phase cleanup keep a hang from blocking CI.
        try { $code = Invoke-Program $uninstaller ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="' + $uninstallLog + '"') 300 }
        catch { Stop-UninstallerPhases; Show-Log $uninstallLog; throw "SMOKE FAILED: the failing uninstaller did not finish: $($_.Exception.Message)" }
    } finally { $held.Dispose() }
    Write-Host "Uninstaller exit code after the forced removal failure: $code"
    $uninstallText = if (Test-Path -LiteralPath $uninstallLog) { Get-Content -LiteralPath $uninstallLog -Raw } else { '' }
    if ($code -eq 0 -or -not (Test-Path -LiteralPath $appIdKey) -or -not (Test-Path -LiteralPath $uninstaller)) { Show-Log $uninstallLog; throw "SMOKE FAILED: a failed uninstall exited $code or removed the registration or the uninstaller" }
    Assert-True ((Get-TreeState $data) -eq $dataHash -and (Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).state -eq 'installed') 'a failed uninstall changed data or the marker'
    if ($uninstallText -notmatch 'Failed: [^\r\n]{10,}' -or -not $uninstallText.Contains('couldn''t stop or remove some files')) { Show-Log $uninstallLog; throw 'SMOKE FAILED: the helper''s Failed: reason or the abort message is missing from the uninstall log' }
    $result = Invoke-Setup 'repair-after-failed-uninstall'
    if ($result.Code -ne 0) { Show-Log $result.Log; throw "SMOKE FAILED: repair after a failed uninstall exit code $($result.Code)" }
    Assert-Healthy 'after the repair that followed the failed uninstall'
    Assert-True ((Get-TreeState $data) -eq $dataHash) 'the repair after a failed uninstall changed data'

    Write-Step 'Silent default uninstall keeps data'
    Invoke-Uninstall ''
    foreach ($gone in @('app','runtime','run','edge-profile','app.previous','app.failed','package-transaction.json','uninstall\unins000.exe')) { Assert-True (-not (Test-Path -LiteralPath (Join-Path $installRoot $gone))) "uninstall left $gone" }
    Assert-True ((Get-TreeState $data) -eq $dataHash) 'default uninstall changed data'
    Assert-True ((Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).state -eq 'uninstalled') 'marker not kept as uninstalled'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $programs 'Living Room Display.lnk')) -and -not (Test-Path -LiteralPath (Join-Path $programs 'Living Room Display - Show display.lnk'))) 'shortcuts remain'
    Assert-True (-not (Test-Port4318) -and @(Get-OwnedProcesses).Count -eq 0) 'port 4318 still in use or an owned process remains'

    Write-Step 'Reinstall keeps the retained data'
    $result = Invoke-Setup 'reinstall'
    if ($result.Code -ne 0) { Show-Log $result.Log; throw "SMOKE FAILED: reinstall exit code $($result.Code)" }
    Assert-True ((Get-TreeState $data) -eq $dataHash) 'reinstall changed data'
    Assert-True (((Get-Http '/api/health').Content | ConvertFrom-Json).version -eq $expectedVersion) 'reinstalled server is not healthy'

    Write-Step 'Uninstall with /REMOVEDATA=1 removes data, snapshots and the folder'
    Invoke-Uninstall '/REMOVEDATA=1'
    Wait-Until { -not (Test-Path -LiteralPath $installRoot) } 90 'install folder removal after a data-delete uninstall'
    Assert-True (-not (Test-Port4318) -and @(Get-OwnedProcesses).Count -eq 0) 'port 4318 still in use or an owned process remains after removal'
    $after = Get-BeforeState
    Assert-True ($after.Saver -eq $before.Saver -and $after.Run -eq $before.Run -and $after.Tasks -eq $before.Tasks -and $after.Firewall -eq $before.Firewall) 'before-state changed after uninstall'
    Assert-True (@(Get-StartMenu | Where-Object { $startBefore -notcontains $_ }).Count -eq 0) 'Start menu entries remain'

    Write-Step 'Refusal: a nonempty folder without a marker (exit 7, unchanged, unregistered)'
    $foreign = Join-Path $work 'not ours'
    $null = New-Item -ItemType Directory -Path $foreign
    [IO.File]::WriteAllText((Join-Path $foreign 'keep.txt'), 'unrelated')
    $foreignBefore = Get-TreeState $foreign
    $code = Invoke-Program $SetupPath ('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLOWELEVATED=1 /LOG="' + (Join-Path $work 'foreign.log') + '" /DIR="' + $foreign + '"')
    Assert-True ($code -eq 7 -and (Get-TreeState $foreign) -eq $foreignBefore -and @(Get-ChildItem -LiteralPath $foreign -Force).Count -eq 1 -and -not (Test-Path -LiteralPath $appIdKey)) "foreign folder: exit $code"

    Write-Step 'Refusal: port 4318 taken by another program (exit 7, nothing created)'
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 4318)
    $listener.Start()
    $result = Invoke-Setup 'port-taken'
    Assert-True ($result.Code -eq 7 -and -not (Test-Path -LiteralPath $installRoot) -and -not (Test-Path -LiteralPath $appIdKey)) "port taken: exit $($result.Code)"
    Assert-True ((Get-Content -LiteralPath $result.Log -Raw).Contains('Helper exit code: 11')) 'the port refusal did not come from the helper (exit 11)'
    Write-Host 'Installer smoke test passed.'
} finally {
    if ($listener) { $listener.Stop() }
    Stop-UninstallerPhases
    foreach ($process in (Get-OwnedProcesses)) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
    if (([IO.Path]::GetFullPath($work)).StartsWith($runnerTemp + '\', [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $work)) {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
