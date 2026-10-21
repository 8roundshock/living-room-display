[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$NodeExe)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('lrd-native-runtime-' + [Guid]::NewGuid().ToString('N'))
$app = Join-Path $fixtureRoot 'app'
$run = Join-Path $fixtureRoot 'run'
$data = Join-Path $fixtureRoot 'data'
$script:node = Join-Path $fixtureRoot 'runtime\node.exe'
$script:processExitTimeoutMs = 10000
$serverRecord = Join-Path $run 'server.json'
$launchedByPowerShell = $null
$ownershipFunctionsLoaded = $false
$utf8 = New-Object Text.UTF8Encoding($false)
function Check([bool]$Condition, [string]$Reason) { if (-not $Condition) { throw $Reason } }
function Invoke-Probe([string]$Operation) {
    $resultFile = Join-Path $fixtureRoot 'probe-result.json'
    if (Test-Path -LiteralPath $resultFile) { Remove-Item -LiteralPath $resultFile }
    $launch = New-Object Diagnostics.ProcessStartInfo
    $launch.FileName = $probe
    $launch.Arguments = $Operation + ' "' + $app + '" ' + $fixturePort
    $launch.UseShellExecute = $false
    $launch.CreateNoWindow = $true
    $launch.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $process = [Diagnostics.Process]::Start($launch)
    try {
        if (-not $process.WaitForExit(30000)) {
            $process.Kill(); $null = $process.WaitForExit(10000)
            throw "Synthetic native runtime $Operation timed out."
        }
        Check ($process.ExitCode -eq 0) "Synthetic native runtime $Operation failed with exit $($process.ExitCode)."
        return Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
    } finally { $process.Dispose() }
}
try {
    Check (Test-Path -LiteralPath $NodeExe -PathType Leaf) 'Supply the existing Node 24 executable.'
    $version = & $NodeExe --version
    Check ($LASTEXITCODE -eq 0 -and $version -match '^v24\.') 'The isolated fixture requires Node 24.'
    foreach ($path in @($app, $run, $data, (Split-Path $script:node -Parent), (Join-Path $app 'dist\server'))) {
        $null = New-Item -ItemType Directory -Path $path -Force
    }
    Copy-Item -LiteralPath $NodeExe -Destination $script:node
    [IO.File]::WriteAllText((Join-Path $fixtureRoot 'installation.json'), '{"product":"living-room-display"}', $utf8)
    $source = @'
const http = require('node:http');
const port = Number(process.env.LRD_PORT);
if (!Number.isInteger(port) || port < 1024 || port === 4318) process.exit(2);
http.createServer((req, res) => {
  res.writeHead(req.url === '/api/health' ? 200 : 404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({status: 'ok', synthetic: true, dataDirectory: process.env.LRD_DATA_DIR}));
}).listen(port, '127.0.0.1');
'@
    [IO.File]::WriteAllText((Join-Path $app 'dist\server\index.js'), $source, $utf8)
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    try { $listener.Start(); $fixturePort = $listener.LocalEndpoint.Port } finally { $listener.Stop() }
    Check ($fixturePort -ne 4318 -and $fixturePort -ge 1024) 'Fixture port must never be the installed server port.'

    # Use the actual current control-script ownership/termination functions, not a copied matcher.
    # Their process, path and record inputs below all belong to the synthetic fixture.
    $tokens = $null; $parseErrors = $null
    $control = [Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'windows\LivingRoomDisplay.ps1'), [ref]$tokens, [ref]$parseErrors)
    Check ($parseErrors.Count -eq 0) 'Control script could not be parsed.'
    foreach ($name in @('Get-OwnedServer', 'Stop-OwnedProcess')) {
        $definition = $control.FindAll({ param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] }, $true) | Where-Object { $_.Name -eq $name }
        Check (@($definition).Count -eq 1) "Missing unique control function $name."
        . ([ScriptBlock]::Create($definition.Extent.Text))
    }
    $ownershipFunctionsLoaded = $true
    $probe = Join-Path $fixtureRoot 'ServerRuntimeProbe.exe'
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    & $compiler /nologo /target:exe /platform:anycpu /reference:System.Management.dll /reference:System.Web.Extensions.dll ("/out:$probe") (Join-Path $repo 'windows\ServerRuntime.cs') (Join-Path $PSScriptRoot 'ServerRuntimeProbe.cs')
    Check ($LASTEXITCODE -eq 0) 'Native runtime fixture compilation failed.'

    $watch = [Diagnostics.Stopwatch]::StartNew()
    $native = Invoke-Probe 'start'
    $coldMilliseconds = $watch.ElapsedMilliseconds
    Check ($native.ServerRunning -and $native.Healthy) 'Native cold start lacks exact owned listener and health.'
    $owned = Get-OwnedServer
    Check ($null -ne $owned) 'PowerShell did not recognize the native-created PID/birth/executable/entry record.'
    try {
        $record = Get-Content -LiteralPath $serverRecord -Raw | ConvertFrom-Json
        Check ($owned.Id -eq $record.processId -and $owned.StartTime.ToUniversalTime().Ticks -eq ([DateTimeOffset]$record.startedAt).UtcDateTime.Ticks) 'Native and PowerShell process identities differ.'
        $health = Invoke-RestMethod -Uri ("http://127.0.0.1:$fixturePort/api/health") -TimeoutSec 2 -UseBasicParsing
        Check ($health.synthetic -and $health.dataDirectory -eq $data) 'Native startup did not use the fixture data directory.'
        Stop-OwnedProcess $owned 'The synthetic native-started server'
    } finally { if ($null -ne $owned) { $owned.Dispose() } }
    $stopped = Invoke-Probe 'status'
    Check (-not $stopped.ServerRunning -and -not $stopped.Healthy) 'PowerShell stop left native-owned fixture running.'

    # Start the reverse interop round through ordinary PowerShell with the unchanged record schema.
    $priorData = $env:LRD_DATA_DIR; $priorPort = $env:LRD_PORT
    try {
        $env:LRD_DATA_DIR = $data; $env:LRD_PORT = [string]$fixturePort
        $entry = Join-Path $app 'dist\server\index.js'
        $launchedByPowerShell = Start-Process -FilePath $script:node -ArgumentList ('"' + $entry + '"') -WorkingDirectory $app -WindowStyle Hidden -PassThru
        $record = @{processId=$launchedByPowerShell.Id; startedAt=$launchedByPowerShell.StartTime.ToUniversalTime().ToString('o')}
        [IO.File]::WriteAllText($serverRecord, ($record | ConvertTo-Json -Compress), $utf8)
    } finally { $env:LRD_DATA_DIR = $priorData; $env:LRD_PORT = $priorPort }
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    do {
        $reverse = Invoke-Probe 'status'
        if ($reverse.ServerRunning -and $reverse.Healthy) { break }
        Start-Sleep -Milliseconds 50
    } while ($deadline.ElapsedMilliseconds -lt 5000)
    Check ($reverse.ServerRunning -and $reverse.Healthy) 'Native runtime did not recognize the PowerShell-started fixture.'
    $stopped = Invoke-Probe 'stop'
    Check (-not $stopped.ServerRunning -and -not $stopped.Healthy) 'Native stop left the PowerShell-started fixture running.'
    Check ($launchedByPowerShell.WaitForExit(10000)) 'The reverse-interop process did not exit.'
    Check (-not (Test-Path -LiteralPath $serverRecord)) 'Native stop left its matching server record.'
    Write-Output ("Native server real fixture PASS: cold start {0} ms; exact WMI/PID/birth/listener health; PowerShell recognition+stop; PowerShell start then native recognition+stop; isolated non-4318 loopback port only." -f $coldMilliseconds)
} finally {
    # Cleanup addresses only matching fixture-owned records and this test's pinned process object.
    if ($ownershipFunctionsLoaded) {
        $remaining = Get-OwnedServer
        if ($null -ne $remaining) { try { Stop-OwnedProcess $remaining 'The synthetic fixture server' } finally { $remaining.Dispose() } }
    }
    if ($null -ne $launchedByPowerShell) {
        try { if (-not $launchedByPowerShell.HasExited) { Stop-OwnedProcess $launchedByPowerShell 'The synthetic PowerShell child' } }
        finally { $launchedByPowerShell.Dispose() }
    }
    if (Test-Path -LiteralPath $fixtureRoot) {
        $resolved = [IO.Path]::GetFullPath($fixtureRoot)
        $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        Check ($resolved.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolved).StartsWith('lrd-native-runtime-')) 'Refusing cleanup outside the synthetic temporary root.'
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
