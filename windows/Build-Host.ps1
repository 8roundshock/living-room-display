[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist\windows'),
    # Optional release metadata used by the Windows installer build. Without
    # them the helper is compiled exactly as before (no icon, no version info).
    [string]$IconFile,
    [string]$Version
)
$ErrorActionPreference = 'Stop'
$framework = if ([Environment]::Is64BitOperatingSystem) { 'Framework64' } else { 'Framework' }
$compiler = Join-Path $env:WINDIR "Microsoft.NET\$framework\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.x C# compiler is required on Windows.' }
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$output = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) 'LivingRoomDisplay.scr'
$arguments = @('/nologo','/target:winexe','/platform:anycpu','/optimize+',"/out:$output",'/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll')
$sources = @((Join-Path $PSScriptRoot 'LivingRoomDisplay.cs'),(Join-Path $PSScriptRoot 'SessionStartup.cs'))
$assemblyInfo = $null
try {
    if ($IconFile) {
        $icon = [IO.Path]::GetFullPath($IconFile)
        if (-not (Test-Path -LiteralPath $icon -PathType Leaf)) { throw "Icon file not found: $icon" }
        $arguments += "/win32icon:$icon"
    }
    if ($Version) {
        if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Version must be x.y.z.' }
        # Temporary generated source; never written into the repository.
        $assemblyInfo = Join-Path ([IO.Path]::GetTempPath()) ('lrd-assemblyinfo-' + [Guid]::NewGuid().ToString('N') + '.cs')
        $info = @"
using System.Reflection;
[assembly: AssemblyTitle("Living Room Display")]
[assembly: AssemblyProduct("Living Room Display")]
[assembly: AssemblyDescription("Living Room Display")]
[assembly: AssemblyVersion("$Version.0")]
[assembly: AssemblyFileVersion("$Version.0")]
[assembly: AssemblyInformationalVersion("$Version")]
"@
        [IO.File]::WriteAllText($assemblyInfo, $info, (New-Object Text.UTF8Encoding($false)))
        $sources += $assemblyInfo
    }
    & $compiler @arguments @sources
    if ($LASTEXITCODE -ne 0) { throw 'Windows helper compilation failed.' }
} finally {
    if ($assemblyInfo -and (Test-Path -LiteralPath $assemblyInfo)) { Remove-Item -LiteralPath $assemblyInfo -Force }
}
Write-Output $output
