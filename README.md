# AllOnline

Ứng dụng web nhiều phòng 3D (hội trường, thảm ngồi, khu bàn, rạp chiếu ngoài trời từ ô tô). Người tham dự dùng nhân vật/đối tượng đại diện, xem màn hình sân khấu chung, chat với người ở gần và bình chọn. Giao diện tiếng Việt, chạy trên máy tính và điện thoại.

## Chạy cục bộ (chế độ demo, không cần tài khoản dịch vụ nào)

```bash
npm install
npm run dev          # http://localhost:3000
```

Khi chưa có `DATABASE_URL`, server chạy **CHẾ ĐỘ DEMO** (băng vàng trên mọi trang):

- CSDL Postgres nhúng (PGlite) lưu ở `./.data/` — cùng bộ SQL với production.
- Đăng nhập demo không mật khẩu, có thể chọn vai trò chủ ứng dụng.
- Nút “Thanh toán giả” trên trang đơn hàng. Server từ chối nút này ngoài demo.

Thử nhiều người: mở thêm cửa sổ ẩn danh/trình duyệt khác, mỗi cửa sổ đăng nhập một tên.

Xoá dữ liệu demo: dừng server rồi xoá thư mục `.data/`.

## Chạy với Supabase thật

Xem [docs/DEPLOY.md](docs/DEPLOY.md). Tóm tắt: điền `.env.local` theo `.env.example` (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `APP_SECRET`), chạy `npm run dev`. Server tự chạy migration vào schema `app`.

Cấp quyền chủ ứng dụng (chỉ người có quyền truy cập DB/máy chủ):

```bash
npm run grant-owner -- email@cua-ban.vn
```

## Kiểm tra

```bash
npm run typecheck
npm run lint
npm test                                   # 47 test: lõi + tích hợp SQL thật (PGlite)
PORT=3100 npm run dev                      # cửa sổ khác
BASE=http://localhost:3100 npx tsx scripts/smoke.ts   # 33 kiểm tra end-to-end HTTP + WebSocket
npm run build
```

## Kiến trúc

```
Trình duyệt (Next.js UI + React Three Fiber)   ← cảnh 3D chạy trên thiết bị người dùng
   │  HTTPS /api/*            │  WebSocket /ws (vé ký HMAC, 60 giây)
   ▼                          ▼
Một tiến trình Node (server/index.ts)
   ├─ Next.js request handler (UI)
   ├─ REST API (server/routes.ts): quyền, slot, đơn, thanh toán, quản trị, log
   ├─ Hub realtime (server/hub.ts) + RoomEngine (src/core/room-engine.ts):
   │     ghế, hàng chờ, timer tìm chỗ, giữ chỗ khi mất mạng, lọc chat gần, màn hình, vote
   └─ Sweeper: hết hạn phòng, hết hạn giữ slot, xoá tệp quá hạn (đồng hồ DB)
   ▼
Postgres schema "app" (Supabase Postgres ở production / PGlite ở demo & test)
Supabase Auth (đăng nhập) · Supabase Storage (tệp tải lên, tuỳ chọn)
```

Quyết định chính (và lý do):

| Quyết định | Lý do |
|---|---|
| Máy chủ WebSocket riêng thay vì Supabase Realtime cho phòng | Broadcast của Supabase gửi theo kênh; không lọc người nhận theo vị trí phía server. Đặc tả cấm “gửi toàn phòng rồi ẩn”. Hub tự tính người nhận từ vị trí đã xác thực. |
| Trạng thái ghế/hàng chờ ở bộ nhớ của một tiến trình | Mỗi thao tác chạy trọn vẹn trên event loop → nguyên tử, không thể hai người cùng ghế. Giới hạn: một instance (xem PROJECT_STATUS). |
| Slot/đơn/thanh toán trong Postgres, khoá hàng `app.settings FOR UPDATE` | Cấp slot nguyên tử giữa nhiều yêu cầu đồng thời; `slots_released_at` bảo đảm trả slot đúng một lần. |
| Schema `app` không lộ qua PostgREST, RLS bật, không policy | Trình duyệt không đọc/ghi bảng trực tiếp; mọi quyền kiểm ở server. Vai trò chỉ đọc từ `app.users.role`, không từ metadata người dùng. |
| PGlite cho demo và test | Chạy cùng SQL với production, test tích hợp không cần Docker. |
| Không host trên Vercel | Vercel Functions không giữ WebSocket lâu dài; gói Hobby cấm dùng thương mại. Dùng một Node host (Railway/Render/Fly…). |

Thư mục:

- `src/core/` — logic thuần dùng chung: slot, giá, layout MAP, engine phòng, màn hình, chat, giao thức.
- `server/` — server Node: cấu hình, DB, xác thực, API, hub realtime, lưu tệp, service.
- `src/app/`, `src/components/` — giao diện.
- `db/migrations/` — schema SQL (tự chạy khi khởi động).
- `supabase/legacy/` — migration bản prototype cũ (không dùng nữa); `supabase/cleanup_legacy_codex_schema.sql` để dọn.
- `tests/`, `scripts/smoke.ts` — kiểm thử.

Trạng thái tính năng, giới hạn và việc còn lại: [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Ranh giới an toàn

AllOnline độc lập với `goixe5sao.vn`: repo, project Supabase, khoá, database và tên miền riêng. Không dùng lại URL, DNS, khoá hay cấu hình của site đang chạy.
