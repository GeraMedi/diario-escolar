# Genera los íconos PNG de la PWA (sin librerías externas)
param([string]$OutDir = "$PSScriptRoot\icons")

Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function New-AppIcon {
  param([int]$Size, [string]$OutFile, [switch]$Maskable)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAlias'
  $g.PixelOffsetMode = 'HighQuality'

  $s = $Size / 512.0   # escala

  # Fondo pastel (gradiente rosa -> lila)
  $p1 = New-Object System.Drawing.Point(0, 0)
  $p2 = New-Object System.Drawing.Point($Size, $Size)
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($p1, $p2, `
        [System.Drawing.Color]::FromArgb(255, 255, 217, 227), `
        [System.Drawing.Color]::FromArgb(255, 230, 221, 255))

  if ($Maskable) {
    $g.FillRectangle($bg, 0, 0, $Size, $Size)
  } else {
    # esquinas redondeadas con GraphicsPath
    $r = [int](110 * $s)
    $roundPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $w = $Size; $h = $Size; $d = $r * 2
    [void]$roundPath.AddArc(0, 0, $d, $d, 180, 90)
    [void]$roundPath.AddArc($w - $d, 0, $d, $d, 270, 90)
    [void]$roundPath.AddArc($w - $d, $h - $d, $d, $d, 0, 90)
    [void]$roundPath.AddArc(0, $h - $d, $d, $d, 90, 90)
    $roundPath.CloseFigure()
    $g.FillPath($bg, $roundPath)
    $edgePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(140, 255, 255, 255), [float](4 * $s))
    $g.DrawPath($edgePen, $roundPath)
    $roundPath.Dispose()
  }

  # --- hoja de cuaderno (leve rotación) ---
  $g.TranslateTransform($Size * 0.5, $Size * 0.5)
  $g.RotateTransform(-8)

  $sheetW = [int](300 * $s); $sheetH = [int](340 * $s)
  $sx = -($sheetW / 2.0); $sy = -($sheetH / 2.0)

  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.FillRectangle($white, [int]$sx, [int]$sy, $sheetW, $sheetH)

  $rulePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 207, 227, 247), [float][math]::Max(1, 3 * $s))
  for ($i = 1; $i -le 6; $i++) {
    $ly = [int]($sy + (40 * $s) + $i * (40 * $s))
    $g.DrawLine($rulePen, [int]($sx + 30 * $s), $ly, [int]($sx + $sheetW - 30 * $s), $ly)
  }
  $redPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 201, 212), [float][math]::Max(1, 3 * $s))
  $g.DrawLine($redPen, [int]($sx + 55 * $s), [int]($sy + 10 * $s), [int]($sx + 55 * $s), [int]($sy + $sheetH - 10 * $s))

  # --- lápiz ---
  $g.RotateTransform(38)

  $pW = [int](46 * $s); $pH = [int](300 * $s)
  $px = -[int]($pW / 2) + [int](20 * $s)
  $py = -[int]($pH / 2)

  $body     = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 212, 107))
  $bodyDark = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 244, 180, 60))
  $wood     = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 243, 217, 168))
  $lead     = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 90, 85, 102))
  $eraser   = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 157, 184))
  $ferrule  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 198, 193, 216))
  $outline  = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 74, 68, 88), [float][math]::Max(1, 5 * $s))

  $bodyTop = $py + [int](45 * $s)
  $bodyH   = [int]($pH * 0.62)
  $tipY    = $bodyTop + $bodyH

  # cuerpo
  $g.FillRectangle($body, $px, $bodyTop, $pW, $bodyH)
  $g.FillRectangle($bodyDark, ($px + [int]($pW * 0.68)), $bodyTop, [int]($pW * 0.32), $bodyH)

  # punta de madera
  $tipPts = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF([float]$px, [float]$tipY)),
    (New-Object System.Drawing.PointF([float]($px + $pW), [float]$tipY)),
    (New-Object System.Drawing.PointF([float]($px + $pW / 2.0), [float]($tipY + 56 * $s)))
  )
  $g.FillPolygon($wood, $tipPts)

  # mina
  $leadPts = [System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF([float]($px + $pW * 0.28), [float]($tipY + 34 * $s))),
    (New-Object System.Drawing.PointF([float]($px + $pW * 0.72), [float]($tipY + 34 * $s))),
    (New-Object System.Drawing.PointF([float]($px + $pW / 2.0), [float]($tipY + 56 * $s)))
  )
  $g.FillPolygon($lead, $leadPts)

  # banda metálica + goma
  $g.FillRectangle($ferrule, $px, ($bodyTop + [int](6 * $s)), $pW, [int](34 * $s))
  $g.FillRectangle($eraser, $px, $py, $pW, [int](50 * $s))

  # contorno del lápiz
  $pencilBottom = $tipY + [int](56 * $s)
  $g.DrawRectangle($outline, $px, $py, $pW, ($pencilBottom - $py))

  $g.ResetTransform()
  $g.Dispose()

  $bmp.Save($OutFile, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "OK -> $OutFile ($Size px)"
}

New-AppIcon -Size 192 -OutFile (Join-Path $OutDir "icon-192.png")
New-AppIcon -Size 512 -OutFile (Join-Path $OutDir "icon-512.png")
New-AppIcon -Size 512 -OutFile (Join-Path $OutDir "icon-maskable-512.png") -Maskable
New-AppIcon -Size 180 -OutFile (Join-Path $OutDir "apple-touch-icon.png") -Maskable
