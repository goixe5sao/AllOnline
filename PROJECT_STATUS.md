# AllOnline — trạng thái dự án

Cập nhật: 2026-11-04 · Nhánh: `claude/realtime-rearchitecture` (Claude Code). Nhánh `master` giữ bản prototype của Codex; chưa hợp nhất.

## Vì sao viết lại kiến trúc

Bản prototype (supabase/legacy) có các lỗi không vá được bằng chỉnh sửa nhỏ:

1. **Leo thang quyền:** `profiles.role` chứa `app_owner` và policy “users can update own profile” cho người dùng tự đặt `role = 'app_owner'`.
2. **Vượt slot:** policy cho insert thẳng vào `rooms` (bỏ qua kiểm tra ngân sách), cho người tham dự tự sửa `room_members.status/seat_id`, cho xoá phòng không trả slot/không log.
3. **Tin client:** tỷ lệ chờ do client gửi; giới hạn 100 hardcode trong CHECK và UI.
4. **Không có realtime:** chat gần không thể lọc người nhận phía server bằng Broadcast.
5. Không có giữ slot khi thanh toán, trả slot một lần, hết hạn, demo mode; camera orbit cho mọi người (trái quy định camera).

## Tính năng — thật / demo / chưa làm

| Hạng mục | Trạng thái |
|---|---|
| Đăng nhập email/mật khẩu qua Supabase Auth (cookie phía server) | **Thật** (cần cấu hình Supabase; chưa thử với project thật trong phiên này) |
| Khách vào bằng link mời chỉ với tên + nhân vật (+ mật mã phòng nếu có), không cần tài khoản; danh tính khách gắn cookie ký HMAC; khách không tạo phòng/thanh toán/quản trị; chủ ứng dụng tắt được trong /admin | Thật, có smoke test. Đánh đổi: khi bật, một người có thể dùng cửa sổ ẩn danh để bình chọn thêm |
| Giới hạn theo **thiết bị** (mã ngẫu nhiên có ký trong cookie httpOnly, không phải fingerprint): mỗi thiết bị một người tham dự, mỗi thiết bị một tài khoản tạo/giữ phòng. Không giới hạn theo IP (văn phòng/trường/4G chung IP vẫn vào được); trần người/IP tuỳ chọn, mặc định 0 = tắt | Thật, có smoke test (6 người cùng IP khác thiết bị đều vào). Đánh đổi: cửa sổ ẩn danh = thiết bị mới |
| Bình chọn “chỉ tài khoản đã đăng ký” (chủ phòng chọn khi tạo): khách xem kết quả nhưng không vote được | Thật, có smoke test — cách chống vote gian đáng tin |
| Dải quảng cáo cố định cuối màn hình sân khấu (mặc định goixe5sao.vn), bấm được trong 3D và khi xem toàn màn hình; sửa trong /admin | Thật |
| Mã giảm giá (/admin → Mã giảm giá): % giảm, tổng lượt, lượt/tài khoản, hạn dùng, bật/tắt; kiểm tra + đếm lượt trong cùng transaction với đơn. Đơn 0 ₫ (giảm 100%) được server tự xác nhận và tạo phòng/gia hạn ngay. Mã **ASDFG = 100%** tạo sẵn (không giới hạn lượt) | Thật, có test |
| Chủ phòng mở link mời có thể **vào như người tham dự** (chọn nhân vật, ngồi ghế, góc nhìn khách, bình chọn, không cần mật mã phòng) mà vẫn giữ nút Điều khiển; nút chuyển qua lại với camera chủ phòng | Thật, có smoke test |
| Bấm vào ghế trống trong 3D → “Đến”: đang ngồi thì đổi chỗ ngay; chế độ vào từ cổng thì tự đi/lái tới rồi vào chỗ (server kiểm tra) | Thật, có test trình duyệt (scripts/e2e-browser-seat.mjs) |
| Góc nhìn khách: quay trọn 360° quanh mình, ngước/cúi chỉ ±12° quanh hướng chuẩn (ngồi: giữa màn hình, giảm dần khi quay đi; đang đi: hơi chúc xuống); không vẽ lưng ghế của chính mình; kéo không bôi đen chữ | Thật |
| Chủ phòng nhấn đúp: camera tự do trượt tới điểm trên sàn (vị trí chat gần đi theo); khi ngồi như khách, nhấn đúp ghế trống là đổi chỗ ngay | Thật, test trình duyệt |
| Chuông tỉnh thức mỗi giờ (xx:00, theo đồng hồ server, giờ VN): tổng hợp bằng Web Audio (không file, không bản quyền), thông báo trên màn hình, nút bật/tắt riêng từng người | Thật, test trình duyệt (giả lập qua mốc giờ) |
| **Chọn cổ phiếu** trong Điều khiển chủ phòng: tìm theo mã hoặc tên công ty trong ~1.540 mã HOSE/HNX/UPCOM (cổ phiếu + ETF, danh sách VCI cập nhật mỗi ngày) và 6 chỉ số; chủ ứng dụng bấm ☆/★ để thêm/bỏ watchlist | Thật; kiểm thử trình duyệt `scripts/e2e-browser-picker.mjs`, ảnh `docs/screenshots/chon-co-phieu-*.png` |
| Lớp phân tích **StockVN** trên biểu đồ sân khấu (gọi StockVN như dịch vụ, không chép thuật toán): trendline, kênh, HT/KC ngang, mô hình nến, phá vỡ, đa khung — giống trang backtest; khung 1p/5p/15p/Ngày; bật/tắt từng lớp | Thật khi StockVN chạy (STOCKVN_URL); đã thử trên máy này |
| Đăng nhập demo, chọn vai trò chủ ứng dụng | **Demo**, chỉ khi không có `DATABASE_URL` |
| Vai trò: chủ ứng dụng (CLI `grant-owner`), chủ phòng (theo `rooms.owner_id`), người tham dự | Thật, kiểm ở server |
| Ngân sách slot cấu hình được, chờ = floor(chính thức × tỷ lệ), cấp nguyên tử, trả đúng một lần, giữ slot cho đơn | Thật, có test |
| Tạo phòng: tên, mô tả, MAP, nhóm đối tượng, sức chứa, bật chờ, chế độ vào, thời hạn, mật mã, màn hình ban đầu, báo giá, dùng thử | Thật |
| 4 MAP dựng sẵn (hội trường, thảm, bàn, drive-in dốc + so le) | Thật — mô hình tạm dựng bằng hình khối trong code (không tài sản bên ngoài, không vấn đề giấy phép) |
| Đối tượng: người (4), động vật (4), xe (4) + LOD đơn giản | Thật — mô hình tạm |
| Chế độ Tự xếp chỗ: chỗ gần màn hình nhất, Đổi chỗ (máy chủ kiểm tra), khu chờ, mời theo thứ tự + hạn nhận chỗ | Thật, có test |
| Chế độ Vào từ cổng: khu chính có giới hạn số người tìm chỗ, đi/lái tới chỗ, “Vào chỗ” nguyên tử, 5 phút (cấu hình), về cổng + cooldown | Thật, có test |
| Một phiên/tài khoản, nhiều tab, mất mạng giữ chỗ (grace cấu hình), tự kết nối lại | Thật, có test |
| Camera: người tham dự góc nhìn mắt/ghế lái, quay đầu, zoom FOV; chủ phòng camera tự do | Thật |
| Xem riêng màn hình (Fullscreen API, fallback lớp phủ cố định) | Thật |
| Màn hình: văn bản, ảnh (https/tải lên), YouTube IFrame API, âm thanh, chat được chọn, bình chọn, biểu đồ nến | Thật; **biểu đồ dùng dữ liệu DEMO** (ghi nhãn rõ) — có lớp `MarketDataProvider` chờ nguồn thật |
| Biểu đồ chứng khoán VN kiểu TradingView (Lightweight Charts, Apache-2.0): khung 1p→1T, nến/thanh/đường/vùng, KL, MA20, EMA50, Bollinger, RSI, chữ thập OHLC; chủ phòng đặt mặc định, người xem tự kéo/zoom/đổi ở chế độ xem màn hình | Thật. **Dữ liệu thật từ API không chính thức** (DNSE/Entrade, dự phòng SSI iBoard, VPS) do server lấy mỗi phút trong giờ giao dịch (15 phút ngoài giờ), lưu app.market_candles. **Độ sâu lịch sử:** cổ phiếu thường nạp nến ngày từ 01/01/2024 (nến 1 phút giữ 45 ngày); **chỉ số và mã trong watchlist nạp toàn bộ lịch sử** (VNINDEX từ 28/07/2000) và giữ nến 1 phút. Watchlist hiện tại: VDS, IDC, VSC, HDC (backtest tập trung vào 4 mã này + VNINDEX). Rủi ro: API có thể đổi/chặn, điều khoản có thể không cho dùng thương mại → thay bằng nguồn có giấy phép trước khi kinh doanh |
| Widget TradingView chính thức (dữ liệu thật, đủ công cụ vẽ) cho mã quốc tế | Thật. TradingView **không cho nhúng mã HOSE/HNX** (đã kiểm chứng: “Mã giao dịch này chỉ có trên TradingView”) |
| Đồng bộ phát/dừng/tua theo mốc giờ server; người vào sau bắt kịp; âm lượng riêng | Thật |
| Chat gần: lọc người nhận phía server, không lưu, giới hạn độ dài/tốc độ/lặp, bong bóng 8 giây | Thật, có test |
| Bình chọn: tạo/mở/đóng, 1 phiếu/tài khoản, đổi đáp án, nhiều cuộc lần lượt, kết quả lên màn hình, log | Thật, có test |
| Giá theo bảng (sức chứa × thời hạn), phụ phí chờ cấu hình, báo giá chốt vào đơn | Thật |
| QR VietQR + duyệt thủ công | Thật (ảnh QR do dịch vụ img.vietqr.io tạo) |
| Webhook thanh toán HMAC chung, idempotent, thiếu tiền/trễ/hết slot | Thật ở mức giao thức; **chưa có adapter cho nhà cung cấp cụ thể** |
| Thanh toán giả | **Chỉ demo** |
| Gia hạn (đơn, giữ sức chứa), cảnh báo đếm ngược trên màn hình, giảm chuyển động | Thật |
| Hết hạn tự động không cần trình duyệt (sweeper theo đồng hồ DB) | Thật, có test |
| Log phòng / log hệ thống, phân quyền xem | Thật |
| Trang quản trị: slot, online, phòng, cài đặt, giá, dùng thử, QR, MAP/nhóm, giao dịch, log | Thật |
| Tải tệp: kiểm tra loại bằng magic bytes, giới hạn dung lượng, tự xoá theo số ngày | Thật (demo: đĩa cục bộ; production: Supabase Storage nếu có service key) |
| Đổi chủ phòng | Có service `transferOwnership` + log; **chưa có UI** |
| Diễn giả trực tiếp | **Chưa làm** (đúng phạm vi): đã chừa kiểu nội dung `live_speaker` trong `src/core/screen.ts` |
| Va chạm giữa các nhân vật/xe | Chưa có — chỉ giới hạn trong vùng (main/khu chờ); đặc tả cho phép bản đầu đơn giản |
| i18n/kiểm thử khả năng truy cập đầy đủ | Chưa |

