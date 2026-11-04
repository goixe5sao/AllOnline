"use client";

import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined || init?.raw ? "POST" : "GET"),
    headers: init?.raw ? init.headers : init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.raw ?? (init?.body !== undefined ? JSON.stringify(init.body) : undefined),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? "HTTP_" + res.status, data.message ?? "Có lỗi xảy ra.", res.status);
  return data as T;
}

export interface Me {
  id: string;
  displayName: string;
  email: string | null;
  role: "app_owner" | "user";
  isDemo: boolean;
  isGuest: boolean;
}

export function useMe() {
  const [state, setState] = useState<{ loading: boolean; user: Me | null; mode: "demo" | "supabase" | null }>({ loading: true, user: null, mode: null });
  const reload = useCallback(() => {
    api<{ user: Me | null; mode: "demo" | "supabase" }>("/api/me")
      .then((r) => setState({ loading: false, user: r.user, mode: r.mode }))
      .catch(() => setState({ loading: false, user: null, mode: null }));
  }, []);
  useEffect(reload, [reload]);
  return { ...state, reload };
}

/** Small polling/loader hook for pages. */
export function useApi<T>(path: string | null, intervalMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const load = () =>
      api<T>(path)
        .then((d) => !cancelled && (setData(d), setError(null)))
        .catch((e) => !cancelled && setError(e));
    load();
    const id = intervalMs ? setInterval(load, intervalMs) : undefined;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [path, intervalMs, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

export function fmtTime(d: string | number | Date) {
  return new Date(d).toLocaleString("vi-VN", { hour12: false });
}

export function fmtDuration(ms: number) {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
