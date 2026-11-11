#!/bin/bash
# Sao lưu hằng đêm: DB StockVN (SQLite, sao lưu online an toàn khi đang ghi) + file upload AllOnline.
# Cài: deploy/linux/install.sh chép file này thành /usr/local/bin/sankhau-backup (timer 20:00 mỗi ngày).
# Chạy tay: sankhau-backup
#  - Trên VPS: /var/backups/sankhau/daily, giữ 7 bản.
#  - Ngoài VPS: nếu có rclone remote "offsite" (Cloudflare R2), đẩy lên offsite:$BUCKET/daily (giữ 30 ngày)
#    và mỗi ngày 1 của tháng thêm offsite:$BUCKET/monthly (giữ 12 tháng).
set -euo pipefail
BUCKET=${SANKHAU_BACKUP_BUCKET:-allonline-backup}
DIR=/var/backups/sankhau/daily
STAMP=$(date +%Y%m%d-%H%M)
LOG=/var/log/sankhau/backup.log
mkdir -p "$DIR"
exec >> "$LOG" 2>&1
echo "[$(date '+%F %T')] start $STAMP"

tmp=$(mktemp -d /var/backups/sankhau/tmp.XXXX)
trap 'rm -rf "$tmp"' EXIT
sqlite3 /srv/stockvn/data/stockpilot.sqlite ".backup '$tmp/stockpilot.sqlite'"
check=$(sqlite3 "$tmp/stockpilot.sqlite" "PRAGMA quick_check;")
[ "$check" = ok ] || { echo "LOI quick_check: $check"; exit 1; }
zstd -q -T0 -10 "$tmp/stockpilot.sqlite" -o "$DIR/stockpilot-$STAMP.sqlite.zst"
tar -C /srv/allonline/.data -cf - uploads | zstd -q -T0 -o "$DIR/allonline-uploads-$STAMP.tar.zst"
(cd "$DIR" && sha256sum "stockpilot-$STAMP.sqlite.zst" "allonline-uploads-$STAMP.tar.zst" > "SHA256-$STAMP")
echo "local: $(du -sh "$DIR/stockpilot-$STAMP.sqlite.zst" | cut -f1) DB"

# giữ 7 bản trên VPS
for pat in 'stockpilot-*.sqlite.zst' 'allonline-uploads-*.tar.zst' 'SHA256-*'; do
  ls -1t "$DIR"/$pat 2>/dev/null | tail -n +8 | xargs -r rm -f
done

if rclone listremotes 2>/dev/null | grep -qx 'offsite:'; then
  for f in "stockpilot-$STAMP.sqlite.zst" "allonline-uploads-$STAMP.tar.zst" "SHA256-$STAMP"; do
    rclone copyto --s3-no-check-bucket "$DIR/$f" "offsite:$BUCKET/daily/$f"
    [ "$(date +%d)" = 01 ] && rclone copyto --s3-no-check-bucket "$DIR/$f" "offsite:$BUCKET/monthly/$f"
  done
  rclone delete --min-age 30d "offsite:$BUCKET/daily" || true
  rclone delete --min-age 370d "offsite:$BUCKET/monthly" || true
  echo "offsite: OK ($(rclone size --json "offsite:$BUCKET" | tr -d '\n'))"
else
  echo "offsite: CHUA CAU HINH (rclone remote 'offsite' chua co) - chi co ban tren VPS"
fi
echo "[$(date '+%F %T')] done"
