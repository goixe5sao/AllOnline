<#
  Chạy một dịch vụ và tự khởi động lại khi nó dừng (giám sát đơn giản, không cần cài thêm gì).
  Được start.ps1 gọi trong cửa sổ ẩn; không chạy tay.
#>
param([Parameter(Mandatory = $true)][ValidateSet('allonline', 'stockvn', 'tunnel')][string]$Service)
. "$PSScriptRoot\common.ps1"
$ErrorActionPreference = 'Continue'
$site = Read-Site

New-Item -ItemType Directory -Force $LogDir, $PidDir | Out-Null
Set-Content -Path (Join-Path $PidDir "$Service.pid") -Value $PID -Encoding ASCII
$log = Join-Path $LogDir "$Service.log"

$node = (Get-Command node).Source
switch ($Service) {
  'allonline' {
    $dir = $AllOnlineDir
    $exe = $node
    $argv = @('node_modules\tsx\dist\cli.mjs', 'server\index.ts')
    $envs = @{
      NODE_ENV = 'production'; HOST = '127.0.0.1'; PORT = '3000'; TRUST_PROXY = '1'
      PUBLIC_ORIGIN = "https://$($site.allonlineHosts[0])"
      STOCKVN_URL = 'http://127.0.0.1:3200'; STOCKVN_API_TOKEN = $site.stockvnApiToken
    }
    # Live camera (Cloudflare Realtime) and AI Stock: values set in site.local.json by the owner.
    # aiStockProvider = "stockvn" turns on real scans/alerts; unset = sample data only, no alerts.
    foreach ($k in @(@('aiStockProvider', 'AI_STOCK_PROVIDER'), @('anthropicApiKey', 'ANTHROPIC_API_KEY'), @('realtimeAppId', 'REALTIME_APP_ID'),@('realtimeAppSecret', 'REALTIME_APP_SECRET'), @('turnKeyId', 'REALTIME_TURN_KEY_ID'), @('turnKeyToken', 'REALTIME_TURN_KEY_TOKEN'))) {
      $v = $site.($k[0])
      if ($v -and -not "$v".StartsWith('DÁN_')) { $envs[$k[1]] = "$v" }
    }
  }
  'stockvn' {
    $dir = $site.stockvnDir
    $exe = $node
    $argv = @('node_modules\next\dist\bin\next', 'start', '-H', '127.0.0.1', '-p', '3200')
    $envs = @{
      NODE_ENV = 'production'; MARKET_DATA_PROVIDER = 'local'
      STOCKVN_PASSWORD = $site.stockvnPassword; STOCKVN_API_TOKEN = $site.stockvnApiToken
    }
  }
  'tunnel' {
    $dir = $DeployDir
    $exe = Find-Cloudflared
    $argv = @('tunnel', '--no-autoupdate', '--config', $TunnelFile, 'run', $site.tunnelName)
    $envs = @{}
  }
}
foreach ($k in $envs.Keys) { Set-Item -Path "env:$k" -Value $envs[$k] }

$out = Join-Path $LogDir "$Service.out.log"
$err = Join-Path $LogDir "$Service.err.log"
while ($true) {
  # Giữ log của lần chạy trước (.prev) để xem vì sao dịch vụ dừng.
  foreach ($f in @($out, $err)) { if (Test-Path $f) { Move-Item -Force $f "$f.prev" } }
  Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss} khởi động {1}" -f (Get-Date), $Service) -Encoding UTF8
  $p = Start-Process -FilePath $exe -ArgumentList $argv -WorkingDirectory $dir -NoNewWindow -PassThru `
    -RedirectStandardOutput $out -RedirectStandardError $err
  $null = $p.Handle   # giữ handle để đọc được ExitCode sau khi tiến trình dừng
  $p.WaitForExit()
  Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss} dừng (mã {1}), chạy lại sau 5 giây" -f (Get-Date), $p.ExitCode) -Encoding UTF8
  Start-Sleep -Seconds 5
}
