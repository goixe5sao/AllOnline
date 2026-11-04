"use client";

/**
 * Stock picker for the room owner: search any listed VN stock/ETF or index (HOSE/HNX/UPCOM).
 * Indices and watchlist symbols load their full history; other stocks load from 2024.
 * The app owner can star (☆/★) a stock to add it to the watchlist.
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

interface Hit {
  symbol: string;
  name: string;
  exchange: string;
  kind: "index" | "stock" | "etf";
  watch: boolean;
  fullHistory: boolean;
}

const KIND_VI = { index: "Chỉ số", stock: "CP", etf: "ETF" } as const;

export function SymbolPicker({ value, onChange }: { value: string; onChange: (symbol: string) => void }) {
  const [q, setQ] = useState(value);
  const [hits, setHits] = useState<Hit[]>([]);
  const [canWatch, setCanWatch] = useState(false);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(
      () =>
        api<{ symbols: Hit[]; canWatch: boolean }>(`/api/market/symbols?q=${encodeURIComponent(q.trim())}&limit=30`)
          .then((d) => {
            if (cancelled) return;
            setHits(d.symbols);
            setCanWatch(d.canWatch);
          })
          .catch(() => !cancelled && setHits([])),
      200,
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, tick]);

  const selected = hits.find((h) => h.symbol === value);

  const pick = (h: Hit) => {
    onChange(h.symbol);
    setQ(h.symbol);
    setOpen(false);
  };

  const toggleWatch = async (h: Hit) => {
    setErr("");
    try {
      await api("/api/admin/watchlist", { method: "POST", body: { symbol: h.symbol, on: !h.watch } });
      setTick((x) => x + 1);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Không đổi được watchlist.");
    }
  };

  return (
    <div className="symbol-picker">
      <input
        type="text"
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          const v = e.target.value.toUpperCase();
          setQ(v);
          onChange(v.trim());
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits[0]) {
            e.preventDefault();
            pick(hits.find((h) => h.symbol === q.trim()) ?? hits[0]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Tìm mã hoặc tên công ty: VNINDEX, FPT, Vinamilk…"
        aria-label="Mã cổ phiếu / chỉ số"
        role="combobox"
        aria-controls="symbol-list"
        aria-expanded={open}
        autoComplete="off"
      />
      {open && hits.length > 0 && (
        <ul id="symbol-list" className="symbol-list" role="listbox">
          {hits.map((h) => (
            <li key={h.symbol} role="option" aria-selected={h.symbol === value}>
              <button type="button" className="symbol-hit" onClick={() => pick(h)}>
                <b>{h.symbol}</b>
                <span className="symbol-name">{h.name}</span>
                <small>
                  {KIND_VI[h.kind]} · {h.exchange}
                  {h.fullHistory ? " · toàn bộ lịch sử" : " · từ 2024"}
                </small>
              </button>
              {canWatch && h.kind !== "index" && (
                <button type="button" className="symbol-star" title={h.watch ? "Bỏ khỏi watchlist" : "Thêm vào watchlist (nạp toàn bộ lịch sử)"} aria-pressed={h.watch} onClick={() => toggleWatch(h)}>
                  {h.watch ? "★" : "☆"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <small className="muted">
        {selected
          ? `${selected.symbol} — ${selected.name}. ${selected.fullHistory ? "Nạp toàn bộ lịch sử (chỉ số / watchlist)." : "Nạp dữ liệu ngày từ 01/01/2024."}`
          : "Chỉ số và mã trong watchlist nạp toàn bộ lịch sử; cổ phiếu khác nạp từ 01/01/2024."}
      </small>
      {err && (
        <small className="error" role="alert">
          {err}
        </small>
      )}
    </div>
  );
}
