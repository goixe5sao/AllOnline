"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MAP_INFO, type MapCode } from "@/core/maps";
import type { HomeRoom } from "@/lib/home-data";
import { MAP_SHORT, STAGE_COPY } from "./stage-info";
import { vnEventTime } from "@/lib/vn-time";

const PER_PAGE = 6;
const DWELL_MS = 9000;

type Channel = "gioi-thieu" | "phong-dang-mo" | "kieu-san-khau";
interface Frame {
  channel: Channel;
  page: number;
  pages: number;
}

function RoomTile({ r }: { r: HomeRoom }) {
  const watching = r.live?.admitted ?? 0;
  return (
    <Link className="st-room" href={`/join/${r.inviteCode}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- small static webp preview */}
      <img src={`/maps/${r.map}.webp`} alt="" loading="lazy" width={160} height={100} />
      <span className="st-room-body">
        <b>{r.name}</b>
        <span className="st-room-meta">
          {MAP_SHORT[r.map]} · {r.officialCapacity} chỗ{r.openEnded ? " · ∞" : ""}
          {r.hasPassword ? " · 🔒" : ""}
        </span>
        {r.startsAt && !watching ? (
          <span className="st-room-live soon" suppressHydrationWarning>
            🗓 {vnEventTime(r.startsAt)}
          </span>
        ) : (
          <span className={`st-room-live ${watching ? "on" : ""}`}>{watching ? `● ${watching} đang xem` : "● Sẵn sàng"}</span>
        )}
      </span>
      <span className="st-room-go" aria-hidden>
        ›
      </span>
    </Link>
  );
}

/**
 * The stage screen as a slideshow: introduction, open rooms (paged), stage types.
 * Every panel is in the server HTML (SEO); only the active one is visible. Auto-advances,
 * pauses on hover/focus, follows #phong-dang-mo / #kieu-san-khau links.
 */
export function StageSlides({ intro, initialRooms, maps }: { intro: ReactNode; initialRooms: HomeRoom[]; maps: MapCode[] }) {
  const [rooms, setRooms] = useState(initialRooms);
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [tick, setTick] = useState(0); // restarts the progress bar animation
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/rooms/public")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { rooms: HomeRoom[] } | null) => d && setRooms(d.rooms))
        .catch(() => undefined);
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, []);

  const roomPages = Math.max(1, Math.ceil(rooms.length / PER_PAGE));
  const frames: Frame[] = useMemo(
    () => [
      { channel: "gioi-thieu", page: 0, pages: 1 },
      ...Array.from({ length: roomPages }, (_, p) => ({ channel: "phong-dang-mo" as const, page: p, pages: roomPages })),
      { channel: "kieu-san-khau", page: 0, pages: 1 },
    ],
    [roomPages],
  );
  const idx = Math.min(i, frames.length - 1);
  const cur = frames[idx];

  const go = useCallback(
    (n: number, user = true) => {
      setI(((n % frames.length) + frames.length) % frames.length);
      setTick((t) => t + 1);
      if (user) setStopped(true); // the visitor took over: no more auto-advance
    },
    [frames.length],
  );
  const goChannel = useCallback((c: Channel, user = true) => go(frames.findIndex((f) => f.channel === c), user), [frames, go]);

  // auto-advance
  useEffect(() => {
    if (stopped || hold || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setTimeout(() => go(idx + 1, false), DWELL_MS);
    return () => clearTimeout(id);
  }, [idx, hold, stopped, go, tick]);

  // links such as #phong-dang-mo switch the channel
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (h === "phong-dang-mo" || h === "kieu-san-khau" || h === "gioi-thieu") goChannel(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [goChannel]);

  const channels: { id: Channel; label: string }[] = [
    { id: "gioi-thieu", label: "Giới thiệu" },
    { id: "phong-dang-mo", label: `Phòng đang mở · ${rooms.length}` },
    { id: "kieu-san-khau", label: "Kiểu sân khấu" },
  ];
  const show = (c: Channel, page = 0) => cur.channel === c && cur.page === page;

  return (
    <div
      className="st"
      ref={root}
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(e) => !root.current?.contains(e.relatedTarget as Node) && setHold(false)}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        if (e.key === "ArrowRight") go(idx + 1);
        if (e.key === "ArrowLeft") go(idx - 1);
      }}
    >
      <div className="st-bar">
        <span className="st-live" aria-hidden>
          ● LIVE
        </span>
        <div className="st-tabs" role="tablist" aria-label="Kênh trên màn hình sân khấu">
          {channels.map((c) => (
            <button key={c.id} role="tab" id={`tab-${c.id}`} aria-controls={c.id} aria-selected={cur.channel === c.id} onClick={() => goChannel(c.id)}>
              {c.label}
              {cur.channel === c.id && !stopped && <span key={tick} className={`st-progress ${hold ? "held" : ""}`} style={{ animationDuration: `${DWELL_MS}ms` }} aria-hidden />}
            </button>
          ))}
        </div>
        <div className="st-arrows">
          <button onClick={() => go(idx - 1)} aria-label="Slide trước">
            ‹
          </button>
          <button onClick={() => go(idx + 1)} aria-label="Slide sau">
            ›
          </button>
        </div>
      </div>

      <div className="st-stack">
        <section id="gioi-thieu" role="tabpanel" aria-labelledby="tab-gioi-thieu" className={`st-panel ${show("gioi-thieu") ? "on" : ""}`} inert={!show("gioi-thieu")}>
          {intro}
        </section>

        {Array.from({ length: roomPages }, (_, p) => (
          <section
            key={p}
            id={p === 0 ? "phong-dang-mo" : undefined}
            role="tabpanel"
            aria-labelledby="tab-phong-dang-mo"
            className={`st-panel ${show("phong-dang-mo", p) ? "on" : ""}`}
            inert={!show("phong-dang-mo", p)}
          >
            <div className="st-head">
              <h2>Phòng đang mở</h2>
              <p>{rooms.length ? `Chủ phòng chọn hiện ở đây · bấm để vào xem, không cần tài khoản${roomPages > 1 ? ` · trang ${p + 1}/${roomPages}` : ""}` : "Chưa có phòng công khai nào — hãy là người mở màn!"}</p>
            </div>
            {rooms.length ? (
              <div className="st-rooms">
                {rooms.slice(p * PER_PAGE, (p + 1) * PER_PAGE).map((r) => (
                  <RoomTile key={r.id} r={r} />
                ))}
              </div>
            ) : (
              <div className="st-empty">
                <Link className="btn-neon" href="/login?mode=signup&next=%2Frooms%2Fnew">
                  Mở phòng đầu tiên
                </Link>
              </div>
            )}
          </section>
        ))}

        <section id="kieu-san-khau" role="tabpanel" aria-labelledby="tab-kieu-san-khau" className={`st-panel ${show("kieu-san-khau") ? "on" : ""}`} inert={!show("kieu-san-khau")}>
          <div className="st-head">
            <h2>Các kiểu sân khấu</h2>
            <p>Ảnh chụp từ khán phòng thật trong ứng dụng · chọn kiểu khi tạo phòng</p>
          </div>
          <div className="st-types">
            {(Object.keys(MAP_INFO) as MapCode[]).map((m) => (
              <article key={m} className={`st-type ${maps.includes(m) ? "" : "off"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- static webp preview */}
                <img src={`/maps/${m}.webp`} alt={`Ảnh ${MAP_INFO[m].name} trong AllOnline`} loading="lazy" width={480} height={300} />
                <h3>{MAP_INFO[m].name}</h3>
                <p className="st-type-tag">{STAGE_COPY[m].tag}</p>
                <p>{STAGE_COPY[m].fit}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <div className="st-dots" aria-label="Các slide">
        {frames.map((f, k) => (
          <button key={k} aria-label={`Slide ${k + 1}`} aria-current={k === idx} onClick={() => go(k)} />
        ))}
      </div>
    </div>
  );
}