## Kết quả kiểm thử (chạy trong phiên này)

```text
npm run typecheck   PASS
npm run lint        0 lỗi (1 cảnh báo có chủ đích: tải lại trang sau đăng xuất)
npm test            71/71 PASS
  - tests/room-engine.test.ts (21): tranh ghế, hàng chờ, 5 phút tìm chỗ, cooldown, mất mạng/kết nối lại, kick, chat gần, layout
  - tests/pure.test.ts (12): slot 20%, giá, đồng bộ màn hình, YouTube URL, lọc chat
  - tests/services.test.ts (14, SQL thật trên PGlite): 12 yêu cầu tạo phòng đồng thời → đúng 8 phòng, giữ/hết hạn đơn,
    trả slot đúng một lần, webhook trùng, thiếu tiền, trễ hạn hết slot, gia hạn, quyền gia hạn, vote
scripts/smoke.ts    59/59 PASS (ổn định qua 3 lần chạy liên tiếp) (server demo thật, HTTP + WebSocket, 5 người dùng + khách)
Supabase thật: schema app tạo bằng migration, 14/14 bảng RLS, Data API không truy cập được schema app (PGRST106),
  12 yêu cầu tạo phòng đồng thời → đúng 8 phòng (khoá FOR UPDATE trên Postgres 17 thật), đóng song song → trả slot đúng 1 lần
npm run build       PASS
scripts/e2e-browser-seat.mjs  2/2 PASS (Chrome headless: đổi chỗ khi đang ngồi; tự đi tới ghế ở chế độ cổng)
Kiểm tra trình duyệt headless (Chrome, 6 phiên): drive-in + hội trường render, màn hình hiển thị biểu đồ, chat, giao diện điện thoại 390px.
```



