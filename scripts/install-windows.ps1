<#
.SYNOPSIS
  Installs (or updates) Felinquent on Windows. Run it again any time to update.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
  powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -WithModel -Login
.PARAMETER WithModel
  Also set up Ollama and the small local model (about 1 GB). The cat works without it.
.PARAMETER Login
  Also start Felinquent when you log in.
.PARAMETER NoLaunch
  Do not start it at the end.
.PARAMETER DryRun
  Only print what it would do.
.NOTES
  This script was written on a Mac and has never been run on Windows. Read it before you run it.
#>
param(
  [switch]$WithModel,
  [switch]$Login,
  [switch]$NoLaunch,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$Model = if ($env:FELINQUENT_OLLAMA_MODEL) { $env:FELINQUENT_OLLAMA_MODEL } else { 'gemma3:1b' }

function Say($msg) { Write-Host "`n==> $msg" }
function Run([scriptblock]$block, [string]$text) {
  if ($DryRun) { Write-Host "    [dry run] $text" } else { & $block }
}
function Has($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + "$env:USERPROFILE\.cargo\bin"
}

Set-Location (Join-Path $PSScriptRoot '..')

Say 'Checking the tools'
if (-not (Has 'winget')) {
  Write-Host 'winget is missing. Install "App Installer" from the Microsoft Store, then run this script again.'
  exit 1
}
if (-not (Has 'node')) {
  Say 'Installing Node.js'
  Run { winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements } 'winget install OpenJS.NodeJS.LTS'
  Refresh-Path
}
if (-not (Has 'cargo')) {
  Say 'Installing Rust'
  Run { winget install --id Rustlang.Rustup -e --silent --accept-package-agreements --accept-source-agreements } 'winget install Rustlang.Rustup'
  Refresh-Path
  Run { rustup default stable-x86_64-pc-windows-msvc } 'rustup default stable-x86_64-pc-windows-msvc'
}
# Rust on Windows needs the Visual Studio C++ build tools to link.
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasBuildTools = (Test-Path $vswhere) -and [bool](& $vswhere -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if (-not $hasBuildTools) {
  Say 'Installing the Visual Studio C++ build tools (this is a big download)'
  Run { winget install --id Microsoft.VisualStudio.2022.BuildTools -e --silent --accept-package-agreements --accept-source-agreements --override '--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended' } 'winget install Microsoft.VisualStudio.2022.BuildTools (C++ workload)'
}

Say 'Building the installer (the first build takes a few minutes)'
Run { npm ci } 'npm ci'
Run { npm run bundle:win } 'npm run bundle:win'

Say 'Installing'
$installer = Get-ChildItem 'src-tauri\target\release\bundle\nsis\*.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $DryRun -and -not $installer) { Write-Host 'The installer was not built. Scroll up for the error.'; exit 1 }
Run { Get-Process felinquent -ErrorAction SilentlyContinue | Stop-Process -Force } 'stop a running Felinquent'
# /S is a silent install for the current user. No admin prompt.
Run { Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait } 'run the installer silently (per user)'
$exe = Join-Path $env:LOCALAPPDATA 'Felinquent\felinquent.exe'
if (-not $DryRun -and -not (Test-Path $exe)) {
  # The installer may name the program differently. Take the first program in the folder.
  $found = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Felinquent') -Filter *.exe -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch 'uninst' } | Select-Object -First 1
  if ($found) { $exe = $found.FullName }
}

if ($WithModel) {
  Say "Setting up the local model ($Model)"
  if (-not (Has 'ollama')) {
    Run { winget install --id Ollama.Ollama -e --silent --accept-package-agreements --accept-source-agreements } 'winget install Ollama.Ollama'
    Refresh-Path
  }
  Run { ollama pull $Model } "ollama pull $Model"
} else {
  Write-Host '    (Skipping the local model. The cat works without it. Add -WithModel to set it up.)'
}

if ($Login) {
  Say 'Starting it at login'
  $startup = [Environment]::GetFolderPath('Startup')
  Run {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut((Join-Path $startup 'Felinquent.lnk'))
    $link.TargetPath = $exe
    $link.Save()
  } "create a Startup shortcut to $exe"
}

if (-not $NoLaunch) {
  Say 'Starting Felinquent'
  Run { Start-Process $exe } "start $exe"
}

Say 'Done'
Write-Host 'Look for the cat icon in the system tray (it may be under the ^ arrow): Character, Panic, Shoo and Quit.'
Write-Host "Logs: $env:LOCALAPPDATA\Felinquent\Logs\overlay.log"
Write-Host 'To remove it: Settings > Apps > Felinquent > Uninstall. Run this script again any time to update.'
