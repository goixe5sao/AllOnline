"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MAP_INFO, type MapCode } from "@/core/maps";
import type { DemoRoomInfo } from "@/core/demo";

interface DemoList {
  enabled: boolean;
  leftSec: number;
  limitSec: number;
  rooms: DemoRoomInfo[];
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, "0")}`;

/**
 * "🎪 Trải nghiệm ngay": always-open demo rooms — be the host or a guest for a few minutes a day,
 * no account needed. Refreshes every 10 s (who is host, seats taken).
 */
export function DemoRooms() {
  const [data, setData] = useState<DemoList | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/demo")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: DemoList | null) => !stop && d && setData(d))
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 10_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  if (!data?.enabled || !data.rooms.length) return null;
  const out = data.leftSec <= 0;
  return (
    <section className="hs-section demo-sec" id="trai-nghiem" aria-labelledby="demo-h">
      <div className="frame frame-demo">
      <div className="desk-sign">
        <span>TRẢI NGHIỆM NGAY</span>
      </div>
      <div className="frame-window">
      <h2 id="demo-h" className="frame-title">🎪 Thử Sân Khấu Online ngay — không cần tài khoản</h2>
      <p className="muted-x demo-lead">
        Vào phòng mẫu và tự tay làm <b>chủ phòng</b> (chiếu YouTube, đưa biểu đồ chứng khoán lên màn hình, tạo bình chọn, bật tắt đèn sân khấu, thử camera) hoặc làm <b>khách</b> (ngồi ghế, chat với người bên cạnh, thả cảm xúc, giơ tay, đặt câu hỏi).
        Mỗi lượt <b>{Math.round(data.limitSec / 60)} phút</b> — hết lượt vào lại ngay, <b>không giới hạn số lượt</b>.
      </p>
      <div className="demo-grid">
        {data.rooms.map((r) => {
          const hostFree = !r.hostName;
          return (
            <article className="demo-card" key={r.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/maps/${r.map}.webp`} alt={MAP_INFO[r.map as MapCode]?.name ?? r.map} loading="lazy" />
              <div className="demo-body">
                <h3>{r.name}</h3>
                <p className="demo-status">
                  <span>{hostFree ? "👑 Chủ phòng: trống" : `👑 ${r.hostName} đang làm chủ phòng${r.hostLeftSec != null ? ` (còn ${mmss(r.hostLeftSec)})` : ""}`}</span>
                  <span>
                    💺 {r.seated}/{r.seats} chỗ{r.waiting ? ` · ${r.waiting} người chờ` : ""}
                  </span>
                </p>
                <div className="demo-actions">
                  {hostFree && !out ? (
                    <Link className="btn-neon small" href={`/join/${r.inviteCode}?as=host`}>
                      👑 Vào làm chủ phòng
                    </Link>
                  ) : (
                    <span className="btn-ghost small disabled" aria-disabled>
                      👑 Vào làm chủ phòng
                    </span>
                  )}
                  {out ? (
                    <span className="btn-ghost small disabled" aria-disabled>
                      🎟 Vào làm khách
                    </span>
                  ) : (
                    <Link className="btn-ghost small" href={`/join/${r.inviteCode}?as=guest`}>
                      🎟 Vào làm khách
                    </Link>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {out && (
        <p>
          <Link className="btn-neon small" href="/login?mode=signup&next=%2Frooms%2Fnew">
            🎁 Mở phòng dùng thử miễn phí của riêng bạn
          </Link>
        </p>
      )}
      </div>
      </div>
    </section>
  );
}
