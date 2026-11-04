# Chạy AllOnline + StockVN trên máy Windows này, với 2 tên miền riêng

Cách đang dùng (chủ dự án chọn 2026-11-04): **máy này chạy app, Supabase giữ dữ liệu AllOnline**,
Cloudflare Tunnel đưa 2 tên miền về máy (không mở cổng router, có HTTPS miễn phí, link cố định).
Khi lượng dùng lớn sẽ chuyển sang VPS (ví dụ Hostinger KVM 2) — tên miền và dữ liệu giữ nguyên.

```
Người dùng ──HTTPS──> Cloudflare ──tunnel──> máy này
                                            ├─ 127.0.0.1:3000  AllOnline ──> Supabase (DB + đăng nhập)
                                            └─ 127.0.0.1:3200  StockVN (có mật khẩu)
                                                 ▲ AllOnline gọi phân tích bằng mã STOCKVN_API_TOKEN
```

Hai app chỉ nghe `127.0.0.1`: từ mạng LAN/Internet chỉ vào được qua tunnel.

## Cần chuẩn bị (chủ dự án)

1. Mua 2 tên miền.
2. Tạo tài khoản Cloudflare (miễn phí), **Add a domain** cho từng tên miền, rồi đổi nameserver ở nơi
   mua tên miền sang 2 nameserver Cloudflare đưa (mua ngay tại Cloudflare thì bỏ qua bước này).
   Chờ Cloudflare báo "Active".

## Cài một lần (PowerShell, trong thư mục AllOnline)

```powershell
.\deploy\windows\setup.ps1 -AllOnline "tenmien-allonline.com,www.tenmien-allonline.com" -StockVN "tenmien-stockvn.com,www.tenmien-stockvn.com"
.\deploy\windows\build.ps1
.\deploy\windows\start.ps1
.\deploy\windows\install-autostart.ps1
```

- `setup.ps1` mở trình duyệt đăng nhập Cloudflare (lần đầu), tạo tunnel `allonline-pc`, trỏ DNS,
  tạo `deploy\windows\site.local.json` với **mật khẩu StockVN** và mã nội bộ ngẫu nhiên (in ra màn hình).
  File này và `cloudflared.local.yml` không đưa lên git.
- Sau đó vào **Supabase → Authentication → URL Configuration**: Site URL = `https://<tên miền AllOnline>`,
  thêm Redirect URL `https://<tên miền AllOnline>/api/auth/callback` (để email xác nhận đăng ký đúng link).
- `install-autostart.ps1`: tự bật khi đăng nhập Windows; khi cắm sạc thì máy không ngủ và gập nắp
  không tắt (chạy pin vẫn ngủ bình thường). Gỡ: `install-autostart.ps1 -Remove`.

## Hằng ngày

| Việc | Lệnh |
|---|---|
| Bật / tắt / bật lại | `start.ps1` / `stop.ps1` / `restart.ps1` |
| Cập nhật code mới | `git pull` (cả 2 repo) → `build.ps1` → `restart.ps1` |
| Xem log | thư mục `deploy\windows\logs\`: `allonline.out.log`, `stockvn.err.log`, `tunnel.out.log`… (lần chạy trước: `.prev`), lịch sử bật/dừng: `allonline.log`… |
| Đổi mật khẩu StockVN | sửa `stockvnPassword` trong `site.local.json` → `restart.ps1` (mọi phiên cũ hết hạn) |

Mỗi dịch vụ chạy trong vòng giám sát (`run-loop.ps1`): dừng/lỗi thì tự bật lại sau 5 giây.

## StockVN khi mở công khai

- Cổng mật khẩu (`StockVN/src/proxy.ts`) bật khi có `STOCKVN_PASSWORD`; không đặt thì chạy như cũ
  (máy dev). Sai 10 lần/15 phút mỗi IP thì bị khoá tạm. Phiên 30 ngày. Đăng xuất: `/logout`.
- AllOnline gọi `/api/ai/replay` bằng header `Authorization: Bearer <STOCKVN_API_TOKEN>`.
- Dữ liệu StockVN (SQLite `StockVN\data\stockpilot.sqlite`) ở máy này **hiện còn trống**: các trang
  tổng quan/cổ phiếu cần chạy `.venv\Scripts\python.exe -m ml.pipeline ingest` (và `daily` hằng ngày).
  Phân tích cho AllOnline và trang /backtest không cần (tự lấy nến từ VCI).

## Giới hạn của cách chạy trên laptop

- Máy tắt, ngủ (chạy pin), mất mạng, cập nhật Windows khởi động lại → app ngừng đến khi đăng nhập lại.
  Nếu cần chạy ổn định 24/7 → chuyển VPS (xem `docs/DEPLOY.md`).
- Tự khởi động theo **đăng nhập** Windows (không cần quyền admin); máy khởi động lại mà chưa ai đăng
  nhập thì chưa chạy.
