"use client";

import { DEMO_IMAGES, DEMO_TEXTS } from "@/core/demo";
import { DemoMissions, type Mission } from "./demo";
import type { LiveDto } from "@/core/live";
import { LiveModeration } from "./live";
import { useState } from "react";
import Link from "next/link";
import { api, ApiError, fmtDuration, fmtTime, useApi } from "@/lib/api";
import { formatVnd } from "@/core/pricing";
import { currentPosition, parseYouTubeId, type ScreenContent, type ScreenState } from "@/core/screen";
import { ANALYSIS_LAYERS, DEFAULT_LAYERS, LAYER_LABEL, type AnalysisLayer } from "@/core/analysis";
import { CHART_INTERVALS, INDICATORS, INTERVAL_LABEL, type ChartInterval, type ChartType, type Indicator } from "@/core/market";
import type { ClientMsg, PollViewDto, RoomInfoDto } from "@/core/protocol";
import type { PublicMember } from "@/core/room-engine";
import type { ChatLine } from "./use-room";
import { SymbolPicker } from "./symbol-picker";
import { HandsList } from "./engage";
import { HostsSection, ScheduleSection, StatsTab } from "./owner-extra";
import { YouTubePanel } from "./youtube-panel";

const STATUS_VI: Record<string, string> = { seated: "Đang ngồi", finding: "Đang tìm chỗ", invited: "Được mời vào chỗ", waiting: "Chờ ngoài cổng" };

function StageStyleSwitch({ roomId, style, lights, send }: { roomId: string; style: "glam" | "plain"; lights: boolean; send: (m: ClientMsg) => void }) {
  const [err, setErr] = useState("");
  const set = async (s: "glam" | "plain") => {
    try {
      await api(`/api/rooms/${roomId}/stage-style`, { body: { style: s } });
    } catch (e) {
      setErr((e as ApiError).message);
    }
  };
  return (
    <div className="stack" style={{ gap: 4 }}>
      <small>Kiểu sân khấu (mọi người thấy ngay)</small>
      <div className="row">
        <button className={`hud-btn ${style === "glam" ? "primary" : ""}`} aria-pressed={style === "glam"} onClick={() => set("glam")}>
          🛸 Hành tinh tương lai
        </button>
        <button className={`hud-btn ${style === "plain" ? "primary" : ""}`} aria-pressed={style === "plain"} onClick={() => set("plain")}>
          ◻ Đơn sắc
        </button>
        <button className={`hud-btn ${lights ? "primary" : ""}`} aria-pressed={lights} onClick={() => send({ t: "stage_lights", on: !lights })}>
          {lights ? "💡 Đèn sân khấu: bật" : "🌑 Đèn sân khấu: tắt"}
        </button>
      </div>
      {err && <small>{err}</small>}
    </div>
  );
}

