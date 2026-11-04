"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { fmtTime, useApi } from "@/lib/api";
import { MAP_INFO, type MapCode } from "@/core/maps";

interface MyRoom {
  id: string;
  name: string;
  map_code: MapCode;
  status: string;
  official_capacity: number;
  waiting_capacity: number;
  total_slots: number;
  expires_at: string;
  invite_code: string;
  is_trial: boolean;
  live: { admitted: number; seated: number; waiting: number } | null;
}

function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState("");
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        const c = code.trim().split("/").pop();
        if (c) router.push(`/join/${encodeURIComponent(c.toUpperCase())}`);
      }}
    >
      <input type="text" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Mã mời, ví dụ K7QX2MPA" aria-label="Mã mời" style={{ flex: 1, minWidth: 180 }} />
      <button className="btn primary">Vào phòng</button>
    </form>
  );
}

function MyRooms() {
  const { data } = useApi<{ rooms: MyRoom[] }>("/api/rooms/mine", 10_000);
  if (!data) return <p className="muted">Đang tải phòng…</p>;
  if (!data.rooms.length) return <p className="muted">Bạn chưa tạo phòng nào.</p>;
  return (
    <div className="grid grid-2">
      {data.rooms.map((r) => (
        <article className="card" key={r.id}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>{r.name}</h3>
            <span className={`badge ${r.status === "open" ? "ok" : ""}`}>{r.status === "open" ? "Đang mở" : r.status === "expired" ? "Hết hạn" : "Đã đóng"}</span>
          </div>
          <p className="muted" style={{ margin: "6px 0" }}>
            {MAP_INFO[r.map_code].name} · {r.official_capacity} chỗ + {r.waiting_capacity} chờ = {r.total_slots} slot {r.is_trial && <span className="badge warn">dùng thử</span>}
          </p>
          <p className="muted" style={{ margin: "6px 0" }}>
            Hết hạn: {fmtTime(r.expires_at)}
            {r.live && ` · Đang có ${r.live.admitted} người (${r.live.seated} ngồi, ${r.live.waiting} chờ)`}
          </p>
          {r.status === "open" && (
            <div className="row">
              <Link className="btn primary small" href={`/room/${r.id}`} onClick={() => sessionStorage.removeItem(`ao-mode-${r.id}`)}>
                Vào điều khiển
              </Link>
              <button className="btn small" onClick={() => navigator.clipboard?.writeText(`${location.origin}/join/${r.invite_code}`)}>
                Sao chép link mời
              </button>
              <code>{r.invite_code}</code>
            </div>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <Link className="btn small" href={`/room/${r.id}/logs`}>
              Log phòng
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <AppShell>
      {(me) => (
        <div className="stack">
          <section className="card">
            <h1>Mọi người, cùng một không gian.</h1>
            <p className="muted">Phòng 3D với màn hình sân khấu chung, chat với người ở gần và bình chọn trực tiếp. Hỗ trợ máy tính và điện thoại.</p>
            {me && !me.isGuest ? (
              <div className="grid grid-2">
                <div className="stack">
                  <strong>Tham gia phòng bằng mã mời</strong>
                  <JoinByCode />
                </div>
                <div className="stack">
                  <strong>Tổ chức phòng của bạn</strong>
                  <Link className="btn primary" href="/rooms/new">
                    Tạo phòng mới
                  </Link>
                </div>
              </div>
            ) : (
              <div className="grid grid-2">
                <div className="stack">
                  <strong>Có mã mời? Vào ngay, không cần tài khoản</strong>
                  <JoinByCode />
                </div>
                <div className="stack">
                  <strong>Muốn tổ chức phòng?</strong>
                  <Link className="btn primary" href="/login">
                    Đăng nhập / đăng ký
                  </Link>
                </div>
              </div>
            )}
          </section>
          {me && !me.isGuest && (
            <section>
              <h2>Phòng của tôi</h2>
              <MyRooms />
            </section>
          )}
          <section className="grid grid-4">
            {(Object.keys(MAP_INFO) as MapCode[]).map((m) => (
              <div className="card" key={m}>
                <h3>{MAP_INFO[m].name}</h3>
                <p className="muted" style={{ margin: 0 }}>
                  {MAP_INFO[m].description}
                </p>
              </div>
            ))}
          </section>
        </div>
      )}
    </AppShell>
  );
}
