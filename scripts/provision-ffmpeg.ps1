# Requires PowerShell 7 and an existing 7-Zip installation. Nothing is installed globally.
# Default mode verifies/downloads a pinned candidate; -Activate is a deliberate runtime step.
[CmdletBinding()]
param(
    [switch]$Activate,
    [string]$SevenZipPath = 'C:\Program Files\7-Zip\7z.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'resources\binary-manifest.json') -Raw | ConvertFrom-Json
$toolsRoot = Join-Path $projectRoot '.tools'
$downloadsRoot = Join-Path $toolsRoot 'downloads'
$archivePath = Join-Path $downloadsRoot $manifest.archive.fileName
$stageRoot = Join-Path $toolsRoot ('ffmpeg-' + $manifest.release)
$payloadRoot = Join-Path $stageRoot $manifest.archive.rootDirectory

function Assert-Hash([string]$Path, [string]$Expected) {
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Expected.ToLowerInvariant()) { throw "SHA256 mismatch: $Path ($actual)" }
}

function Assert-ProjectPath([string]$Path) {
    $resolved = [System.IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path leaves this project: $resolved"
    }
    # Reparse points can redirect an apparently local path outside the project.
    $cursor = $resolved
    while ($cursor -and $cursor -ne $projectRoot) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "Reparse point is not a provisioning target: $cursor" }
        }
        $cursor = [System.IO.Path]::GetDirectoryName($cursor)
    }
}

if ($manifest.release -ne '9.0.1' -or $manifest.platform -ne 'win32-x64') { throw 'This provisioner is pinned to the reviewed Windows x64 9.0.1 manifest.' }
Assert-ProjectPath $archivePath
Assert-ProjectPath $payloadRoot
Assert-ProjectPath (Join-Path $projectRoot 'ffmpeg')
if (-not (Test-Path -LiteralPath $SevenZipPath -PathType Leaf)) { throw "Use -SevenZipPath to select an existing 7-Zip executable: $SevenZipPath" }
[System.IO.Directory]::CreateDirectory($downloadsRoot) | Out-Null

# Keep an interrupted download separate. A verified existing archive is reused offline.
if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    $partialPath = $archivePath + '.' + [Guid]::NewGuid().ToString('N') + '.download'
    Assert-ProjectPath $partialPath
    Invoke-WebRequest -Uri $manifest.archive.url -OutFile $partialPath -TimeoutSec 600
    Assert-Hash $partialPath $manifest.archive.sha256
    Move-Item -LiteralPath $partialPath -Destination $archivePath
}
Assert-Hash $archivePath $manifest.archive.sha256
if ((Get-Item -LiteralPath $archivePath).Length -ne $manifest.archive.sizeBytes) { throw 'Pinned archive size differs.' }
& $SevenZipPath t $archivePath -bsp0
if ($LASTEXITCODE -ne 0) { throw '7-Zip archive integrity test failed.' }

if (-not (Test-Path -LiteralPath $payloadRoot)) {
    & $SevenZipPath x $archivePath ('-o' + $stageRoot) -bsp0
    if ($LASTEXITCODE -ne 0) { throw '7-Zip extraction failed; the incomplete stage is retained for inspection.' }
}

# Verify every executable before running even its version command. A partial/mixed stage fails closed.
foreach ($binary in $manifest.binaries) {
    $candidatePath = Join-Path $payloadRoot $binary.archivePath
    Assert-ProjectPath $candidatePath
    Assert-Hash $candidatePath $binary.sha256
    $versionLines = & $candidatePath -version 2>&1
    if ($LASTEXITCODE -ne 0 -or -not ($versionLines[0].ToString().Contains($binary.version))) {
        throw "Unexpected executable version: $candidatePath"
    }
}
foreach ($notice in $manifest.notices) { Assert-Hash (Join-Path $payloadRoot $notice.archivePath) $notice.sha256 }

if (-not $Activate) {
    Write-Output "Verified staged FFmpeg/ffprobe $($manifest.release): $payloadRoot"
    Write-Output 'Active binaries unchanged. Use -Activate only at the independently checkpointed FFmpeg upgrade milestone.'
    exit 0
}

$activeRoot = Join-Path $projectRoot 'ffmpeg'
$activeBinaryPaths = @($manifest.binaries | ForEach-Object { [System.IO.Path]::GetFullPath((Join-Path $projectRoot $_.runtimePath)) })
# Replacing an executable while the application owns it would invalidate baseline/upgrade attribution.
$running = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $activeBinaryPaths -contains $_.ExecutablePath })
if ($running.Count) { throw 'An active project FFmpeg/ffprobe process is running; finish or cancel it before activation.' }

$priorBinaries = @()
foreach ($binary in $manifest.binaries) {
    $destination = Join-Path $projectRoot $binary.runtimePath
    Assert-ProjectPath $destination
    if (Test-Path -LiteralPath $destination) {
        $oldHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        $allowedHashes = @($binary.sha256) + @($binary.knownPreviousSha256)
        if ($oldHash -notin $allowedHashes) { throw "Unrecognized active binary preserved: $destination ($oldHash)" }
        $savedPath = Join-Path $toolsRoot ('previous-ffmpeg\' + $oldHash + '\' + $binary.name)
        Assert-ProjectPath $savedPath
        [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($savedPath)) | Out-Null
        if (-not (Test-Path -LiteralPath $savedPath)) { Copy-Item -LiteralPath $destination -Destination $savedPath }
        Assert-Hash $savedPath $oldHash
        $priorBinaries += [pscustomobject]@{ destination = $destination; savedPath = $savedPath; sha256 = $oldHash }
    }
}

[System.IO.Directory]::CreateDirectory($activeRoot) | Out-Null
$activationFiles = @()
try {
    # Prepare the entire matching pair beside its final paths before replacing either file.
    foreach ($binary in $manifest.binaries) {
        $destination = Join-Path $projectRoot $binary.runtimePath
        $incoming = $destination + '.' + [Guid]::NewGuid().ToString('N') + '.incoming'
        Copy-Item -LiteralPath (Join-Path $payloadRoot $binary.archivePath) -Destination $incoming
        Assert-Hash $incoming $binary.sha256
        $activationFiles += [pscustomobject]@{ incoming = $incoming; destination = $destination; sha256 = $binary.sha256 }
    }
    foreach ($file in $activationFiles) {
        Move-Item -LiteralPath $file.incoming -Destination $file.destination -Force
        Assert-Hash $file.destination $file.sha256
    }
} catch {
    # Restore only exact previously verified files. Unknown user files never become cleanup targets.
    foreach ($file in $activationFiles) {
        $hadPrevious = @($priorBinaries | Where-Object { $_.destination -eq $file.destination }).Count -gt 0
        if (-not $hadPrevious -and (Test-Path -LiteralPath $file.destination -PathType Leaf)) {
            Assert-Hash $file.destination $file.sha256
            Remove-Item -LiteralPath $file.destination
        }
    }
    foreach ($prior in $priorBinaries) {
        Copy-Item -LiteralPath $prior.savedPath -Destination $prior.destination -Force
        Assert-Hash $prior.destination $prior.sha256
    }
    throw
}
Write-Output "Activated verified matching FFmpeg/ffprobe $($manifest.release) in $activeRoot"
Write-Output 'Previous binaries are preserved under .tools/previous-ffmpeg; run encoder and application checks before checkpointing.'
