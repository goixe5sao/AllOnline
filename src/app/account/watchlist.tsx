"use client";
import { useState } from "react";
import { api, useApi, type Me } from "@/lib/api";
import { PLAN_LABEL, VIP_REASON } from "@/core/ai-plan";
import { Card, Button, Field, Input, Select } from "@/components/ui";
import { alertLabel, type AlertFeed } from "@/core/stock-alerts";
import { StockAlertHistory } from "@/components/room/stock-alerts";
export function Watchlist({ me }: { me: Me }) {
  const enabled = me.aiPlan && me.aiPlan !== "off";
  const {data,error,reload} = useApi<{symbols:string[];deliveryAvailable:boolean;zaloLinked:boolean}>(enabled ? "/api/ai-stock/follows" : null);
  const feed = useApi<AlertFeed>(enabled ? "/api/ai-stock/alerts" : null,15000);
  const [term,setTerm] = useState(""), [symbol,setSymbol] = useState(""), [message,setMessage] = useState(""), [busy,setBusy] = useState(false);
  const hits = useApi<{symbols:{symbol:string;name:string}[]}>(enabled && term ? `/api/market/symbols?q=${encodeURIComponent(term)}` : null);
  const change = async (s:string,on:boolean) => {setBusy(true);setMessage("");try{await api("/api/ai-stock/follows",{body:{symbol:s,following:on}});reload();feed.reload();setMessage(on ? "Đã thêm mã." : "Đã bỏ theo dõi.");}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
  return <Card className="account-section stack" id="ai-watchlist"><h2>Mã theo dõi</h2><p>Gói AI: {PLAN_LABEL[me.aiPlan ?? "off"]} · {data?.symbols.length ?? 0}/{me.aiFollowLimit ?? 0} mã</p>
    {me.aiPlan === "basic" && <p>Tài khoản thường: chỉ nhận cảnh báo kháng cự</p>}
    {!enabled ? <p>AI đã tắt cho tài khoản này. Liên hệ quản trị để bật AI.</p> : <>
      <p>{me.allowedKinds?.map(k=>alertLabel[k]).join(" · ")}</p>{me.aiPlan !== "vip" && <p>{VIP_REASON}</p>}
      <Field label="Tìm mã thị trường"><Input value={term} maxLength={40} onChange={e=>{setTerm(e.target.value);setSymbol("");}} placeholder="VD: FPT"/></Field>
      <Field label="Chọn mã"><Select value={symbol} onChange={e=>setSymbol(e.target.value)}><option value="">Chọn mã trong danh sách</option>{hits.data?.symbols.map(s=><option key={s.symbol} value={s.symbol}>{s.symbol} · {s.name}</option>)}</Select></Field>
      <Button disabled={busy || !symbol} onClick={()=>change(symbol,true)}>Thêm mã theo dõi</Button>
      {data?.symbols.map(s=><div className="row" key={s}><strong>{s}</strong><Button variant="secondary" disabled={busy} onClick={()=>change(s,false)}>Bỏ theo dõi {s}</Button></div>)}
      {!data?.deliveryAvailable && <p>Gửi Zalo đang tạm tắt trong khi xác minh chính sách nhắn chủ động.</p>}
      {data && !data.zaloLinked && <p>Liên kết Zalo để nhận thông báo khi được phép.</p>}
      {error && <p role="alert">{error.message}</p>}{hits.error && <p role="alert">{hits.error.message}</p>}
      {feed.error ? <p role="status">{feed.error.message}</p> : <StockAlertHistory feed={feed.data}/>}
    </>}{message && <p role="status">{message}</p>}
  </Card>;
}
