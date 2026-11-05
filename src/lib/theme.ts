"use client";

import { useSyncExternalStore } from "react";

/**
 * Site-wide light / dark theme. The choice lives on <html data-theme="…"> (set before first
 * paint by THEME_SCRIPT in the root layout, so there is no flash) and in localStorage.
 */
export type Theme = "light" | "dark";

const KEY = "ao-theme";
const EVENT = "ao-theme-change";

function current(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function setTheme(t: Theme) {
  const root = document.documentElement;
  root.dataset.theme = t;
  root.style.colorScheme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

/** Server render assumes the default (dark); the browser then reports the real theme. */
export function useTheme(): [Theme, (t: Theme) => void] {
  return [useSyncExternalStore(subscribe, current, () => "dark"), setTheme];
}
