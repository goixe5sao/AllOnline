# Bật Zalo, SePay và đọc ảnh chuyển khoản

> The Zalo OA bot instructions below are historical. T-1 replaces that transport;
> use [ZALO-BOT.md](ZALO-BOT.md) for current bot configuration and webhook registration.
> The OAuth app login and SePay instructions remain separate.

Tài liệu này dành cho chủ ứng dụng AllOnline (sankhau.pro.vn).

Code đã có sẵn. Mỗi tính năng tự bật khi điền khoá tương ứng vào `D:\ActiveProject\AllOnline\.env.local`, sau đó chạy `.\deploy\windows\restart.ps1`. Thiếu khoá nào thì tính năng đó tự ẩn, phần còn lại của web vẫn chạy bình thường.

| Tính năng | Biến cần điền | Khi chưa điền |
|---|---|---|
| Nút "Đăng nhập bằng Zalo" | `ZALO_APP_ID`, `ZALO_APP_SECRET` | Nút không hiện |
| Bot Zalo OA: đăng ký/đăng nhập, nhắc sự kiện, nhận ảnh chuyển khoản | `ZALO_APP_ID`, `ZALO_APP_SECRET`, `ZALO_OA_ID`, `ZALO_OA_SECRET`, `ZALO_OA_REFRESH_TOKEN` | Bot không hoạt động |
| Tiền vào tài khoản là đơn tự xác nhận | `SEPAY_API_KEY` | Duyệt tay trong /admin như trước |
| Claude đọc ảnh chuyển khoản | `ANTHROPIC_API_KEY` | Ảnh khách gửi chuyển sang chờ duyệt tay |

## 1. Zalo for Developers: ứng dụng và Official Account

1. Vào https://developers.zalo.me, đăng nhập bằng Zalo của bạn, rồi **Tạo ứng dụng** (ví dụ "AllOnline").
   - Lấy **ID ứng dụng** và **Khóa bí mật**, điền vào `ZALO_APP_ID` và `ZALO_APP_SECRET`.
2. **Xác thực tên miền** sankhau.pro.vn: Zalo đưa cho bạn một thẻ meta.
   - Chép giá trị trong thẻ đó vào `ZALO_SITE_VERIFICATION`, rồi build lại bằng `.\deploy\windows\build.ps1`.
3. **Đăng nhập (Social API)**: thêm Callback URL `https://sankhau.pro.vn/api/auth/zalo/callback`.
4. **Official Account**: tạo OA tại https://oa.zalo.me (ví dụ "AllOnline — Sân khấu 3D").
   - Liên kết OA với ứng dụng ở mục *Official Account → Liên kết OA*.
   - Lấy **OA ID** điền vào `ZALO_OA_ID`. Link `https://zalo.me/<OA ID>` sẽ hiện trên trang đăng nhập và trang mời.
5. **Webhook** (mục *Webhook* của ứng dụng):
   - Địa chỉ: `https://sankhau.pro.vn/api/zalo/webhook`.
   - Bật các sự kiện: `follow`, `user_send_text`, `user_send_image`.
   - Lấy **OA Secret Key** điền vào `ZALO_OA_SECRET`. Server dùng khoá này để kiểm tra chữ ký trên mỗi tin Zalo gửi về.
6. **Token OA**: trong *Công cụ → API Explorer*, chọn OA và lấy **Refresh Token**, điền vào `ZALO_OA_REFRESH_TOKEN`.
   - Chỉ cần điền một lần. Sau đó server tự đổi token mới và lưu vào cơ sở dữ liệu.

Lưu ý về tin nhắn của bot:
- Tin nhắn trả lời và nhắc lịch là loại tin "tư vấn" của Zalo, miễn phí trong khoảng thời gian Zalo cho phép kể từ lần cuối người dùng nhắn cho OA.
- Ngoài khoảng đó, muốn nhắn được phải dùng ZNS (dịch vụ trả phí của Zalo). AllOnline chưa dùng ZNS.
- Vì vậy trang mời khuyên khách bấm **NHẮC <mã mời>** ngay trên Zalo. Khách bấm "Thêm vào lịch" cũng được điện thoại tự nhắc trước 30 phút.

