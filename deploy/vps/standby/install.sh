#!/bin/bash
# One-time setup of the home warm standby on the Linux VM (Ubuntu 24.04, same Node 24 + Python 3.12 as the VPS).
# Run as root on the VM from this directory: sudo bash install.sh
set -euo pipefail
cd "$(dirname "$0")"
getent group sankhau >/dev/null || groupadd -r -g 987 sankhau
getent passwd sankhau >/dev/null || useradd -r -u 999 -g sankhau -d /var/lib/sankhau -s /usr/sbin/nologin sankhau
getent group vaultwarden >/dev/null || groupadd -r -g 985 vaultwarden
getent passwd vaultwarden >/dev/null || useradd -r -u 995 -g vaultwarden -d /srv/vaultwarden -s /usr/sbin/nologin vaultwarden
mkdir -p /srv/allonline /srv/stockvn/data /srv/vaultwarden /opt/vaultwarden /var/lib/sankhau /var/lib/standby
chown sankhau:sankhau /var/lib/sankhau
install -d -o sankhau -g sankhau -m 755 /var/log/sankhau
install -d -o vaultwarden -g vaultwarden -m 750 /var/log/vaultwarden
install -m 755 standby-sync standby-up standby-down /usr/local/sbin/
cat > /etc/systemd/system/standby-sync.service <<'EOF'
[Unit]
Description=Home standby: pull production copy from the VPS (services stay stopped)
After=network-online.target wg-quick@wg0.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/standby-sync
TimeoutStartSec=2h
EOF
cat > /etc/systemd/system/standby-sync.timer <<'EOF'
[Unit]
Description=Home standby sync daily 21:30 (VPS backup 20:00, snapshots 21:05)
[Timer]
OnCalendar=*-*-* 21:30:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable standby-sync.timer >/dev/null
echo "installed; first sync: sudo standby-sync"
