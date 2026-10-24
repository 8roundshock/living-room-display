[CmdletBinding()]
param([string]$NodeExe)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$scratch = Join-Path $repo ('.local\windows-check-' + [Guid]::NewGuid().ToString('N'))
$fixture = Join-Path $scratch 'install'
$compiled = Join-Path $scratch 'compiled'
$null = New-Item -ItemType Directory -Path $fixture -Force
$ownedTestProcess = $null
$junction = Join-Path $fixture 'with-junction\link'
$passed = 0
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Expect-Failure([scriptblock]$Action, [string]$Message) {
    $failed = $false
    try { & $Action } catch { $failed = $true }
    Assert-True $failed $Message
}
try {
    foreach ($file in @('LivingRoomDisplay.ps1','Build-Host.ps1','Test-Windows.ps1','tests\Test-IdleRestore.ps1','tests\Test-InstallLifecycle.ps1','tests\Test-PreviewLifecycle.ps1','tests\Test-SourceProvenance.ps1','tests\Test-PackageInstall.ps1','tests\Test-ServerRuntime.ps1','installer\Build-Installer.ps1','installer\New-InstallerArt.ps1','installer\tests\Test-InstallerPolicy.ps1','installer\tests\Test-InstallerPayload.ps1','installer\tests\Test-InstallerSmoke.ps1')) {
        $parseErrors = $null
        $null = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file),[ref]$null,[ref]$parseErrors)
        Assert-True ($parseErrors.Count -eq 0) "PowerShell syntax failed: $file"
        # Windows PowerShell 5.1 reads BOM-less scripts as ANSI: keep them ASCII.
        Assert-True (-not ([IO.File]::ReadAllText((Join-Path $PSScriptRoot $file)) -match '[^\x00-\x7F]')) "PowerShell script is not ASCII: $file"
    }
    $passed++
    $binary = & (Join-Path $PSScriptRoot 'Build-Host.ps1') -OutputDirectory $compiled
    foreach ($argument in @('--check','/p 0','/p:0','--invalid')) {
        $launch = New-Object Diagnostics.ProcessStartInfo
        $launch.FileName = $binary
        $launch.Arguments = $argument
        $launch.UseShellExecute = $false
        $launch.CreateNoWindow = $true
        $launch.RedirectStandardOutput = $true
        $launch.RedirectStandardError = $true
        $process = [Diagnostics.Process]::Start($launch)
        try {
            Assert-True ($process.WaitForExit(10000)) 'Read-only native invocation timed out.'
            $expected = if ($argument -eq '--invalid') { 1 } else { 0 }
            Assert-True ($process.ExitCode -eq $expected) ("Native argument failed: " + $argument + ': ' + $process.StandardError.ReadToEnd())
        } finally { if (-not $process.HasExited) { $process.Kill() }; $process.Dispose() }
    }
    $passed++
    # Real -File binding differs from dot-sourcing on Windows PowerShell5.1.
    # Missing install should reach the ownership guard, not fail a parameter default.
    $controlInvocation = New-Object Diagnostics.ProcessStartInfo
    $controlInvocation.FileName = (Get-Process -Id $PID).Path
    $controlInvocation.Arguments = '-NoProfile -File "' + (Join-Path $PSScriptRoot 'LivingRoomDisplay.ps1') + '" Status -InstallRoot "' + $fixture + '"'
    $controlInvocation.UseShellExecute = $false
    $controlInvocation.CreateNoWindow = $true
    $controlInvocation.RedirectStandardError = $true
    $controlInvocation.RedirectStandardOutput = $true
    $controlProcess = [Diagnostics.Process]::Start($controlInvocation)
    try {
        Assert-True ($controlProcess.WaitForExit(10000)) 'Control -File invocation timed out.'
        $controlError = $controlProcess.StandardError.ReadToEnd()
        Assert-True ($controlProcess.ExitCode -ne 0 -and $controlError.Contains('Not installed at')) 'Control -File did not reach the intended missing-install guard.'
    } finally { if (-not $controlProcess.HasExited) { $controlProcess.Kill() }; $controlProcess.Dispose() }
    $passed++
    $framework = if ([Environment]::Is64BitOperatingSystem) { 'Framework64' } else { 'Framework' }
    $compiler = Join-Path $env:WINDIR "Microsoft.NET\$framework\v4.0.30319\csc.exe"
    $lifecycleTest = Join-Path $compiled 'HostLifecycleTests.exe'
    & $compiler /nologo /target:exe /platform:anycpu "/out:$lifecycleTest" (Join-Path $PSScriptRoot 'SessionStartup.cs') (Join-Path $PSScriptRoot 'tests\HostLifecycleTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Lifecycle regression compilation failed.' }
    & $lifecycleTest
    if ($LASTEXITCODE -ne 0) { throw 'Lifecycle regression failed.' }
    $passed++
    $snapshotTest = Join-Path $compiled 'DesktopSnapshotTests.exe'
    & $compiler /nologo /target:exe /platform:anycpu "/out:$snapshotTest" /reference:System.Drawing.dll (Join-Path $PSScriptRoot 'DesktopSnapshot.cs') (Join-Path $PSScriptRoot 'tests\DesktopSnapshotTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Snapshot encoding regression compilation failed.' }
    & $snapshotTest
    if ($LASTEXITCODE -ne 0) { throw 'Snapshot encoding regression failed.' }
    $passed++
    $preparationTest = Join-Path $compiled 'PreviewPreparationTests.exe'
    & $compiler /nologo /target:exe /platform:anycpu "/out:$preparationTest" (Join-Path $PSScriptRoot 'PreviewPreparation.cs') (Join-Path $PSScriptRoot 'tests\PreviewPreparationTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Preview preparation policy compilation failed.' }
    & $preparationTest
    if ($LASTEXITCODE -ne 0) { throw 'Preview preparation policy regression failed.' }
    $passed++
    $claimFlowTest = Join-Path $compiled 'PreparedClaimFlowTests.exe'
    & $compiler /nologo /target:exe /platform:anycpu "/out:$claimFlowTest" (Join-Path $PSScriptRoot 'PreviewPreparation.cs') (Join-Path $PSScriptRoot 'tests\PreparedClaimFlowTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Prepared claim orchestration compilation failed.' }
    & $claimFlowTest
    if ($LASTEXITCODE -ne 0) { throw 'Prepared claim orchestration regression failed.' }
    $passed++
    $protocolTest = Join-Path $compiled 'PreparedSnapshotProtocolTests.exe'
    & $compiler /nologo /target:exe /platform:anycpu "/out:$protocolTest" /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'PreparedSnapshotClient.cs') (Join-Path $PSScriptRoot 'tests\PreparedSnapshotProtocolTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Prepared snapshot protocol compilation failed.' }
    & $protocolTest
    if ($LASTEXITCODE -ne 0) { throw 'Prepared snapshot protocol regression failed.' }
    $passed++
    $pipeTest = Join-Path $compiled 'NativePreviewPipeTests.exe'
    & $compiler /nologo /target:exe /platform:anycpu /main:NativePreviewPipeTests "/out:$pipeTest" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.Management.dll (Join-Path $PSScriptRoot 'PreviewPreparer.cs') (Join-Path $PSScriptRoot 'PreviewPreparation.cs') (Join-Path $PSScriptRoot 'PreparedSnapshotClient.cs') (Join-Path $PSScriptRoot 'DesktopSnapshot.cs') (Join-Path $PSScriptRoot 'tests\NativePreviewPipeTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Native preview pipe compilation failed.' }
    & $pipeTest
    if ($LASTEXITCODE -ne 0) { throw 'Native preview pipe regression failed.' }
    $passed++
    $runtimeTest = Join-Path $compiled 'ServerRuntimeTests.exe'
    & $compiler /nologo /target:exe /platform:anycpu "/out:$runtimeTest" /reference:System.Management.dll /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'ServerRuntime.cs') (Join-Path $PSScriptRoot 'tests\ServerRuntimeTests.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Server runtime regression compilation failed.' }
    & $runtimeTest
    if ($LASTEXITCODE -ne 0) { throw 'Server runtime regression failed.' }
    $passed++
    if ($NodeExe) {
        & (Join-Path $PSScriptRoot 'tests\Test-ServerRuntime.ps1') -NodeExe $NodeExe
        $passed++
    }
    foreach($testName in @('ActiveInputTests','SurfacePolicyTests')) {
        $target=Join-Path $compiled ($testName+'.exe')
        $sources=if($testName -eq 'ActiveInputTests'){@((Join-Path $PSScriptRoot 'SessionStartup.cs'))}else{@((Join-Path $PSScriptRoot 'SurfacePolicy.cs'))}
        & $compiler /nologo /target:exe /platform:anycpu "/out:$target" $sources (Join-Path $PSScriptRoot ('tests\'+$testName+'.cs'))
        if($LASTEXITCODE -ne 0){throw ($testName+' compilation failed')}
        & $target
        if($LASTEXITCODE -ne 0){throw ($testName+' failed')}
        $passed++
    }
    & (Join-Path $PSScriptRoot 'tests\Test-IdleRestore.ps1')
    $passed++
    & (Join-Path $PSScriptRoot 'tests\Test-InstallLifecycle.ps1')
    $passed++
    & (Join-Path $PSScriptRoot 'tests\Test-PreviewLifecycle.ps1')
    $passed++
    & (Join-Path $PSScriptRoot 'tests\Test-SourceProvenance.ps1')
    $passed++
    & (Join-Path $PSScriptRoot 'tests\Test-PackageInstall.ps1')
    $passed++
    & (Join-Path $PSScriptRoot 'installer\tests\Test-InstallerPolicy.ps1')
    $passed++
    # Release metadata: generated icon and version info on the helper.
    $art = & (Join-Path $PSScriptRoot 'installer\New-InstallerArt.ps1') -OutputDirectory (Join-Path $scratch 'art')
    $versioned = & (Join-Path $PSScriptRoot 'Build-Host.ps1') -OutputDirectory (Join-Path $scratch 'versioned') -IconFile $art.Icon -Version '9.8.7'
    $versionInfo = (Get-Item -LiteralPath $versioned).VersionInfo
    Assert-True ($versionInfo.ProductName -eq 'Living Room Display' -and $versionInfo.FileVersion -eq '9.8.7.0' -and $versionInfo.FileDescription -eq 'Living Room Display') 'Versioned helper lacks product/version info.'
    Assert-True ([string]::IsNullOrEmpty((Get-Item -LiteralPath $binary).VersionInfo.ProductName)) 'The default helper build changed: it gained version info.'
    $preparerInfo = (Get-Item -LiteralPath (Join-Path (Split-Path $versioned -Parent) 'LivingRoomDisplay.Preview.exe')).VersionInfo
    Assert-True ($preparerInfo.ProductName -eq 'Living Room Display' -and $preparerInfo.FileVersion -eq '9.8.7.0') 'Versioned preview preparer lacks product/version info.'
    $passed++
    . (Join-Path $PSScriptRoot 'LivingRoomDisplay.ps1') -InstallRoot $fixture -FunctionsOnly
    Write-Json $marker @{product='living-room-display'}
    Assert-Installed
    $outside = Join-Path $scratch 'outside'
    $null = New-Item -ItemType Directory -Path $outside
    [IO.File]::WriteAllText((Join-Path $outside 'keep.txt'),'preserve')
    Expect-Failure { Remove-OwnedDirectory $outside } 'Out-of-install cleanup was not rejected.'
    Expect-Failure { Remove-OwnedDirectory $InstallRoot } 'Install root cleanup was not rejected.'
    Assert-True (Test-Path -LiteralPath (Join-Path $outside 'keep.txt')) 'Out-of-install file changed.'
    $inside = Join-Path $fixture 'removable'
    $null = New-Item -ItemType Directory -Path $inside
    [IO.File]::WriteAllText((Join-Path $inside 'temporary.txt'),'temporary')
    Remove-OwnedDirectory $inside
    Assert-True (-not (Test-Path -LiteralPath $inside)) 'Owned test directory was not removed.'
    $passed++
    $null = New-Item -ItemType Directory -Path (Split-Path $junction -Parent)
    $null = New-Item -ItemType Junction -Path $junction -Target $outside
    Expect-Failure { Remove-OwnedDirectory (Split-Path $junction -Parent) } 'Nested junction cleanup was not rejected.'
    Expect-Failure { Assert-NoReparseAncestor (Join-Path $junction 'keep.txt') } 'Junction ancestor was not rejected.'
    Assert-True (Test-Path -LiteralPath (Join-Path $outside 'keep.txt')) 'Junction target changed.'
    $passed++
    $null = New-Item -ItemType Directory -Path $run -Force
    [IO.File]::WriteAllText((Join-Path $run 'server.json'),'{broken')
    Assert-True ($null -eq (Get-OwnedServer)) 'Malformed PID data was adopted.'
    Write-Json (Join-Path $run 'server.json') @{processId=$PID;startedAt=(Get-Process -Id $PID).StartTime.ToUniversalTime().ToString('o')}
    Assert-True ($null -eq (Get-OwnedServer)) 'Unrelated PowerShell process was adopted.'
    $passed++
    if ($NodeExe) {
        $NodeExe = [IO.Path]::GetFullPath($NodeExe)
        $script:node = $NodeExe
        $entryDirectory = Join-Path $app 'dist\server'
        $null = New-Item -ItemType Directory -Path $entryDirectory -Force
        $entry = Join-Path $entryDirectory 'index.js'
        [IO.File]::WriteAllText($entry, 'setTimeout(() => {}, 60000);')
        $ownedTestProcess = Start-Process -FilePath $NodeExe -ArgumentList ('"' + $entry + '"') -WindowStyle Hidden -PassThru
        Write-Json (Join-Path $run 'server.json') @{processId=$ownedTestProcess.Id;startedAt=$ownedTestProcess.StartTime.ToUniversalTime().ToString('o')}
        # A just-started process can briefly report no command line through CIM
        # (seen on a CI runner), so allow it a moment before judging ownership.
        for ($attempt = 0; $attempt -lt 20 -and $null -eq (Get-OwnedServer); $attempt++) { Start-Sleep -Milliseconds 150 }
        if ($null -eq (Get-OwnedServer)) {
            $seen = Get-CimInstance Win32_Process -Filter "ProcessId=$($ownedTestProcess.Id)"
            $record = Get-Content -LiteralPath (Join-Path $run 'server.json') -Raw
            throw ("Exact owned test process was not recognized. PS $($PSVersionTable.PSVersion); node=$script:node; exe=$($seen.ExecutablePath); cmd=$($seen.CommandLine); record=$record; start=" + (Get-Process -Id $ownedTestProcess.Id).StartTime.ToUniversalTime().ToString('o') + '; parsed=' + ([DateTimeOffset](ConvertFrom-Json $record).startedAt).UtcDateTime.ToString('o'))
        }
        Write-Json (Join-Path $run 'server.json') @{processId=$ownedTestProcess.Id;startedAt='2000-01-01T00:00:00.0000000Z'}
        Assert-True ($null -eq (Get-OwnedServer)) 'Reused PID/start-time mismatch was adopted.'
        $passed++
        # Stop must not return until the server is gone. Stop-Process only starts
        # ending it, and meanwhile it keeps app as its working folder, so Setup's
        # rename of app right after Stop could fail (#77 review of d2dd04f). The
        # rename goes through Setup's own Move-OwnedItem, as in a rollback.
        $ownedTestProcess | Stop-Process -Force
        $null = $ownedTestProcess.WaitForExit(10000)
        $renamedApp = Join-Path $fixture 'app.renamed'
        for ($round = 1; $round -le 5; $round++) {
            $ownedTestProcess = Start-Process -FilePath $NodeExe -ArgumentList ('"' + $entry + '"') -WorkingDirectory $app -WindowStyle Hidden -PassThru
            Write-Json (Join-Path $run 'server.json') @{processId=$ownedTestProcess.Id;startedAt=$ownedTestProcess.StartTime.ToUniversalTime().ToString('o')}
            for ($attempt = 0; $attempt -lt 20 -and $null -eq (Get-OwnedServer); $attempt++) { Start-Sleep -Milliseconds 150 }
            Assert-True ($null -ne (Get-OwnedServer)) "Round ${round}: the owned test server was not recognized."
            Stop-App
            Assert-True $ownedTestProcess.HasExited "Round ${round}: Stop returned before the owned server had exited."
            Move-OwnedItem $app $renamedApp
            Move-OwnedItem $renamedApp $app
        }
        $passed++
    }
} finally {
    if ($ownedTestProcess -and -not $ownedTestProcess.HasExited) { $ownedTestProcess | Stop-Process -Force }
    $scratchFull = [IO.Path]::GetFullPath($scratch)
    $allowed = [IO.Path]::GetFullPath((Join-Path $repo '.local')).TrimEnd('\') + '\'
    if (-not $scratchFull.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { throw 'Test cleanup path escaped .local.' }
    # PS5.1 Remove-Item can throw on a junction. Validate the exact known link,
    # then delete only that directory entry with recursion explicitly disabled.
    if (Test-Path -LiteralPath $junction) {
        $junctionFull = [IO.Path]::GetFullPath($junction)
        $expectedLink = Join-Path $scratchFull 'install\with-junction\link'
        if ($junctionFull -ne $expectedLink -or -not $junctionFull.StartsWith($scratchFull + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Test junction path escaped its expected location.' }
        if (-not ((Get-Item -LiteralPath $junctionFull -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Expected test junction is no longer a reparse point; cleanup stopped.' }
        [IO.Directory]::Delete($junctionFull, $false)
        Assert-True (-not (Test-Path -LiteralPath $junctionFull)) 'Known test junction was not removed.'
        Assert-True (Test-Path -LiteralPath (Join-Path $scratchFull 'outside\keep.txt')) 'Junction target was changed by link cleanup.'
    }
    Remove-Item -LiteralPath $scratchFull -Recurse -Force
}
Write-Output "$passed Windows checks passed, including cleanup. Only isolated test processes/listeners; no capture, kiosk, live install, or screensaver setting was used."
