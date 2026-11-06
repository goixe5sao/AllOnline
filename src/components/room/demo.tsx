"use client";

/** "Phòng trải nghiệm" bits inside the room: time left, the end screen, the host's to-do list. */
import Link from "next/link";
import { useEffect, useState } from "react";
import type { DemoDto } from "@/core/demo";

export const DEMO_OVER_TEXT = "Bạn đã dùng hết thời gian trải nghiệm hôm nay (5 phút mỗi ngày) — nhường chỗ cho người tiếp theo nhé.";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, "0")}`;

/** "⏳ Còn 4:35" — counts down while you are in the room (paused in the waiting area, like the server). */
export function DemoClock({ demo, waiting, isHost }: { demo: DemoDto; waiting: boolean; isHost: boolean }) {
  const [left, setLeft] = useState(demo.leftSec);
  const [from, setFrom] = useState(demo);
  if (from !== demo) {
    setFrom(demo);
    setLeft(demo.leftSec);
  }
  useEffect(() => {
    if (waiting || demo.unlimited) return;
    const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(t);
  }, [waiting, demo.unlimited]);
  if (demo.unlimited) return null;
  return (
    <span className={`hud-chip demo-clock ${left <= 60 ? "low" : ""}`} title="Thời gian trải nghiệm còn lại hôm nay">
      {isHost ? "👑 Chủ phòng trải nghiệm · " : "🎟 Trải nghiệm · "}⏳ {waiting ? "tạm dừng khi chờ" : `còn ${mmss(left)}`}
    </span>
  );
}

/** Shown when the day's minutes are used up: what next. */
export function DemoOver() {
  return (
    <div className="stack demo-over">
      <p>Hy vọng bạn đã thấy Sân Khấu Online hoạt động thế nào! Để dùng không giới hạn:</p>
      <Link className="btn primary" href="/login?mode=signup&next=%2Frooms%2Fnew">
        🎁 Mở phòng dùng thử miễn phí của riêng bạn
      </Link>
      <Link className="btn" href="/#trai-nghiem">
        Xem phòng trải nghiệm khác
      </Link>
    </div>
  );
}

export type Mission = "youtube" | "chart" | "poll" | "lights" | "camera";
export const MISSIONS: [Mission, string][] = [
  ["youtube", "Chiếu một video YouTube (tab Màn hình → Video YouTube)"],
  ["chart", "Đưa biểu đồ VNINDEX lên màn hình"],
  ["poll", "Tạo một bình chọn (tab Bình chọn)"],
  ["lights", "Bật / tắt đèn sân khấu (quả cầu → 💡)"],
  ["camera", "Xem thử camera của bạn (quả cầu → 🎥)"],
];

/** The host's to-do list for 5 minutes; ticks as things are done. */
export function DemoMissions({ done }: { done: Set<Mission> }) {
  return (
    <div className="demo-missions">
      <strong>🎯 Thử ngay ({done.size}/{MISSIONS.length})</strong>
      <ul>
        {MISSIONS.map(([k, label]) => (
          <li key={k} className={done.has(k) ? "done" : ""}>
            {done.has(k) ? "✅" : "⬜"} {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
