$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assetDir = Join-Path $PSScriptRoot '..\src\assets'
[System.IO.Directory]::CreateDirectory($assetDir) | Out-Null
$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)
$green = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#0b6b5c'))
$yellow = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml('#ffd166')), 12
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
try {
    $graphics.FillRectangle($green, 12, 12, 232, 232)
    $graphics.DrawLines($yellow, [System.Drawing.Point[]]@((New-Object System.Drawing.Point 56, 100), (New-Object System.Drawing.Point 56, 56), (New-Object System.Drawing.Point 100, 56)))
    $graphics.DrawLines($yellow, [System.Drawing.Point[]]@((New-Object System.Drawing.Point 156, 56), (New-Object System.Drawing.Point 200, 56), (New-Object System.Drawing.Point 200, 100)))
    $graphics.DrawLines($yellow, [System.Drawing.Point[]]@((New-Object System.Drawing.Point 56, 156), (New-Object System.Drawing.Point 56, 200), (New-Object System.Drawing.Point 100, 200)))
    $graphics.DrawLines($yellow, [System.Drawing.Point[]]@((New-Object System.Drawing.Point 156, 200), (New-Object System.Drawing.Point 200, 200), (New-Object System.Drawing.Point 200, 156)))
    $graphics.FillRectangle($white, 89, 86, 78, 17)
    $graphics.FillRectangle($white, 119, 96, 18, 77)
    $bitmap.Save((Join-Path $assetDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $png = [System.IO.File]::ReadAllBytes((Join-Path $assetDir 'icon.png'))
    $stream = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter $stream
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]1)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$png.Length)
        $writer.Write([uint32]22)
        $writer.Write($png)
        $writer.Flush()
        [System.IO.File]::WriteAllBytes((Join-Path $assetDir 'icon.ico'), $stream.ToArray())
    } finally {
        $writer.Dispose()
        $stream.Dispose()
    }
} finally {
    $graphics.Dispose()
    $bitmap.Dispose()
    $green.Dispose()
    $yellow.Dispose()
    $white.Dispose()
}
Write-Output "Generated application icons in $assetDir"
