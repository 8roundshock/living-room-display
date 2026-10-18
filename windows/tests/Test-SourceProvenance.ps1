Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$windowsDirectory = Split-Path $PSScriptRoot -Parent
$repository = Split-Path $windowsDirectory -Parent
$scratchRoot = Join-Path $repository ('.local\source-provenance-' + [Guid]::NewGuid().ToString('N'))
$source = Join-Path $scratchRoot 'source'
$archive = Join-Path $scratchRoot 'archive'
$null = New-Item -ItemType Directory -Path (Join-Path $source 'windows'),$archive -Force
try {
    . (Join-Path $windowsDirectory 'LivingRoomDisplay.ps1') -InstallRoot (Join-Path $scratchRoot 'install') -FunctionsOnly
    $git = (Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    & $git init --quiet $source
    if ($LASTEXITCODE -ne 0) { throw 'Provenance fixture Git initialization failed.' }
    $content = Join-Path $source 'synthetic.txt'
    [IO.File]::WriteAllText($content,'synthetic')
    & $git -C $source add synthetic.txt
    & $git -C $source -c user.name=Fixture -c user.email=fixture@example.invalid -c ('core.hooksPath=' + (Join-Path $scratchRoot 'no-hooks')) commit --quiet -m fixture
    if ($LASTEXITCODE -ne 0) { throw 'Provenance fixture Git commit failed.' }
    $revision = & $git -C $source rev-parse HEAD
    $hostDirectory = Join-Path $source 'windows'
    $clean = Get-SourceProvenance $source $hostDirectory
    if ($clean.sourceState -ne 'clean' -or $clean.sourceRevision -ne $revision) { throw 'Clean source provenance did not match its real Git revision.' }
    [IO.File]::AppendAllText($content,' changed')
    $dirty = Get-SourceProvenance $source $hostDirectory
    if ($dirty.sourceState -ne 'dirty' -or $dirty.sourceRevision -ne $revision) { throw 'Dirty source was not identified without inventing a revision.' }
    $nested = Join-Path $source 'nested'
    $null = New-Item -ItemType Directory -Path $nested
    foreach ($unknown in @((Get-SourceProvenance $archive (Join-Path $archive 'windows')),(Get-SourceProvenance $nested (Join-Path $nested 'windows')),(Get-SourceProvenance $source $windowsDirectory))) {
        if ($unknown.sourceState -ne 'unknown' -or $null -ne $unknown.sourceRevision) { throw 'Archive, enclosing repository or composed sources produced false provenance.' }
    }
} finally {
    $full = [IO.Path]::GetFullPath($scratchRoot)
    $allowed = [IO.Path]::GetFullPath((Join-Path $repository '.local')).TrimEnd('\') + '\'
    if (-not $full.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) { throw 'Provenance test cleanup escaped .local.' }
    Remove-Item -LiteralPath $full -Recurse -Force
}
Write-Output 'Clean/dirty Git source, archive, wrong-parent and composed-source provenance passed; only local synthetic Git fixtures were used.'
