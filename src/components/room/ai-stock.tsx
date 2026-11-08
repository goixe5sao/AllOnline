"use client";
import { useState } from "react";
import { Button, Card, CardBody, Field, Input, Select, Badge, EmptyState, Skeleton } from "@/components/ui";
import { StageChart } from "./stage-chart";
import { STOCK_DISCLAIMER, type AiStockContent, type StockScan, type StockPick } from "@/core/ai-stock";
import type { ClientMsg } from "@/core/protocol";
import type { ScreenState } from "@/core/screen";
import { useApi } from "@/lib/api";
import { Pause, Play, SkipForward, Pin, Square } from "lucide-react";
import "./ai-stock.css";

const biasLabel = { up: "Thiên hướng tăng", down: "Thiên hướng giảm", neutral: "Trung tính" };
const signalLabel: Record<string, string> = { poc_breakout: "Vượt POC", poc_breakdown: "Thủng POC", "pattern:ascending_triangle": "Tam giác tăng", sr_breakout: "Vượt hỗ trợ / kháng cự", ml_rank: "Xếp hạng mô hình" };
export function StockSignal({ pick, snapshot, fixture, commentary }: { pick: StockPick; snapshot: StockScan; fixture: boolean; commentary?: string }) {
  return <section className="ai-stock-signal" aria-label={`Tín hiệu ${pick.symbol}`}>
    <div className="row"><strong>{pick.symbol}</strong><Badge>{biasLabel[pick.bias]}</Badge><span>Điểm {pick.score.toFixed(2)}</span></div>
    <p>Giá {pick.price} · {pick.changePct.toFixed(2)}% · Đơn vị: nghìn đồng</p>
    {fixture && <p className="ai-stock-fixture">Dữ liệu mẫu · Giá và thống kê giả lập, không phải kết quả backtest thực.</p>}
    <p>Ảnh chụp: {new Date(snapshot.asOf).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · Trễ {snapshot.dataDelayMin} phút · Nguồn không chính thức</p>
    <ul>{pick.signals.slice(0,3).map((s,i) => <li key={i}><strong>{signalLabel[s.type] ?? `Tín hiệu ${s.type}`}</strong><br/>{(s.stats.hitRate * 100).toFixed(0)}% · n={s.stats.n} · {s.stats.horizon} phiên<br/><small>Khoảng tin cậy 95%: {(s.stats.ci95[0]*100).toFixed(0)}–{(s.stats.ci95[1]*100).toFixed(0)}% · {fixture ? "Thống kê mẫu" : "Tần suất thực nghiệm"}</small></li>)}</ul>
    {commentary && <p className="ai-stock-commentary">{commentary}</p>}
    <small>{STOCK_DISCLAIMER}</small>
  </section>;
}
export function AiStockStage({ content }: { content: AiStockContent }) {
  const pick = content.snapshot.picks[content.index];
  return <div className="ai-stock-stage"><div className="ai-stock-chart"><StageChart key={pick.symbol + content.snapshot.asOf} symbol={pick.symbol} interval="D" layers={[]} indicators={[]} interactive={false} aiPick={pick} aiFixture={content.fixture}/></div><StockSignal pick={pick} snapshot={content.snapshot} fixture={content.fixture} commentary={content.commentary}/></div>;
}
export function AiStockControls({ screen, send }: { screen: ScreenState; send: (m: ClientMsg) => void }) {
  const [topN, setTopN] = useState(8), [seconds, setSeconds] = useState(45);
  const c = screen.content.kind === "ai-stock" ? screen.content : null;
  const command = (command: "start" | "pause" | "resume" | "skip" | "pin" | "stop", symbol?: string) => send({ t: "screen", action: "ai_stock", command, topN, seconds, symbol });
  return <Card><CardBody><div className="stack ai-stock-controls"><strong>AI dẫn chương trình</strong>
    <p>Quét VN100, lần lượt trình bày các mã. Các thống kê mẫu được ghi rõ trên sân khấu.</p>
    <Field label="Số mã hàng đầu"><Input type="number" min={1} max={100} value={topN} onChange={e=>setTopN(Number(e.target.value))}/></Field>
    <Field label="Giây mỗi mã"><Input type="number" min={10} max={300} value={seconds} onChange={e=>setSeconds(Number(e.target.value))}/></Field>
    <Button disabled={!Number.isInteger(topN) || topN<1 || topN>100 || !Number.isInteger(seconds) || seconds<10 || seconds>300} onClick={()=>command("start")}>{c ? "Khởi động lại AI" : "Bật AI"}</Button>
    {c && <><p role="status">{c.snapshot.picks[c.index].symbol} · {c.pinned ? "Đang ghim" : c.paused ? "Tạm dừng" : "Đang dẫn"} · {c.topN} mã · {c.seconds} giây/mã</p><div className="row">
      <Button variant="secondary" icon={c.paused || c.pinned ? <Play/> : <Pause/>} onClick={()=>command(c.paused || c.pinned ? "resume" : "pause")}>{c.paused || c.pinned ? "Tiếp tục" : "Tạm dừng"}</Button>
      <Button variant="secondary" icon={<SkipForward/>} onClick={()=>command("skip")}>Bỏ qua</Button>
      <Button variant="secondary" icon={<Pin/>} onClick={()=>command("pin",c.snapshot.picks[c.index].symbol)}>Ghim mã</Button>
      <Button variant="secondary" icon={<Square/>} onClick={()=>command("stop")}>Dừng AI</Button>
    </div><Field label="Ghim mã trong bản quét"><Select value={c.snapshot.picks[c.index].symbol} onChange={e=>command("pin", e.target.value)}>{c.snapshot.picks.map(p=><option key={p.symbol}>{p.symbol}</option>)}</Select></Field></>}
    <small>{STOCK_DISCLAIMER}</small>
  </div></CardBody></Card>;
}
/** Local selection has no send callback: it cannot change the stage. */
export function AiStockList({ current }: { current?: AiStockContent }) {
  const { data, error } = useApi<{ snapshot: StockScan; fixture: boolean }>(current ? null : "/api/ai-stock/scan");
  const [symbol, setSymbol] = useState<string | null>(null);
  const result = current ? { snapshot: current.snapshot, fixture: current.fixture } : data;
  if (!error && !result) return <Skeleton/>;
  if (!result) return <EmptyState title="Chưa có bản quét" description={error?.message || "Vui lòng thử lại sau."}/>;
  const pick = result.snapshot.picks.find(p=>p.symbol===symbol);
  return <div className="stack ai-stock-list"><h2>Bảng AI Stock</h2><p>Chọn mã để xem riêng trên thiết bị của bạn.</p><small>Ảnh chụp: {new Date(result.snapshot.asOf).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })} · Trễ {result.snapshot.dataDelayMin} phút</small>
    {pick ? <><Button variant="secondary" onClick={()=>setSymbol(null)}>Về danh sách</Button><div className="ai-stock-private-chart"><StageChart key={pick.symbol} symbol={pick.symbol} aiPick={pick} aiFixture={result.fixture} layers={[]} interactive={false}/></div><StockSignal pick={pick} {...result}/></> : <><small>{result.fixture ? "Dữ liệu mẫu · Thống kê giả lập" : "VN100 · Nguồn không chính thức"}</small><small>{STOCK_DISCLAIMER}</small>{result.snapshot.picks.map(p=><Button key={p.symbol} variant="secondary" onClick={()=>setSymbol(p.symbol)}>#{p.rank} {p.symbol} · Điểm {p.score.toFixed(2)} · {biasLabel[p.bias]}</Button>)}</>}
  </div>;
}
