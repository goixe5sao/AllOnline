"use client";
import { useState } from "react";
import { alertCopy, alertLabel, fixtureAlerts, vnSession as vnAlertDay, type AlertFeed } from "@/core/stock-alerts";
import { STOCK_DISCLAIMER } from "@/core/ai-stock";
import { api, useApi } from "@/lib/api";
import { Button } from "@/components/ui";

export function useStockAlerts(fixture = false) {
  const result = useApi<AlertFeed>(fixture ? null : "/api/ai-stock/alerts", 15_000);
  // Shared sample presentations remain visible to demo-room guests without private AI access.
  return fixture ? { ...result, data: { ...fixtureAlerts(), fixture: true }, error: null } : result;
}
export function StockAlertBanner({ symbol, fixture = false }: { symbol: string; fixture?: boolean }) {
  const { data, error } = useStockAlerts(fixture);
  // History remains available separately; yesterday's alert is never advertised as new.
  const alert = data?.alerts.find(a=>a.symbol===symbol && vnAlertDay(a.createdAt)===vnAlertDay(Date.now()));
  return <div className="stock-alert-banner" role="status">
    {alert ? <><strong>⚠ {alert.symbol} · {alertLabel[alert.kind]}</strong><p>{alertCopy(alert)}</p><small>{data?.fixture && "Dữ liệu mẫu · Thống kê giả lập · "}{new Date(alert.createdAt).toLocaleString("vi-VN")} · Nguồn không chính thức</small></>
      : <small>{error ? "Không tải được cảnh báo." : data ? "Chưa có cảnh báo trong phiên cho mã này." : "Đang tải cảnh báo…"}</small>}
    {data?.error && <p>{data.error}</p>}
  </div>;
}
export function StockAlertHistory({ feed, symbol }: { feed?: AlertFeed | null; symbol?: string }) {
  const alerts = feed?.alerts.filter(a=>!symbol || a.symbol===symbol);
  return <section className="stock-alert-history" aria-label="Lịch sử cảnh báo"><h3>Lịch sử cảnh báo{symbol ? ` · ${symbol}` : ""}</h3>
    <p>{feed?.fixture ? "Dữ liệu mẫu · Thống kê giả lập · " : ""}Cảnh báo hai nhịp · Thống kê chỉ hiện khi được duyệt.</p>
    {feed?.error && <p role="status">{feed.error}</p>}
    {feed?.asOf && <small>Cập nhật: {new Date(feed.asOf).toLocaleString("vi-VN")}</small>}
    {!alerts?.length && <p>Chưa có cảnh báo.</p>}
    {alerts?.map(a=><article key={a.id+ a.createdAt}><strong>⚠ {a.symbol} · {alertLabel[a.kind]}</strong><p>{alertCopy(a)}</p><small>{new Date(a.createdAt).toLocaleString("vi-VN")} · Nguồn không chính thức</small></article>)}
    <small>{STOCK_DISCLAIMER}</small>
  </section>;
}
export function StockFollow({ symbol }: { symbol: string }) {
  const { data, error, reload } = useApi<{ symbols: string[]; zaloLinked: boolean; deliveryAvailable: boolean; dailyCap: number }>("/api/ai-stock/follows");
  const [busy,setBusy] = useState(false), [message,setMessage] = useState("");
  const following = data?.symbols.includes(symbol);
  const toggle = async () => {
    setBusy(true); setMessage("");
    try { await api("/api/ai-stock/follows", { body: { symbol, following: !following } }); reload(); }
    catch (e) { setMessage((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="stock-follow"><Button disabled={!data || busy} aria-pressed={!!following} onClick={toggle}>{following ? "Bỏ theo dõi" : "Theo dõi mã"} {symbol}</Button>
    {error && <p role="status">{error.message}</p>}
    {data && <><p>Tối đa {data.dailyCap} thông báo/ngày. Bạn có thể bỏ theo dõi bất kỳ lúc nào.</p>{!data.zaloLinked && <p><a href="/account">Liên kết Zalo trong Tài khoản</a> để nhận thông báo khi được phép.</p>}<p>{data.deliveryAvailable ? "Zalo chỉ gửi khi còn cửa sổ nhắn tin hợp lệ. Dữ liệu mẫu luôn dùng thông báo giả lập." : "Gửi Zalo đang tạm tắt trong khi xác minh chính sách nhắn chủ động."}</p></>}
    {message && <p role="alert">{message}</p>}
  </section>;
}
