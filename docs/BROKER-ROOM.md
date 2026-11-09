# Phòng tư vấn cho môi giới (Broker Room): đề xuất tính năng

Bản 2026-11-09. Tổng hợp từ góc nhìn môi giới (Claude) và bản rà soát code độc lập (Codex).

## Bối cảnh chủ dự án đã chốt
- **Mục tiêu:** hút khách mới, chăm khách hiện có, bán gói VIP thu phí, và đào tạo nhà đầu tư.
- **Quy mô:** hội thảo 30–300 người mỗi buổi.
- **Người dùng chính:** tư vấn viên **tự do** (không thuộc công ty chứng khoán).
- **Khán giả:** xem bằng **điện thoại, trong giờ giao dịch** (9h–15h).

## Hệ quả thiết kế
1. **Trên điện thoại phải "vào là xem được ngay".** Người xem vào trong 1 chạm (link Zalo), mặc định ở chế độ 2D nhẹ: màn hình, tiếng và chat. 3D là tuỳ chọn. Trong giờ giao dịch, khách vừa làm việc vừa nghe.
2. **Phải nghe rõ tiếng broker ở mọi chỗ ngồi.** Giọng nói hiện tại nghe theo khoảng cách, kiểu trò chuyện quanh bàn. Với 30–300 người, broker cần một kênh "sân khấu" phát cho cả phòng.
3. **Pháp lý (quan trọng với tư vấn tự do).** Ở Việt Nam, tư vấn đầu tư chứng khoán là nghiệp vụ có điều kiện, gắn với công ty chứng khoán và chứng chỉ hành nghề. Nền tảng nên định vị là **chia sẻ kiến thức và bình luận thị trường**, không bán "khuyến nghị mua/bán kèm cam kết lợi nhuận". Cần có quy định nội dung, cảnh báo rủi ro bắt buộc và ghi nhận đồng ý. Chủ dự án nên hỏi luật sư trước khi mở bán gói VIP.

## Tính năng đã có (tái sử dụng)
- Phát camera qua Cloudflare Realtime (một người lên sóng, có duyệt).
- Giọng nói theo khoảng cách và nhóm riêng.
- Màn hình sân khấu chiếu được văn bản, ảnh, YouTube, trang web, âm thanh và biểu đồ VN-Index có lớp phân tích StockVN.
- Bình chọn, Q&A (bình chọn câu hỏi và ghim lên sân khấu), thả cảm xúc, giơ tay, đồng chủ phòng.
- Lịch sự kiện, đếm ngược, nhắc qua Zalo, file lịch .ics.
- Thanh toán VietQR và SePay (hiện chỉ dùng cho việc thuê phòng).
- Báo cáo người tham dự và CSV.

## Đề xuất

### GIAI ĐOẠN 1: "Buổi điểm tin chuyên nghiệp" (bắt buộc trước khi bán)
| # | Tính năng | Vì sao broker và khách cần | Công sức |
|---|---|---|---|
| 1 | **Chia sẻ màn hình** (broker dùng máy tính): chiếu phần mềm giao dịch, slide, báo cáo; tự quay lại camera khi dừng | Đây là công cụ làm việc số 1 của broker | M |
| 2 | **Kênh tiếng sân khấu** cho cả phòng, kèm **mời khách lên nói** (từ danh sách giơ tay, có giới hạn thời gian) | Với 30–300 người, ai cũng phải nghe rõ broker; hỏi đáp trực tiếp tạo cảm giác tin tưởng | M |
| 3 | **Chế độ xem nhanh trên điện thoại** (2D): màn hình lớn, tiếng, chat và Q&A; tiết kiệm dung lượng mạng, chạy được nền khi khoá màn hình nếu trình duyệt cho phép | Khách xem trong giờ làm việc trên 4G | M |
| 4 | **Chat chung cả phòng** có kiểm duyệt (ẩn tin, cấm chat, chặn link và số điện thoại lạ để chống lừa đảo) | Chat hiện tại chỉ tới người ngồi gần; hội thảo cần một kênh chung | M |
| 5 | **Cảnh báo rủi ro và nội quy**: khách bấm đồng ý khi vào phòng; dải cảnh báo cố định trên màn hình | Bảo vệ broker và nền tảng | S |
| 6 | **Nút "Đăng ký tư vấn riêng"**: khách để lại tên và Zalo kèm đồng ý liên hệ; broker xuất danh sách và nhận báo qua bot Zalo | Biến người xem thành khách hàng, đúng mục tiêu hút khách | S–M |

### GIAI ĐOẠN 2: "Kiếm tiền và giữ chân"
| # | Tính năng | Ghi chú | Công sức |
|---|---|---|---|
| 7 | **Gói thành viên VIP theo tháng**: phòng chỉ cho thành viên, thu qua VietQR/SePay, tự hết hạn và nhắc gia hạn qua Zalo | Cần thêm "quyền vào phòng theo gói" (hiện chỉ có tiền thuê phòng) | L |
| 8 | **Lịch cố định**, ví dụ "Điểm tin 8h45 mỗi sáng" hay "Tổng kết tuần tối thứ 6", tự nhắc qua Zalo | Tạo thói quen quay lại | M |
| 9 | **Bảng mã theo dõi** trên sân khấu: 5–10 mã broker đang nói tới, kèm giá, % thay đổi và VN-Index | *Cần chủ dự án quyết:* hiện đã chốt chỉ hiện VN-Index | M |
| 10 | **Ghi hình và xem lại** cho thành viên VIP và lớp học | Cần đồng ý ghi hình, chỗ lưu trữ và chi phí | L |
| 11 | **Trang hồ sơ broker**: ảnh, kinh nghiệm, lịch buổi sắp tới, nút theo dõi | Tạo uy tín, không đăng "thành tích lãi" thiếu kiểm chứng | M |

### GIAI ĐOẠN 3: "Khác biệt bằng AI và đào tạo"
- **Tóm tắt buổi bằng AI**, gửi qua Zalo cho người tham dự: các ý chính, câu hỏi hay, kèm cảnh báo rủi ro.
- **Trợ lý trả lời câu hỏi lặp lại** trong lúc broker đang nói (dựa trên nội dung buổi).
- **Lớp học**: chuỗi bài, bài kiểm tra nhanh bằng bình chọn, chứng nhận hoàn thành.
- **Phễu chuyển đổi**: thống kê đã xem → đăng ký tư vấn → trở thành VIP.

## Câu hỏi còn mở (chủ dự án)
- Có giữ định hướng "kiến thức/bình luận, không khuyến nghị cam kết lợi nhuận" không? Có hỏi luật sư trước khi bán gói VIP không?
- Giá gói VIP dự kiến bao nhiêu? Nền tảng thu tiền rồi chia cho broker, hay broker tự thu?
- Có cần bảng nhiều mã (mục 9), hay giữ đúng chỉ VN-Index?
- Có cần ghi hình (mục 10) ngay không?
