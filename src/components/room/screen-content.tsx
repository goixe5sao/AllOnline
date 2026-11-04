"use client";

import { useEffect, useRef, useState } from "react";
import { currentPosition, type ScreenState } from "@/core/screen";
import type { PollViewDto, StageAd } from "@/core/protocol";
import { StageChart, TradingViewWidget } from "./stage-chart";

export interface ScreenProps {
  state: ScreenState;
  serverNow: () => number;
  polls: PollViewDto[];
  roomName: string;
  expiresAt: number | null;
  warningMinutes: number[];
  volume: number;
  muted: boolean;
  /** false = do not mount media players (another view is playing). */
  active: boolean;
  fullscreen?: boolean;
  reduceMotion?: boolean;
  ad?: StageAd | null;
}

// ---------- YouTube (official IFrame Player API) ----------

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(s: number, allow: boolean): void;
  getCurrentTime(): number;
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
  loadVideoById(id: string, start?: number): void;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, o: unknown) => YTPlayer; PlayerState: Record<string, number> };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytReady: Promise<void> | null = null;
function loadYouTubeApi() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve) => {
    if (window.YT?.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  });
  return ytReady;
}

function YouTubeSync({ videoId, state, serverNow, volume, muted }: { videoId: string } & Pick<ScreenProps, "state" | "serverNow" | "volume" | "muted">) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    loadYouTubeApi().then(() => {
      if (cancelled || !host.current || !window.YT) return;
      const el = document.createElement("div");
      host.current.innerHTML = "";
      host.current.appendChild(el);
      player.current = new window.YT.Player(el, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, start: Math.floor(currentPosition(stateRef.current, serverNow())) },
        events: {
          onReady: () => !cancelled && setReady(true),
          onError: (e: { data: number }) =>
            setErr(e.data === 101 || e.data === 150 ? "Chủ sở hữu video không cho phép phát nhúng. Hãy chọn video khác." : e.data === 2 || e.data === 100 ? "Video không tồn tại hoặc đã bị gỡ." : "Không phát được video."),
        },
      });
    });
    return () => {
      cancelled = true;
      setReady(false);
      player.current?.destroy();
      player.current = null;
    };
  }, [videoId, serverNow]);

  // Apply play/pause/seek from the server state; correct drift periodically.
  useEffect(() => {
    if (!ready || !player.current) return;
    const p = player.current;
    const sync = () => {
      const want = currentPosition(stateRef.current, serverNow());
      const have = p.getCurrentTime?.() ?? 0;
      if (Math.abs(have - want) > 2) p.seekTo(want, true);
      if (stateRef.current.playing) p.playVideo();
      else p.pauseVideo();
    };
    sync();
    const id = setInterval(sync, 4000);
    return () => clearInterval(id);
  }, [ready, state.rev, state.playing, serverNow]);

  useEffect(() => {
    if (!ready || !player.current) return;
    player.current.setVolume(volume);
    if (muted) player.current.mute();
    else player.current.unMute();
  }, [ready, volume, muted]);

  return (
    <>
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      {err && (
        <div className="screen-text" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "#000" }}>
          {err}
        </div>
      )}
    </>
  );
}

function AudioSync({ url, title, state, serverNow, volume, muted }: { url: string; title: string } & Pick<ScreenProps, "state" | "serverNow" | "volume" | "muted">) {
  const ref = useRef<HTMLAudioElement>(null);
  const [blocked, setBlocked] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const sync = () => {
      const want = currentPosition(stateRef.current, serverNow());
      if (Math.abs(a.currentTime - want) > 1.5 && Number.isFinite(want)) a.currentTime = want;
      if (stateRef.current.playing) a.play().then(() => setBlocked(false), () => setBlocked(true));
      else a.pause();
    };
    sync();
    const id = setInterval(sync, 4000);
    return () => clearInterval(id);
  }, [state.rev, state.playing, serverNow, url]);
  useEffect(() => {
    if (ref.current) {
      ref.current.volume = volume / 100;
      ref.current.muted = muted;
    }
  }, [volume, muted]);
  return (
    <div className="screen-text">
      <audio ref={ref} src={url} preload="auto" />
      <div style={{ fontSize: "1.6em" }}>♪</div>
      <div>{title}</div>
      <div style={{ fontSize: "0.5em", opacity: 0.8 }}>{state.playing ? "Đang phát" : "Tạm dừng"}</div>
      {blocked && <div style={{ fontSize: "0.5em" }}>Trình duyệt chặn tự phát — bấm “Bật tiếng” ở thanh điều khiển.</div>}
    </div>
  );
}

