"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MAP_INFO, type MapCode } from "@/core/maps";
import type { HomeRoom } from "@/lib/home-data";

const MAP_SHORT: Record<MapCode, string> = { hall: "Hội trường", carpet: "Thảm ngồi", tables: "Khu bàn", drive_in: "Rạp ô tô" };

function RoomCard({ r }: { r: HomeRoom }) {
  const watching = r.live?.admitted ?? 0;
  return (
    <article className="rc">
      <Link href={`/join/${r.inviteCode}`} className="rc-media" aria-label={`Vào phòng ${r.name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- small static preview, already optimised webp */}
        <img src={`/maps/${r.map}.webp`} alt={`Khung cảnh ${MAP_INFO[r.map].name}`} loading="lazy" width={480} height={300} />
        <span className={`rc-live ${watching ? "on" : ""}`}>{watching ? `● ${watching} đang xem` : "● Sẵn sàng"}</span>
        <span className="rc-map">{MAP_SHORT[r.map]}</span>
      </Link>
      <div className="rc-body">
        <h3>
          <Link href={`/join/${r.inviteCode}`}>{r.name}</Link>
        </h3>
        {r.description && <p className="rc-desc">{r.description}</p>}
        <ul className="rc-tags" aria-label="Thông tin phòng">
          <li>{r.officialCapacity} chỗ</li>
          <li>{r.entryMode === "auto_assign" ? "Tự xếp chỗ" : "Vào từ cổng"}</li>
          {r.openEnded ? <li className="t-inf">∞ Vô thời hạn</li> : <li>Đến {new Date(r.expiresAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })}</li>}
          {r.hasPassword && <li className="t-lock">🔒 Có mật mã</li>}
        </ul>
        <div className="rc-foot">
          <span className="rc-owner">Chủ phòng: {r.ownerName}</span>
          <Link className="rc-go" href={`/join/${r.inviteCode}`}>
            Vào xem →
          </Link>
        </div>
      </div>
    </article>
  );
}

/** Public rooms (server-rendered first, then refreshed every 20 s). */
export function LiveRooms({ initial, maps }: { initial: HomeRoom[]; maps: MapCode[] }) {
  const [rooms, setRooms] = useState(initial);
  const [filter, setFilter] = useState<MapCode | "all">("all");
  useEffect(() => {
    const load = () =>
      fetch("/api/rooms/public")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { rooms: HomeRoom[] } | null) => d && setRooms(d.rooms))
        .catch(() => undefined);
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, []);
  const shown = useMemo(() => (filter === "all" ? rooms : rooms.filter((r) => r.map === filter)), [rooms, filter]);
  const counts = useMemo(() => Object.fromEntries(maps.map((m) => [m, rooms.filter((r) => r.map === m).length])), [rooms, maps]);

  return (
    <>
      <div className="chips" role="group" aria-label="Lọc theo kiểu sân khấu">
        <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          Tất cả <span>{rooms.length}</span>
        </button>
        {maps.map((m) => (
          <button key={m} aria-pressed={filter === m} onClick={() => setFilter(m)}>
            {MAP_SHORT[m]} <span>{counts[m] ?? 0}</span>
          </button>
        ))}
      </div>
      {shown.length ? (
        <div className="rc-grid">
          {shown.map((r) => (
            <RoomCard key={r.id} r={r} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <p>
            <strong>{rooms.length ? "Chưa có phòng công khai kiểu này." : "Chưa có phòng công khai nào đang mở."}</strong>
          </p>
          <p>Hãy là người đầu tiên mở sân khấu — chủ phòng tự chọn hiện phòng ở đây hay giữ riêng tư.</p>
          <Link className="btn-neon small" href="/login?mode=signup&next=%2Frooms%2Fnew">
            Mở phòng đầu tiên
          </Link>
        </div>
      )}
    </>
  );
}
