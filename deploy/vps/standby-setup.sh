#!/usr/bin/env bash
# VPS side of the home "warm standby" (owner 26/11/2026): the Linux VM on the home NAS (WireGuard 10.66.0.5)
# pulls a copy of production every night so the sites can be moved there in ~15 minutes if the VPS dies.
#  - read-only rsync modules for the standby peer only (code + builds in /srv, vaultwarden binary, cloudflared binary,
#    consistent SQLite snapshots) and access to the existing nightly backup + config modules
#  - a 21:05 timer that writes consistent copies of the small live SQLite DBs (sim.sqlite) for the standby
# Idempotent. Run as root on the VPS. The standby side: deploy/vps/standby/ (see docs/STANDBY-NAS.md).
set -euo pipefail
STANDBY_IP=10.66.0.5
SRV_IP=10.66.0.1
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }

# 1) existing modules: also allow the standby peer
sed -i -E "s/^(\s*hosts allow = )10\.66\.0\.4\s*$/\110.66.0.4 $STANDBY_IP/" /etc/rsyncd.conf
grep -q '^&include /etc/rsyncd.d' /etc/rsyncd.conf || printf '\n&include /etc/rsyncd.d\n' >> /etc/rsyncd.conf
mkdir -p /etc/rsyncd.d /var/backups/sankhau/standby
chmod 700 /var/backups/sankhau/standby

# 2) standby-only modules (rsyncd re-reads its config on every connection)
cat > /etc/rsyncd.d/standby.conf <<EOF
# managed by deploy/vps/standby-setup.sh — read-only, standby VM only
[standby-srv]
  comment = production code + builds (/srv) for the home standby
  path = /srv
  read only = yes
  list = no
  hosts allow = $STANDBY_IP
  hosts deny = *
  exclude = /nas/ /goixe5sao/ /stockvn/releases/ /allonline/releases/ /stockvn/data/logs/ /stockvn/data/*.sqlite* /vaultwarden/data/db.sqlite3*

[standby-opt]
  path = /opt/vaultwarden
  read only = yes
  list = no
  hosts allow = $STANDBY_IP
  hosts deny = *

[standby-bin]
  path = /usr/bin
  read only = yes
  list = no
  hosts allow = $STANDBY_IP
  hosts deny = *
  filter = + /cloudflared - *

[standby-snap]
  comment = consistent SQLite snapshots for the standby (written 21:05)
  path = /var/backups/sankhau/standby
  read only = yes
  list = no
  hosts allow = $STANDBY_IP
  hosts deny = *
EOF

# 3) firewall: the standby may use rsync on the VPS (nothing else is opened)
ufw status | grep -q "873/tcp on wg0 .*ALLOW IN *$STANDBY_IP" || \
  ufw allow in on wg0 from "$STANDBY_IP" to "$SRV_IP" port 873 proto tcp comment 'nas-vps standby rsync' >/dev/null

# 4) consistent snapshots of the small live SQLite DBs (online .backup, safe while the apps write)
cat > /usr/local/bin/sankhau-standby-snap <<'EOF'
#!/bin/bash
set -euo pipefail
D=/var/backups/sankhau/standby
for db in /srv/stockvn/data/sim.sqlite; do
  [ -f "$db" ] || continue
  n=$(basename "$db")
  sqlite3 "$db" ".backup '$D/$n.tmp'"
  [ "$(sqlite3 "$D/$n.tmp" 'PRAGMA quick_check;')" = ok ] || { echo "quick_check failed: $n"; rm -f "$D/$n.tmp"; exit 1; }
  mv -f "$D/$n.tmp" "$D/$n"
done
date -Is > "$D/stamp"
EOF
chmod 755 /usr/local/bin/sankhau-standby-snap
cat > /etc/systemd/system/sankhau-standby-snap.service <<'EOF'
[Unit]
Description=Consistent SQLite snapshots for the home standby VM
[Service]
Type=oneshot
ExecStart=/usr/local/bin/sankhau-standby-snap
EOF
cat > /etc/systemd/system/sankhau-standby-snap.timer <<'EOF'
[Unit]
Description=Standby snapshots daily 21:05 (standby pulls at 21:30)
[Timer]
OnCalendar=*-*-* 21:05:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now sankhau-standby-snap.timer >/dev/null
/usr/local/bin/sankhau-standby-snap
echo "standby VPS side ready: $(cat /var/backups/sankhau/standby/stamp)"
