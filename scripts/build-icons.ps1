# Original ScreenLingo artwork; keep geometry and palette aligned with src/assets/icon.svg.
# Uses only Windows System.Drawing: no network, font, or image-converter dependency.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDir = Join-Path $PSScriptRoot '..\src\assets'
[System.IO.Directory]::CreateDirectory($assetDir) | Out-Null

function Get-Color([string]$Hex, [int]$Alpha = 255) {
    return [System.Drawing.Color]::FromArgb($Alpha, [System.Drawing.ColorTranslator]::FromHtml($Hex))
}

function New-RoundedRectangle([single]$X, [single]$Y, [single]$Width, [single]$Height, [single]$Radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $Radius * 2
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-RoundPen([string]$Hex, [single]$Width, [int]$Alpha = 255) {
    $pen = [System.Drawing.Pen]::new((Get-Color $Hex $Alpha), $Width)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    return $pen
}

function Resize-Icon([System.Drawing.Bitmap]$Source, [int]$Size) {
    $target = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $canvas = [System.Drawing.Graphics]::FromImage($target)
    try {
        $canvas.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $canvas.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $canvas.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $canvas.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $canvas.DrawImage($Source, [System.Drawing.Rectangle]::new(0, 0, $Size, $Size))
    } finally {
        $canvas.Dispose()
    }
    return $target
}

$bitmap = [System.Drawing.Bitmap]::new(1024, 1024, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$resources = [System.Collections.Generic.List[System.IDisposable]]::new()
try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.ScaleTransform(2, 2)

    $base = New-RoundedRectangle 12 12 488 488 104
    $baseFill = [System.Drawing.SolidBrush]::new((Get-Color '#9be5ef'))
    $glyphPen = New-RoundPen '#102a36' 36
    foreach ($resource in @($base, $baseFill, $glyphPen)) {
        $resources.Add($resource)
    }
    $graphics.FillPath($baseFill, $base)

    # Hand-drawn geometric strokes for the translation character (U+8BD1).
    # Large open counters and two flat colors preserve recognition at taskbar sizes.
    $glyph = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $resources.Add($glyph)
    $glyph.AddLine(106, 102, 146, 136)
    $glyph.StartFigure()
    $glyph.AddLines([System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(84, 204), [System.Drawing.PointF]::new(146, 204),
        [System.Drawing.PointF]::new(146, 398), [System.Drawing.PointF]::new(174, 362)))
    $glyph.StartFigure()
    $glyph.AddLine(228, 108, 412, 108)
    $glyph.AddBezier(412, 108, 382, 174, 324, 222, 232, 251)
    $glyph.StartFigure()
    $glyph.AddBezier(250, 143, 286, 192, 337, 228, 414, 251)
    $glyph.StartFigure()
    $glyph.AddLine(240, 305, 414, 305)
    $glyph.StartFigure()
    $glyph.AddLine(232, 373, 434, 373)
    $glyph.StartFigure()
    $glyph.AddLine(326, 278, 326, 432)
    $graphics.DrawPath($glyphPen, $glyph)

    $pngBitmap = Resize-Icon $bitmap 512
    try {
        $pngBitmap.Save((Join-Path $assetDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $pngBitmap.Dispose()
    }

    # Modern Windows accepts PNG-compressed 32-bit images at every ICO size.
    $sizes = @(16, 24, 32, 48, 64, 128, 256)
    $images = [System.Collections.Generic.List[byte[]]]::new()
    foreach ($size in $sizes) {
        $frame = Resize-Icon $bitmap $size
        $pngStream = [System.IO.MemoryStream]::new()
        try {
            $frame.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
            $images.Add($pngStream.ToArray())
        } finally {
            $pngStream.Dispose()
            $frame.Dispose()
        }
    }
    $stream = [System.IO.MemoryStream]::new()
    $writer = [System.IO.BinaryWriter]::new($stream)
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]$sizes.Count)
        $offset = 6 + 16 * $sizes.Count
        for ($i = 0; $i -lt $sizes.Count; $i++) {
            $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
            $writer.Write([byte]$dimension)
            $writer.Write([byte]$dimension)
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]32)
            $writer.Write([uint32]$images[$i].Length)
            $writer.Write([uint32]$offset)
            $offset += $images[$i].Length
        }
        foreach ($image in $images) { $writer.Write($image) }
        $writer.Flush()
        [System.IO.File]::WriteAllBytes((Join-Path $assetDir 'icon.ico'), $stream.ToArray())
    } finally {
        $writer.Dispose()
        $stream.Dispose()
    }
} finally {
    foreach ($resource in $resources) { $resource.Dispose() }
    $graphics.Dispose()
    $bitmap.Dispose()
}
Write-Output "Generated 512px PNG and seven-size Windows ICO in $assetDir"
