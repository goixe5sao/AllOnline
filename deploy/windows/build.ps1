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
# Trang tĩnh (SEO: canonical, Open Graph) gắn địa chỉ công khai lúc build — dùng tên miền thật,
# không lấy giá trị localhost trong .env.local (biến môi trường được ưu tiên hơn file .env).
$env:PUBLIC_ORIGIN = "https://$($site.allonlineHosts[0])"
Invoke-Step $AllOnlineDir 'AllOnline: build' @('run', 'build')
Remove-Item Env:PUBLIC_ORIGIN
Invoke-Step $site.stockvnDir 'StockVN: npm ci' @('ci', '--no-audit', '--no-fund')
Invoke-Step $site.stockvnDir 'StockVN: build' @('run', 'build')
Write-Host 'Build xong.'
