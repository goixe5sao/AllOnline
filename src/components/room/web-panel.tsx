"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { ScreenState } from "@/core/screen";
import type { ClientMsg } from "@/core/protocol";
import { WEB_SPEED_LABEL, WEB_SPEEDS, normalizeWebUrl, type WebSpeed } from "@/core/webscroll";
import { DEMO_WEB_URL } from "@/core/demo";

interface Shot {
  shots: string[];
  url: string;
  w: number;
  h: number;
  title: string;
  takenAt: number;
}

/**
 * Owner's "Trang web tự cuộn": paste a link → the server photographs the whole page → the stage
 * scrolls it from the top to the bottom, back up, and again. "Chụp lại" refreshes the photo.
 * Demo rooms: always goixe5sao.vn, no link to type (the server keeps one shared photo).
 */
export function WebPanel({ send, screen, roomId, demo }: { send: (m: ClientMsg) => void; screen: ScreenState; roomId: string; demo?: boolean }) {
  const cur = screen.content.kind === "web" ? screen.content : null;
  const [link, setLink] = useState(demo ? DEMO_WEB_URL : (cur?.url ?? ""));
  const [speed, setSpeed] = useState<WebSpeed>(cur?.speed ?? "normal");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const put = (s: Shot, sp: WebSpeed) => {
    send({ t: "screen", action: "set", content: { kind: "web", url: s.url, shots: s.shots, w: s.w, h: s.h, title: s.title || undefined, speed: sp, takenAt: s.takenAt } });
    send({ t: "screen", action: "play" });
  };

  const shoot = async (url: string) => {
    setErr("");
    if (!normalizeWebUrl(url)) return setErr("Link không hợp lệ — dán địa chỉ trang web công khai, ví dụ https://vnexpress.net");
    setBusy(true);
    try {
      put(await api<Shot>(`/api/rooms/${roomId}/webshot`, { body: { url } }), speed);
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack web-panel" style={{ gap: 8 }}>
      {demo ? (
        <small>
          Trang chiếu: <b>goixe5sao.vn</b> — bản trải nghiệm dùng trang có sẵn; phòng thật của bạn thì dán link trang nào cũng được.
        </small>
      ) : (
        <div className="row">
          <input type="text" value={link} onChange={(e) => (setLink(e.target.value), setErr(""))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void shoot(link))} placeholder="Dán link trang web, ví dụ https://vnexpress.net" style={{ flex: 1 }} aria-label="Link trang web" />
        </div>
      )}
      <div className="row" role="radiogroup" aria-label="Tốc độ cuộn">
        <small>Tốc độ cuộn:</small>
        {WEB_SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={speed === s}
            className={`hud-btn ${speed === s ? "primary" : ""}`}
            onClick={() => {
              setSpeed(s);
              // already on screen: same photo, new speed (starts again from the top)
              if (cur) put({ shots: cur.shots, url: cur.url, w: cur.w, h: cur.h, title: cur.title ?? "", takenAt: cur.takenAt }, s);
            }}
          >
            {WEB_SPEED_LABEL[s]}
          </button>
        ))}
      </div>
      <div className="row">
        <button type="button" className="hud-btn primary" disabled={busy || !link.trim()} onClick={() => void shoot(link)}>
          {busy ? "⏳ Đang chụp trang… (5–20 giây)" : demo ? "📸 Chiếu trang goixe5sao.vn lên màn hình" : "📸 Chụp trang & chiếu lên màn hình"}
        </button>
        {cur && !busy && !demo && (
          <button type="button" className="hud-btn" onClick={() => void shoot(cur.url)} title="Trang đã đổi nội dung? Chụp lại bản mới">
            🔄 Chụp lại
          </button>
        )}
      </div>
      {err && <small style={{ color: "var(--danger, #e5484d)" }}>{err}</small>}
      <small>
        Máy chủ chụp <b>toàn bộ trang</b> thành một ảnh dài; màn hình cuộn từ đầu xuống cuối trang, dừng 3 giây, quay lên đầu và lặp lại — mọi người thấy cùng một vị trí. Đây là ảnh chụp (không bấm được link trong trang); trang thay đổi thì bấm “Chụp lại”. Trang cần đăng nhập sẽ chỉ chụp được phần công khai.
      </small>
    </div>
  );
}
