#!/usr/bin/env bash
# Home QNAP NAS as a second, PULL-only backup target for the VPS.
#  - adds WireGuard peer "qnap" = 10.66.0.4 (can reach only rsync on 10.66.0.1)
#  - read-only rsync daemon module [sankhau-backup] = /var/backups/sankhau/daily,
#    bound to 10.66.0.1, hosts allow 10.66.0.4 (no password, see step 3)
#  NAS side: a pull script from root cron (21:00) + daily volume snapshots (22:00).
#  - writes the client files to /root/secrets/qnap/ and a copy to /srv/nas/claude/qnap/
# Re-running keeps the existing keys/password (delete /root/secrets/qnap to regenerate).
set -euo pipefail
[ "$(id -u)" = 0 ] || exec sudo bash "$0" "$@"

NAS_IP=10.66.0.4
SRV_IP=10.66.0.1
SEC=/root/secrets/qnap
PUB_ENDPOINT=103.175.248.207:51820
install -d -m 700 "$SEC"

if [ ! -f "$SEC/private.key" ]; then
  umask 077
  wg genkey > "$SEC/private.key"
  wg pubkey < "$SEC/private.key" > "$SEC/public.key"
  wg genpsk > "$SEC/psk.key"
fi
NAS_PUB=$(cat "$SEC/public.key")
SRV_PUB=$(wg show wg0 public-key)

# 1) WireGuard peer (persisted in wg0.conf + applied live, no tunnel restart)
if ! grep -q "$NAS_PUB" /etc/wireguard/wg0.conf; then
  cat >> /etc/wireguard/wg0.conf <<EOF

[Peer]
# qnap (home NAS, pull-only backups)
PublicKey = $NAS_PUB
PresharedKey = $(cat "$SEC/psk.key")
AllowedIPs = $NAS_IP/32
EOF
fi
wg set wg0 peer "$NAS_PUB" preshared-key "$SEC/psk.key" allowed-ips "$NAS_IP/32"

# 2) firewall: the NAS may use rsync only; no SMB / SSH over the tunnel
ufw allow in on wg0 from "$NAS_IP" to "$SRV_IP" port 873 proto tcp comment 'qnap rsync' >/dev/null
ufw insert 1 deny in on wg0 from "$NAS_IP" to any port 445 proto tcp comment 'qnap no smb' >/dev/null
ufw insert 1 deny in on wg0 from "$NAS_IP" to any port 22 proto tcp comment 'qnap no ssh' >/dev/null

# 3) read-only rsync daemon. NO password: QNAP's rsync 3.0.7 segfaults on daemon auth (QTS 5.2.11),
#    so access = bound to the WireGuard address + hosts allow = the NAS peer only.
cat > /etc/rsyncd.conf <<EOF
# managed by deploy/vps/qnap-setup.sh
address = $SRV_IP
port = 873
uid = root
gid = root
use chroot = yes
max connections = 2
log file = /var/log/rsyncd.log
timeout = 600

[sankhau-backup]
  comment = VPS nightly backups (read-only; access = WireGuard peer 10.66.0.4 only)
  path = /var/backups/sankhau/daily
  read only = yes
  list = yes
  hosts allow = $NAS_IP 10.66.0.5
  hosts deny = *

[sankhau-config]
  comment = VPS config + secrets (read-only; NAS peer only; never on R2)
  path = /var/backups/sankhau/config
  read only = yes
  list = yes
  hosts allow = $NAS_IP 10.66.0.5
  hosts deny = *

# home standby modules (deploy/vps/standby-setup.sh)
&include /etc/rsyncd.d
EOF
install -d /etc/systemd/system/rsync.service.d
cat > /etc/systemd/system/rsync.service.d/wg.conf <<'EOF'
[Unit]
After=wg-quick@wg0.service
Requires=wg-quick@wg0.service
EOF
systemctl daemon-reload
systemctl enable --now rsync.service
systemctl restart rsync.service

# 4) client files
cat > "$SEC/qnap-wg0.conf" <<EOF
[Interface]
PrivateKey = $(cat "$SEC/private.key")
Address = $NAS_IP/32

[Peer]
PublicKey = $SRV_PUB
PresharedKey = $(cat "$SEC/psk.key")
Endpoint = $PUB_ENDPOINT
AllowedIPs = 10.66.0.0/24
PersistentKeepalive = 25
EOF
chmod 600 "$SEC"/*
OUT=/srv/nas/claude/qnap
install -d -o nas -g nas -m 700 "$OUT"
install -o nas -g nas -m 600 "$SEC/qnap-wg0.conf" "$OUT/qnap-wg0.conf"
echo "OK: peer $NAS_IP, rsync module sankhau-backup on $SRV_IP:873; files in $OUT"
