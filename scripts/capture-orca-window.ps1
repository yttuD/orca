Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = $PSScriptRoot
$orcaRoot = Split-Path -Parent $scriptDir
$destDirOrca = Join-Path $orcaRoot "screenshots"

# Dynamic discovery of orchestrator engine documentation screenshots directory
$destDirMasterCandidates = @(
    (Join-Path $orcaRoot "..\ORQUESTADOR-MASTER\docs\orca\screenshots"),
    (Join-Path $orcaRoot "..\Chat-AGY-CODEX-Orquestador\docs\orca\screenshots")
)
$destDirMaster = $null
foreach ($candidate in $destDirMasterCandidates) {
    if (Test-Path (Split-Path -Parent $candidate)) {
        $destDirMaster = [System.IO.Path]::GetFullPath($candidate)
        break
    }
}
if (!$destDirMaster) {
    $destDirMaster = [System.IO.Path]::GetFullPath($destDirMasterCandidates[0])
}

if (!(Test-Path $destDirMaster)) {
    New-Item -ItemType Directory -Force -Path $destDirMaster | Out-Null
}
if (!(Test-Path $destDirOrca)) {
    New-Item -ItemType Directory -Force -Path $destDirOrca | Out-Null
}

$electronExe = Join-Path $orcaRoot "node_modules\electron\dist\electron.exe"
if (!(Test-Path $electronExe)) {
    throw "Electron binary not found at: $electronExe"
}

Write-Host "Launching Electron..."
$directScreenshotPath = Join-Path $destDirOrca "orca-window-direct.png"
$env:ORCA_SCREENSHOT_PATH = $directScreenshotPath
$proc = Start-Process -FilePath $electronExe `
    -ArgumentList ".", "--js-flags=--max-old-space-size=768" `
    -WorkingDirectory $orcaRoot `
    -PassThru

Write-Host "Process started with PID: $($proc.Id). Waiting 12 seconds for full window load and Managed IPC query..."
Start-Sleep -Seconds 12

Write-Host "Capturing primary screen..."
try {
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
} catch {
    Write-Host "Screen copy skipped: $_"
}

if (Test-Path $directScreenshotPath) {
    $destDirectMaster = Join-Path $destDirMaster "orca-window-direct.png"
    Copy-Item $directScreenshotPath $destDirectMaster -Force
    Copy-Item $directScreenshotPath (Join-Path $destDirMaster "orca-managed-projects-online.png") -Force
    Copy-Item $directScreenshotPath (Join-Path $destDirOrca "orca-managed-projects-online.png") -Force
    Write-Host " - Direct window capture: $directScreenshotPath"
}

Write-Host "Stopping Electron process tree..."
try {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
} catch {}
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Done."
