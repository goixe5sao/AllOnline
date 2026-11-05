"use client";

import { useEffect, useState } from "react";
import { api, fmtDuration } from "@/lib/api";
import { parseYouTubeId, PLAYLIST_MAX, type ScreenState, type YouTubeEndMode } from "@/core/screen";
import type { ClientMsg } from "@/core/protocol";

const MODES: [YouTubeEndMode, string, string][] = [
  ["stop", "⏹ Dừng lại", "Hết video thì dừng ở khung cuối"],
  ["loop", "🔁 Chiếu lặp lại", "Hết video thì chiếu lại từ đầu, liên tục"],
  ["next", "⏭ Chiếu tiếp danh sách", "Hết video thì chiếu video kế tiếp trong danh sách; hết danh sách quay lại video đầu"],
];

type Info = { title: string | null; durationSec: number | null };
/** Titles / lengths already asked for, shared by every panel instance. */
const infoCache = new Map<string, Info>();

/**
 * Owner's YouTube controls: a playlist (add by link, reorder, remove, play any entry now) and what
 * happens when a video ends. Changes apply live to the video on screen (no restart); the server
 * moves on by itself at the end, for everyone at the same moment.
 */
export function YouTubePanel({ send, screen }: { send: (m: ClientMsg) => void; screen: ScreenState }) {
  const cur = screen.content.kind === "youtube" ? screen.content : null;
  const [list, setList] = useState<string[]>(() => (cur ? (cur.playlist?.length ? cur.playlist : [cur.videoId]) : []));
  const [mode, setMode] = useState<YouTubeEndMode>(cur?.endMode ?? "stop");
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");
  const [, setTick] = useState(0);

  // titles + lengths for the list (server reads them from YouTube)
  useEffect(() => {
    let alive = true;
    for (const id of list) {
      if (infoCache.has(id)) continue;
      infoCache.set(id, { title: null, durationSec: null });
      api<Info>(`/api/youtube/${id}`)
        .then((i) => infoCache.set(id, i))
        .catch(() => {})
        .finally(() => alive && setTick((t) => t + 1));
    }
    return () => {
      alive = false;
    };
  }, [list]);

  /** Keep the local state and, when a YouTube video is on screen, the live rule in step. */
  const apply = (nextList: string[], nextMode: YouTubeEndMode) => {
    setList(nextList);
    setMode(nextMode);
    if (cur) send({ t: "screen", action: "yt_options", endMode: nextMode, playlist: nextList });
  };
  const add = () => {
    setErr("");
    const ids = link
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => parseYouTubeId(x));
    if (!ids.length) return setErr("Dán link YouTube vào ô trên.");
    if (ids.some((x) => !x)) return setErr("Có link YouTube không hợp lệ.");
    const fresh = (ids as string[]).filter((x, i, a) => !list.includes(x) && a.indexOf(x) === i);
    if (!fresh.length) return setErr("Video này đã có trong danh sách.");
    if (list.length + fresh.length > PLAYLIST_MAX) return setErr(`Danh sách tối đa ${PLAYLIST_MAX} video.`);
    apply([...list, ...fresh], mode);
    setLink("");
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const n = [...list];
    [n[i], n[j]] = [n[j], n[i]];
    apply(n, mode);
  };
  const remove = (i: number) => apply(list.filter((_, k) => k !== i), mode);
  /** Put entry i on the screen now (paused, like any new content: the owner presses ▶ Phát). */
  const playNow = (i: number) =>
    send({ t: "screen", action: "set", content: { kind: "youtube", videoId: list[i], endMode: mode, playlist: list.length > 1 ? list : undefined, index: i } });

  return (
    <div className="stack yt-panel" style={{ gap: 8 }}>
      <div className="row">
        <input type="text" value={link} onChange={(e) => (setLink(e.target.value), setErr(""))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} placeholder="Dán link YouTube (nhiều link cách nhau bằng dấu cách)" style={{ flex: 1 }} aria-label="Link YouTube" />
        <button type="button" className="hud-btn" onClick={add}>
          ➕ Thêm
        </button>
      </div>
      {err && <small style={{ color: "var(--danger)" }}>{err}</small>}

      {list.length > 0 && (
        <ol className="yt-list" aria-label="Danh sách phát">
          {list.map((id, i) => {
            const info = infoCache.get(id);
            const onAir = cur?.videoId === id;
            return (
              <li key={id} className={onAir ? "on-air" : ""}>
                <span className="yt-n">{onAir ? "▶" : i + 1}</span>
                <span className="yt-t" title={id}>
                  {info?.title || id}
                  {info?.durationSec ? <small> · {fmtDuration(info.durationSec * 1000)}</small> : null}
                </span>
                <span className="yt-b">
                  <button type="button" className="hud-btn" title="Chiếu video này ngay" aria-label={`Chiếu ngay video ${i + 1}`} onClick={() => playNow(i)}>
                    ▶
                  </button>
                  <button type="button" className="hud-btn" aria-label={`Đưa video ${i + 1} lên`} disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button type="button" className="hud-btn" aria-label={`Đưa video ${i + 1} xuống`} disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  <button type="button" className="hud-btn" aria-label={`Xoá video ${i + 1}`} onClick={() => remove(i)}>
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="field">
        <strong style={{ fontSize: 13 }}>Khi hết video</strong>
        <div className="row" role="radiogroup" aria-label="Khi hết video">
          {MODES.map(([v, t, d]) => (
            <button key={v} type="button" role="radio" aria-checked={mode === v} className={`hud-btn ${mode === v ? "primary" : ""}`} title={d} onClick={() => apply(list, v)}>
              {t}
            </button>
          ))}
        </div>
        <small>{MODES.find((m) => m[0] === mode)?.[2]}</small>
        {mode === "next" && list.length < 2 && <small style={{ color: "var(--warn, #f0b860)" }}>Thêm ít nhất 2 video vào danh sách để chiếu tiếp.</small>}
      </div>

      <div className="row">
        <button type="button" className="hud-btn primary" disabled={!list.length} onClick={() => playNow(0)}>
          Hiển thị video đầu tiên lên màn hình
        </button>
        {cur && (cur.playlist?.length ?? 0) > 1 && (
          <button type="button" className="hud-btn" onClick={() => send({ t: "screen", action: "yt_next" })}>
            ⏭ Video tiếp
          </button>
        )}
      </div>
      <small>Dùng trình phát nhúng chính thức của YouTube. Video bị chủ sở hữu chặn nhúng sẽ báo lỗi trên màn hình. Lặp lại / chiếu tiếp do máy chủ điều khiển nên mọi người chuyển video cùng lúc, kể cả khi bạn đóng bảng này.</small>
    </div>
  );
}
