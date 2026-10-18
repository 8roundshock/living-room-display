[CmdletBinding()]
param([string]$OutputDirectory = (Join-Path $PSScriptRoot '..\dist\windows'))
$ErrorActionPreference = 'Stop'
$framework = if ([Environment]::Is64BitOperatingSystem) { 'Framework64' } else { 'Framework' }
$compiler = Join-Path $env:WINDIR "Microsoft.NET\$framework\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework 4.x C# compiler is required on Windows.' }
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$output = Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) 'LivingRoomDisplay.scr'
$sources=@('LivingRoomDisplay.cs','SessionStartup.cs','AmbientSession.cs','NativeDisplay.cs','SurfacePolicy.cs') | ForEach-Object { Join-Path $PSScriptRoot $_ }
& $compiler /nologo /target:winexe /platform:anycpu /optimize+ "/out:$output" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll $sources
if ($LASTEXITCODE -ne 0) { throw 'Windows helper compilation failed.' }
Write-Output $output
