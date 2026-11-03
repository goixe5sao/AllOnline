# AllOnline - trạng thái dự án

Cập nhật: 2026-11-04

## Mục tiêu hiện tại

AllOnline là ứng dụng không gian 3D nhiều phòng. Supabase riêng của dự án:

- Project ref: `lhyessbzkmmurkwlsdzc`
- URL: `https://lhyessbzkmmurkwlsdzc.supabase.co`
- Không commit `.env.local`, publishable key hoặc service key.

## Đã có trong source

- Next.js 16 App Router, React, TypeScript, React Three Fiber.
- Supabase browser/server client và middleware refresh session.
- Đăng ký, đăng nhập email/password, callback xác nhận email.
- Dashboard đọc session và danh sách phòng thật từ Supabase.
- Tạo phòng qua RPC `create_room`.
- Join phòng qua mã mời/mật khẩu qua RPC `join_room_by_invite`.
- Trang phòng 3D thử nghiệm.
- Migrations Supabase 001 đến 005 trong `supabase/migrations/` đã được người dùng chạy thành công.
- RLS, giới hạn slot, mật khẩu hash, chặn anonymous tạo phòng.
- Bộ test nghiệp vụ Vitest: 63 test.

## Kiểm tra đã đạt

```text
npm run lint  PASS
npm run test  PASS - 63/63
npm run build PASS
```

Smoke test Supabase đã đạt:

- 100/100 request trang chủ HTTP 200.
- 100/100 mã mời không hợp lệ bị từ chối với `ROOM_NOT_FOUND`.
- Anonymous tạo phòng bị từ chối với `OWNER_ACCOUNT_REQUIRED`.

## Vấn đề còn tồn tại cần xử lý trước khi gọi production-ready

Luồng đăng nhập thực tế trên trình duyệt của người dùng vẫn chưa được xác nhận hoàn chỉnh: sau khi đăng nhập, dashboard có lúc vẫn hiển thị chế độ khách. Đã đổi server từ `getClaims()` sang `getUser()`, đổi điều hướng sau login sang full navigation và middleware cũng dùng `getUser()`, nhưng cần tiếp tục debug bằng browser session thật.

Không được kết luận luồng sau đây đã pass nếu chưa kiểm tra bằng tài khoản email đã xác nhận:

1. Chủ phòng đăng nhập.
2. Chủ phòng tạo phòng.
3. Lấy mã/link mời.
4. Client đăng nhập anonymous hoặc tài khoản khác.
5. Client join bằng link và mật khẩu.
6. Chủ phòng mở được trang phòng và thấy client.

## Lệnh tiếp tục

```powershell
cd D:\ActiveProject\AllOnline
npm.cmd run dev
npm.cmd run lint
npm.cmd run test
npm.cmd run build
```

Kiểm tra `.env.local` tồn tại cục bộ trước khi chạy. Không in giá trị key ra terminal/chat.
