# Tắt rồi bật lại (dùng sau build.ps1).
& "$PSScriptRoot\stop.ps1"
Start-Sleep -Seconds 2
& "$PSScriptRoot\start.ps1"
