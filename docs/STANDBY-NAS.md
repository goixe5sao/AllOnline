# Máy dự phòng ở nhà (warm standby trên NAS)

Mục tiêu: VPS sập → chuyển sankhau.pro.vn, broker.pro.vn, pass.sankhau.pro.vn sang máy ảo Linux trên NAS ở nhà trong
khoảng 10–15 phút, không đổi DNS (cùng Cloudflare Tunnel). Gọi Xe 5 Sao không nằm ở đây (chạy trên Vercel, có máy dự phòng riêng).

## Cách hoạt động
| Giờ | Ở đâu | Việc |
|---|---|---|
| 20:00 | VPS | `sankhau-backup`: DB StockVN, trạng thái StockVN (sim.sqlite + file nhỏ), upload, Vaultwarden, Supabase, gói cấu hình |
| 21:05 | VPS | `sankhau-standby-snap`: bản chụp nhất quán `sim.sqlite` cho máy dự phòng |
| 21:30 | máy ảo NAS | `standby-sync`: kéo code + bản build (/srv), gói cấu hình (unit systemd, tunnel, env), backup mới nhất (kiểm SHA256), khôi phục DB, chạy thử web StockVN + Vaultwarden trên localhost rồi TẮT hết |

- Máy dự phòng chỉ ĐỌC từ VPS qua WireGuard (rsync chỉ-đọc, chỉ cho phép IP của máy ảo). VPS không có quyền vào nhà.
- Bình thường mọi dịch vụ trên máy dự phòng đều TẮT, không tự bật khi khởi động. Kết quả: `/var/lib/standby/status.json`, log `sync.log`.
- Dữ liệu trên máy dự phòng = bản backup 20:00 gần nhất (StockVN mất phần dữ liệu trong ngày sau 20:00 nếu VPS sập).
  AllOnline dùng Supabase (đám mây) nên không mất gì.

Cài đặt: VPS `sudo bash deploy/vps/standby-setup.sh`; máy ảo `sudo bash deploy/vps/standby/install.sh` rồi `sudo standby-sync`.

## Chuyển sang máy dự phòng (VPS sập)
1. Nếu VPS còn sống: `sudo systemctl stop cloudflared-sankhau stockvn-zalo stockvn-live.timer` trên VPS
   (hai đầu tunnel cùng chạy sẽ chia đôi khách; hai bot Zalo cùng đọc sẽ mất tin nhắn).
2. Trên máy ảo: `sudo standby-up --yes` (web + kho mật khẩu + bot Zalo + lịch dữ liệu).
   Diễn tập không đụng bot: `sudo standby-up --yes --web-only`.
3. Kiểm tra 3 tên miền. Thiếu so với VPS: ảnh chụp web (không có Chrome), tải video YouTube (để trên VPS), backup đêm.

## Quay về VPS
1. Nếu máy dự phòng đã phục vụ người dùng thật: dừng dịch vụ trên máy ảo (`standby-down --copied` ở bước 3), rồi chép dữ liệu
   mới về VPS TRƯỚC khi VPS chạy lại: `/srv/stockvn/data/{stockpilot,sim}.sqlite` (dùng `sqlite3 .backup`),
   `/srv/vaultwarden/data/`, `/srv/allonline/.data/uploads/`.
2. Trên VPS: `sudo systemctl start cloudflared-sankhau stockvn-zalo stockvn-live.timer`.
3. Trên máy ảo: `sudo standby-down --copied` (hoặc `--discard` nếu là diễn tập). Đồng bộ đêm chạy lại bình thường.

## Diễn tập 26/11/2026 01:00
- Đồng bộ lần đầu khoảng 2 phút (code 2,6 GB + DB 3,3 GB); các đêm sau chỉ tải phần thay đổi (vài giây đến vài phút).
- Chuyển tunnel VPS → nhà: gián đoạn **≈ 9 giây**; 3 tên miền trả 200 từ máy ở nhà, thời gian phản hồi ≈ 0,5 s (VPS ≈ 0,4 s).
- Chuyển về VPS: gián đoạn **≈ 2 giây**. Bot Zalo và lịch dữ liệu chưa diễn tập (chỉ một nơi được đọc bot).
