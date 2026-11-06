# Thử tải (load test) — 05/11/2026

Kịch bản: [scripts/load-test.mjs](../scripts/load-test.mjs). Khách ảo kết nối qua WebSocket, không mở trình duyệt. Hoạt động của mỗi khách giống một tab thật:

- Vào phòng, được xếp chỗ tự động.
- Ping mỗi 5 giây để đo độ trễ.
- Chat khoảng 1 lần/phút.
- Bình chọn khi chủ phòng mở bình chọn.

Mỗi phòng có một chủ phòng riêng. Chủ phòng đổi nội dung màn hình sân khấu mỗi 10 giây và mở một bình chọn ở mỗi mức tải.

Môi trường thử:

- Server AllOnline chạy chế độ production (`NODE_ENV=production`) trên laptop Windows (24 GB RAM).
- Dữ liệu dùng PGlite trong bộ nhớ (chế độ demo) nên RAM đo được cao hơn bản thật khoảng 250 MB. Bản thật dùng Supabase và chỉ chiếm khoảng 145 MB.
- Khách ảo chạy trên cùng máy.

## Nhiều phòng (30 phòng × 50 người)

| Người xem | Vào được | Có ghế | Lỗi | Độ trễ p50 / p95 / p99 (ms) | Tin server gửi/giây | Băng thông ra | RAM server | CPU server (1 lõi) |
|---:|---:|---:|---:|---|---:|---:|---:|---:|
| 100 | 100 | 100 | 0 | 1 / 2 / 6 | 39 | ~0 MB/s | 490 MB | 2% |
| 250 | 250 | 250 | 0 | 1 / 2 / 6 | 147 | 0,02 MB/s | 360 MB | 4% |
| 500 | 500 | 500 | 0 | 1 / 3 / 25 | 437 | 0,08 MB/s | 369 MB | 6% |
| 1000 | 1000 | 1000 | 0 | 1 / 6 / 40 | 1325 | 0,29 MB/s | 414 MB | 10% |
| 1500 | 1500 | 1500 | 0 | 1 / 8 / 17 | 2677 | 0,62 MB/s | 421 MB | 15% |

Trong lần thử này có 2496 tin chat và 3350 lượt bình chọn; server không trả lỗi nào.

## Một phòng lớn (500 người cùng phòng)

| Người xem | Vào được | Độ trễ p50 / p95 / p99 (ms) | Tin server gửi/giây | Băng thông ra | RAM server | CPU server |
|---:|---:|---|---:|---:|---:|---:|
| 250 | 250 | 1 / 3 / 6 | 1654 | 0,47 MB/s | 424 MB | 5% |
| 500 | 500 | 1 / 18 / 43 | 6044 | 1,83 MB/s | 433 MB | 13% |

## Kết luận cho VPS 4 GB / 2 vCPU

- **RAM không phải giới hạn.** Ở 1500 người, RAM gần như không đổi: tăng khoảng 100 MB so với lúc rảnh.
- **Phải để ý CPU và băng thông.** Phòng càng đông thì mỗi tin nhắn càng phải gửi tới nhiều người. 500 người chung một phòng cần khoảng 1,8 MB/s, tức khoảng 15 Mbit/s.
- vCPU của VPS thường chậm hơn laptop 1,5–2 lần. Dù vậy, 1000–1500 người chia ra nhiều phòng vẫn chỉ dùng dưới khoảng 30% một lõi.
- **Chưa đo trong lần này:**
  - Người đi lại liên tục: gửi vị trí 10 lần/giây, nặng hơn người ngồi yên. Thường chỉ xảy ra vài phút lúc vào phòng tìm chỗ.
  - Độ trễ mạng thật giữa Việt Nam và nơi đặt VPS.
  - Video/livestream trên màn hình sân khấu: phát từ YouTube và các nguồn ngoài, không đi qua server.

Chạy lại:

```bash
ALLOW_DEMO_MODE=1 DATABASE_URL= NODE_ENV=production TRUST_PROXY=1 PORT=3100 PUBLIC_ORIGIN=http://localhost:3100 node node_modules/tsx/dist/cli.mjs server/index.ts
BASE=http://localhost:3100 SERVER_PID=<pid node con của server> STEPS=100,250,500,1000,1500 HOLD=45 node scripts/load-test.mjs
BASE=http://localhost:3100 SERVER_PID=<pid> PER_ROOM=500 STEPS=250,500 HOLD=40 node scripts/load-test.mjs
```
