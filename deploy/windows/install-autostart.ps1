<#
  Cho hai app tự bật mỗi khi đăng nhập Windows, và giữ laptop không ngủ khi cắm sạc.
  -Remove để gỡ.
#>
param([switch]$Remove)
. "$PSScriptRoot\common.ps1"
$taskName = 'AllOnline server'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host 'Đã gỡ tự khởi động.'
  return
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument (
  "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $DeployDir 'start.ps1')`"")
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Đã đăng ký '$taskName': tự bật khi đăng nhập Windows."

# Cắm sạc: không ngủ, gập máy không làm gì (chạy bằng pin vẫn ngủ như bình thường để bảo vệ pin).
& powercfg.exe /change standby-timeout-ac 0
& powercfg.exe /change hibernate-timeout-ac 0
& powercfg.exe /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
& powercfg.exe /setactive SCHEME_CURRENT
Write-Host 'Đã đặt: khi cắm sạc máy không ngủ, gập nắp không tắt.'
