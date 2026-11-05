<#
  Cài một lần: tạo Cloudflare Tunnel cố định cho 2 tên miền và file cấu hình máy này.

  .\deploy\windows\setup.ps1 -AllOnline "allonline.vn,www.allonline.vn" -StockVN "stockvn.vn,www.stockvn.vn"

  Yêu cầu: cả hai tên miền đã được thêm vào tài khoản Cloudflare (nameserver đã trỏ về Cloudflare).
  Lần đầu, cloudflared mở trình duyệt để bạn đăng nhập Cloudflare và chọn một tên miền — PHẢI chọn
  đúng tên miền của app (vd. sankhau.pro.vn): lệnh trỏ DNS ghi vào tên miền đã chọn lúc đăng nhập,
  chọn nhầm tên miền khác trong cùng tài khoản sẽ tạo bản ghi rác trong tên miền đó.
#>
param(
  [Parameter(Mandatory = $true)][string]$AllOnline,
  [Parameter(Mandatory = $true)][string]$StockVN,
  [string]$TunnelName = 'allonline-pc',
  [string]$StockVnDir = 'D:\ActiveProject\StockVN'
)
. "$PSScriptRoot\common.ps1"

$cf = Find-Cloudflared
$aoHosts = Split-Hosts $AllOnline
$svHosts = Split-Hosts $StockVN
if (-not $aoHosts -or -not $svHosts) { throw 'Cần ít nhất một tên miền cho mỗi app.' }
if (-not (Test-Path (Join-Path $StockVnDir 'package.json'))) { throw "Không thấy StockVN ở $StockVnDir" }

# 1) Đăng nhập Cloudflare (tạo ~/.cloudflared/cert.pem)
$cfHome = Join-Path $env:USERPROFILE '.cloudflared'
if (-not (Test-Path (Join-Path $cfHome 'cert.pem'))) {
  Write-Host '>> Mở trình duyệt để đăng nhập Cloudflare... Khi được hỏi, chọn ĐÚNG tên miền của app.'
  & $cf tunnel login
  if ($LASTEXITCODE -ne 0) { throw 'Đăng nhập Cloudflare thất bại.' }
}

# 2) Tạo tunnel (nếu chưa có) và lấy ID
$list = & $cf tunnel list --output json | ConvertFrom-Json
$tunnel = $list | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
if (-not $tunnel) {
  Write-Host ">> Tạo tunnel $TunnelName"
  & $cf tunnel create $TunnelName | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Tạo tunnel thất bại.' }
  $list = & $cf tunnel list --output json | ConvertFrom-Json
  $tunnel = $list | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
}
$tunnelId = $tunnel.id
$credFile = Join-Path $cfHome "$tunnelId.json"
if (-not (Test-Path $credFile)) { throw "Thiếu $credFile (tunnel tạo ở máy khác?). Xoá tunnel trên Cloudflare rồi chạy lại." }

# 3) Trỏ DNS từng tên miền vào tunnel (CNAME do Cloudflare quản lý)
foreach ($h in ($aoHosts + $svHosts)) {
  Write-Host ">> DNS $h -> tunnel"
  & $cf tunnel route dns --overwrite-dns $TunnelName $h | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Không trỏ được DNS cho $h (tên miền đã nằm trong tài khoản Cloudflare chưa?)" }
}

# 4) File cấu hình tunnel: tên miền -> cổng nội bộ (hai app chỉ nghe 127.0.0.1)
$lines = @("tunnel: $tunnelId", "credentials-file: $credFile", 'ingress:')
foreach ($h in $aoHosts) { $lines += "  - hostname: $h"; $lines += '    service: http://127.0.0.1:3000' }
foreach ($h in $svHosts) { $lines += "  - hostname: $h"; $lines += '    service: http://127.0.0.1:3200' }
$lines += '  - service: http_status:404'
Set-Content -Path $TunnelFile -Value $lines -Encoding ASCII

# 5) Cấu hình máy (giữ mật khẩu/mã cũ nếu chạy lại)
$old = $null
if (Test-Path $SiteFile) { $old = Get-Content $SiteFile -Raw -Encoding UTF8 | ConvertFrom-Json }
$site = [ordered]@{
  allonlineHosts   = $aoHosts
  stockvnHosts     = $svHosts
  tunnelName       = $TunnelName
  stockvnDir       = $StockVnDir
  stockvnPassword  = $(if ($old -and $old.stockvnPassword) { $old.stockvnPassword } else { New-Secret 12 })
  stockvnApiToken  = $(if ($old -and $old.stockvnApiToken) { $old.stockvnApiToken } else { New-Secret 32 })
}
($site | ConvertTo-Json) | Set-Content -Path $SiteFile -Encoding UTF8

Write-Host ''
Write-Host '== Xong. =='
Write-Host "AllOnline : https://$($aoHosts[0])"
Write-Host "StockVN   : https://$($svHosts[0])   (mật khẩu: $($site.stockvnPassword))"
Write-Host "Cấu hình  : $SiteFile  (KHÔNG đưa lên git)"
Write-Host ''
Write-Host 'Việc còn lại trên Supabase -> Authentication -> URL Configuration:'
Write-Host "  Site URL      = https://$($aoHosts[0])"
Write-Host "  Redirect URLs + https://$($aoHosts[0])/api/auth/callback"
Write-Host 'Sau đó: .\deploy\windows\build.ps1 ; .\deploy\windows\start.ps1 ; .\deploy\windows\install-autostart.ps1'
