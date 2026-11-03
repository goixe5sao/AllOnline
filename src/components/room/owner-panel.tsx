"use client";

import { useState } from "react";
import Link from "next/link";
import { api, ApiError, fmtDuration, fmtTime, useApi } from "@/lib/api";
import { currentPosition, parseYouTubeId, type ScreenContent, type ScreenState } from "@/core/screen";
import type { ClientMsg, PollViewDto, RoomInfoDto } from "@/core/protocol";
import type { PublicMember } from "@/core/room-engine";
import type { ChatLine } from "./use-room";

const STATUS_VI: Record<string, string> = { seated: "Đang ngồi", finding: "Đang tìm chỗ", invited: "Được mời vào chỗ", waiting: "Chờ ngoài cổng" };

function ScreenTab({ send, screen, serverNow, roomId }: { send: (m: ClientMsg) => void; screen: ScreenState; serverNow: () => number; roomId: string }) {
  const [kind, setKind] = useState<ScreenContent["kind"]>("text");
  const [value, setValue] = useState("");
  const [title, setTitle] = useState("");
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
    else if (kind === "chart") content = { kind: "chart", symbol: (value.trim() || "VNINDEX").toUpperCase(), source: "demo" };
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
        <select value={kind} onChange={(e) => setKind(e.target.value as ScreenContent["kind"])}>
          <option value="text">Văn bản</option>
          <option value="image">Hình ảnh (https hoặc tải lên)</option>
          <option value="youtube">Video YouTube</option>
          <option value="audio">Âm thanh (https hoặc tải lên)</option>
          <option value="chart">Biểu đồ nến (dữ liệu demo)</option>
          <option value="blank">Màn hình trống</option>
        </select>
      </label>
      {kind === "text" && <textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} maxLength={500} placeholder="Nội dung hiển thị" />}
      {(kind === "image" || kind === "audio" || kind === "youtube" || kind === "chart") && (
        <input type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "youtube" ? "https://www.youtube.com/watch?v=…" : kind === "chart" ? "Mã chứng khoán, ví dụ VNINDEX" : "https://…"} />
      )}
      {kind === "audio" && <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tiêu đề" />}
      {(kind === "image" || kind === "audio") && (
        <label className="field">
          <small>Hoặc tải tệp lên (ảnh PNG/JPEG/WebP/GIF, âm thanh MP3/OGG/WAV/M4A; giới hạn dung lượng do chủ ứng dụng cấu hình)</small>
          <input type="file" accept={kind === "image" ? "image/png,image/jpeg,image/webp,image/gif" : "audio/*"} disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      )}
      {kind === "chart" && <small>Chưa có nguồn dữ liệu thị trường thật — biểu đồ ghi rõ “DỮ LIỆU DEMO”.</small>}
      {kind === "youtube" && <small>Dùng trình phát nhúng chính thức của YouTube. Video bị chủ sở hữu chặn nhúng sẽ báo lỗi trên màn hình.</small>}
      <button className="hud-btn primary" onClick={show}>
        Hiển thị lên màn hình
      </button>
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

function PeopleTab({ members, send }: { members: PublicMember[]; send: (m: ClientMsg) => void }) {
  const count = (s: string) => members.filter((m) => m.status === s).length;
  return (
    <div className="stack">
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
              <td style={{ textAlign: "right" }}>
                <button className="hud-btn" onClick={() => confirm(`Mời ${m.name} ra khỏi phòng?`) && send({ t: "kick", userId: m.userId })}>
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
  const { data } = useApi<{ room: { invite_code: string } }>(`/api/rooms/${room.id}`);
  const [hours, setHours] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const link = data ? `${typeof location !== "undefined" ? location.origin : ""}/join/${data.room.invite_code}` : "";
  return (
    <div className="stack">
      <div className="notice">
        Hết hạn lúc {fmtTime(room.expiresAt)} (còn {fmtDuration(room.expiresAt - serverNow())})
      </div>
      {data && (
        <div className="stack">
          <small>Link mời</small>
          <code style={{ wordBreak: "break-all" }}>{link}</code>
          <button className="hud-btn" onClick={() => navigator.clipboard?.writeText(link)}>
            Sao chép link mời
          </button>
        </div>
      )}
      {catalog?.extensionEnabled && (
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
          <button
            className="hud-btn primary"
            disabled={!hours}
            onClick={async () => {
              try {
                const r = await api<{ orderId: string }>(`/api/rooms/${room.id}/extend`, { body: { hours } });
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
      <Link className="hud-btn" href={`/room/${room.id}/logs`} target="_blank">
        Xem log phòng
      </Link>
      <button
        className="hud-btn"
        style={{ color: "#ff9a8f" }}
        onClick={async () => {
          if (!confirm("Đóng phòng ngay? Mọi người sẽ bị kết thúc phiên và slot được trả về hệ thống.")) return;
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
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"screen" | "polls" | "people" | "chat" | "room">("screen");
  const tabs: [typeof tab, string][] = [
    ["screen", "Màn hình"],
    ["polls", "Bình chọn"],
    ["people", "Người tham dự"],
    ["chat", "Chat"],
    ["room", "Phòng"],
  ];
  return (
    <aside className="side-panel" aria-label="Điều khiển chủ phòng">
      <div className="row between">
        <strong>Điều khiển chủ phòng</strong>
        <button className="hud-btn" onClick={p.onClose} aria-label="Đóng bảng điều khiển">
          ✕
        </button>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "screen" && <ScreenTab send={p.send} screen={p.screen} serverNow={p.serverNow} roomId={p.room.id} />}
      {tab === "polls" && <PollsTab send={p.send} polls={p.polls} />}
      {tab === "people" && <PeopleTab members={p.members} send={p.send} />}
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
              <button className="hud-btn" onClick={() => p.send({ t: "promote_chat", id: c.id })}>
                Lên màn hình
              </button>
            </div>
          ))}
          {!p.chat.length && <small>Chưa có tin nhắn ở gần.</small>}
        </div>
      )}
      {tab === "room" && <RoomTab room={p.room} serverNow={p.serverNow} />}
    </aside>
  );
}
