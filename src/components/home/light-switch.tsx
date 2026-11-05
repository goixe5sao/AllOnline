"use client";

import { useEffect, useSyncExternalStore } from "react";

const KEY = "ao-lights";
const EVENT = "ao-lights-change";

// In-memory fallback when storage is blocked (private mode, disabled site data).
let memory = false;
function read(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? memory : v === "on";
  } catch {
    return memory;
  }
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** House lights of the theater: off = cinema dark with sweeping beams, on = warm lit hall. */
export function LightSwitch({ target }: { target: string }) {
  // Server render: lights off; the browser then shows the visitor's last choice.
  const on = useSyncExternalStore(subscribe, read, () => false);
  useEffect(() => {
    document.querySelector(target)?.classList.toggle("lights-on", on);
  }, [on, target]);
  return (
    <button
      type="button"
      className={`lsw ${on ? "on" : ""}`}
      role="switch"
      aria-checked={on}
      onClick={() => {
        memory = !on;
        try {
          localStorage.setItem(KEY, memory ? "on" : "off");
        } catch {}
        window.dispatchEvent(new Event(EVENT));
      }}
    >
      <span className="lsw-track" aria-hidden>
        <span className="lsw-knob" />
      </span>
      <span>{on ? "💡 Tắt đèn" : "💡 Bật đèn"}</span>
    </button>
  );
}
