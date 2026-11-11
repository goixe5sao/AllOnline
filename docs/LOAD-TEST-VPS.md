# Thử tải trên VPS — 11/11/2026

Máy: VPS InterData BF26 Core (5 vCore Xeon Platinum 8272CL, 7.8 GB RAM, NVMe), Ubuntu 24.04.
Kịch bản giống [LOAD-TEST.md](LOAD-TEST.md) (`scripts/load-test.mjs`, khách ảo qua WebSocket).
Server thử là một bản AllOnline **riêng** ở cổng 3100 (chế độ demo, PGlite, không `.env.local`), chạy cùng lúc
với site thật (:3000), StockVN web và `ml.live`. Khách ảo chạy trên chính VPS. "CPU server" = % của 1 lõi.

## Nhiều phòng (30 phòng × 50 người)

| Người xem | Vào được | Lỗi | Độ trễ p50 / p95 / p99 (ms) | Tin gửi/giây | Băng thông ra | RAM server | CPU server |
|---:|---:|---:|---|---:|---:|---:|---:|
| 100 | 100 | 0 | 1 / 1 / 1 | 40 | ~0 MB/s | 562 MB | 2% |
| 250 | 250 | 0 | 0 / 1 / 1 | 138 | 0,02 MB/s | 569 MB | 4% |
| 500 | 500 | 0 | 0 / 1 / 3 | 426 | 0,08 MB/s | 610 MB | 7% |
| 1000 | 1000 | 0 | 0 / 1 / 5 | 1323 | 0,29 MB/s | 695 MB | 10% |
| 1500 | 1500 | 0 | 0 / 3 / 11 | 2768 | 0,63 MB/s | 712 MB | 15% |

2608 tin chat, 3350 lượt bình chọn, không lỗi.

## Một phòng lớn (500 người cùng phòng)

| Người xem | Vào được | Độ trễ p50 / p95 / p99 (ms) | Tin gửi/giây | Băng thông ra | CPU server |
|---:|---:|---|---:|---:|---:|
| 250 | 250 | 0 / 1 / 6 | 1586 | 0,45 MB/s | 6% |
| 500 | 500 | 0 / 9 / 19 | 5917 | 1,78 MB/s | 13% |

## Build trong lúc đang có 1500 người xem

`next build` AllOnline (bản sao riêng) chạy giữa lúc 1500 khách ảo đang ở trong phòng:

- Build mất **22 giây**.
- CPU **toàn VPS** (5 lõi) lúc build cao nhất: **63%** (57% user + 6% sys), còn trống 37%. Hàng chờ CPU tối đa 2.
- Ngoài lúc build: 1500 người chỉ dùng **2–3% CPU toàn VPS**. Lúc 1500 người cùng vào phòng: ~27%.
- Khách ảo: 1500/1500 vào được, 0 lỗi, độ trễ p50/p95/p99 = 0 / 2 / 8 ms.
- Trang chủ site thật (đo mỗi 5 giây): trung vị 0,10 s, chậm nhất 0,82 s (lúc build).

## Kết luận

- VPS dư sức rất nhiều: 1500 người + StockVN chỉ dùng khoảng 1/30 sức CPU; RAM dùng ~1,7 GB / 7,8 GB.
- Build lúc đông người không làm quá tải; site chỉ chậm thoáng qua dưới 1 giây. Deploy (`deploy.sh`) vẫn dừng
  site 20–60 giây, nên làm ngoài giờ đông khách.
- Giới hạn thật sau này sẽ là băng thông ra khi phòng rất đông (500 người/phòng ≈ 15 Mbit/s; VPS 300 Mbit/s).
