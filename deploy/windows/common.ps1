# Dùng chung cho các script chạy AllOnline + StockVN trên máy Windows này (Windows PowerShell 5.1).
$ErrorActionPreference = 'Stop'

$DeployDir   = $PSScriptRoot
$AllOnlineDir = (Resolve-Path (Join-Path $DeployDir '..\..')).Path
$SiteFile    = Join-Path $DeployDir 'site.local.json'
$TunnelFile  = Join-Path $DeployDir 'cloudflared.local.yml'
$LogDir      = Join-Path $DeployDir 'logs'
$PidDir      = Join-Path $DeployDir 'pids'

function Find-Cloudflared {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe")) {
    if (Test-Path $p) { return $p }
  }
  throw 'Không tìm thấy cloudflared. Cài: winget install --id Cloudflare.cloudflared'
}

function Read-Site {
  if (-not (Test-Path $SiteFile)) { throw "Chưa có $SiteFile — chạy setup.ps1 trước." }
  return Get-Content $SiteFile -Raw -Encoding UTF8 | ConvertFrom-Json
}

function New-Secret([int]$bytes = 24) {
  $b = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  # Chữ và số dễ gõ (bỏ ký tự dễ nhầm), đủ mạnh cho mật khẩu/mã.
  $alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return -join ($b | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

function Split-Hosts([string]$s) {
  return @($s -split '[,\s]+' | Where-Object { $_ } | ForEach-Object { $_.Trim().ToLower() })
}