## Giới hạn thực tế

- **Chưa kiểm chứng tải 100 người.** Smoke test dùng 5 người. Cần test tải WebSocket riêng (ví dụ k6/artillery với 100–120 kết nối, 10 tin vị trí/giây) và test hiệu năng 3D riêng trên điện thoại tầm trung. Không tuyên bố đáp ứng 100 người khi chưa đo.
- **Một instance server.** Trạng thái ghế/hàng chờ ở bộ nhớ; khởi động lại server làm mất chỗ ngồi hiện tại (người dùng tự kết nối lại và được xếp lại). Mở rộng ngang cần phân phòng theo instance (sticky theo roomId) hoặc chuyển state sang Redis.
- Vị trí được kiểm tra tốc độ/vùng, không kiểm tra va chạm vật cản.
- Biểu đồ nến dùng dữ liệu demo.
- Cảnh báo dev “Attempted to synchronously unmount a root” đến từ `@react-three/drei` `Html` với React 19 khi danh sách avatar đổi; chỉ ở dev, không ảnh hưởng chức năng.

## Việc cần chủ dự án quyết định / cung cấp

1. Chọn host Node (Railway/Render/Fly) và gói trả phí; xác minh giá hiện hành.
2. `DATABASE_URL` (Session pooler) + `APP_SECRET` cho môi trường thử nghiệm; (tuỳ chọn) `SUPABASE_SERVICE_ROLE_KEY` + bucket private.
3. Tài khoản ngân hàng nhận QR; chọn cổng đối soát (SePay/Casso/PayOS…) nếu muốn tự động.
4. Bảng giá thật (giá hiện tại là giá mẫu).
5. Nguồn dữ liệu chứng khoán có giấy phép nếu cần biểu đồ thật.
6. Duyệt và hợp nhất nhánh `claude/realtime-rearchitecture` vào `master`.

