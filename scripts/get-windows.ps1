<#
  Installs or updates Felinquent from the latest release, without the SmartScreen warning.
  Paste this in PowerShell:

    irm https://raw.githubusercontent.com/abozaralizadeh/Felinquent/main/scripts/get-windows.ps1 | iex

  It downloads Felinquent-setup.exe from the latest GitHub release, checks it against the SHA-256
  published next to it (and stops if it doesn't match), runs it without questions (it installs for
  you only, no admin) and starts Felinquent. Browsers tag what they download as "from the
  internet", and that tag is what makes Windows SmartScreen ask whether the app is safe. A download
  made by PowerShell doesn't get it. The cat keeps what it learned: that lives in
  %APPDATA%\app.felinquent, not in the app. Run it again any time to update.

  $env:FELINQUENT_NO_OPEN = '1' installs without starting it.
  $env:FELINQUENT_FROM = '<url>' downloads from another folder with the same two files, for testing.
#>
# In a block of its own, so piping it into iex changes nothing in your PowerShell session.
& {
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$from = if ($env:FELINQUENT_FROM) { $env:FELINQUENT_FROM.TrimEnd('/') } else { 'https://github.com/abozaralizadeh/Felinquent/releases/latest/download' }
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("felinquent-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Felinquent needs 64-bit Windows.' }
  $setup = Join-Path $tmp 'Felinquent-setup.exe'

  Write-Host '==> Downloading Felinquent'
  Invoke-WebRequest -UseBasicParsing -Uri "$from/Felinquent-setup.exe" -OutFile $setup
  $sum = (Invoke-WebRequest -UseBasicParsing -Uri "$from/Felinquent-setup.exe.sha256").Content
  if ($sum -is [byte[]]) { $sum = [Text.Encoding]::ASCII.GetString($sum) }
  $want = ($sum.Trim() -split '\s+')[0].ToLowerInvariant()
  $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $setup).Hash.ToLowerInvariant()
  if ($want -notmatch '^[0-9a-f]{64}$' -or $got -ne $want) { throw "the download doesn't match its checksum, so it was not installed." }
  Write-Host '==> Checksum matches'

  # A running copy keeps its files busy, so it closes first. It starts again at the end.
  Get-Process -Name 'Felinquent' -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null; Start-Sleep -Milliseconds 500; if (-not $_.HasExited) { $_.Kill() } }

  Write-Host '==> Installing'
  $p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "the installer stopped (code $($p.ExitCode))." }

  $exe = Join-Path $env:LOCALAPPDATA 'Felinquent\felinquent.exe'
  if (-not (Test-Path $exe)) { throw "the installer finished but Felinquent isn't in $env:LOCALAPPDATA\Felinquent." }
  Write-Host "==> Installed in $env:LOCALAPPDATA\Felinquent"

  if ($env:FELINQUENT_NO_OPEN -ne '1') {
    Start-Process -FilePath $exe
    Write-Host '==> Started. Look for the cat at the bottom of the screen, and its icon by the clock.'
  }
}
catch {
  Write-Host "Felinquent: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
}
}
