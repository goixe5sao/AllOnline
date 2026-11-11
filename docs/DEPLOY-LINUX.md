# Chạy trên VPS Linux (từ 2026-11-11)

Sân Khấu Online (AllOnline) và StockVN chạy trên VPS InterData `mhc-vps` (103.175.248.207, Ubuntu 24.04,
5 vCore, 7.8 GB RAM, 69 GB NVMe). Laptop Windows không còn phục vụ web (`deploy/windows/start.ps1` từ chối chạy
khi có file `deploy/windows/MOVED-TO-VPS`; lịch "StockVN Live" trên laptop đã Disabled).

Truy cập: `ssh vps` (chỉ bằng khóa, root). Web đi qua Cloudflare Tunnel cũ (id 33533ab5…), không mở cổng web nào.

## Dịch vụ (systemd)

| Unit | Việc | Log |
|---|---|---|
| `sankhau.target` | gom các dịch vụ dưới, bật khi khởi động | |
| `allonline` | `server/index.ts` :3000 | `/var/log/sankhau/allonline.log` |
| `stockvn-web` | `next start` :3200 | `/var/log/sankhau/stockvn-web.log` |
| `stockvn-zalo` | `ml.zalo_commands` (nơi DUY NHẤT đọc tin Zalo Bot StockVN) | `/srv/stockvn/data/logs/zalo-commands.log` |
| `stockvn-live.timer` → `stockvn-live` | T2–T6 08:55: `ml.live` + job cuối ngày, chạy lại khi lỗi tới 15:05 | `/srv/stockvn/data/logs/live-YYYYMMDD.log` |
| `stockvn-live-boot` | VPS khởi động lại trong giờ phiên → chạy tiếp `ml.live` | |
| `cloudflared-sankhau` | tunnel: sankhau.pro.vn, www, stockvn.sankhau.pro.vn | `journalctl -u cloudflared-sankhau` |
| `wg-quick@wg0`, `smbd` | VPN + ổ NAS cá nhân `\\10.66.0.1\nas` (xem `deploy/vps/nas-setup.sh`) | |

Lệnh hay dùng: `systemctl status sankhau.target`, `systemctl restart allonline`, `journalctl -u allonline -f`.

## Cấu hình bí mật (không nằm trong git)

- `/srv/allonline/.env.local` — giống `.env.local` trên laptop.
- `/srv/stockvn/.env.local` — `ZALO_BOT_TOKEN`, `ZALO_CHAT_ID`.
- `/etc/sankhau/site.env` — biến lấy từ `deploy/windows/site.local.json` (STOCKVN_PASSWORD, STOCKVN_API_TOKEN,
  AI_STOCK_PROVIDER, REALTIME_*). Các dịch vụ app đọc qua `EnvironmentFile`.
- `/etc/cloudflared/<tunnel-id>.json` + `/etc/cloudflared/sankhau.yml` (= `deploy/linux/cloudflared.yml`).

App chạy bằng user `sankhau` (không đăng nhập được). Dữ liệu: `/srv/stockvn/data/stockpilot.sqlite`,
file upload AllOnline: `/srv/allonline/.data/uploads`.

## Cập nhật code

Từ PC (Git Bash), thư mục repo AllOnline, sau khi đã merge vào master:

```bash
bash deploy/linux/deploy.sh allonline          # hoặc: deploy.sh allonline <branch>
bash deploy/linux/deploy.sh stockvn            # repo StockVN ở /d/ActiveProject/StockVN
```

Script gửi đúng các file trong git, `npm ci` khi package-lock đổi, dừng → build → bật (ngừng ~30–60 s).
Build lỗi thì bật lại bản cũ. Lịch sử: `/var/log/sankhau/deploys.log`. Chỉ đổi Python (StockVN `ml/`) vẫn
dùng `deploy.sh stockvn`; worker Python lấy code mới khi khởi động lại: `systemctl restart stockvn-zalo`,
`systemctl restart stockvn-live` (trong giờ phiên).

Cài lại từ đầu / thêm dịch vụ: `ssh vps 'bash -s' < deploy/linux/install.sh` (chạy lại an toàn).

## Kết quả kiểm tra khi chuyển (2026-11-11)

- API giá VCI, VNDirect, Entrade, VPS gọi được từ IP VPS; SSI iBoard 403 (chặn IP datacenter, chỉ là nguồn dự phòng).
- Ổ NVMe ~5 GB/s tuần tự, ~99k IOPS ghi 4k; mạng ~180 Mbps xuống / ~134 Mbps lên; Supabase (Tokyo) ~65 ms.
- Khởi động lại VPS: web trở lại sau ~15 s, tất cả dịch vụ tự bật.

## Sao lưu và khôi phục

`sankhau-backup.timer` chạy 20:00 mỗi ngày (`/usr/local/bin/sankhau-backup` = `deploy/linux/backup.sh`):
DB StockVN (sao lưu online bằng `sqlite3 .backup`, kiểm `quick_check`, nén zstd ~95 MB) + file upload AllOnline.

- Trên VPS: `/var/backups/sankhau/daily`, giữ 7 bản. Log: `/var/log/sankhau/backup.log`.
- Ngoài VPS: Cloudflare R2, rclone remote `offsite`, bucket `allonline-backup`: `daily/` giữ 30 ngày, `monthly/`
  (ngày 1) giữ 12 tháng. Chưa có remote `offsite` thì script chỉ lưu trên VPS và ghi cảnh báo vào log.
- Chạy tay: `ssh vps sankhau-backup`.

Khôi phục DB StockVN:

```bash
ssh vps
cd /var/backups/sankhau/daily && sha256sum -c SHA256-<stamp>
systemctl stop stockvn-web stockvn-zalo stockvn-live
zstd -d stockpilot-<stamp>.sqlite.zst -o /srv/stockvn/data/stockpilot.sqlite.restore
cd /srv/stockvn/data && mv stockpilot.sqlite stockpilot.sqlite.broken && rm -f stockpilot.sqlite-wal stockpilot.sqlite-shm
mv stockpilot.sqlite.restore stockpilot.sqlite && chown sankhau:sankhau stockpilot.sqlite
systemctl start stockvn-web stockvn-zalo   # trong giờ phiên thêm: systemctl start stockvn-live
```

Lấy từ R2: `rclone copy offsite:allonline-backup/daily/<file> .` Khôi phục thử ngày 2026-11-11: hash OK,
`integrity_check` ok, số nến ngày khớp DB đang chạy, đủ file upload.
