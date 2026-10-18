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
    foreach ($file in @('LivingRoomDisplay.ps1','Build-Host.ps1','Test-Windows.ps1')) {
        $parseErrors = $null
        $null = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $file),[ref]$null,[ref]$parseErrors)
        Assert-True ($parseErrors.Count -eq 0) "PowerShell syntax failed: $file"
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
        Assert-True ($null -ne (Get-OwnedServer)) 'Exact owned test process was not recognized.'
        Write-Json (Join-Path $run 'server.json') @{processId=$ownedTestProcess.Id;startedAt='2000-01-01T00:00:00.0000000Z'}
        Assert-True ($null -eq (Get-OwnedServer)) 'Reused PID/start-time mismatch was adopted.'
        $passed++
    }
    Write-Output "$passed Windows checks passed. No capture, kiosk, install, port listener, or screensaver setting was used."
} finally {
    if ($ownedTestProcess -and -not $ownedTestProcess.HasExited) { $ownedTestProcess | Stop-Process -Force }
    # Remove only this test's known junction itself, then validate its absolute scratch root.
    if (Test-Path -LiteralPath $junction) { Remove-Item -LiteralPath $junction -Force }
    $scratchFull = [IO.Path]::GetFullPath($scratch)
    $allowed = [IO.Path]::GetFullPath((Join-Path $repo '.local')).TrimEnd('\') + '\'
    if (-not $scratchFull.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { throw 'Test cleanup path escaped .local.' }
    Remove-Item -LiteralPath $scratchFull -Recurse -Force
}
