#!/bin/bash
# Cập nhật code lên VPS rồi build + restart. Chạy từ PC (Git Bash), ở thư mục repo AllOnline:
#   bash deploy/linux/deploy.sh allonline [git-ref=master]
#   bash deploy/linux/deploy.sh stockvn   [git-ref=master]
# Chỉ gửi file trong git (không gửi .env.local, data, node_modules). Code cũ được thay bằng
# rsync --delete trên VPS; giữ nguyên .env.local, .data, data/, .venv, node_modules.
set -e
app=${1:?allonline|stockvn}; ref=${2:-master}
case $app in
  allonline) repo=$(cd "$(dirname "$0")/../.." && pwd); services="allonline" ;;
  stockvn)   repo=${STOCKVN_REPO:-/d/ActiveProject/StockVN}; services="stockvn-web" ;;
  *) echo "app = allonline | stockvn"; exit 1 ;;
esac
rev=$(git -C "$repo" rev-parse --short "$ref")
echo "== $app @ $rev"
git -C "$repo" archive --format=tar "$ref" | ssh vps "rm -rf /srv/$app.src && mkdir -p /srv/$app.src && tar x -C /srv/$app.src"
ssh vps "bash -s" <<EOF
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
