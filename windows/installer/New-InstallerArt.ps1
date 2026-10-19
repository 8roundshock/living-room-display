[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputDirectory)
# Renders the favicon motif (public/favicon.svg: rounded #090b12 square,
# #625d88 ring, #aaa4d7 crescent, #b7afe5 dot) into a multi-size .ico and the
# Setup wizard PNGs at build time. No binary art is committed; no real data.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$OutputDirectory = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force

function New-Color([string]$Hex) { return [Drawing.ColorTranslator]::FromHtml($Hex) }
function Get-ArcAngles([double]$CenterX, [double]$CenterY, [double]$X, [double]$Y) { return [Math]::Atan2($Y - $CenterY, $X - $CenterX) * 180 / [Math]::PI }

function Draw-Motif([Drawing.Graphics]$Graphics, [double]$Left, [double]$Top, [double]$Size, [bool]$WithTile) {
    # All coordinates follow the 48x48 SVG viewBox.
    $scale = $Size / 48.0
    function P([double]$Value) { return [single]$Value }
    $Graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $Graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    if ($WithTile) {
        $radius = 12 * $scale; $d = 2 * $radius
        $tile = New-Object Drawing.Drawing2D.GraphicsPath
        $tile.AddArc((P $Left), (P $Top), (P $d), (P $d), 180, 90)
        $tile.AddArc((P ($Left + $Size - $d)), (P $Top), (P $d), (P $d), 270, 90)
        $tile.AddArc((P ($Left + $Size - $d)), (P ($Top + $Size - $d)), (P $d), (P $d), 0, 90)
        $tile.AddArc((P $Left), (P ($Top + $Size - $d)), (P $d), (P $d), 90, 90)
        $tile.CloseFigure()
        $brush = New-Object Drawing.SolidBrush (New-Color '#090b12')
        $Graphics.FillPath($brush, $tile); $brush.Dispose(); $tile.Dispose()
    }
    $ring = New-Object Drawing.Pen ((New-Color '#625d88'), (P ([Math]::Max(1.0, 1.0 * $scale))))
    $Graphics.DrawEllipse($ring, (P ($Left + 8 * $scale)), (P ($Top + 9 * $scale)), (P (32 * $scale)), (P (32 * $scale)))
    $ring.Dispose()
    # Crescent: "M32 28 a11 11 0 0 1 -13 -15 a11 11 0 1 0 13 15 Z".
    $p1x = 32; $p1y = 28; $p2x = 19; $p2y = 13; $r = 11
    $mx = ($p1x + $p2x) / 2; $my = ($p1y + $p2y) / 2
    $dx = $p2x - $p1x; $dy = $p2y - $p1y; $chord = [Math]::Sqrt($dx * $dx + $dy * $dy)
    $h = [Math]::Sqrt($r * $r - ($chord / 2) * ($chord / 2))
    $ux = $dx / $chord; $uy = $dy / $chord
    $ax = $mx - $uy * $h; $ay = $my + $ux * $h   # small clockwise arc P1 -> P2
    $bx = $mx + $uy * $h; $by = $my - $ux * $h   # large counter-clockwise arc P2 -> P1
    $a1 = Get-ArcAngles $ax $ay $p1x $p1y; $a2 = Get-ArcAngles $ax $ay $p2x $p2y
    $sweepA = $a2 - $a1; while ($sweepA -le 0) { $sweepA += 360 }
    if ($sweepA -gt 180) { $ax = $mx + $uy * $h; $ay = $my - $ux * $h; $bx = $mx - $uy * $h; $by = $my + $ux * $h; $a1 = Get-ArcAngles $ax $ay $p1x $p1y; $a2 = Get-ArcAngles $ax $ay $p2x $p2y; $sweepA = $a2 - $a1; while ($sweepA -le 0) { $sweepA += 360 } }
    $b1 = Get-ArcAngles $bx $by $p2x $p2y; $b2 = Get-ArcAngles $bx $by $p1x $p1y
    $sweepB = $b2 - $b1; while ($sweepB -ge 0) { $sweepB -= 360 }
    $moon = New-Object Drawing.Drawing2D.GraphicsPath
    $moon.AddArc((P ($Left + ($ax - $r) * $scale)), (P ($Top + ($ay - $r) * $scale)), (P (2 * $r * $scale)), (P (2 * $r * $scale)), (P $a1), (P $sweepA))
    $moon.AddArc((P ($Left + ($bx - $r) * $scale)), (P ($Top + ($by - $r) * $scale)), (P (2 * $r * $scale)), (P (2 * $r * $scale)), (P $b1), (P $sweepB))
    $moon.CloseFigure()
    $pen = New-Object Drawing.Pen ((New-Color '#aaa4d7'), (P ([Math]::Max(1.0, 1.8 * $scale))))
    $pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
    $Graphics.DrawPath($pen, $moon); $pen.Dispose(); $moon.Dispose()
    $dot = New-Object Drawing.SolidBrush (New-Color '#b7afe5')
    $Graphics.FillEllipse($dot, (P ($Left + 21 * $scale)), (P ($Top + 5 * $scale)), (P (6 * $scale)), (P (6 * $scale)))
    $dot.Dispose()
}

