#!/bin/bash
# Cập nhật code lên VPS rồi build + restart. Chạy ở thư mục repo AllOnline, từ PC (Git Bash, qua
# `ssh vps`) HOẶC ngay trên VPS (VS Code Remote-SSH: tự nhận ra /srv/<app> và chạy bằng sudo):
#   bash deploy/linux/deploy.sh allonline [git-ref=master]
#   bash deploy/linux/deploy.sh stockvn   [git-ref=master]
# Ép chế độ: DEPLOY_LOCAL=1 (chạy tại chỗ bằng sudo) hoặc DEPLOY_LOCAL=0 (qua ssh vps).
# Chỉ gửi file trong git (không gửi .env.local, data, node_modules). Code cũ được thay bằng
# rsync --delete trên VPS; giữ nguyên .env.local, .data, data/, .venv, node_modules.
set -e
app=${1:?allonline|stockvn}; ref=${2:-master}
case $app in
  allonline) repo=$(cd "$(dirname "$0")/../.." && pwd); services="allonline" ;;
  stockvn)   default=/d/ActiveProject/StockVN; [ -d "$HOME/work/StockVN/.git" ] && default=$HOME/work/StockVN
             repo=${STOCKVN_REPO:-$default}; services="stockvn-web" ;;
  *) echo "app = allonline | stockvn"; exit 1 ;;
esac
# Trên VPS (có /srv/<app> và sudo) thì chạy tại chỗ; `ssh vps` không trỏ được về chính nó.
if [ -z "${DEPLOY_LOCAL:-}" ]; then
  if [ -d "/srv/$app" ] && command -v systemctl >/dev/null; then DEPLOY_LOCAL=1; else DEPLOY_LOCAL=0; fi
fi
if [ "$DEPLOY_LOCAL" = 1 ]; then
  vps_cmd() { sudo bash -c "$1"; }; vps_script() { sudo bash -s; }
else
  vps_cmd() { ssh vps "$1"; };      vps_script() { ssh vps "bash -s"; }
fi
rev=$(git -C "$repo" rev-parse --short "$ref")
echo "== $app @ $rev"
git -C "$repo" archive --format=tar "$ref" | vps_cmd "rm -rf /srv/$app.src && mkdir -p /srv/$app.src && tar x -C /srv/$app.src"
vps_script <<EOF
set -e
cd /srv/$app
lock_before=\$(sha256sum package-lock.json 2>/dev/null | cut -c1-64)
rsync -a --delete --exclude=/.env.local --exclude=/.data --exclude=/data --exclude=/.venv \
  --exclude=/node_modules --exclude=/.next --exclude=/ml/logs /srv/$app.src/ /srv/$app/
rm -rf /srv/$app.src
chown -R sankhau:sankhau /srv/$app
lock_after=\$(sha256sum package-lock.json | cut -c1-64)
if [ "\$lock_before" != "\$lock_after" ] || [ ! -d node_modules ]; then sudo -u sankhau npm ci --no-audit --no-fund --loglevel=error; fi
if [ "$app" = stockvn ]; then sudo -u sankhau .venv/bin/pip install -q -r ml/requirements.txt; fi
# Dừng -> build -> bật (site ngừng ~30-60 s). Build lỗi: khôi phục .next cũ và bật lại.
systemctl stop $services
rm -rf .next-old; [ -d .next ] && cp -a .next .next-old
if ! sudo -u sankhau env NEXT_TELEMETRY_DISABLED=1 PUBLIC_ORIGIN=https://sankhau.pro.vn npx next build > /var/log/sankhau/build-$app.log 2>&1; then
  tail -30 /var/log/sankhau/build-$app.log
  rm -rf .next; [ -d .next-old ] && mv .next-old .next
  systemctl start $services; echo "BUILD LOI - da bat lai ban cu (code moi van nam tren dia)"; exit 1
fi
systemctl start $services
sleep 8
systemctl is-active $services
echo "$rev \$(date '+%F %T')" >> /var/log/sankhau/deploys.log
EOF
echo "== deployed $app @ $rev"
