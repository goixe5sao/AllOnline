# AllOnline

Nền tảng không gian 3D nhiều phòng, giao diện tiếng Việt. Mốc đầu tiên hiện có dashboard quản lý và bản xem trước 3D cục bộ; dữ liệu chưa kết nối dịch vụ thật khi chưa cấu hình Supabase riêng.

## Chạy cục bộ

```bash
npm install
copy .env.example .env.local
npm run dev
```

Mở `http://localhost:3000`.

## Kiến trúc hiện tại

- Next.js 16 App Router + TypeScript + Tailwind CSS 4.
- Dashboard trong `src/app/page.tsx`, style trong `src/app/globals.css`.
- Không gian 3D cục bộ dùng React Three Fiber trong `src/components/space-canvas.tsx`.
- Supabase SSR client đã chuẩn bị tại `src/lib/supabase/`; frontend chỉ dùng publishable key.
- Chưa có service key, project ID hoặc database thật trong repository.

## Ranh giới an toàn

AllOnline là dự án độc lập. Không dùng lại URL, database, DNS, khóa hoặc cấu hình của `goixe5sao.vn`. Chế độ demo được hiển thị rõ trong UI và không đại diện cho kết nối thật.

## Kiểm tra

```bash
npm run lint
npm run test
npm run build
```

`npm run test` chạy 63 test nghiệp vụ cho sức chứa, khu vực chờ, ngân sách slot,
tên phòng, trạng thái phòng, mật khẩu và giới hạn thành viên.

## Kiểm thử tích hợp Supabase

Đã có migration 001 đến 005 trong `supabase/migrations/`. Chạy theo thứ tự trong
SQL Editor của project AllOnline. Luồng chủ phòng cần tài khoản email đã xác nhận;
người tham gia có thể đăng nhập anonymous sau đó join bằng mã mời và mật khẩu.

## Lộ trình kế tiếp

1. Tạo Supabase project riêng, schema/RLS cho người dùng, vai trò, phòng và slot.
2. Thay dữ liệu dashboard bằng query server-side và thêm đăng nhập cookie-based.
3. Xây luồng tạo phòng dùng thử với cấp slot nguyên tử và kiểm thử cạnh tranh.
4. Thêm realtime cho hiện diện, vị trí, chat gần, màn hình và vote.
