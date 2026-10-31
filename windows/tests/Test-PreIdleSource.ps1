[CmdletBinding()]
param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\..\.local\preidle-source-checks'))
$ErrorActionPreference = 'Stop'
$windows = Split-Path -Parent $PSScriptRoot
$compiler = Join-Path $env:WINDIR ('Microsoft.NET\' + $(if ([Environment]::Is64BitOperatingSystem) { 'Framework64' } else { 'Framework' }) + '\v4.0.30319\csc.exe')
$output = [IO.Path]::GetFullPath($OutputDirectory)
$null = New-Item -ItemType Directory -Path $output -Force

# Compile both production binaries, but NEVER execute either entry point here.
$null = & (Join-Path $windows 'Build-Host.ps1') -OutputDirectory (Join-Path $output 'compiled-only')
function Invoke-Synthetic([string]$Name, [string[]]$Sources, [string[]]$References = @()) {
    $target = Join-Path $output ($Name + '.exe')
    $arguments = @('/nologo','/target:exe','/platform:anycpu',"/out:$target","/main:$Name")
    $arguments += @($References | ForEach-Object { "/reference:$_" })
    $arguments += @($Sources | ForEach-Object { Join-Path $windows $_ })
    & $compiler @arguments
    if ($LASTEXITCODE -ne 0) { throw "$Name compilation failed" }
    & $target
    if ($LASTEXITCODE -ne 0) { throw "$Name failed" }
}
Invoke-Synthetic 'PreviewPreparationTests' @('PreviewPreparation.cs','tests\PreviewPreparationTests.cs')
Invoke-Synthetic 'NativePreviewContextTests' @('PreviewPreparer.cs','PreviewPreparation.cs','PreparedSnapshotClient.cs','DesktopSnapshot.cs','tests\NativePreviewContextTests.cs') @('System.Windows.Forms.dll','System.Drawing.dll','System.Web.Extensions.dll','System.Management.dll')
Invoke-Synthetic 'NativePreviewPipeTests' @('PreviewPreparer.cs','PreviewPreparation.cs','PreparedSnapshotClient.cs','DesktopSnapshot.cs','tests\NativePreviewPipeTests.cs') @('System.Windows.Forms.dll','System.Drawing.dll','System.Web.Extensions.dll','System.Management.dll')
Invoke-Synthetic 'PreparedClaimFlowTests' @('PreviewPreparation.cs','tests\PreparedClaimFlowTests.cs')
Invoke-Synthetic 'PreparedSnapshotProtocolTests' @('PreparedSnapshotClient.cs','tests\PreparedSnapshotProtocolTests.cs') @('System.Web.Extensions.dll')
Invoke-Synthetic 'DesktopSnapshotTests' @('DesktopSnapshot.cs','tests\DesktopSnapshotTests.cs') @('System.Drawing.dll')
Invoke-Synthetic 'HostLifecycleTests' @('SessionStartup.cs','tests\HostLifecycleTests.cs')
Invoke-Synthetic 'StartupAdmissionTests' @('StartupAdmission.cs','tests\StartupAdmissionTests.cs')
Invoke-Synthetic 'SessionExitDeadlineTests' @('SessionStartup.cs','tests\SessionExitDeadlineTests.cs')
Invoke-Synthetic 'ActiveInputTests' @('SessionStartup.cs','tests\ActiveInputTests.cs')
Invoke-Synthetic 'SurfacePolicyTests' @('SurfacePolicy.cs','tests\SurfacePolicyTests.cs')
Invoke-Synthetic 'ServerRuntimeTests' @('ServerRuntime.cs','tests\ServerRuntimeTests.cs') @('System.Management.dll','System.Web.Extensions.dll')
& (Join-Path $PSScriptRoot 'Test-PreviewLifecycle.ps1')
& (Join-Path $PSScriptRoot 'Test-LogonStartup.ps1')
& (Join-Path $PSScriptRoot 'Test-StartupAdmission.ps1')
& (Join-Path $windows 'installer\tests\Test-InstallerPolicy.ps1')
Write-Output 'Pre-idle source checks passed. No production helper, watcher, desktop capture or installed endpoint was run.'