## Bàn giao (cuối phiên 2026-11-04)

- Nhánh `claude/realtime-rearchitecture` đã push lên GitHub; **chưa gộp vào `master`** (chờ chủ dự án duyệt PR).
- Supabase thật đang dùng (migration 001–007 đã áp). Bảng cũ của Codex đã xoá.
- **Chạy thử bằng IP công cộng** (máy Windows của chủ dự án):
  ```bash
  npm run build
  NODE_ENV=production PORT=3000 PUBLIC_ORIGIN=http://113.173.117.84:3000 npx tsx server/index.ts
  ```
  Để người ngoài Internet vào được cần làm thêm (quyền admin / router):
  1. Mở cổng Windows Firewall (PowerShell **Run as Administrator**):
     `New-NetFirewallRule -DisplayName "AllOnline 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow`
  2. Router: chuyển tiếp (port forward) TCP 3000 → `192.168.5.142:3000`.
  3. Supabase → Authentication → URL Configuration: thêm `http://113.173.117.84:3000` và `http://113.173.117.84:3000/api/auth/callback`.
  IP công cộng nhà mạng có thể thay đổi; đây chỉ là bản dùng thử qua HTTP (không mã hoá). Bản thật nên chạy trên host Node có HTTPS.
- Việc tiếp theo: gộp nhánh; chọn host (Railway/Render/Fly); nguồn dữ liệu chứng khoán có giấy phép; adapter webhook thanh toán thật; thử tải với điện thoại thật; UI chuyển chủ phòng; bucket Supabase Storage cho tải tệp.
