param([Parameter(Mandatory)][string]$Run)
$ErrorActionPreference = 'Stop'
$work = Split-Path -Parent $PSScriptRoot; $kit = $PSScriptRoot; $root = Join-Path $work $Run
if (Test-Path -LiteralPath $root) { throw "run folder exists: $Run" }
foreach ($d in 'cfg','out','wsb') { [void][IO.Directory]::CreateDirectory((Join-Path $root $d)) }
Copy-Item -LiteralPath (Join-Path $kit 'build.sh'), (Join-Path $kit 'qualify.ps1') -Destination (Join-Path $root 'cfg')
$hb = (Get-FileHash -LiteralPath (Join-Path $root 'cfg\build.sh') -Algorithm SHA256).Hash.ToLower()
$hq = (Get-FileHash -LiteralPath (Join-Path $root 'cfg\qualify.ps1') -Algorithm SHA256).Hash.ToLower()
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $root 'cfg\guest.ps1'), ([IO.File]::ReadAllText((Join-Path $kit 'guest.template.ps1')).Replace('@BUILD@',$hb).Replace('@QUALIFY@',$hq)), $utf8)
$wsb = Join-Path $root "wsb\$Run.wsb"
[IO.File]::WriteAllText($wsb, ([IO.File]::ReadAllText((Join-Path $kit 'build.template.wsb')).Replace('@RUN@',$Run)), $utf8)
$names = 'WindowsSandbox','WindowsSandboxClient','WindowsSandboxRemoteSession','WindowsSandboxServer','vmmemWindowsSandbox'
if (@(Get-Process -Name $names -ErrorAction SilentlyContinue).Count) { throw 'a sandbox is already running' }
Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsSandbox.exe') -ArgumentList ('"' + $wsb + '"')
"launched $Run build.sh=$hb at $([DateTime]::UtcNow.ToString('o'))"
