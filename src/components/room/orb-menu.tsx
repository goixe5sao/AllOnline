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
 */
export function AlienOrb({ items, onReact, badge }: { items: OrbItem[]; onReact?: (e: Reaction) => void; badge?: number }) {
  const [open, setOpen] = useState(false);
  const [reacts, setReacts] = useState(false);
  const root = useRef<HTMLDivElement>(null);

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

  // Arcs in the up-left quarter around the orb (bottom-right corner): 3, 4 and 4 places; the
  // reaction toggle takes the last place of the last arc, reactions get an arc of their own.
  const RINGS = [
    { n: 3, r: 1.25 },
    { n: 4, r: 2.1 },
    { n: 4, r: 2.95 },
  ];
  const all = onReact ? [...items, null] : items;
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
    return { "--cx": (Math.cos(a) * ring).toFixed(3), "--cy": (Math.sin(a) * ring).toFixed(3), "--d": `${(i + k) * 18}ms` } as React.CSSProperties;
  }
  return (
    <div className={`orb-root ${open ? "open" : ""}`} ref={root}>
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
          <button key={r} type="button" className="orb-item react" style={place(i, REACTIONS.length, 3.85)} aria-label={`Thả ${REACTION_EMOJI[r]}`} onClick={() => onReact(r)}>
            <span className="orb-ico" aria-hidden>
              {REACTION_EMOJI[r]}
            </span>
          </button>
        ))}
      <button type="button" className="orb" aria-expanded={open} aria-label={open ? "Đóng menu" : "Mở menu (phím M)"} title={open ? "Đóng (Esc)" : "Menu (phím M)"} onClick={() => setOpen(!open)}>
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
