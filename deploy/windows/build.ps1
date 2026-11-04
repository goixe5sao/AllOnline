# Build bản production của cả hai app. Chạy lại sau mỗi lần cập nhật code (rồi restart.ps1).
. "$PSScriptRoot\common.ps1"
$site = Read-Site

function Invoke-Step([string]$dir, [string]$label, [string[]]$npmArgs) {
  Write-Host ">> $label"
  Push-Location $dir
  try {
    & npm.cmd @npmArgs
    if ($LASTEXITCODE -ne 0) { throw "$label thất bại (mã $LASTEXITCODE)" }
  } finally { Pop-Location }
}

Invoke-Step $AllOnlineDir 'AllOnline: npm ci' @('ci', '--no-audit', '--no-fund')
Invoke-Step $AllOnlineDir 'AllOnline: build' @('run', 'build')
Invoke-Step $site.stockvnDir 'StockVN: npm ci' @('ci', '--no-audit', '--no-fund')
Invoke-Step $site.stockvnDir 'StockVN: build' @('run', 'build')
Write-Host 'Build xong.'
