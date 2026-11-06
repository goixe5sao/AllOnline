"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError, fmtTime, useApi, useMe } from "@/lib/api";
import { MAP_INFO, type MapCode } from "@/core/maps";
import { formatVnd } from "@/core/pricing";

interface Bill {
  deposit: number;
  hourlyRate: number;
  billedHours: number;
  charge: number;
  balance: number;
}
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
  is_public: boolean;
  open_ended: boolean;
  live: { admitted: number; seated: number; waiting: number } | null;
  bill: Bill | null;
  settlement: { billed_hours: number; hourly_rate_vnd: number; charge_vnd: number; deposit_vnd: number; balance_vnd: number; status: "refund_due" | "collect_due" | "settled"; note: string } | null;
}

function SettlementLine({ s }: { s: NonNullable<MyRoom["settlement"]> }) {
  const what = s.balance_vnd > 0 ? `hoàn lại cho bạn ${formatVnd(s.balance_vnd)}` : s.balance_vnd < 0 ? `bạn cần trả thêm ${formatVnd(-s.balance_vnd)}` : "không chênh lệch";
  return (
    <p className="mr-bill">
      Quyết toán: {s.billed_hours} giờ × {formatVnd(s.hourly_rate_vnd)} = {formatVnd(s.charge_vnd)}, đã cọc {formatVnd(s.deposit_vnd)} → {what}.{" "}
      <b>{s.status === "settled" ? "Đã xử lý" : s.status === "refund_due" ? "Đang chờ hoàn tiền" : "Chờ thanh toán phần thiếu"}</b>
    </p>
  );
}

/** Closed, expired, or past its end time (the sweeper may not have closed it yet). */
export function roomEnded(r: Pick<MyRoom, "status" | "open_ended" | "expires_at">, now = Date.now()) {
  return r.status !== "open" || (!r.open_ended && new Date(r.expires_at).getTime() <= now);
}

/** Ended rooms stay in the main list only while money is still to be settled (open-ended bill). */
export function splitMyRooms<T extends Pick<MyRoom, "status" | "open_ended" | "expires_at" | "settlement">>(rooms: T[], now = Date.now()) {
  const shown: T[] = [];
  const ended: T[] = [];
  for (const r of rooms) (!roomEnded(r, now) || (r.settlement && r.settlement.status !== "settled") ? shown : ended).push(r);
  return { shown, ended };
}

function MyRoomsList() {
  const { data, reload } = useApi<{ rooms: MyRoom[] }>("/api/rooms/mine", 15_000);
  const [err, setErr] = useState("");
  const [showEnded, setShowEnded] = useState(false);
  if (!data) return <p className="muted-x">Đang tải phòng của bạn…</p>;
  if (!data.rooms.length)
    return (
      <p className="muted-x">
        Bạn chưa có phòng nào. <Link href="/rooms/new">Mở phòng đầu tiên →</Link>
      </p>
    );
  const { shown, ended } = splitMyRooms(data.rooms);
  const list = showEnded ? [...shown, ...ended] : shown;
  return (
    <div className="stack" style={{ gap: 12 }}>
      {!shown.length && (
        <p className="muted-x">
          Không có phòng nào đang mở. <Link href="/rooms/new">Mở phòng mới →</Link>
        </p>
      )}
      <div className="mr-grid">
      {err && <p className="mr-err">{err}</p>}
      {list.map((r) => (
        <article className={`mr ${roomEnded(r) ? "ended" : ""}`} key={r.id}>
          <div className="mr-head">
            <h3>{r.name}</h3>
            <span className={`mr-status ${r.status === "open" ? "on" : ""}`}>{r.status === "open" ? "Đang mở" : r.status === "expired" ? "Hết hạn" : "Đã đóng"}</span>
          </div>
          <p className="mr-meta">
            {MAP_INFO[r.map_code].name} · {r.official_capacity} chỗ + {r.waiting_capacity} chờ {r.is_trial && "· dùng thử"}
            <br />
            {r.open_ended ? "Vô thời hạn — mở đến khi bạn tắt" : `Hết hạn: ${fmtTime(r.expires_at)}`}
            {r.live && ` · ${r.live.admitted} người trong phòng`}
          </p>
          {r.bill && (
            <p className="mr-bill">
              Đến giờ: {r.bill.billedHours} giờ × {formatVnd(r.bill.hourlyRate)} = {formatVnd(r.bill.charge)} / cọc {formatVnd(r.bill.deposit)}
              {r.bill.balance < 0 && <b> · vượt cọc {formatVnd(-r.bill.balance)}</b>}
            </p>
          )}
          {r.settlement && <SettlementLine s={r.settlement} />}
          {r.status === "open" && (
            <div className="mr-actions">
              <Link className="btn-neon small" href={`/room/${r.id}`} onClick={() => sessionStorage.removeItem(`ao-mode-${r.id}`)}>
                Vào điều khiển
              </Link>
              <button className="btn-ghost small" onClick={() => navigator.clipboard?.writeText(`${location.origin}/join/${r.invite_code}`)}>
                Sao chép link mời
              </button>
              <label className="mr-toggle">
                <input
                  type="checkbox"
                  checked={r.is_public}
                  onChange={async (e) => {
                    setErr("");
                    try {
                      await api(`/api/rooms/${r.id}/visibility`, { body: { isPublic: e.target.checked } });
                      reload();
                    } catch (x) {
                      setErr((x as ApiError).message);
                    }
                  }}
                />
                Hiện trên trang chủ
              </label>
            </div>
          )}
          <Link className="mr-log" href={`/room/${r.id}/logs`}>
            Log phòng
          </Link>
        </article>
      ))}
      </div>
      {ended.length > 0 && (
        <button type="button" className="btn-ghost small mr-more" aria-expanded={showEnded} onClick={() => setShowEnded(!showEnded)}>
          {showEnded ? "Ẩn phòng đã kết thúc" : `Xem ${ended.length} phòng đã kết thúc`}
        </button>
      )}
    </div>
  );
}

/** Only for signed-in members: their rooms, visibility switches and open-ended bills. */
export function MyRooms() {
  const { user } = useMe();
  if (!user || user.isGuest) return null;
  return (
    <section className="hs-section" aria-labelledby="my-rooms-h">
      <div className="sec-head">
        <h2 id="my-rooms-h">Phòng của tôi</h2>
        <Link className="btn-neon small" href="/rooms/new">
          + Tạo phòng
        </Link>
      </div>
      <MyRoomsList />
    </section>
  );
}
