# Tắt cả ba dịch vụ (kể cả tiến trình con node/cloudflared).
. "$PSScriptRoot\common.ps1"
foreach ($svc in @('tunnel', 'allonline', 'stockvn')) {
  $pidFile = Join-Path $PidDir "$svc.pid"
  if (-not (Test-Path $pidFile)) { continue }
  $id = [int](Get-Content $pidFile)
  if (Get-Process -Id $id -ErrorAction SilentlyContinue) {
    & taskkill.exe /PID $id /T /F | Out-Null
    Write-Host "Đã tắt $svc"
  }
  Remove-Item $pidFile -Force
}
