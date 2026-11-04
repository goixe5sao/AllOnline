# Bật StockVN, AllOnline và tunnel (mỗi cái một tiến trình ẩn, tự chạy lại khi lỗi).
. "$PSScriptRoot\common.ps1"
$null = Read-Site
if (-not (Test-Path $TunnelFile)) { throw 'Chưa có cấu hình tunnel — chạy setup.ps1 trước.' }
New-Item -ItemType Directory -Force $LogDir, $PidDir | Out-Null

foreach ($svc in @('stockvn', 'allonline', 'tunnel')) {
  $pidFile = Join-Path $PidDir "$svc.pid"
  if (Test-Path $pidFile) {
    $old = Get-Process -Id ([int](Get-Content $pidFile)) -ErrorAction SilentlyContinue
    if ($old) { Write-Host "$svc đang chạy (PID $($old.Id))"; continue }
  }
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $DeployDir 'run-loop.ps1'), '-Service', $svc
  ) | Out-Null
  Write-Host "Đã bật $svc (log: $(Join-Path $LogDir "$svc.out.log"))"
}