## 2. SePay: tiền vào là phòng tự mở

1. Đăng ký tại https://sepay.vn (có gói miễn phí), liên kết tài khoản ngân hàng đang nhận tiền.
   - Đây phải là cùng số tài khoản đã điền ở /admin → *Nhận thanh toán QR*.
2. Vào *Tích hợp WebHooks → Thêm webhook*:
   - Gọi đến URL: `https://sankhau.pro.vn/api/payments/sepay`
   - Kiểu chứng thực: **API Key**. Tự đặt một chuỗi khó đoán và điền cùng chuỗi đó vào `SEPAY_API_KEY`.
   - Chỉ gửi giao dịch **tiền vào**.
3. Khách chuyển khoản với nội dung là **mã đơn** (AOxxxxxx). SePay báo về server trong vài giây:
   - Đơn tự xác nhận và phòng tự mở.
   - Bot Zalo nhắn link mời cho khách, nếu khách đã liên kết Zalo.
   - Chuyển thiếu tiền hoặc trễ hạn thì đơn chuyển sang "cần kiểm tra", giống như khi duyệt tay.

## 3. Ảnh chuyển khoản gửi qua bot

Thứ tự xử lý khi khách gửi ảnh cho bot:

1. Claude đọc ảnh và lấy ra số tiền, nội dung chuyển khoản, số tài khoản nhận, thời gian và độ rõ của ảnh.
   - Cần `ANTHROPIC_API_KEY`, lấy tại https://console.anthropic.com.
   - Mỗi ảnh tốn khoảng vài chục đồng.
2. Bot tìm đơn khớp với **mã đơn** trong nội dung chuyển khoản. Nếu nội dung không có mã, bot chỉ khớp khi khách có đúng một đơn trùng số tiền.
3. Nếu ngân hàng (SePay) đã báo tiền về, phòng đã mở sẵn; bot chỉ xác nhận lại với khách.
4. Chỉ có ảnh mà chưa có tiền về:
   - **Mặc định** (mức tự duyệt = 0): ảnh chờ SePay báo tiền về. Nếu chưa dùng SePay, ảnh chờ bạn duyệt ở /admin → **Biên lai & ngân hàng**.
     - Quá 15 phút chưa thấy tiền về thì ảnh chuyển sang "Cần duyệt".
     - Bot nhắn Zalo cho chủ ứng dụng nếu tài khoản đó đã liên kết Zalo.
   - Nếu bạn đặt **mức tự duyệt** lớn hơn 0 (ở /admin → Cài đặt), ảnh tự mở phòng chỉ khi đủ tất cả điều kiện sau:
     - đơn có số tiền không quá mức đó;
     - Claude đọc rõ;
     - đúng mã đơn;
     - đủ tiền;
     - 4 số cuối của tài khoản nhận khớp;
     - người đó chưa được tự duyệt quá 2 lần trong 24 giờ.

> Ảnh chụp màn hình chuyển khoản rất dễ làm giả. Cách an toàn nhất là bật SePay và để mức tự duyệt = 0: khi đó phòng chỉ mở khi tiền thật đã vào tài khoản.

## 4. Thử trước khi có khoá thật

Ở bản demo (chạy trên máy, không cần khoá), vào **Tài khoản → Thử bot Zalo** để nhắn với bot y như trên Zalo. Bot chạy đúng logic thật:
- đăng ký;
- link đăng nhập;
- `LK <mã>`;
- `NHẮC <mã mời>`;
- `LỊCH`;
- `ĐƠN`;
- gửi ảnh.

Các bài kiểm tra tự động nằm ở `tests/zalo-pay.test.ts` và `scripts/e2e-zalo.mjs`.
