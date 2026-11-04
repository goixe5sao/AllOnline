# Triển khai AllOnline (dịch vụ riêng, không đụng goixe5sao.vn)

> Chưa triển khai công khai. Các bước dưới đây chỉ thực hiện khi chủ dự án yêu cầu.
> Giới hạn/giá của nhà cung cấp thay đổi theo thời gian — **kiểm tra lại trang giá chính thức trước khi chọn gói**.

## 1. Supabase (project riêng: `lhyessbzkmmurkwlsdzc`)

1. Auth → Providers: bật Email (xác nhận email nên bật). **Không cần** bật Anonymous Sign-ins (đã bỏ — mỗi phiếu bầu cần một tài khoản thật).
2. Auth → URL Configuration: Site URL = địa chỉ thử nghiệm; thêm Redirect URL `https://<địa-chỉ>/api/auth/callback`.
3. Connect → lấy chuỗi **Session pooler** (hoặc Direct) → `DATABASE_URL`. Đây là bí mật, chỉ đặt ở server.
4. (Tuỳ chọn) Storage → tạo bucket **private** `allonline-uploads`; đặt `SUPABASE_SERVICE_ROLE_KEY` ở server để cho phép tải ảnh/âm thanh. Không có khoá này thì tải tệp lên chỉ hoạt động ở demo; vẫn dùng được liên kết https.
5. (Tuỳ chọn) SQL Editor → chạy `supabase/cleanup_legacy_codex_schema.sql` để xoá bảng prototype cũ trong `public` (các bảng đó từng cho người dùng tự sửa `role`).

Schema `app` được server tạo tự động khi khởi động (bảng `app.schema_migrations` ghi lại). Schema này không nằm trong “Exposed schemas” của Data API — **đừng thêm vào**.

## 2. Máy chủ Node (UI + API + WebSocket chung một tiến trình)

Yêu cầu: Node 20+, tiến trình chạy liên tục, hỗ trợ WebSocket, **một instance** (xem giới hạn).

Lệnh:

```bash
npm ci
npm run build
npm start            # NODE_ENV=production tsx server/index.ts
```

Đặt `TRUST_PROXY=1` khi chạy sau proxy của host (Railway/Render/Fly đều có) để giới hạn theo IP dùng đúng IP người dùng.

Biến môi trường bắt buộc ở production: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `APP_SECRET`, `PUBLIC_ORIGIN`. Thiếu biến DB → server **từ chối khởi động** (không lặng lẽ chạy demo).

Lựa chọn host (cần xác minh giá/giới hạn hiện hành):

- **Railway / Render / Fly.io**: chạy Node lâu dài và WebSocket; chọn gói trả phí cho mục đích thương mại, 1 instance, tắt auto-scale ngang.
- **Vercel**: không phù hợp cho server này (Functions không giữ WebSocket; gói Hobby chỉ dành cho mục đích phi thương mại). Có thể dùng Vercel cho UI tĩnh trong tương lai nếu tách hub ra host riêng, nhưng hiện chưa cần.

Tên miền thử nghiệm: dùng subdomain mặc định của host (ví dụ `allonline-test.up.railway.app`) hoặc một tên miền **mới**. Không sửa DNS của `goixe5sao.vn`.

## 3. Tạo tài khoản chủ ứng dụng an toàn

1. Đăng ký tài khoản bằng email trên ứng dụng và xác nhận email.
2. Trên máy có `DATABASE_URL` (máy dev hoặc shell của host): `npm run grant-owner -- email@...`.
3. Thu hồi: `npm run grant-owner -- email@... --revoke`.

Không có API/nút nào trên web cấp quyền này; metadata người dùng (Supabase `user_metadata`) không được dùng để cấp quyền.

## 4. Thanh toán

- Mặc định: QR VietQR (ảnh tạo từ `img.vietqr.io` theo tài khoản cấu hình trong /admin) + **chủ ứng dụng duyệt thủ công** sau khi đối soát sao kê.
- Webhook: `POST /api/payments/webhook`, body JSON `{ "txnId", "orderCode", "amount" }`, header `X-Signature: hex(HMAC_SHA256(PAYMENT_WEBHOOK_SECRET, rawBody))`. Cần viết một adapter nhỏ chuyển định dạng của nhà cung cấp (SePay/Casso/PayOS…) sang body này và xác minh chữ ký **của nhà cung cấp** trước. Webhook trùng `txnId` bị bỏ qua; thiếu tiền → `underpaid`; trễ hạn → chỉ tạo phòng nếu còn slot, nếu không → `needs_review`.
- Thanh toán giả chỉ có ở demo.

## 5. Sao lưu & vận hành

- Hết hạn phòng/đơn do sweeper trong server chạy mỗi 5 giây theo đồng hồ DB. Nếu server dừng, phòng quá hạn không nhận người mới (kiểm tra khi nạp phòng) và sẽ được đóng ngay khi server chạy lại; slot được tính lại đúng vì việc trả slot gắn với `slots_released_at`.
- Dùng tính năng backup của Supabase theo gói.

## 6. Dịch vụ phân tích StockVN (tuỳ chọn)

> Đang chạy trên máy Windows với 2 tên miền + Cloudflare Tunnel: xem **[DEPLOY-WINDOWS.md](DEPLOY-WINDOWS.md)**
> (StockVN đã có cổng mật khẩu; AllOnline gọi bằng `STOCKVN_API_TOKEN`).

Trendline, kênh, hỗ trợ/kháng cự, mô hình nến, phá vỡ, đa khung trên biểu đồ sân khấu do app
**StockVN** (repo `goixe5sao/StockVN`) tính; AllOnline chỉ gọi API `/api/ai/replay` của nó.

1. Trên cùng máy/mạng nội bộ với AllOnline: clone StockVN, cài Python 3.12 + `python -m venv .venv`
   + `.venv\Scripts\python.exe -m pip install -r ml\requirements.txt`, `npm ci --ignore-scripts`
   (API phân tích không cần `better-sqlite3`).
2. Chạy **chỉ nghe nội bộ** (StockVN chưa có đăng nhập):
   `STOCKPILOT_AUTO_INGEST=0 npx next dev -H 127.0.0.1 -p 3200` (hoặc `next build && next start -H 127.0.0.1 -p 3200`).
3. AllOnline: đặt `STOCKVN_URL=http://127.0.0.1:3200`. Không đặt thì biểu đồ vẫn chạy, chỉ báo "chưa kết nối StockVN".

Mỗi lần tính mất ~4–6 giây; AllOnline lưu tạm 1 phút mỗi mã/khung và chỉ chạy 1 phép tính một lúc.
Khi StockVN cải tiến thuật toán, AllOnline tự nhận (không có logic phân tích trùng lặp).
