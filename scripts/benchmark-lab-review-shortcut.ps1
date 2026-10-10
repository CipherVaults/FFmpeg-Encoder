$ErrorActionPreference = 'Stop'

# This is a per-user shortcut, not a startup task or a global service. It
# launches the existing Node runtime with one fixed read-only helper script.
$taskProjectRoot = Split-Path -Parent $PSScriptRoot
$taskNodePath = 'C:\Program Files\nodejs\node.exe'
$taskReviewScript = Join-Path $PSScriptRoot 'benchmark-lab-review-access.cjs'
$taskDesktop = [Environment]::GetFolderPath('Desktop')
$taskShortcutPath = Join-Path $taskDesktop 'FFmpeg Visual Review.lnk'
if (!(Test-Path -LiteralPath $taskNodePath) -or !(Test-Path -LiteralPath $taskReviewScript)) {
    throw 'The existing Node runtime or review helper is missing.'
}
$taskShell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $taskShortcutPath) {
    $taskExisting = $taskShell.CreateShortcut($taskShortcutPath)
    if ($taskExisting.Description -ne 'FFmpeg Encoder: blind visual review') {
        throw 'An unrelated Desktop shortcut already has this name; it has been preserved.'
    }
}
$taskShortcut = $taskShell.CreateShortcut($taskShortcutPath)
$taskShortcut.TargetPath = $taskNodePath
$taskShortcut.Arguments = '"' + $taskReviewScript + '" --open'
$taskShortcut.WorkingDirectory = $taskProjectRoot
$taskShortcut.WindowStyle = 7
$taskShortcut.Description = 'FFmpeg Encoder: blind visual review'
$taskShortcut.IconLocation = (Join-Path $env:WINDIR 'System32\shell32.dll') + ',13'
$taskShortcut.Save()
$taskSaved = $taskShell.CreateShortcut($taskShortcutPath)
[pscustomobject]@{Shortcut=$taskShortcutPath; Target=$taskSaved.TargetPath; Arguments=$taskSaved.Arguments} | ConvertTo-Json
