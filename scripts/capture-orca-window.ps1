Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$destDirMaster = "D:\Programacion-Cosas\ORQUESTADOR-MASTER\docs\orca\screenshots"
$destDirOrca = "D:\Programacion-Cosas\orca\screenshots"

if (!(Test-Path $destDirMaster)) {
    New-Item -ItemType Directory -Force -Path $destDirMaster | Out-Null
}
if (!(Test-Path $destDirOrca)) {
    New-Item -ItemType Directory -Force -Path $destDirOrca | Out-Null
}

Write-Host "Launching Electron..."
$env:ORCA_SCREENSHOT_PATH = "D:\Programacion-Cosas\orca\screenshots\orca-window-direct.png"
$proc = Start-Process -FilePath "D:\Programacion-Cosas\orca\node_modules\electron\dist\electron.exe" `
    -ArgumentList ".", "--js-flags=--max-old-space-size=768" `
    -WorkingDirectory "D:\Programacion-Cosas\orca" `
    -PassThru

Write-Host "Process started with PID: $($proc.Id). Waiting 12 seconds for full window load and Managed IPC query..."
Start-Sleep -Seconds 12

Write-Host "Capturing primary screen..."
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

$fileMaster = Join-Path $destDirMaster "orca-managed-projects-online.png"
$fileOrca = Join-Path $destDirOrca "orca-managed-projects-online.png"

$bitmap.Save($fileMaster, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Save($fileOrca, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

Write-Host "Screenshots saved successfully:"
Write-Host " - $fileMaster (Size: $((Get-Item $fileMaster).Length) bytes)"
Write-Host " - $fileOrca (Size: $((Get-Item $fileOrca).Length) bytes)"

if (Test-Path $env:ORCA_SCREENSHOT_PATH) {
    Copy-Item $env:ORCA_SCREENSHOT_PATH (Join-Path $destDirMaster "orca-window-direct.png") -Force
    Write-Host " - Direct window capture: $env:ORCA_SCREENSHOT_PATH"
}

Write-Host "Stopping Electron process tree..."
try {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
} catch {}
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Done."
