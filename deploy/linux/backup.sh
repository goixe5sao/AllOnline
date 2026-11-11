#!/bin/bash
# Sao lưu hằng đêm: DB StockVN (SQLite, sao lưu online) + DB chính AllOnline trên Supabase (pg_dump) + file upload.
# Cài: deploy/linux/install.sh chép file này thành /usr/local/bin/sankhau-backup (timer 20:00 mỗi ngày).
# Chạy tay: sankhau-backup
#  - Trên VPS: /var/backups/sankhau/daily, giữ 7 bản.
#  - Ngoài VPS: nếu có rclone remote "offsite" (Cloudflare R2), đẩy lên offsite:$BUCKET/daily (giữ 30 ngày)
#    và mỗi ngày 1 của tháng thêm offsite:$BUCKET/monthly (giữ 6 tháng).
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
files=("stockpilot-$STAMP.sqlite.zst" "allonline-uploads-$STAMP.tar.zst")

# DB chính AllOnline trên Supabase (Postgres 17): schema app, auth, storage, public — pg_dump 17 (kho PGDG).
# Lỗi ở đây không chặn các phần khác, nhưng cuối script trả mã lỗi -> Zalo báo.
sb_failed=0
if eval "$(python3 - <<'P'
import urllib.parse, shlex
for l in open('/srv/allonline/.env.local', encoding='utf-8'):
    if l.startswith('DATABASE_URL='):
        u = urllib.parse.urlsplit(l.split('=', 1)[1].strip().strip('"').strip("'"))
        env = dict(PGHOST=u.hostname, PGPORT=str(u.port or 5432), PGUSER=urllib.parse.unquote(u.username),
                   PGPASSWORD=urllib.parse.unquote(u.password), PGDATABASE=u.path.lstrip('/') or 'postgres')
        print(' '.join(f'export {k}={shlex.quote(v)};' for k, v in env.items()))
P
)" && PGSSLMODE=require /usr/lib/postgresql/17/bin/pg_dump -Fc -Z zstd:10 --no-owner --no-privileges \
     -n app -n auth -n storage -n public -f "$DIR/supabase-$STAMP.dump"; then
  files+=("supabase-$STAMP.dump")
else
  sb_failed=1; rm -f "$DIR/supabase-$STAMP.dump"; echo "LOI: pg_dump Supabase that bai"
fi
unset PGPASSWORD

(cd "$DIR" && sha256sum "${files[@]}" > "SHA256-$STAMP")
files+=("SHA256-$STAMP")
echo "local: $(du -sh "$DIR/stockpilot-$STAMP.sqlite.zst" | cut -f1) StockVN, $(du -sh "$DIR/supabase-$STAMP.dump" 2>/dev/null | cut -f1) Supabase"

# giữ 7 bản trên VPS
for pat in 'stockpilot-*.sqlite.zst' 'allonline-uploads-*.tar.zst' 'supabase-*.dump' 'SHA256-*'; do
  ls -1t "$DIR"/$pat 2>/dev/null | tail -n +8 | xargs -r rm -f
done

if rclone listremotes 2>/dev/null | grep -qx 'offsite:'; then
  for f in "${files[@]}"; do
    rclone copyto --s3-no-check-bucket "$DIR/$f" "offsite:$BUCKET/daily/$f"
    [ "$(date +%d)" = 01 ] && rclone copyto --s3-no-check-bucket "$DIR/$f" "offsite:$BUCKET/monthly/$f"
  done
  rclone delete --min-age 30d "offsite:$BUCKET/daily" || true
  rclone delete --min-age 185d "offsite:$BUCKET/monthly" || true
  r2_bytes=$(rclone size --json "offsite:$BUCKET" | grep -oP '"bytes":\K[0-9]+')
  echo "offsite: OK ($((r2_bytes / 1048576)) MB on R2)"
else
  r2_bytes=0
  echo "offsite: CHUA CAU HINH (rclone remote 'offsite' chua co) - chi co ban tren VPS"
fi

# Cảnh báo dung lượng qua Zalo (tối đa 1 lần/tuần cho mỗi loại)
warn() { # key, message
  local stamp=/var/backups/sankhau/.warned-$1
  if [ ! -f "$stamp" ] || [ -n "$(find "$stamp" -mtime +6)" ]; then
    /usr/local/bin/sankhau-notify "⚠️ VPS mhc-vps dung lượng: $2" && touch "$stamp"
  fi
}
R2_LIMIT_GB=${R2_WARN_GB:-9}       # R2 miễn phí 10 GB
DISK_LIMIT_PCT=${DISK_WARN_PCT:-75}
DB_LIMIT_GB=${DB_WARN_GB:-5}
disk_pct=$(df --output=pcent / | tail -1 | tr -dc '0-9')
db_bytes=$(stat -c %s /srv/stockvn/data/stockpilot.sqlite)
echo "size: disk ${disk_pct}%, DB $((db_bytes / 1048576)) MB, R2 $((r2_bytes / 1048576)) MB"
[ "$r2_bytes" -gt $((R2_LIMIT_GB * 1073741824)) ] && warn r2 "R2 đã dùng $((r2_bytes / 1048576)) MB (miễn phí 10 GB). Nên giảm số bản sao lưu giữ lại."
[ "$disk_pct" -ge "$DISK_LIMIT_PCT" ] && warn disk "ổ VPS đã dùng ${disk_pct}% (69 GB). Cần dọn hoặc nâng gói."
[ "$db_bytes" -gt $((DB_LIMIT_GB * 1073741824)) ] && warn db "DB StockVN đã $((db_bytes / 1048576)) MB (ngưỡng ${DB_LIMIT_GB} GB)."
echo "[$(date '+%F %T')] done"
exit $sb_failed
