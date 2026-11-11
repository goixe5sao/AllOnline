#!/bin/bash
# Cài/cập nhật dịch vụ AllOnline (Sân Khấu Online) + StockVN trên VPS Ubuntu 24.04.
# Chạy từ PC:  ssh vps 'bash -s' < deploy/linux/install.sh
# Yêu cầu có sẵn (do người vận hành chép lên, KHÔNG nằm trong git):
#   /srv/allonline/.env.local            (khóa AllOnline: Supabase, SePay, Zalo…)
#   /srv/stockvn/.env.local              (ZALO_BOT_TOKEN / ZALO_CHAT_ID của StockVN)
#   /etc/sankhau/site.env                (biến lấy từ site.local.json: STOCKVN_PASSWORD, STOCKVN_API_TOKEN, REALTIME_*, AI_STOCK_PROVIDER…)
#   /etc/cloudflared/<tunnel-id>.json    (khóa tunnel Cloudflare)
# Script KHÔNG khởi động dịch vụ; dùng: systemctl start sankhau.target
set -e
export DEBIAN_FRONTEND=noninteractive
APP_USER=sankhau

# --- gói hệ thống: Chrome (chụp trang web cho phòng), font tiếng Việt, cloudflared
if ! command -v google-chrome >/dev/null; then
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list
fi
if ! command -v cloudflared >/dev/null; then
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared noble main" > /etc/apt/sources.list.d/cloudflared.list
fi
apt-get update -qq
apt-get install -y -qq google-chrome-stable cloudflared fonts-noto-core fonts-noto-color-emoji >/dev/null

# --- user chạy app (không đăng nhập được)
id $APP_USER >/dev/null 2>&1 || useradd -r -m -d /var/lib/$APP_USER -s /usr/sbin/nologin $APP_USER
chown -R $APP_USER:$APP_USER /srv/allonline /srv/stockvn
chmod 600 /srv/allonline/.env.local /srv/stockvn/.env.local 2>/dev/null || true
mkdir -p /etc/sankhau && chmod 750 /etc/sankhau && chgrp $APP_USER /etc/sankhau
[ -f /etc/sankhau/site.env ] && chmod 640 /etc/sankhau/site.env && chgrp $APP_USER /etc/sankhau/site.env
mkdir -p /srv/stockvn/data/logs && chown -R $APP_USER:$APP_USER /srv/stockvn/data

# --- wrapper ml.live (giống ml/run-live.ps1: chạy lại khi lỗi, tới 15:05)
cat > /usr/local/bin/stockvn-live <<'S'
#!/bin/bash
cd /srv/stockvn
export PYTHONIOENCODING=utf-8 PYTHONUNBUFFERED=1
log=data/logs/live-$(date +%Y%m%d).log
code=0
for attempt in $(seq 1 20); do
  .venv/bin/python -m ml.live >> "$log" 2>&1; code=$?
  if [ $code -eq 0 ] || [ "$(date +%H%M)" -ge 1505 ]; then break; fi
  echo "[$(date +%T)] ml.live exit $code, restart $attempt/20 in 30s" >> "$log"
  sleep 30
done
exit $code
S
chmod 755 /usr/local/bin/stockvn-live

# --- systemd
cat > /etc/systemd/system/allonline.service <<U
[Unit]
Description=Sân Khấu Online (AllOnline) :3000
After=network-online.target
Wants=network-online.target
PartOf=sankhau.target

[Service]
User=$APP_USER
WorkingDirectory=/srv/allonline
EnvironmentFile=/etc/sankhau/site.env
Environment=NODE_ENV=production HOST=127.0.0.1 PORT=3000 TRUST_PROXY=1 PUBLIC_ORIGIN=https://sankhau.pro.vn STOCKVN_URL=http://127.0.0.1:3200 CHROME_PATH=/usr/bin/google-chrome
ExecStart=/usr/bin/node node_modules/tsx/dist/cli.mjs server/index.ts
Restart=always
RestartSec=5
StandardOutput=append:/var/log/sankhau/allonline.log
StandardError=append:/var/log/sankhau/allonline.log

