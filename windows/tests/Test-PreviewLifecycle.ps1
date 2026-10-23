Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Pure/injected control checks: no process, listener, input, registry or desktop probes.
$windowsDirectory = Split-Path $PSScriptRoot -Parent
$repository = Split-Path $windowsDirectory -Parent
$scratch = Join-Path $repository ('.local\preview-lifecycle-' + [Guid]::NewGuid().ToString('N'))
$oldPreparer = $env:LRD_PREVIEW_PREPARER
$oldDisabled = $env:LRD_PREVIEW_PREPARER_DISABLED
function Assert-True([bool]$Value, [string]$Message) { if (-not $Value) { throw $Message } }
try {
    . (Join-Path $windowsDirectory 'LivingRoomDisplay.ps1') -InstallRoot (Join-Path $scratch 'install') -FunctionsOnly
    $null = New-Item -ItemType Directory -Path (Join-Path $app 'dist\server'),$runtime -Force
    [IO.File]::WriteAllText((Join-Path $app 'dist\server\index.js'),'synthetic')
    [IO.File]::WriteAllText($script:node,'synthetic')
    function Assert-Installed { }
    function Get-OwnedServer { return $null }
    function Start-Sleep { param($Milliseconds) }
    function Write-Json { param($Path,$Value) }
    function Test-Server { $script:healthCalls++; return $script:healthCalls -gt 1 }
    function Start-Process {
        param($FilePath,$ArgumentList,$WorkingDirectory,[switch]$PassThru,$WindowStyle)
        Assert-True ($env:LRD_PREVIEW_PREPARER -eq $script:expectedPreparer) 'Child opt-in was not scoped to lifecycle launch.'
        Assert-True ($FilePath -eq $script:node -and $WorkingDirectory -eq $app -and $WindowStyle -eq 'Hidden') 'Lifecycle launch changed executable or visibility.'
        if ($script:throwLaunch) { throw 'synthetic launch failure' }
        return [pscustomobject]@{ Id=41; StartTime=[DateTime]::UtcNow; HasExited=$false }
    }
    $env:LRD_PREVIEW_PREPARER = 'preserve-parent-value'
    foreach ($disabled in @($null,'1')) {
        $env:LRD_PREVIEW_PREPARER_DISABLED = $disabled
        $script:expectedPreparer = if ($disabled -eq '1') { '0' } else { '1' }
        foreach ($throwLaunch in @($false,$true)) {
            $script:throwLaunch = $throwLaunch; $script:healthCalls = 0; $caught = $false
            try { Start-App } catch { $caught = $true; Assert-True ($_.Exception.Message -eq 'synthetic launch failure') 'Unexpected launch error.' }
            Assert-True ($caught -eq $throwLaunch) 'Synthetic launch outcome changed.'
            Assert-True ($env:LRD_PREVIEW_PREPARER -eq 'preserve-parent-value') 'Lifecycle launch failed to restore parent opt-in.'
        }
    }
    $script:expectedPath = Join-Path $app 'windows\LivingRoomDisplay.Preview.exe'
    $script:server = [pscustomobject]@{ Id=41; HasExited=$false; StartTime=[DateTime]'2026-01-01T00:00:00Z' }
    $script:child = [pscustomobject]@{ Id=42; HasExited=$false; Path=$script:expectedPath; StartTime=[DateTime]'2026-01-01T00:00:01Z'; Handle=[IntPtr]1; Disposed=$false }
    $script:child | Add-Member ScriptMethod Dispose { $this.Disposed = $true }
    function Get-Process { param($Id,$ErrorAction) return $script:child }
    function Get-CimInstance {
        param($ClassName,$Filter,$ErrorAction)
        if ($Filter -like 'ProcessId=*') { return [pscustomobject]@{ ExecutablePath=$script:currentPath; ParentProcessId=$script:currentParent } }
        Assert-True ($Filter -eq "Name='LivingRoomDisplay.Preview.exe' AND ParentProcessId=41") 'Preparer discovery is not parent scoped.'
        return [pscustomobject]@{ ExecutablePath=$script:expectedPath; ProcessId=42 }
    }
    $script:currentPath = $script:expectedPath; $script:currentParent = 41
    Assert-True (@(Get-OwnedPreparers $script:server).Count -eq 1) 'Exact parented preparer was not retained.'
    $script:currentParent = 99
    Assert-True (@(Get-OwnedPreparers $script:server).Count -eq 0 -and $script:child.Disposed) 'Recycled PID inherited old parent ownership.'
    $script:currentParent = 41; $script:currentPath = $script:expectedPath + '.foreign'
    Assert-True (@(Get-OwnedPreparers $script:server).Count -eq 0) 'Foreign preparer executable was adopted.'
    $script:currentPath = $script:expectedPath; $script:child.StartTime = [DateTime]'2025-01-01T00:00:00Z'
    Assert-True (@(Get-OwnedPreparers $script:server).Count -eq 0) 'Preparer predating exact server was adopted.'
    $script:server.HasExited = $true
    Assert-True (@(Get-OwnedPreparers $script:server).Count -eq 0) 'Exited server adopted a preparer.'
} finally {
    $env:LRD_PREVIEW_PREPARER = $oldPreparer; $env:LRD_PREVIEW_PREPARER_DISABLED = $oldDisabled
    if (Test-Path -LiteralPath $scratch) {
        $resolved = [IO.Path]::GetFullPath($scratch)
        $allowed = [IO.Path]::GetFullPath((Join-Path $repository '.local')) + '\'
        if (-not $resolved.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { throw 'Synthetic cleanup escaped .local.' }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
Write-Output 'Preview lifecycle injected checks passed: scoped opt-in/disable, parent restoration and exact parented process ownership.'