function PollOnScreen({ poll }: { poll: PollViewDto | undefined }) {
  if (!poll) return <div className="screen-text">Bình chọn không còn.</div>;
  return (
    <div style={{ width: "100%", display: "grid", placeItems: "center", gap: "0.4em" }}>
      <div style={{ fontWeight: 700, textAlign: "center", padding: "0 5%" }}>{poll.question}</div>
      <div className="poll-bars">
        {poll.options.map((o) => (
          <div className="poll-bar" key={o.id}>
            <i style={{ width: `${o.pct}%` }} />
            <span>
              <span>{o.label}</span>
              <span>
                {o.votes} phiếu · {o.pct}%
              </span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: "0.55em", opacity: 0.85 }}>
        {poll.totalVoters} người đã bình chọn · {poll.status === "open" ? "đang mở" : poll.status === "closed" ? "đã đóng" : "chưa mở"}
      </div>
    </div>
  );
}

function ExpiryOverlay({ expiresAt, serverNow, warningMinutes }: { expiresAt: number; serverNow: () => number; warningMinutes: number[] }) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(id);
  }, [serverNow]);
  const remaining = expiresAt - now;
  const windowMs = Math.max(0, ...warningMinutes) * 60_000;
  if (remaining > windowMs || remaining <= 0) return null;
  const m = Math.floor(remaining / 60_000);
  const s = Math.floor((remaining % 60_000) / 1000);
  return (
    <div className="screen-overlay-warning" role="status">
      Phòng đóng sau {m}:{String(s).padStart(2, "0")}
    </div>
  );
}

export function ScreenContent(p: ScreenProps) {
  const c = p.state.content;
  let body: React.ReactNode;
  switch (c.kind) {
    case "blank":
      body = <div className="screen-text" style={{ opacity: 0.8 }}>{p.roomName}</div>;
      break;
    case "text":
      body = <div className="screen-text">{c.text}</div>;
      break;
    case "image":
      // eslint-disable-next-line @next/next/no-img-element
      body = <img src={c.url} alt="Hình ảnh trên màn hình" referrerPolicy="no-referrer" />;
      break;
    case "youtube":
      body = p.active ? <YouTubeSync videoId={c.videoId} {...p} /> : <div className="screen-text">▶ Video đang phát ở chế độ xem màn hình</div>;
      break;
    case "audio":
      body = p.active ? <AudioSync url={c.url} title={c.title} {...p} /> : <div className="screen-text">♪ {c.title}</div>;
      break;
    case "chart":
      // Re-keyed on the owner's shared settings so local (full-screen) tweaks reset when they change.
      body = (
        <div style={{ position: "absolute", inset: p.ad ? "0 0 9% 0" : 0 }}>
          <StageChart key={JSON.stringify(c)} symbol={c.symbol} interval={c.interval} chartType={c.chartType} indicators={c.indicators} layers={c.layers} interactive={!!p.fullscreen} />
        </div>
      );
      break;
    case "tradingview":
      body = p.active ? (
        <div style={{ position: "absolute", inset: p.ad ? "0 0 9% 0" : 0 }}>
          <TradingViewWidget symbol={c.symbol} interval={c.interval} interactive={!!p.fullscreen} />
        </div>
      ) : (
        <div className="screen-text">TradingView · {c.symbol}</div>
      );
      break;
    case "chat":
      body = (
        <div className="screen-text">
          “{c.text}”
          <div style={{ fontSize: "0.55em", opacity: 0.8, marginTop: "0.5em" }}>— {c.author}</div>
        </div>
      );
      break;
    case "poll":
      body = <PollOnScreen poll={p.polls.find((x) => x.id === c.pollId)} />;
      break;
  }
  return (
    <div className={`screen-surface ${p.fullscreen ? "fullscreen" : ""} ${p.reduceMotion ? "reduce-motion" : ""}`}>
      {body}
      {c.kind === "chat" && <span className="screen-label">Tin nhắn được chủ phòng đưa lên màn hình (được lưu log)</span>}
      {p.ad && (
        <a className="screen-ad" href={p.ad.url} target="_blank" rel="noopener noreferrer">
          <span className="screen-ad-tag">Quảng cáo</span>
          {p.ad.text}
          <span aria-hidden> ↗</span>
        </a>
      )}
      {p.expiresAt && <ExpiryOverlay expiresAt={p.expiresAt} serverNow={p.serverNow} warningMinutes={p.warningMinutes} />}
    </div>
  );
}