function New-Canvas([int]$Width, [int]$Height, [string]$Background) {
    $bitmap = New-Object Drawing.Bitmap $Width, $Height, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear($(if ($Background) { New-Color $Background } else { [Drawing.Color]::Transparent }))
    return [pscustomobject]@{Bitmap=$bitmap;Graphics=$graphics}
}
function Get-PngBytes([Drawing.Bitmap]$Bitmap) {
    $stream = New-Object IO.MemoryStream
    try { $Bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png); return $stream.ToArray() } finally { $stream.Dispose() }
}
function Get-DibBytes([Drawing.Bitmap]$Bitmap) {
    # 32-bit BGRA bottom-up DIB plus an all-zero AND mask, as ICO entries expect.
    $size = $Bitmap.Width
    $rect = New-Object Drawing.Rectangle 0, 0, $size, $size
    $locked = $Bitmap.LockBits($rect, [Drawing.Imaging.ImageLockMode]::ReadOnly, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $stride = [Math]::Abs($locked.Stride)
        $pixels = New-Object byte[] ($stride * $size)
        [Runtime.InteropServices.Marshal]::Copy($locked.Scan0, $pixels, 0, $pixels.Length)
    } finally { $Bitmap.UnlockBits($locked) }
    $maskStride = [int]([Math]::Ceiling($size / 32.0) * 4)
    $stream = New-Object IO.MemoryStream
    $writer = New-Object IO.BinaryWriter($stream)
    try {
        $writer.Write([int]40); $writer.Write([int]$size); $writer.Write([int]($size * 2))
        $writer.Write([int16]1); $writer.Write([int16]32); $writer.Write([int]0)
        $writer.Write([int]($size * $size * 4 + $maskStride * $size)); $writer.Write([int]0); $writer.Write([int]0); $writer.Write([int]0); $writer.Write([int]0)
        for ($row = $size - 1; $row -ge 0; $row--) { $writer.Write($pixels, $row * $stride, $size * 4) }
        $writer.Write((New-Object byte[] ($maskStride * $size)))
        $writer.Flush()
        return $stream.ToArray()
    } finally { $writer.Dispose() }
}

# Multi-size application icon.
$iconSizes = @(16, 20, 24, 32, 40, 48, 64, 256)
$images = foreach ($size in $iconSizes) {
    $canvas = New-Canvas $size $size $null
    try {
        Draw-Motif $canvas.Graphics 0 0 $size $true
        $canvas.Graphics.Flush()
        if ($size -ge 256) { ,(Get-PngBytes $canvas.Bitmap) } else { ,(Get-DibBytes $canvas.Bitmap) }
    } finally { $canvas.Graphics.Dispose(); $canvas.Bitmap.Dispose() }
}
$iconPath = Join-Path $OutputDirectory 'LivingRoomDisplay.ico'
$stream = [IO.File]::Open($iconPath, [IO.FileMode]::Create)
$writer = New-Object IO.BinaryWriter($stream)
try {
    $writer.Write([int16]0); $writer.Write([int16]1); $writer.Write([int16]$iconSizes.Count)
    $offset = 6 + 16 * $iconSizes.Count
    for ($index = 0; $index -lt $iconSizes.Count; $index++) {
        $size = $iconSizes[$index]; $bytes = [byte[]]$images[$index]
        $writer.Write([byte]($size % 256)); $writer.Write([byte]($size % 256)); $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([int16]1); $writer.Write([int16]32); $writer.Write([int]$bytes.Length); $writer.Write([int]$offset)
        $offset += $bytes.Length
    }
    foreach ($bytes in $images) { $writer.Write([byte[]]$bytes) }
} finally { $writer.Dispose() }

# Wizard art at 100/125/150/200% (Inno picks the closest to the screen DPI).
# Small: the tile itself. Large (Finish page): the motif on true black.
$small = foreach ($size in @(55, 69, 83, 110)) {
    $canvas = New-Canvas $size $size $null
    try {
        Draw-Motif $canvas.Graphics 0 0 $size $true
        $path = Join-Path $OutputDirectory "wizard-small-$size.png"
        $canvas.Bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png); $path
    } finally { $canvas.Graphics.Dispose(); $canvas.Bitmap.Dispose() }
}
$large = foreach ($scale in @(1.0, 1.25, 1.5, 2.0)) {
    $width = [int][Math]::Round(164 * $scale); $height = [int][Math]::Round(314 * $scale)
    $canvas = New-Canvas $width $height '#000000'
    try {
        $motif = [Math]::Round($width * 0.62)
        Draw-Motif $canvas.Graphics (($width - $motif) / 2) (($height - $motif) / 2 - $height * 0.08) $motif $false
        $path = Join-Path $OutputDirectory "wizard-large-$width.png"
        $canvas.Bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png); $path
    } finally { $canvas.Graphics.Dispose(); $canvas.Bitmap.Dispose() }
}
[pscustomobject]@{Icon=$iconPath;WizardSmall=@($small);WizardLarge=@($large)}