[Install]
WantedBy=sankhau.target
U

cat > /etc/systemd/system/stockvn-web.service <<U
[Unit]
Description=StockVN web :3200
After=network-online.target
PartOf=sankhau.target

[Service]
User=$APP_USER
WorkingDirectory=/srv/stockvn
EnvironmentFile=/etc/sankhau/site.env
Environment=NODE_ENV=production MARKET_DATA_PROVIDER=local
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3200
Restart=always
RestartSec=5
StandardOutput=append:/var/log/sankhau/stockvn-web.log
StandardError=append:/var/log/sankhau/stockvn-web.log

[Install]
WantedBy=sankhau.target
U

cat > /etc/systemd/system/stockvn-zalo.service <<U
[Unit]
Description=StockVN Zalo command worker (the ONLY getUpdates consumer)
After=network-online.target
PartOf=sankhau.target

[Service]
User=$APP_USER
WorkingDirectory=/srv/stockvn
Environment=PYTHONIOENCODING=utf-8 PYTHONUNBUFFERED=1
ExecStart=/srv/stockvn/.venv/bin/python -m ml.zalo_commands
Restart=always
RestartSec=10
StandardOutput=append:/srv/stockvn/data/logs/zalo-commands.log
StandardError=append:/srv/stockvn/data/logs/zalo-commands.log

[Install]
WantedBy=sankhau.target
U

cat > /etc/systemd/system/stockvn-live.service <<U
[Unit]
Description=StockVN live session (1-min candles, alerts, end-of-day job)
After=network-online.target

[Service]
Type=simple
User=$APP_USER
ExecStart=/usr/local/bin/stockvn-live
TimeoutStartSec=infinity
U

cat > /etc/systemd/system/stockvn-live.timer <<U
[Unit]
Description=StockVN live 08:55 Mon-Fri

[Timer]
OnCalendar=Mon..Fri 08:55
Persistent=false

[Install]
WantedBy=timers.target
U

# VPS khởi động lại trong giờ phiên (T2-T6 08:50-15:00) -> chạy tiếp ml.live ngay
cat > /usr/local/bin/stockvn-in-session <<'S'
#!/bin/bash
# exit 0 khi đang T2-T6 08:50-14:59 (giờ VPS = Asia/Ho_Chi_Minh)
[ "$(date +%u)" -le 5 ] || exit 1
t=$(date +%H%M)
[ "$t" -ge 0850 ] && [ "$t" -lt 1500 ]
S
chmod 755 /usr/local/bin/stockvn-in-session
cat > /etc/systemd/system/stockvn-live-boot.service <<'U'
[Unit]
Description=Resume StockVN live after a reboot during the trading session
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecCondition=/usr/local/bin/stockvn-in-session
ExecStart=/bin/systemctl start --no-block stockvn-live.service

[Install]
WantedBy=multi-user.target
U

cat > /etc/systemd/system/cloudflared-sankhau.service <<U
[Unit]
Description=Cloudflare Tunnel sankhau.pro.vn
After=network-online.target
Wants=network-online.target
PartOf=sankhau.target

[Service]
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate --config /etc/cloudflared/sankhau.yml run
Restart=always
RestartSec=5

[Install]
WantedBy=sankhau.target
U

cat > /etc/systemd/system/sankhau.target <<U
[Unit]
Description=Sân Khấu Online + StockVN
Wants=allonline.service stockvn-web.service stockvn-zalo.service cloudflared-sankhau.service

[Install]
WantedBy=multi-user.target
U

mkdir -p /var/log/sankhau && chown $APP_USER:$APP_USER /var/log/sankhau
cat > /etc/logrotate.d/sankhau <<L
/var/log/sankhau/*.log /srv/stockvn/data/logs/zalo-commands.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
L
systemctl daemon-reload
echo "install OK"
