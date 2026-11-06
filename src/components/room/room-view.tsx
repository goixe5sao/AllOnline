"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildLayout, MAP_INFO, type AvatarGroup, type Layout } from "@/core/maps";
import { api, fmtDuration } from "@/lib/api";
import type { PollViewDto } from "@/core/protocol";
import { hourIndex, ringBell, unlockAudio, vnHourLabel } from "./bell";
import { PITCH_RANGE, RoomScene, type Controls } from "./scene";
import { ScreenContent } from "./screen-content";
import { OwnerPanel } from "./owner-panel";
import { QaPanel, ReactionStream } from "./engage";
import { AlienOrb } from "./orb-menu";
import { useRoom } from "./use-room";
import { LiveAudio, LivePanel, useLivePublisher, useLiveViewer } from "./live";
import { DEMO_OVER_TEXT, DemoClock, DemoOver, type Mission } from "./demo";

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
    avatar: typeof window === "undefined" ? null : readSession<{ group: AvatarGroup; model: string; color?: string }>(`ao-avatar-${roomId}`),
    // The room owner chose "attend as a participant" on the invite page.
    asParticipant: typeof window !== "undefined" && sessionStorage.getItem(`ao-mode-${roomId}`) === "participant",
    // "Phòng trải nghiệm": the visitor chose "Vào làm chủ phòng" on the invite page
    demoHost: typeof window !== "undefined" && sessionStorage.getItem(`ao-demo-host-${roomId}`) === "1",
  }));
  const { session: s, store, send, serverNow, leave } = useRoom(roomId, boot);
  // Live camera: watching whoever is on air, and this device's own camera when broadcasting.
  const selfId = s.you?.userId ?? "";
  const liveView = useLiveViewer(roomId, s.live, selfId);
  const pub = useLivePublisher(roomId, send);
  const onAirSelf = !!s.live?.onAir && s.live.onAir.userId === selfId;
  // Demo host: the to-do list ticks as things get done
  const isDemoHost = !!s.demo && s.demo.hostId === selfId && !!selfId;
  const [missions, setMissions] = useState<Set<Mission>>(() => new Set());
  const tick = (k: Mission) => setMissions((m) => (m.has(k) ? m : new Set([...m, k])));
  const scrKind = s.screen.content.kind;
  const lightsNow = s.room?.stageLights;
  const [lights0, setLights0] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!isDemoHost) return;
    if (scrKind === "youtube") tick("youtube");
    if (scrKind === "chart") tick("chart");
  }, [isDemoHost, scrKind]);
  useEffect(() => {
    if (!isDemoHost || lightsNow === undefined) return;
    if (lights0 === undefined) setLights0(lightsNow);
    else if (lights0 !== lightsNow) tick("lights");
  }, [isDemoHost, lightsNow, lights0]);
  useEffect(() => {
    if (isDemoHost && s.polls.length) tick("poll");
  }, [isDemoHost, s.polls.length]);
  useEffect(() => {
    if (isDemoHost && pub.preview) tick("camera");
  }, [isDemoHost, pub.preview]);
  // Cut by a moderator / replaced / live switched off: stop the camera here too.
  const pubLive = pub.state === "live";
  const pubStop = pub.stop;
  useEffect(() => {
    if (pubLive && s.live && !onAirSelf) pubStop(false);
  }, [pubLive, onAirSelf, s.live, pubStop]);
  const controls = useRef<Controls>({ yaw: 0, pitch: 0, fov: 60, keys: new Set(), joy: { x: 0, y: 0 } });
  const [wrap, setWrap] = useState<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [fullView, setFullView] = useState(false);
  const [panel, setPanel] = useState<"owner" | "seats" | "qa" | "live" | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [gfx, setGfx] = useState<"lite" | "full" | "ultra">("full");
  // Graphics levels only exist for the "Hành tinh tương lai" stage; a "Đơn sắc" room is one simple
  // look for everyone (the viewer's saved choice comes back when the owner switches the stage).
  const glamRoom = s.room?.stageStyle === "glam";
  const gfxOn = glamRoom ? gfx : "full";
  const lite = gfxOn === "lite";
  // After an automatic fall-back, choosing "Siêu đẹp" again means "keep it": no more watchdog.
  const [gfxDropped, setGfxDropped] = useState(false);
  const [gfxForced, setGfxForced] = useState(false);
  const chooseGfx = (v: "lite" | "full" | "ultra") => {
    if (v === "ultra" && gfxDropped) setGfxForced(true);
    setGfx(v);
    try {
      localStorage.setItem("ao-gfx", v);
    } catch {}
  };
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(true);
  const [chatText, setChatText] = useState("");
  const [nearSeat, setNearSeat] = useState<string | null>(null);
  const [touch, setTouch] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const now = useNow(1000);
  const fullRef = useRef<HTMLDivElement>(null);
  // Tapped free seat (popup with "Đến") and the seat we are walking to.
  const [seatPick, setSeatPick] = useState<{ id: string; x: number; y: number } | null>(null);
  const [goingTo, setGoingTo] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const onSeatClick = useCallback((id: string, x: number, y: number) => setSeatPick({ id, x, y }), []);
  const personalStatus = s.personal?.status;
  const goToSeat = (id: string) => {
    const target = layout?.seats.find((x) => x.id === id);
    if (personalStatus === "seated") send({ t: "change_seat", seatId: id });
    else if (personalStatus === "finding" && target) {
      controls.current.goto = { x: target.x, z: target.z, seatId: target.id };
      setGoingTo(target.id);
    } else setNote(personalStatus === "invited" ? "Hãy bấm “Nhận chỗ” trước." : "Bạn đang chờ ngoài cổng, chưa được vào khu chính.");
    setSeatPick(null);
  };
  useEffect(() => {
    if (personalStatus !== "finding") setGoingTo(null);
    if (personalStatus !== "finding" && controls.current) controls.current.goto = null;
  }, [personalStatus, s.personal?.seatId]);
  useEffect(() => {
    if (!goingTo) return;
    // Manual movement cancels auto-walk inside the render loop; drop the highlight too.
    const id = setInterval(() => !controls.current.goto && setGoingTo(null), 400);
    return () => clearInterval(id);
  }, [goingTo]);
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(id);
  }, [note]);

  // ---- hourly mindfulness bell (every hh:00, by server clock) ----
  const [bellOn, setBellOn] = useState(true);
  const [bellToast, setBellToast] = useState<string | null>(null);
  const bellRef = useRef({ on: true, volume: 80 });
  bellRef.current = { on: bellOn, volume };
  useEffect(() => {
    try {
      setBellOn(localStorage.getItem("ao-bell") !== "0");
    } catch {}
    // Audio may only start after a user gesture.
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  useEffect(() => {
    let last = hourIndex(serverNow());
    const id = setInterval(() => {
      const t = serverNow();
      const idx = hourIndex(t);
      if (idx > last) {
        last = idx;
        if (!bellRef.current.on) return;
        ringBell(bellRef.current.volume / 100);
        setBellToast("🔔 Chuông tỉnh thức · " + vnHourLabel(idx * 3_600_000));
        setTimeout(() => setBellToast(null), 8000);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [serverNow]);

  useEffect(() => {
    try {
      const g = localStorage.getItem("ao-gfx");
      if (g === "lite" || g === "full" || g === "ultra") setGfx(g);
      else if (localStorage.getItem("ao-lite") === "1") setGfx("lite"); // older setting
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
  const handSet = useMemo(() => new Set(s.hands.map((h) => h.userId)), [s.hands]);

  // Default: the view from behind (own avatar + screen); ↑ / the HUD button for the own eyes.
  const [behind, setBehind] = useState(true);
  useEffect(() => {
    controls.current.behind = behind;
  }, [behind]);
  const movableRef = useRef(false);
  movableRef.current = !!movable;

  // keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      controls.current.keys.add(e.key.toLowerCase());
      // While walking, ↓/↑ move; otherwise they switch between own view and the view from behind.
      if (!movableRef.current && !e.repeat) {
        if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") setBehind(true);
        if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") setBehind(false);
      }
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
      c.pitch = Math.max(-PITCH_RANGE, Math.min(PITCH_RANGE, c.pitch - (e.clientY - prev.y) * 0.003));
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
          {(s.endReason === DEMO_OVER_TEXT || s.endReason?.includes("thời gian trải nghiệm")) && <DemoOver />}
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
    expiresAt: s.room.openEnded ? null : s.room.expiresAt,
    warningMinutes: s.settings?.warningMinutes ?? [30, 10, 1],
    volume,
    muted,
    reduceMotion,
    ad: s.ad,
    onEnded: (rev: number) => send({ t: "screen_ended", rev }),
    live: s.live?.onAir ? (onAirSelf ? (pub.preview ? { stream: pub.preview, name: s.live.onAir.name, mirror: true } : null) : liveView.stream ? { stream: liveView.stream, name: s.live.onAir.name } : null) : null,
  };
  const p = s.personal;
  const remaining = s.room.openEnded ? Infinity : s.room.expiresAt - (now + (serverNow() - Date.now()));
  const warnWindow = Math.max(0, ...(s.settings?.warningMinutes ?? [30])) * 60_000;
  const openPoll = [...s.polls].reverse().find((x) => x.status === "open") ?? null;
  const canModerate = s.you.isRoomOwner || s.you.isModerator;
  const handUp = handSet.has(s.you.userId);
  const openQuestions = s.questions.filter((q) => q.status === "open").length;

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
          ultra={gfxOn === "ultra"}
          onSlow={
            gfxForced
              ? undefined
              : () => {
                  setGfx("full"); // not saved: the viewer's choice stays for next time
                  setGfxDropped(true);
                  setNote("Máy hơi chậm với đồ hoạ Siêu đẹp — đã tạm chuyển về Đầy đủ. Bấm Siêu đẹp lần nữa để giữ nguyên.");
                }
          }
          paused={fullView}
          domElement={wrap}
          portal={wrapRef}
          highlightFree={me?.status === "finding"}
          ad={s.ad}
          selectedSeat={seatPick?.id ?? goingTo}
          behindView={isParticipant && behind}
          hands={handSet}
          stageStyle={s.room.stageStyle}
          stageLights={s.room.stageLights}
          onSeatClick={onSeatClick}
          onSeatDoubleClick={s.you.isRoomOwner ? goToSeat : undefined}
          screen={<ScreenContent {...screenProps} active={!fullView} />}
        />
      </div>

      {/* Over the 3D view only a small status pill; every function lives in the alien orb. */}
      <div className="hud-top hud-status">
        <span className="hud-pill" title={MAP_INFO[s.room.map].name}>
          <b className="title">{s.room.name}</b>
          {isParticipant && me?.status === "seated" && <span className="hud-pill-sub">· Chỗ {me.seatId}</span>}
          {s.room.isTrial && <span className="hud-pill-sub hide-mobile">· Dùng thử</span>}
        </span>
        {s.conn === "reconnecting" && (
          <span className="hud-chip" style={{ color: "#f0b860" }} title="Mất kết nối — đang thử lại, chỗ của bạn được giữ tạm">
            ⚠ Đang kết nối lại
          </span>
        )}
        {remaining < warnWindow && (
          <span className="hud-chip" style={{ color: "#ff9a8f" }}>
            ⏳ {fmtDuration(remaining)}
          </span>
        )}
        {s.role === "observer" && <span className="hud-chip">Quan sát</span>}
        {s.demo && <DemoClock demo={s.demo} waiting={me?.status === "waiting"} isHost={isDemoHost} />}
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
        {chatOpen ? (
          <div className="chat-box">
            <div className="row between" style={{ alignItems: "center" }}>
              <small style={{ opacity: 0.8 }}>Chat với người trong bán kính {s.settings?.chatRadius ?? 8} m · không lưu</small>
              <button className="hud-btn chat-close" onClick={() => setChatOpen(false)} aria-label="Đóng chat">
                ✕
              </button>
            </div>
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
              <input autoFocus value={chatText} onChange={(e) => setChatText(e.target.value)} maxLength={s.settings?.chatMaxLength ?? 200} placeholder="Chat với người ở gần…" aria-label="Tin nhắn chat gần" />
              <button className="hud-btn">Gửi</button>
            </form>
          </div>
        ) : (
          // closed chat: new messages float up briefly, then fade
          <div className="chat-toasts" aria-live="polite">
            {s.chat
              .filter((c) => now - c.at < 8000)
              .slice(-3)
              .map((c) => (
                <div className="msg" key={c.id}>
                  <b>{c.name}</b>
                  {c.text}
                </div>
              ))}
          </div>
        )}
        <span style={{ flex: 1 }} />
        {isParticipant && openPoll && <ParticipantPoll poll={openPoll} myVote={s.myVotes[openPoll.id]} onVote={(o) => send({ t: "vote", pollId: openPoll.id, optionId: o })} isGuest={s.you.isGuest} />}
      </div>
      {moreOpen && (
        <div className="hud-menu orb-settings" role="dialog" aria-label="Cài đặt">
          <div className="row between" style={{ alignItems: "center" }}>
            <strong>Cài đặt</strong>
            <button className="hud-btn chat-close" onClick={() => setMoreOpen(false)} aria-label="Đóng cài đặt">
              ✕
            </button>
          </div>
          <label className="hud-menu-row">
            <span>🔊 Âm lượng</span>
            <input type="range" min={0} max={100} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Âm lượng" />
          </label>
          {glamRoom && (
          <div className="hud-menu-row" role="radiogroup" aria-label="Đồ hoạ">
            <span>✨ Đồ hoạ</span>
            <span className="gfx-seg">
              {(
                [
                  ["lite", "Nhẹ", "Ít hiệu ứng, cho máy yếu"],
                  ["full", "Đầy đủ", "Mặc định"],
                  ["ultra", "Siêu đẹp", "Đèn toả sáng thật — cần máy khoẻ, tự hạ về Đầy đủ nếu máy quá chậm"],
                ] as const
              ).map(([v, t, d]) => (
                <button key={v} type="button" role="radio" aria-checked={gfx === v} className={gfx === v ? "on" : ""} title={d} onClick={() => chooseGfx(v)}>
                  {t}
                </button>
              ))}
            </span>
          </div>
          )}
          <button
            role="menuitemcheckbox"
            aria-checked={bellOn}
            className="hud-menu-row"
            onClick={() => {
              const v = !bellOn;
              setBellOn(v);
              try {
                localStorage.setItem("ao-bell", v ? "1" : "0");
              } catch {}
              if (v) {
                unlockAudio();
                setTimeout(() => ringBell(volume / 100), 50); // preview
              }
            }}
          >
            <span>{bellOn ? "🔔" : "🔕"} Chuông mỗi giờ</span>
            <b>{bellOn ? "Bật" : "Tắt"}</b>
          </button>
          {s.you.isRoomOwner && (
            <button
              className="hud-menu-row"
              onClick={async () => {
                if (isParticipant) {
                  sessionStorage.removeItem(`ao-mode-${roomId}`);
                  leave();
                  window.location.reload();
                } else {
                  const r = await api<{ room: { invite_code: string } }>(`/api/rooms/${roomId}`);
                  window.location.href = `/join/${r.room.invite_code}`;
                }
              }}
            >
              <span>{isParticipant ? "🎥 Về chế độ chủ phòng (camera tự do)" : "🪑 Ngồi như khách"}</span>
            </button>
          )}
          <small className="hud-menu-note">
            Phím: M mở quả cầu · ↑ góc của tôi · ↓ xem từ sau
            {s.role === "owner" ? " · Camera tự do: kéo để xoay, chuột phải để dời, cuộn để zoom, nhấn đúp để đến vị trí" : ""}
          </small>
        </div>
      )}
      {!fullView && (
        <AlienOrb
          badge={canModerate ? s.hands.length : 0}
          onReact={s.role !== "observer" ? (e) => send({ t: "react", e }) : undefined}
          items={[
            { id: "chat", icon: "💬", label: "Chat", onClick: () => setChatOpen(!chatOpen), active: chatOpen },
            ...(isParticipant ? [{ id: "hand", icon: "✋", label: handUp ? "Hạ tay" : "Giơ tay", onClick: () => send({ t: "hand", up: !handUp }), active: handUp }] : []),
            { id: "qa", icon: "❓", label: "Hỏi đáp", onClick: () => setPanel(panel === "qa" ? null : "qa"), active: panel === "qa", badge: openQuestions },
            { id: "screen", icon: "📺", label: "Xem màn hình", onClick: openFull },
            ...(isParticipant ? [{ id: "view", icon: behind ? "👁" : "🎥", label: behind ? "Góc của tôi" : "Xem từ sau", onClick: () => setBehind(!behind), active: !behind, stay: true }] : []),
            { id: "sound", icon: muted ? "🔇" : "🔊", label: muted ? "Bật tiếng" : "Tắt tiếng", onClick: () => setMuted(!muted), active: !muted, stay: true },
            ...(canModerate ? [{ id: "lights", icon: s.room.stageLights ? "💡" : "🌑", label: s.room.stageLights ? "Tắt đèn sân khấu" : "Bật đèn sân khấu", onClick: () => send({ t: "stage_lights", on: !s.room!.stageLights }), active: s.room.stageLights, stay: true }] : []),
            ...(s.live && (s.live.mode !== "off" || canModerate) && (isParticipant || canModerate) ? [{ id: "live", icon: onAirSelf ? "🔴" : "🎥", label: onAirSelf ? "Đang live" : "Live camera", onClick: () => setPanel(panel === "live" ? null : "live"), active: panel === "live" || onAirSelf }] : []),
            ...(canModerate ? [{ id: "control", icon: "🎬", label: "Điều khiển", onClick: () => setPanel(panel === "owner" ? null : "owner"), active: panel === "owner", badge: s.hands.length }] : []),
            ...(isParticipant && s.room.entryMode === "auto_assign" && me?.status === "seated" ? [{ id: "seats", icon: "💺", label: "Đổi chỗ", onClick: () => setPanel(panel === "seats" ? null : "seats"), active: panel === "seats" }] : []),
            { id: "settings", icon: "⚙️", label: "Cài đặt", onClick: () => setMoreOpen(!moreOpen), active: moreOpen },
            {
              id: "leave",
              icon: "🚪",
              label: "Rời phòng",
              onClick: () => {
                leave();
                window.location.href = "/";
              },
            },
          ]}
        />
      )}
      <ReactionStream store={store} muted={muted} volume={volume} reduceMotion={reduceMotion} />

      {seatPick && (
        <div className="status-card" style={{ top: Math.max(56, seatPick.y - 110), left: seatPick.x, transform: "translateX(-50%)", width: 220 }} role="dialog" aria-label="Chọn chỗ">
          <strong>Chỗ {seatPick.id}</strong> <span style={{ color: "#3ddc97" }}>· trống</span>
          <div className="row" style={{ justifyContent: "center", marginTop: 8 }}>
            <button
              className="hud-btn primary"
              onClick={() => goToSeat(seatPick.id)}
            >
              Đến
            </button>
            <button className="hud-btn" onClick={() => setSeatPick(null)}>
              Huỷ
            </button>
          </div>
        </div>
      )}
      {bellToast && (
        <div className="status-card" role="status" style={{ top: 110 }}>
          {bellToast}
          <div style={{ fontSize: 12, opacity: 0.8 }}>Hít thở sâu và trở về với hiện tại.</div>
        </div>
      )}
      {note && (
        <div className="status-card" style={{ top: "auto", bottom: 170 }} role="alert" onClick={() => setNote(null)}>
          {note}
        </div>
      )}
      {s.toast && (
        <div className="status-card" style={{ top: "auto", bottom: 120 }} role="alert">
          {s.toast}
        </div>
      )}

      {panel === "owner" && canModerate && (
        <OwnerPanel
          send={send}
          screen={s.screen}
          serverNow={serverNow}
          polls={s.polls}
          members={members}
          room={s.room}
          chat={s.chat}
          hands={s.hands}
          isOwner={s.you.isRoomOwner}
          selfId={s.you.userId}
          onClose={() => setPanel(null)}
          live={s.live}
          onOpenCamera={() => setPanel("live")}
          demo={isDemoHost && !s.you.isRoomOwner ? { missions } : null}
        />
      )}
      {panel === "live" && s.live && <LivePanel live={s.live} selfId={s.you.userId} isMod={canModerate} send={send} pub={pub} onClose={() => setPanel(null)} previewOnly={!!s.demo && !s.you.isRoomOwner} />}
      <LiveAudio stream={onAirSelf ? null : liveView.stream} volume={volume} muted={muted} />
      {panel === "qa" && (
        <QaPanel
          questions={s.questions}
          myVotes={s.myQuestionVotes}
          selfId={s.you.userId}
          canAsk={s.role !== "observer"}
          isMod={canModerate}
          send={send}
          onClose={() => setPanel(null)}
        />
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
