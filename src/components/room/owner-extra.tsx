"use client";

import { useState } from "react";
import { api, ApiError, useApi } from "@/lib/api";

/** "2026-11-12T20:00" in the viewer's local time ⇄ epoch ms. */
function toLocalInput(ms: number | null) {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Planned start of the event: shown on the invite page with a countdown and reminders. */
export function ScheduleSection({ roomId, startsAt }: { roomId: string; startsAt: number | null }) {
  const [value, setValue] = useState(toLocalInput(startsAt));
  const [msg, setMsg] = useState("");
  const save = async (v: string) => {
    try {
      await api(`/api/rooms/${roomId}/schedule`, { body: { startsAt: v ? new Date(v).getTime() : null } });
      setMsg(v ? "Đã lưu giờ bắt đầu. Người đăng ký nhắc sẽ được báo trước." : "Đã bỏ lịch.");
    } catch (e) {
      setMsg((e as ApiError).message);
    }
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <strong>Lịch sự kiện</strong>
      <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Giờ bắt đầu" />
      <div className="row">
        <button className="hud-btn primary" onClick={() => save(value)} disabled={!value}>
          Lưu giờ bắt đầu
        </button>
        {startsAt && (
          <button
            className="hud-btn"
            onClick={() => {
              setValue("");
              save("");
            }}
          >
            Bỏ lịch
          </button>
        )}
      </div>
      <small>Trang mời hiện đếm ngược, nút “Nhắc tôi” (qua Zalo) và “Thêm vào lịch”.</small>
      {msg && <small>{msg}</small>}
    </div>
  );
}

/** Co-hosts and ownership transfer (owner only). */
export function HostsSection({ roomId }: { roomId: string }) {
  const { data, reload } = useApi<{ moderators: { userId: string; name: string; email: string | null }[] }>(`/api/rooms/${roomId}/moderators`);
  const [email, setEmail] = useState("");
  const [owner, setOwner] = useState("");
  const [msg, setMsg] = useState("");
  const run = async (f: () => Promise<unknown>, ok: string) => {
    try {
      await f();
      setMsg(ok);
      reload();
    } catch (e) {
      setMsg((e as ApiError).message);
    }
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <strong>Trợ lý điều hành</strong>
      <small>Trợ lý điều khiển được màn hình, bình chọn, hỏi đáp và mời người ra; không đóng phòng, không thanh toán, không đổi chủ phòng.</small>
      {data?.moderators.map((m) => (
        <div key={m.userId} className="row between">
          <span>
            {m.name} {m.email && <small>({m.email})</small>}
          </span>
          <button className="hud-btn" onClick={() => run(() => api(`/api/rooms/${roomId}/moderators/${m.userId}/remove`, { body: {} }), `Đã bỏ quyền trợ lý của ${m.name}.`)}>
            Bỏ
          </button>
        </div>
      ))}
      {data && !data.moderators.length && <small>Chưa có trợ lý. Có thể chọn ngay trong tab Người tham dự.</small>}
      <div className="row">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email tài khoản" aria-label="Email trợ lý" style={{ flex: 1 }} />
        <button className="hud-btn" disabled={!email.includes("@")} onClick={() => run(() => api(`/api/rooms/${roomId}/moderators`, { body: { email } }), "Đã thêm trợ lý.")}>
          Thêm
        </button>
      </div>
      <strong style={{ marginTop: 8 }}>Chuyển chủ phòng</strong>
      <div className="row">
        <input type="email" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Email chủ phòng mới" aria-label="Email chủ phòng mới" style={{ flex: 1 }} />
        <button
          className="hud-btn"
          style={{ color: "#ff9a8f" }}
          disabled={!owner.includes("@")}
          onClick={() =>
            confirm(`Chuyển phòng cho ${owner}? Bạn sẽ mất quyền chủ phòng (có thể được giữ lại làm trợ lý).`) &&
            run(() => api(`/api/rooms/${roomId}/transfer`, { body: { email: owner, keepAsModerator: true } }), "Đã chuyển chủ phòng. Bạn vẫn là trợ lý.")
          }
        >
          Chuyển
        </button>
      </div>
      {msg && <small className="notice">{msg}</small>}
    </div>
  );
}

interface Report {
  room: { name: string; openedAt: number; closedAt: number | null };
  peak: { connections: number; at: number | null };
  uniqueVisitors: number;
  totals: { reactions: number; chats: number; questions: number; answered: number; polls: number; votes: number };
  series: { at: number; connections: number; seated: number; waiting: number }[];
  polls: { question: string; status: string; options: { label: string; votes: number; pct: number }[]; totalVoters: number }[];
  topQuestions: { text: string; author: string; votes: number; status: string }[];
}

function Spark({ series }: { series: Report["series"] }) {
  if (series.length < 2) return <small>Chưa đủ dữ liệu (lấy mẫu mỗi phút).</small>;
  const w = 320;
  const h = 70;
  const max = Math.max(1, ...series.map((s) => s.connections));
  const t0 = series[0].at;
  const t1 = series[series.length - 1].at;
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * w;
  const y = (v: number) => h - (v / max) * (h - 6) - 3;
  const line = series.map((s, i) => `${i ? "L" : "M"}${x(s.at).toFixed(1)},${y(s.connections).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={`Số người trong phòng theo thời gian, cao nhất ${max}`}>
      <path d={`${line}L${w},${h}L0,${h}Z`} fill="rgb(61 220 151 / 0.18)" />
      <path d={line} fill="none" stroke="#3ddc97" strokeWidth="2" />
    </svg>
  );
}

/** Attendance and engagement for the owner / co-hosts; CSV for reports. */
export function StatsTab({ roomId }: { roomId: string }) {
  const { data, error } = useApi<Report>(`/api/rooms/${roomId}/report`, 60_000);
  if (error) return <p className="notice">{error.message}</p>;
  if (!data) return <small>Đang tải…</small>;
  const t = data.totals;
  return (
    <div className="stack">
      <div className="stats-grid">
        <div>
          <b>{data.peak.connections}</b>
          <small>đông nhất{data.peak.at ? ` lúc ${new Date(data.peak.at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : ""}</small>
        </div>
        <div>
          <b>{data.uniqueVisitors}</b>
          <small>lượt người vào</small>
        </div>
        <div>
          <b>{t.reactions}</b>
          <small>cảm xúc</small>
        </div>
        <div>
          <b>{t.chats}</b>
          <small>tin chat</small>
        </div>
        <div>
          <b>
            {t.answered}/{t.questions}
          </b>
          <small>câu hỏi đã trả lời</small>
        </div>
        <div>
          <b>{t.votes}</b>
          <small>phiếu ({t.polls} bình chọn)</small>
        </div>
      </div>
      <strong>Số người trong phòng</strong>
      <Spark series={data.series} />
      {data.polls.map((p, i) => (
        <div key={i} className="notice stack" style={{ gap: 2 }}>
          <strong>{p.question}</strong>
          {p.options.map((o) => (
            <small key={o.label}>
              {o.label}: {o.votes} ({o.pct}%)
            </small>
          ))}
        </div>
      ))}
      {data.topQuestions.length > 0 && <strong>Câu hỏi được ủng hộ nhiều nhất</strong>}
      {data.topQuestions.map((q, i) => (
        <small key={i}>
          ▲{q.votes} · {q.text} — {q.author}
        </small>
      ))}
      <a className="hud-btn primary" href={`/api/rooms/${roomId}/report.csv`} download>
        Tải báo cáo CSV (Excel)
      </a>
      <small>Không lưu nội dung chat; chỉ đếm số lượng. Số người lấy mẫu mỗi phút.</small>
    </div>
  );
}
