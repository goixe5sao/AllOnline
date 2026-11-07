"use client";

/** "Phòng trải nghiệm" bits inside the room: time left, the end screen, the host's to-do list. */
import Link from "next/link";
import { useEffect, useState } from "react";
import type { DemoDto } from "@/core/demo";

export const DEMO_OVER_TEXT = "Hết lượt trải nghiệm. Bạn vào lại ngay được — không giới hạn số lượt.";

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
    <span className={`hud-chip demo-clock ${left <= 60 ? "low" : ""}`} title="Thời gian còn lại của lượt trải nghiệm này (hết lượt thì vào lại)">
      {isHost ? "👑 Chủ phòng trải nghiệm · " : "🎟 Trải nghiệm · "}⏳ {waiting ? "tạm dừng khi chờ" : `còn ${mmss(left)}`}
    </span>
  );
}

/** Shown when a visit's minutes are used up: come back in, or open your own room. */
export function DemoOver() {
  return (
    <div className="stack demo-over">
      <button className="btn primary" onClick={() => window.location.reload()}>
        🔄 Vào lại phòng trải nghiệm
      </button>
      <p>Muốn dùng liền mạch, không bị ngắt giữa chừng? Mở phòng của riêng bạn:</p>
      <Link className="btn" href="/login?mode=signup&next=%2Frooms%2Fnew">
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
  ["camera", "Lên sóng camera cho cả phòng (quả cầu → 📹 Live camera)"],
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