function ScreenTab({ send, screen, serverNow, roomId, demo }: { send: (m: ClientMsg) => void; screen: ScreenState; serverNow: () => number; roomId: string; demo?: boolean }) {
  // a YouTube video on screen → open its controls straight away
  const [kind, setKind] = useState<ScreenContent["kind"]>(screen.content.kind === "youtube" ? "youtube" : "text");
  const [value, setValue] = useState("");
  const [title, setTitle] = useState("");
  const [interval, setIntervalOpt] = useState<ChartInterval>("D");
  const [chartType, setChartType] = useState<ChartType>("candles");
  const [inds, setInds] = useState<Indicator[]>(["volume", "ma20"]);
  const [aLayers, setALayers] = useState<AnalysisLayer[]>(DEFAULT_LAYERS);
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);

  const show = () => {
    setErr("");
    let content: ScreenContent | null = null;
    if (kind === "text") content = value.trim() ? { kind: "text", text: value.trim().slice(0, 500) } : null;
    else if (kind === "youtube") {
      const id = parseYouTubeId(value);
      content = id ? { kind: "youtube", videoId: id } : null;
      if (!id) return setErr("Link YouTube không hợp lệ.");
    } else if (kind === "image") content = value ? { kind: "image", url: value.trim() } : null;
    else if (kind === "audio") content = value ? { kind: "audio", url: value.trim(), title: title.trim() || "Âm thanh" } : null;
    else if (kind === "chart") content = { kind: "chart", symbol: (value.trim() || "VNINDEX").toUpperCase(), source: "demo", interval, chartType, indicators: inds, layers: aLayers };
    else if (kind === "tradingview") content = { kind: "tradingview", symbol: (value.trim() || "NASDAQ:AAPL").toUpperCase(), interval };
    else if (kind === "blank") content = { kind: "blank" };
    if (!content) return setErr("Hãy nhập nội dung.");
    send({ t: "screen", action: "set", content });
  };

  const upload = async (file: File) => {
    setUploading(true);
    setErr("");
    try {
      const r = await api<{ url: string; mime: string }>(`/api/rooms/${roomId}/uploads`, { raw: file, headers: { "Content-Type": "application/octet-stream" } });
      setValue(r.url);
      if (r.mime.startsWith("audio/")) {
        setKind("audio");
        setTitle(file.name);
      } else setKind("image");
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setUploading(false);
    }
  };

  const playable = screen.content.kind === "youtube" || screen.content.kind === "audio";
  const pos = currentPosition(screen, serverNow());
  return (
    <div className="stack">
      <div className="notice">
        Đang chiếu: <strong>{screen.content.kind}</strong>
        {playable && ` · ${screen.playing ? "đang phát" : "tạm dừng"} · ${fmtDuration(pos * 1000)}`}
        {screen.content.kind === "youtube" && screen.content.endMode === "loop" && " · 🔁 lặp lại"}
        {screen.content.kind === "youtube" && screen.content.endMode === "next" && ` · ⏭ danh sách ${(screen.content.index ?? 0) + 1}/${screen.content.playlist?.length ?? 1}`}
      </div>
      {playable && (
        <div className="row">
          <button className="hud-btn" onClick={() => send({ t: "screen", action: screen.playing ? "pause" : "play" })}>
            {screen.playing ? "⏸ Dừng" : "▶ Phát"}
          </button>
          <button className="hud-btn" onClick={() => send({ t: "screen", action: "seek", positionSec: Math.max(0, pos - 10) })}>
            −10s
          </button>
          <button className="hud-btn" onClick={() => send({ t: "screen", action: "seek", positionSec: pos + 10 })}>
            +10s
          </button>
          <button className="hud-btn" onClick={() => send({ t: "screen", action: "seek", positionSec: 0 })}>
            Về đầu
          </button>
        </div>
      )}
      <label className="field">
        Loại nội dung
        <select value={kind} onChange={(e) => {
            setKind(e.target.value as ScreenContent["kind"]);
            setValue("");
          }}>
          <option value="text">{demo ? "Văn bản (thư viện mẫu)" : "Văn bản"}</option>
          <option value="image">{demo ? "Hình ảnh (thư viện mẫu)" : "Hình ảnh (https hoặc tải lên)"}</option>
          <option value="youtube">Video YouTube</option>
          {!demo && <option value="audio">Âm thanh (https hoặc tải lên)</option>}
          <option value="chart">Biểu đồ chứng khoán VN kiểu TradingView</option>
          <option value="tradingview">TradingView chính thức — mã quốc tế (dữ liệu thật)</option>
          <option value="blank">Màn hình trống</option>
        </select>
      </label>
      {kind === "text" && demo && (
        <select value={value} onChange={(e) => setValue(e.target.value)} aria-label="Văn bản mẫu">
          <option value="">— Chọn một câu —</option>
          {DEMO_TEXTS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}
      {kind === "image" && demo && (
        <select value={value} onChange={(e) => setValue(e.target.value)} aria-label="Hình mẫu">
          <option value="">— Chọn một hình —</option>
          {DEMO_IMAGES.map((i) => (
            <option key={i.url} value={i.url}>
              {i.label}
            </option>
          ))}
        </select>
      )}
      {demo && (kind === "text" || kind === "image") && <small>Bản trải nghiệm: chữ và hình chọn trong thư viện mẫu. Phòng thật của bạn thì gõ chữ, dán link hay tải ảnh tuỳ ý.</small>}
      {kind === "text" && !demo && <textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} maxLength={500} placeholder="Nội dung hiển thị" />}
      {kind === "chart" && <SymbolPicker value={value} onChange={setValue} />}
      {kind === "youtube" && <YouTubePanel send={send} screen={screen} />}
      {((kind === "image" && !demo) || kind === "audio" || kind === "tradingview") && (
        <input type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "tradingview" ? "Ví dụ NASDAQ:AAPL, BINANCE:BTCUSDT, OANDA:XAUUSD" : "https://…"} />
      )}
      {kind === "audio" && <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tiêu đề" />}
      {((kind === "image" && !demo) || kind === "audio") && (
        <label className="field">
          <small>Hoặc tải tệp lên (ảnh PNG/JPEG/WebP/GIF, âm thanh MP3/OGG/WAV/M4A; giới hạn dung lượng do chủ ứng dụng cấu hình)</small>
          <input type="file" accept={kind === "image" ? "image/png,image/jpeg,image/webp,image/gif" : "audio/*"} disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      )}
      {(kind === "chart" || kind === "tradingview") && (
        <label className="field">
          Khung thời gian
          <select value={interval} onChange={(e) => setIntervalOpt(e.target.value as ChartInterval)}>
            {CHART_INTERVALS.map((iv) => (
              <option key={iv} value={iv}>
                {INTERVAL_LABEL[iv]}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === "chart" && (
        <>
          <label className="field">
            Kiểu biểu đồ
            <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)}>
              <option value="candles">Nến</option>
              <option value="bars">Thanh OHLC</option>
              <option value="line">Đường</option>
              <option value="area">Vùng</option>
            </select>
          </label>
          <div className="row">
            {INDICATORS.map((ind) => (
              <label className="check" key={ind}>
                <input type="checkbox" checked={inds.includes(ind)} onChange={(e) => setInds(e.target.checked ? [...inds, ind] : inds.filter((x) => x !== ind))} />
                {({ volume: "Khối lượng", ma20: "MA20", ema50: "EMA50", bb: "Bollinger", rsi: "RSI" } as const)[ind]}
              </label>
            ))}
          </div>
          <strong style={{ fontSize: 13 }}>Lớp phân tích StockVN</strong>
          <div className="row">
            {ANALYSIS_LAYERS.map((l) => (
              <label className="check" key={l}>
                <input type="checkbox" checked={aLayers.includes(l)} onChange={(e) => setALayers(e.target.checked ? [...aLayers, l] : aLayers.filter((x) => x !== l))} />
                {LAYER_LABEL[l]}
              </label>
            ))}
          </div>
          <small>Trendline, kênh, hỗ trợ/kháng cự, mô hình nến, phá vỡ, đa khung do dịch vụ StockVN tính (giống trang backtest), có ở khung 1p/5p/15p/Ngày.</small>
          <small>Dữ liệu thật do server lấy mỗi phút từ API không chính thức (DNSE/Entrade, dự phòng SSI, VPS); nguồn ghi trên biểu đồ. Mã mới cần ~vài giây để tải lần đầu. Người xem bấm “Xem màn hình” để tự kéo/zoom/đổi chỉ báo.</small>
        </>
      )}
      {kind === "tradingview" && <small>TradingView không cho nhúng mã sàn Việt Nam (HOSE/HNX). Dùng cho cổ phiếu quốc tế, crypto, vàng, ngoại tệ. Ở chế độ “Xem màn hình”, người xem dùng đủ công cụ vẽ/chỉ báo của TradingView.</small>}
      {kind !== "youtube" && (
        <button className="hud-btn primary" onClick={show}>
          Hiển thị lên màn hình
        </button>
      )}
      {err && <p className="notice">{err}</p>}
    </div>
  );
}

function PollsTab({ send, polls }: { send: (m: ClientMsg) => void; polls: PollViewDto[] }) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState("Đồng ý\nKhông đồng ý");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  return (
    <div className="stack">
      <div className="stack">
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Câu hỏi" maxLength={200} />
        <textarea rows={4} value={opts} onChange={(e) => setOpts(e.target.value)} placeholder="Mỗi dòng một lựa chọn (2–6)" />
        <label className="check">
          <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} /> Chỉ tài khoản đã đăng ký mới được bình chọn
        </label>
        <small>Nên bật khi cần kết quả công bằng: khách không tài khoản có thể mở cửa sổ ẩn danh để thành “người mới”.</small>
        <button
          className="hud-btn primary"
          onClick={() => {
            const options = opts.split("\n").map((s) => s.trim()).filter(Boolean);
            if (q.trim() && options.length >= 2) {
              send({ t: "poll_create", question: q.trim(), options: options.slice(0, 6), verifiedOnly });
              setQ("");
            }
          }}
        >
          Tạo bình chọn
        </button>
      </div>
      {[...polls].reverse().map((p) => (
        <div key={p.id} className="notice stack" style={{ gap: 6 }}>
          <div className="row between">
            <strong>{p.question}</strong>
            <span className="badge">
              {p.status === "open" ? "đang mở" : p.status === "closed" ? "đã đóng" : "nháp"}
              {p.verifiedOnly && " · chỉ tài khoản"}
            </span>
          </div>
          {p.options.map((o) => (
            <small key={o.id}>
              {o.label}: {o.votes} ({o.pct}%)
            </small>
          ))}
          <small>Tổng: {p.totalVoters} người đã vote</small>
          <div className="row">
            {p.status === "draft" && (
              <button className="hud-btn" onClick={() => send({ t: "poll_open", id: p.id })}>
                Mở vote
              </button>
            )}
            {p.status === "open" && (
              <button className="hud-btn" onClick={() => send({ t: "poll_close", id: p.id })}>
                Đóng vote
              </button>
            )}
            <button className="hud-btn" onClick={() => send({ t: "poll_show", id: p.id })}>
              Đưa lên màn hình
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function PeopleTab({ members, send, hands, isOwner, selfId, roomId, noKick }: { members: PublicMember[]; send: (m: ClientMsg) => void; hands: { userId: string; name: string; at: number }[]; isOwner: boolean; selfId: string; roomId: string; noKick?: boolean }) {
  const count = (s: string) => members.filter((m) => m.status === s).length;
  const [msg, setMsg] = useState("");
  return (
    <div className="stack">
      <HandsList hands={hands} send={send} />
      {msg && <small className="notice">{msg}</small>}
      <div className="row">
        <span className="badge ok">{count("seated")} đang ngồi</span>
        <span className="badge warn">{count("finding") + count("invited")} đang tìm/nhận chỗ</span>
        <span className="badge">{count("waiting")} chờ ngoài cổng</span>
      </div>
      <table className="data">
        <tbody>
          {members.map((m) => (
            <tr key={m.userId}>
              <td>
                {m.name}
                {!m.connected && <small> (mất kết nối)</small>}
                <br />
                <small>
                  {STATUS_VI[m.status]}
                  {m.seatId && ` · ${m.seatId}`}
                </small>
              </td>
              <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                {isOwner && m.userId !== selfId && (
                  <button
                    className="hud-btn"
                    title="Trợ lý được điều khiển màn hình, bình chọn, hỏi đáp và mời người ra (cần có tài khoản)"
                    onClick={async () => {
                      try {
                        const r = await api<{ name: string }>(`/api/rooms/${roomId}/moderators`, { body: { userId: m.userId } });
                        setMsg(`${r.name} đã là trợ lý điều hành.`);
                      } catch (e) {
                        setMsg((e as ApiError).message);
                      }
                    }}
                  >
                    Làm trợ lý
                  </button>
                )}{" "}
                <button className="hud-btn" hidden={noKick} onClick={() => confirm(`Mời ${m.name} ra khỏi phòng?`) && send({ t: "kick", userId: m.userId })}>
                  Mời ra
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!members.length && <small>Chưa có người tham dự.</small>}
    </div>
  );
}

function RoomTab({ room, serverNow }: { room: RoomInfoDto; serverNow: () => number }) {
  const { data: catalog } = useApi<{ durationOptions: number[]; extensionEnabled: boolean }>("/api/catalog");
  const { data, reload } = useApi<{
    room: { invite_code: string; is_public: boolean };
    bill: { deposit: number; hourlyRate: number; billedHours: number; charge: number; balance: number } | null;
  }>(`/api/rooms/${room.id}`, 60_000);
  const [hours, setHours] = useState<number | null>(null);
  const [promo, setPromo] = useState("");
  const [msg, setMsg] = useState("");
  const link = data ? `${typeof location !== "undefined" ? location.origin : ""}/join/${data.room.invite_code}` : "";
  return (
    <div className="stack">
      {room.openEnded ? (
        <div className="notice stack" style={{ gap: 4 }}>
          <strong>Phòng mở vô thời hạn — đến khi bạn tắt</strong>
          {data?.bill && (
            <>
              <span>
                Đã tính {data.bill.billedHours} giờ × {formatVnd(data.bill.hourlyRate)} = <strong>{formatVnd(data.bill.charge)}</strong> (đã cọc {formatVnd(data.bill.deposit)})
              </span>
              <span style={{ color: data.bill.balance < 0 ? "#ff9a8f" : undefined }}>
                {data.bill.balance >= 0 ? `Nếu tắt bây giờ: hoàn lại ${formatVnd(data.bill.balance)}` : `Nếu tắt bây giờ: cần trả thêm ${formatVnd(-data.bill.balance)}`}
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="notice">
          Hết hạn lúc {fmtTime(room.expiresAt)} (còn {fmtDuration(room.expiresAt - serverNow())})
        </div>
      )}
      {data && (
        <label className="check">
          <input
            type="checkbox"
            checked={data.room.is_public}
            onChange={async (e) => {
              await api(`/api/rooms/${room.id}/visibility`, { body: { isPublic: e.target.checked } });
              reload();
            }}
          />{" "}
          Hiện phòng trên trang chủ
        </label>
      )}
      {data && (
        <div className="stack">
          <small>Link mời</small>
          <code style={{ wordBreak: "break-all" }}>{link}</code>
          <button className="hud-btn" onClick={() => navigator.clipboard?.writeText(link)}>
            Sao chép link mời
          </button>
        </div>
      )}
      {catalog?.extensionEnabled && !room.openEnded && (
        <div className="stack">
          <strong>Gia hạn (giữ nguyên sức chứa)</strong>
          <select value={hours ?? ""} onChange={(e) => setHours(Number(e.target.value))}>
            <option value="" disabled>
              Chọn thời gian
            </option>
            {catalog.durationOptions.map((h) => (
              <option key={h} value={h}>
                +{h} giờ
              </option>
            ))}
          </select>
          <input type="text" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} placeholder="Mã giảm giá (nếu có)" maxLength={32} aria-label="Mã giảm giá" />
          <button
            className="hud-btn primary"
            disabled={!hours}
            onClick={async () => {
              try {
                const r = await api<{ orderId: string; free: boolean }>(`/api/rooms/${room.id}/extend`, { body: { hours, promoCode: promo.trim() || undefined } });
                if (r.free) {
                  setMsg("Đã gia hạn miễn phí bằng mã giảm giá.");
                  return;
                }
                window.open(`/orders/${r.orderId}`, "_blank");
                setMsg("Đã tạo đơn gia hạn. Gia hạn chỉ có hiệu lực khi thanh toán được xác nhận.");
              } catch (e) {
                setMsg((e as ApiError).message);
              }
            }}
          >
            Tạo đơn gia hạn
          </button>
          {msg && <small>{msg}</small>}
        </div>
      )}
      <ScheduleSection roomId={room.id} startsAt={room.startsAt} />
      <HostsSection roomId={room.id} />
      <Link className="hud-btn" href={`/room/${room.id}/logs`} target="_blank">
        Xem log phòng
      </Link>
      <button
        className="hud-btn"
        style={{ color: "#ff9a8f" }}
        onClick={async () => {
          const bill = room.openEnded ? " Phòng vô thời hạn sẽ được quyết toán theo số giờ đã mở." : "";
          if (!confirm("Đóng phòng ngay? Mọi người sẽ bị kết thúc phiên và slot được trả về hệ thống." + bill)) return;
          await api(`/api/rooms/${room.id}/close`, { body: {} });
        }}
      >
        Đóng phòng
      </button>
    </div>
  );
}

export function OwnerPanel(p: {
  send: (m: ClientMsg) => void;
  screen: ScreenState;
  serverNow: () => number;
  polls: PollViewDto[];
  members: PublicMember[];
  room: RoomInfoDto;
  chat: ChatLine[];
  hands: { userId: string; name: string; at: number }[];
  isOwner: boolean;
  selfId: string;
  onClose: () => void;
  live: LiveDto | null;
  /** Open the camera panel (the owner goes live themself). */
  onOpenCamera: () => void;
  /** Demo host ("Phòng trải nghiệm"): to-do list, library-only text / pictures, no kick / promote / live broadcast. */
  demo?: { missions: Set<Mission> } | null;
}) {
  const [tab, setTab] = useState<"screen" | "live" | "polls" | "people" | "chat" | "stats" | "room">("screen");
  const liveReq = p.live?.requests.length ?? 0;
  const tabs: [typeof tab, string][] = [
    ["screen", "Màn hình"],
    ["live", p.live?.onAir ? "🔴 Live" : liveReq ? `Live · 🙋${liveReq}` : "Live"],
    ["polls", "Bình chọn"],
    ["people", p.hands.length ? `Người tham dự · ✋${p.hands.length}` : "Người tham dự"],
    ["chat", "Chat"],
    ["stats", "Thống kê"],
    ...(p.isOwner ? ([["room", "Phòng"]] as [typeof tab, string][]) : []),
  ];
  return (
    <aside className="side-panel" aria-label="Điều khiển chủ phòng">
      <div className="row between">
        <strong>{p.demo ? "👑 Chủ phòng trải nghiệm" : p.isOwner ? "Điều khiển chủ phòng" : "Điều khiển (trợ lý)"}</strong>
        <button className="hud-btn" onClick={p.onClose} aria-label="Đóng bảng điều khiển">
          ✕
        </button>
      </div>
      {p.demo && <DemoMissions done={p.demo.missions} />}
      <div className="tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "screen" && (
        <>
          <StageStyleSwitch roomId={p.room.id} style={p.room.stageStyle} lights={p.room.stageLights} send={p.send} />
          <ScreenTab send={p.send} screen={p.screen} serverNow={p.serverNow} roomId={p.room.id} demo={!!p.demo} />
        </>
      )}
      {tab === "live" &&
        (p.demo ? (
          <div className="stack" style={{ gap: 8 }}>
            <p className="notice">Phòng thật: bạn (hoặc khán giả được bạn duyệt) live camera + micro lên màn hình cho cả phòng. Bản trải nghiệm chỉ cho <b>xem trước camera của chính bạn</b>.</p>
            <button className="hud-btn primary" onClick={p.onOpenCamera}>
              🎥 Xem thử camera của tôi
            </button>
          </div>
        ) : (
          <LiveModeration live={p.live} send={p.send} selfId={p.selfId} onOpenCamera={p.onOpenCamera} />
        ))}
      {tab === "polls" && <PollsTab send={p.send} polls={p.polls} />}
      {tab === "people" && <PeopleTab members={p.members} send={p.send} hands={p.hands} isOwner={p.isOwner} selfId={p.selfId} roomId={p.room.id} noKick={!!p.demo} />}
      {tab === "stats" && <StatsTab roomId={p.room.id} />}
      {tab === "chat" && (
        <div className="stack">
          <small>
            Bạn chỉ nhận tin của người ở gần vị trí camera (bán kính chat). Tin nhắn không được lưu; chỉ tin bạn chọn đưa lên màn hình mới được ghi log từ thời điểm đó.
          </small>
          {[...p.chat].reverse().map((c) => (
            <div key={c.id} className="notice row between">
              <span>
                <b>{c.name}:</b> {c.text}
              </span>
              <button className="hud-btn" hidden={!!p.demo} onClick={() => p.send({ t: "promote_chat", id: c.id })}>
                Lên màn hình
              </button>
            </div>
          ))}
          {!p.chat.length && <small>Chưa có tin nhắn ở gần.</small>}
        </div>
      )}
      {tab === "room" && p.isOwner && <RoomTab room={p.room} serverNow={p.serverNow} />}
    </aside>
  );
}
