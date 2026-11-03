"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildLayout, MAP_INFO, type AvatarGroup, type Layout } from "@/core/maps";
import { fmtDuration } from "@/lib/api";
import type { PollViewDto } from "@/core/protocol";
import { RoomScene, type Controls } from "./scene";
import { ScreenContent } from "./screen-content";
import { OwnerPanel } from "./owner-panel";
import { useRoom } from "./use-room";

function readSession<T>(key: string): T | null {
  try {
    const v = sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function useNow(ms = 1000) {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setN(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}

function Joystick({ controls }: { controls: React.RefObject<Controls> }) {
  const knob = useRef<HTMLDivElement>(null);
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const set = (x: number, y: number) => {
    controls.current.joy = { x, y };
    if (knob.current) knob.current.style.transform = `translate(${x * 35}px, ${y * 35}px)`;
  };
  return (
    <div
      className="joystick"
      aria-label="Cần điều khiển di chuyển"
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const r = e.currentTarget.getBoundingClientRect();
        origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        const o = origin.current;
        if (!o || o.id !== e.pointerId) return;
        const dx = (e.clientX - o.x) / 50;
        const dy = (e.clientY - o.y) / 50;
        const len = Math.max(1, Math.hypot(dx, dy));
        set(dx / len, dy / len);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        origin.current = null;
        set(0, 0);
      }}
      onPointerCancel={() => {
        origin.current = null;
        set(0, 0);
      }}
    >
      <div className="knob" ref={knob} />
    </div>
  );
}

function SeatPicker({ layout, occupied, mySeat, onPick, onClose }: { layout: Layout; occupied: Set<string>; mySeat: string | null; onPick: (id: string) => void; onClose: () => void }) {
  const xs = layout.seats.map((s) => s.x);
  const zs = layout.seats.map((s) => s.z);
  const minX = Math.min(...xs, -layout.screen.width / 2) - 2;
  const maxX = Math.max(...xs, layout.screen.width / 2) + 2;
  const minZ = layout.screen.z - 1;
  const maxZ = Math.max(...zs) + 2;
  const r = layout.map === "drive_in" ? 1.2 : 0.4;
  return (
    <aside className="side-panel" aria-label="Chọn chỗ khác">
      <div className="row between">
        <strong>Đổi chỗ — chọn chỗ trống (xanh)</strong>
        <button className="hud-btn" onClick={onClose}>
          ✕
        </button>
      </div>
      <svg className="minimap" viewBox={`${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}`}>
        <rect x={layout.screen.x - layout.screen.width / 2} y={layout.screen.z - 0.3} width={layout.screen.width} height={0.6} fill="#dfe8ff" />
        {layout.seats.map((s) => {
          const mine = s.id === mySeat;
          const taken = occupied.has(s.id) && !mine;
          return (
            <g key={s.id} className="seat" onClick={() => !taken && !mine && onPick(s.id)} role="button" aria-label={`Chỗ ${s.id}${taken ? " (có người)" : ""}`}>
              <circle cx={s.x} cy={s.z} r={r} fill={mine ? "#f0b860" : taken ? "#5b6670" : "#3ddc97"} />
            </g>
          );
        })}
      </svg>
      <small>Màu vàng: chỗ của bạn. Máy chủ kiểm tra lại khi bạn chọn; nếu người khác vừa lấy, bạn sẽ được báo.</small>
    </aside>
  );
}

function ParticipantPoll({ poll, myVote, onVote, isGuest }: { poll: PollViewDto; myVote?: string; onVote: (o: string) => void; isGuest: boolean }) {
  const locked = poll.verifiedOnly && isGuest;
  return (
    <div className="hud-chip" style={{ borderRadius: 12, padding: 10, maxWidth: 320 }}>
      <strong>{poll.question}</strong>
      <div className="stack" style={{ gap: 6, marginTop: 6 }}>
        {poll.options.map((o) => (
          <button key={o.id} className={`hud-btn ${myVote === o.id ? "primary" : ""}`} onClick={() => onVote(o.id)} disabled={poll.status !== "open" || locked} style={{ textAlign: "left" }}>
            {o.label}
            {(myVote || poll.status === "closed" || locked) && ` — ${o.votes} (${o.pct}%)`}
          </button>
        ))}
      </div>
      {locked && (
        <div style={{ fontSize: 12, margin: "6px 0" }}>
          Bình chọn này chỉ dành cho tài khoản đã đăng ký. <a href="/login" target="_blank" style={{ color: "#9fe0c4" }}>Đăng nhập</a> để bình chọn.
        </div>
      )}
      <small>
        {poll.totalVoters} người đã vote · {poll.status === "open" ? "có thể đổi đáp án đến khi đóng" : "đã đóng"}
      </small>
    </div>
  );
}

export function RoomView({ roomId }: { roomId: string }) {
  const [boot] = useState(() => ({
    pass: typeof window === "undefined" ? null : sessionStorage.getItem(`ao-pass-${roomId}`),
    avatar: typeof window === "undefined" ? null : readSession<{ group: AvatarGroup; model: string }>(`ao-avatar-${roomId}`),
  }));
  const { session: s, store, send, serverNow, leave } = useRoom(roomId, boot);
  const controls = useRef<Controls>({ yaw: 0, pitch: 0, fov: 60, keys: new Set(), joy: { x: 0, y: 0 } });
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [fullView, setFullView] = useState(false);
  const [panel, setPanel] = useState<"owner" | "seats" | null>(null);
  const [lite, setLite] = useState(false);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(true);
  const [chatText, setChatText] = useState("");
  const [nearSeat, setNearSeat] = useState<string | null>(null);
  const [touch, setTouch] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const now = useNow(1000);
  const fullRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setLite(localStorage.getItem("ao-lite") === "1");
    } catch {}
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const layout = useMemo(() => (s.room ? buildLayout(s.room.map, s.room.officialCapacity) : null), [s.room?.map, s.room?.officialCapacity]); // eslint-disable-line react-hooks/exhaustive-deps
  const me = s.you ? store.map.get(s.you.userId) : undefined;
  const isParticipant = s.role === "participant";
  const movable = isParticipant && me && (me.status === "finding" || me.status === "waiting");
  const members = useMemo(() => [...store.map.values()], [s.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const occupied = useMemo(() => new Set(members.filter((m) => m.status === "seated" && m.seatId).map((m) => m.seatId!)), [members]);

  // keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      controls.current.keys.add(e.key.toLowerCase());
      if (e.key === "Escape") setFullView(false);
    };
    const up = (e: KeyboardEvent) => controls.current.keys.delete(e.key.toLowerCase());
    const blur = () => controls.current.keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // look around (drag) and zoom (wheel / pinch) for participants
  useEffect(() => {
    if (!wrap || !isParticipant) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const move = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = controls.current;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) c.fov = Math.max(25, Math.min(75, c.fov - (d - pinch) * 0.08));
        pinch = d;
        return;
      }
      c.yaw -= (e.clientX - prev.x) * 0.004;
      c.pitch = Math.max(-0.7, Math.min(0.7, c.pitch - (e.clientY - prev.y) * 0.004));
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      controls.current.fov = Math.max(25, Math.min(75, controls.current.fov + e.deltaY * 0.02));
    };
    wrap.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    wrap.addEventListener("wheel", wheel, { passive: false });
    return () => {
      wrap.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      wrap.removeEventListener("wheel", wheel);
    };
  }, [wrap, isParticipant]);

  // nearest free seat for "Vào chỗ" (gate mode)
  useEffect(() => {
    if (!layout || !me || me.status !== "finding") {
      setNearSeat(null);
      return;
    }
    const id = setInterval(() => {
      const cur = store.map.get(me.userId);
      if (!cur) return;
      let best: string | null = null;
      let bestD = layout.claimDistance;
      for (const seat of layout.seats) {
        if (occupied.has(seat.id)) continue;
        const d = Math.hypot(seat.x - cur.x, seat.z - cur.z);
        if (d <= bestD) {
          bestD = d;
          best = seat.id;
        }
      }
      setNearSeat(best);
    }, 250);
    return () => clearInterval(id);
  }, [layout, me?.status, me?.userId, occupied, store]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFull = useCallback(() => {
    setFullView(true);
    requestAnimationFrame(() => {
      const el = fullRef.current;
      // Browser fullscreen when supported; otherwise the fixed overlay fills the viewport.
      if (el?.requestFullscreen) el.requestFullscreen().catch(() => undefined);
    });
  }, []);
  const closeFull = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    setFullView(false);
  }, []);
  useEffect(() => {
    const onFs = () => !document.fullscreenElement && setFullView(false);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  if (s.conn === "ended")
    return (
      <div className="page page-narrow">
        <div className="card stack">
          <h1>Phiên tham dự đã kết thúc</h1>
          <p>{s.endReason}</p>
          {s.endReason?.includes("tab hoặc thiết bị khác") && (
            <button className="btn primary" onClick={() => window.location.reload()}>
              Dùng ở tab này (tab kia sẽ dừng)
            </button>
          )}
          <Link className="btn" href="/">
            Về trang chính
          </Link>
        </div>
      </div>
    );

  if (!s.room || !layout || !s.you || !s.role)
    return (
      <div className="page page-narrow">
        <p className="muted">{s.conn === "reconnecting" ? "Mất kết nối, đang thử lại…" : "Đang vào phòng…"}</p>
      </div>
    );

  const screenProps = {
    state: s.screen,
    serverNow,
    polls: s.polls,
    roomName: s.room.name,
    expiresAt: s.room.expiresAt,
    warningMinutes: s.settings?.warningMinutes ?? [30, 10, 1],
    volume,
    muted,
    reduceMotion,
    ad: s.ad,
  };
  const p = s.personal;
  const remaining = s.room.expiresAt - (now + (serverNow() - Date.now()));
  const warnWindow = Math.max(0, ...(s.settings?.warningMinutes ?? [30])) * 60_000;
  const openPoll = [...s.polls].reverse().find((x) => x.status === "open") ?? null;

  return (
    <div className="room-root">
      <div
        className="canvas-wrap"
        ref={(el) => {
          wrapRef.current = el;
          setWrap(el);
        }} style={{ visibility: fullView ? "hidden" : "visible" }}>
        <RoomScene
          layout={layout}
          store={store}
          version={s.version}
          bubbleTick={Math.floor(now / 1000)}
          role={s.role}
          selfId={s.you.userId}
          entryMode={s.room.entryMode}
          controls={controls}
          send={send}
          lite={lite}
          paused={fullView}
          domElement={wrap}
          portal={wrapRef}
          highlightFree={me?.status === "finding"}
          ad={s.ad}
          screen={<ScreenContent {...screenProps} active={!fullView} />}
        />
      </div>

      <div className="hud-top">
        <Link className="hud-btn" href="/" onClick={() => leave()} aria-label="Rời phòng">
          ← Rời phòng
        </Link>
        <span className="title">{s.room.name}</span>
        <span className="hud-chip hide-mobile">{MAP_INFO[s.room.map].name}</span>
        {s.conn === "reconnecting" && <span className="hud-chip" style={{ color: "#f0b860" }}>Mất kết nối — đang thử lại, chỗ của bạn được giữ tạm</span>}
        {s.room.isTrial && <span className="hud-chip hide-mobile">Dùng thử</span>}
        {remaining < warnWindow && <span className="hud-chip" style={{ color: "#ff9a8f" }}>Còn {fmtDuration(remaining)}</span>}
        <span style={{ flex: 1 }} />
        <button className="hud-btn" onClick={() => setMuted(!muted)}>
          {muted ? "🔇 Bật tiếng" : "🔊 Tắt tiếng"}
        </button>
        <input type="range" min={0} max={100} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Âm lượng" className="hide-mobile" style={{ width: 90 }} />
        <button className="hud-btn primary" onClick={openFull}>
          Xem màn hình
        </button>
        <button
          className="hud-btn"
          onClick={() => {
            const v = !lite;
            setLite(v);
            try {
              localStorage.setItem("ao-lite", v ? "1" : "0");
            } catch {}
          }}
          aria-pressed={lite}
        >
          {lite ? "Đồ hoạ: nhẹ" : "Đồ hoạ: đầy đủ"}
        </button>
        {s.role === "owner" && (
          <button className="hud-btn primary" onClick={() => setPanel(panel === "owner" ? null : "owner")}>
            Điều khiển
          </button>
        )}
        {isParticipant && s.room.entryMode === "auto_assign" && me?.status === "seated" && (
          <button className="hud-btn" onClick={() => setPanel(panel === "seats" ? null : "seats")}>
            Đổi chỗ
          </button>
        )}
      </div>

      {isParticipant && p && p.status !== "seated" && (
        <div className="status-card" role="status">
          {p.status === "waiting" && (
            <>
              <strong>Bạn đang chờ ngoài cổng</strong>
              <div>
                Vị trí trong hàng chờ: #{p.queuePosition}
                {p.cooldownUntil > serverNow() && ` · có thể được gọi lại sau ${fmtDuration(p.cooldownUntil - serverNow())}`}
              </div>
              <small>Bạn vẫn xem được màn hình, chat với người gần và bình chọn.</small>
            </>
          )}
          {p.status === "invited" && (
            <>
              <strong>Có chỗ trống cho bạn!</strong>
              <div>Còn {fmtDuration((p.deadline ?? 0) - serverNow())} để nhận chỗ.</div>
              <button className="hud-btn primary" onClick={() => send({ t: "accept_invite" })}>
                Nhận chỗ
              </button>
            </>
          )}
          {p.status === "finding" && (
            <>
              <strong>Hãy {me?.avatar.group === "vehicles" ? "lái" : "đi"} đến một chỗ trống (vòng xanh)</strong>
              <div>Thời gian tìm chỗ còn {fmtDuration((p.deadline ?? 0) - serverNow())}. Hết giờ bạn sẽ quay lại khu chờ.</div>
              {nearSeat ? (
                <button className="hud-btn primary" onClick={() => send({ t: "claim", seatId: nearSeat })}>
                  Vào chỗ {nearSeat}
                </button>
              ) : (
                <small>{touch ? "Dùng cần điều khiển bên trái để di chuyển, kéo màn hình để nhìn quanh." : "W A S D / phím mũi tên để di chuyển, kéo chuột để nhìn quanh, cuộn để zoom."}</small>
              )}
            </>
          )}
        </div>
      )}

      {movable && touch && <Joystick controls={controls} />}

      <div className="hud-bottom">
        <div className="chat-box">
          <div className="chat-log" aria-live="polite">
            {s.chat.slice(-8).map((c) => (
              <div className="msg" key={c.id}>
                <b>{c.name}</b>
                {c.text}
              </div>
            ))}
          </div>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              if (chatText.trim()) send({ t: "chat", text: chatText });
              setChatText("");
            }}
          >
            <input value={chatText} onChange={(e) => setChatText(e.target.value)} maxLength={s.settings?.chatMaxLength ?? 200} placeholder="Chat với người ở gần…" aria-label="Tin nhắn chat gần" />
            <button className="hud-btn">Gửi</button>
          </form>
          <span className="chat-note">
            Chỉ người trong bán kính {s.settings?.chatRadius ?? 8} m nhận được. Tin nhắn không được lưu. Không có voice/webcam.
          </span>
        </div>
        <span style={{ flex: 1 }} />
        {isParticipant && openPoll && <ParticipantPoll poll={openPoll} myVote={s.myVotes[openPoll.id]} onVote={(o) => send({ t: "vote", pollId: openPoll.id, optionId: o })} isGuest={s.you.isGuest} />}
        {isParticipant && me?.status === "seated" && <span className="hud-chip">Chỗ {me.seatId}</span>}
        {s.role === "owner" && <span className="hud-chip">Camera tự do: kéo để xoay, chuột phải/hai ngón để di chuyển, cuộn để zoom</span>}
        {s.role === "observer" && <span className="hud-chip">Chủ ứng dụng — chế độ quan sát</span>}
      </div>

      {s.toast && (
        <div className="status-card" style={{ top: "auto", bottom: 120 }} role="alert">
          {s.toast}
        </div>
      )}

      {panel === "owner" && s.role === "owner" && (
        <OwnerPanel send={send} screen={s.screen} serverNow={serverNow} polls={s.polls} members={members} room={s.room} chat={s.chat} onClose={() => setPanel(null)} />
      )}
      {panel === "seats" && me && (
        <SeatPicker
          layout={layout}
          occupied={occupied}
          mySeat={me.seatId}
          onPick={(id) => {
            send({ t: "change_seat", seatId: id });
            setPanel(null);
          }}
          onClose={() => setPanel(null)}
        />
      )}

      {fullView && (
        <div className="fullscreen-view" ref={fullRef}>
          <ScreenContent {...screenProps} active fullscreen />
          <div className="bar">
            <button className="hud-btn" onClick={() => setMuted(!muted)}>
              {muted ? "🔇 Bật tiếng" : "🔊 Tắt tiếng"}
            </button>
            <input type="range" min={0} max={100} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Âm lượng" />
            <button className="hud-btn primary" onClick={closeFull}>
              Thoát xem màn hình
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
