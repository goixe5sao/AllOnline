"use client";

import { useEffect, useRef, useState } from "react";
import { REACTIONS, REACTION_EMOJI, type Reaction } from "@/core/protocol";

export interface OrbItem {
  id: string;
  icon: string;
  label: string;
  onClick: () => void;
  /** Highlighted (feature currently on / its panel open). */
  active?: boolean;
  /** Small counter (raised hands, open questions). */
  badge?: number;
  /** Keep the orb open after the click (toggles). */
  stay?: boolean;
}

/**
 * The alien orb: one floating sphere that holds every room function. Closed, it is the only
 * control over the 3D view; open, the functions fan out around it on two arcs, and 😊 opens a
 * third arc of reactions. M / Esc toggles it from the keyboard.
 *
 * Drag it anywhere (mouse or finger): the spot is remembered on this device, and the arcs always
 * fan out toward the middle of the screen. A short tap still opens / closes it.
 */
const POS_KEY = "ao-orb-pos";
/** Pointer travel (px) before a press becomes a drag instead of a tap. */
const DRAG_PX = 8;

type Pos = { x: number; y: number }; // orb centre, fractions of the room area (survives rotation / resize)

function readPos(): Pos | null {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
    return v && typeof v.x === "number" && typeof v.y === "number" ? v : null;
  } catch {
    return null;
  }
}
export function AlienOrb({ items, onReact, badge }: { items: OrbItem[]; onReact?: (e: Reaction) => void; badge?: number }) {
  const [open, setOpen] = useState(false);
  const [reacts, setReacts] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [, setTick] = useState(0); // re-layout on resize
  const drag = useRef<{ id: number; sx: number; sy: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);
  useEffect(() => {
    setPos(readPos());
    const r = () => setTick((t) => t + 1);
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);
  const area = () => (root.current?.offsetParent as HTMLElement | null)?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  /** Keep the orb fully on screen (margin = half its size + a little). */
  const clampPx = (x: number, y: number, a: DOMRect) => {
    const m = (root.current?.offsetWidth ?? 66) / 2 + 10;
    return { x: Math.min(a.width - m, Math.max(m, x)), y: Math.min(a.height - m, Math.max(m + 14, y)) };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
    // capture now: a fast mouse leaves the orb before the drag threshold is reached
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_PX) return;
      d.moved = true;
      setOpen(false);
    }
    const a = area();
    const c = clampPx(e.clientX - a.left, e.clientY - a.top, a);
    setPos({ x: c.x / a.width, y: c.y / a.height });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || !d.moved) return;
    justDragged.current = true; // the click that follows a drag must not toggle the menu
    setTimeout(() => (justDragged.current = false), 50);
    setPos((p) => {
      try {
        if (p) localStorage.setItem(POS_KEY, JSON.stringify(p));
      } catch {}
      return p;
    });
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key.toLowerCase() === "m") setOpen((o) => !o);
      if (e.key === "Escape") setOpen(false);
    };
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", away);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", away);
    };
  }, []);
  useEffect(() => {
    if (!open) setReacts(false);
  }, [open]);

  // Arcs in the up-left quarter around the orb (bottom-right corner): 3, 4 and 4 places (+ a 4th arc when needed); the
  // reaction toggle takes the last place of the last arc, reactions get an arc of their own.
  // A 4th arc only when there are more functions (owner attending as a participant).
  const all = onReact ? [...items, null] : items;
  // Arcs open toward the middle of the screen: mirrored when the orb sits on the left / top half.
  let style: React.CSSProperties | undefined;
  let fx = 1;
  let fy = 1;
  if (pos && root.current) {
    const a = area();
    const c = clampPx(pos.x * a.width, pos.y * a.height, a);
    const half = (root.current.offsetWidth || 66) / 2;
    style = { left: c.x - half, top: c.y - half, right: "auto", bottom: "auto" };
    fx = c.x < a.width / 2 ? -1 : 1;
    fy = c.y < a.height / 2 ? -1 : 1;
  }
  const RINGS = [
    { n: 3, r: 1.25 },
    { n: 4, r: 2.1 },
    { n: 4, r: 2.95 },
    ...(all.length > 11 ? [{ n: all.length - 11, r: 3.8 }] : []),
  ];
  const reactR = RINGS[RINGS.length - 1].r + 0.9;
  const slots: { item: OrbItem | null; style: React.CSSProperties }[] = [];
  let k = 0;
  for (const ring of RINGS) {
    const list = all.slice(k, k + ring.n);
    k += ring.n;
    list.forEach((item, i) => slots.push({ item, style: place(i, list.length, ring.r) }));
  }
  function place(i: number, n: number, ring: number) {
    const a0 = Math.PI * 1.04; // just above the horizontal: nothing falls below the screen edge
    const a1 = Math.PI * 1.5;
    const a = n === 1 ? (a0 + a1) / 2 : a0 + ((a1 - a0) * i) / (n - 1);
    // unit offsets × ring factor; the CSS multiplies by --R (smaller on phones)
    return { "--cx": (Math.cos(a) * ring * fx).toFixed(3), "--cy": (Math.sin(a) * ring * fy).toFixed(3), "--d": `${(i + k) * 18}ms` } as React.CSSProperties;
  }
  return (
    <div className={`orb-root ${open ? "open" : ""} ${pos ? "moved" : ""}`} ref={root} style={style}>
      {slots.map(({ item: it, style }) =>
        it ? (
          <button
            key={it.id}
            type="button"
            className={`orb-item ${it.active ? "active" : ""}`}
            style={style}
            aria-label={it.label}
            title={it.label}
            tabIndex={open ? 0 : -1}
            data-orb={it.id}
            onClick={() => {
              it.onClick();
              if (!it.stay) setOpen(false);
            }}
          >
            <span className="orb-ico" aria-hidden>
              {it.icon}
            </span>
            <span className="orb-lbl">{it.label}</span>
            {!!it.badge && <span className="orb-badge">{it.badge}</span>}
          </button>
        ) : (
          <button
            key="react"
            type="button"
            className={`orb-item react-toggle ${reacts ? "active" : ""}`}
            style={style}
            aria-label="Thả cảm xúc"
            title="Thả cảm xúc"
            tabIndex={open ? 0 : -1}
            data-orb="react"
            onClick={() => setReacts(!reacts)}
          >
            <span className="orb-ico" aria-hidden>
              😊
            </span>
            <span className="orb-lbl">Cảm xúc</span>
          </button>
        ),
      )}
      {onReact &&
        reacts &&
        REACTIONS.map((r, i) => (
          <button key={r} type="button" className="orb-item react" style={place(i, REACTIONS.length, reactR)} aria-label={`Thả ${REACTION_EMOJI[r]}`} onClick={() => onReact(r)}>
            <span className="orb-ico" aria-hidden>
              {REACTION_EMOJI[r]}
            </span>
          </button>
        ))}
      <button type="button" className="orb" aria-expanded={open} aria-label={open ? "Đóng menu" : "Mở menu (phím M)"}
        title={open ? "Đóng (Esc)" : "Menu (phím M) · giữ và kéo để di chuyển"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onClick={() => {
          if (!justDragged.current) setOpen(!open);
        }}
      >
        <span className="orb-ring r1" aria-hidden />
        <span className="orb-ring r2" aria-hidden />
        <span className="orb-core" aria-hidden>
          <span className="orb-eye" />
        </span>
        <span className="orb-antenna" aria-hidden />
        {!open && !!badge && <span className="orb-badge">{badge}</span>}
      </button>
    </div>
  );
}
