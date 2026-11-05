"use client";

/**
 * Live camera on the stage screen.
 * Media: broadcaster → Cloudflare Realtime (SFU) → every viewer, over WebRTC. Our server only
 * exchanges the SDP with Cloudflare (the secret stays there) and decides who may go live.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { LIVE_MAX_VIDEO_BPS, LIVE_MODE_LABEL, LIVE_MODES, type LiveDto, type LiveMode } from "@/core/live";
import type { ClientMsg } from "@/core/protocol";

let iceCache: { at: number; servers: RTCIceServer[] } | null = null;
async function iceServers(): Promise<RTCIceServer[]> {
  if (iceCache && Date.now() - iceCache.at < 3600_000) return iceCache.servers;
  const r = await api<{ iceServers: RTCIceServer[] }>("/api/live/ice");
  iceCache = { at: Date.now(), servers: r.iceServers };
  return r.iceServers;
}

const errText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error && e.name === "NotAllowedError" ? "Bạn chưa cho phép dùng camera / micro." : e instanceof Error && e.name === "NotFoundError" ? "Không tìm thấy camera hoặc micro." : "Không kết nối được, thử lại nhé.");

// ---------------- watching ----------------

/** The person on air, pulled from the SFU (not for the broadcaster themself). */
export function useLiveViewer(roomId: string, live: LiveDto | null, selfId: string) {
  const on = live?.onAir ?? null;
  const key = on && on.userId !== selfId ? on.sessionId : null;
  const [stream, setStream] = useState<{ key: string; s: MediaStream } | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!key) return;
    let pc: RTCPeerConnection | null = null;
    let dead = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const again = () => {
      if (!dead) retry = setTimeout(() => setAttempt((a) => a + 1), 2500);
    };
    (async () => {
      const ice = await iceServers();
      if (dead) return;
      pc = new RTCPeerConnection({ iceServers: ice, bundlePolicy: "max-bundle" });
      const ms = new MediaStream();
      pc.ontrack = (e) => {
        ms.addTrack(e.track);
        if (!dead) setStream({ key, s: new MediaStream(ms.getTracks()) });
      };
      pc.onconnectionstatechange = () => {
        if (pc?.connectionState === "failed") again();
      };
      const r = await api<{ sessionId: string; offer: RTCSessionDescriptionInit }>(`/api/live/${roomId}/pull`, { body: {} });
      if (dead) return;
      await pc.setRemoteDescription(r.offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await api(`/api/live/${roomId}/answer`, { body: { sessionId: r.sessionId, answer: { type: "answer", sdp: pc.localDescription!.sdp } } });
      if (!dead) setError(null);
    })().catch((e) => {
      if (dead) return;
      setError({ key, text: errText(e) });
      // the broadcaster's tracks may need a moment on the SFU: try again a few times
      if (attempt < 5) again();
    });
    return () => {
      dead = true;
      clearTimeout(retry);
      pc?.close();
    };
  }, [roomId, key, attempt]);

  return { stream: stream && stream.key === key ? stream.s : null, error: error && error.key === key ? error.text : "" };
}

/** Plays the live audio (the video elements on the screen stay muted). */
export function LiveAudio({ stream, volume, muted }: { stream: MediaStream | null; volume: number; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    if (a.srcObject !== stream) a.srcObject = stream;
    a.volume = Math.max(0, Math.min(1, volume / 100));
    a.muted = muted;
    if (stream && !muted) void a.play().catch(() => {});
  }, [stream, volume, muted]);
  return <audio ref={ref} autoPlay playsInline style={{ display: "none" }} />;
}

/** The camera picture on the stage screen (muted: sound plays through LiveAudio). */
export function LiveVideo({ stream, name, mirror }: { stream: MediaStream; name: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (v && v.srcObject !== stream) {
      v.srcObject = stream;
      void v.play().catch(() => {});
    }
  }, [stream]);
  return (
    <div className="live-on-screen">
      <video ref={ref} autoPlay playsInline muted style={mirror ? { transform: "scaleX(-1)" } : undefined} />
      <span className="live-badge">
        <i aria-hidden /> LIVE · {name}
      </span>
    </div>
  );
}

// ---------------- broadcasting ----------------

export type PubState = "idle" | "preview" | "connecting" | "live";

/** Camera / mic of this device, and the connection that sends them to the SFU. */
export function useLivePublisher(roomId: string, send: (m: ClientMsg) => void) {
  const [state, setState] = useState<PubState>("idle");
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const release = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setPreview(null);
  }, []);

  /** Ask for the camera / mic (or switch device) and show the preview. */
  const openPreview = useCallback(
    async (cam?: string, mic?: string) => {
      setError("");
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, ...(cam ? { deviceId: { exact: cam } } : { facingMode: "user" }) },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(mic ? { deviceId: { exact: mic } } : {}) },
        });
        const pc = pcRef.current;
        if (pc) {
          // on air: swap the tracks without renegotiating
          for (const sender of pc.getSenders()) {
            const t = s.getTracks().find((x) => x.kind === sender.track?.kind);
            if (t) await sender.replaceTrack(t);
          }
        }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        s.getAudioTracks().forEach((t) => (t.enabled = micOn));
        s.getVideoTracks().forEach((t) => (t.enabled = camOn));
        streamRef.current = s;
        setPreview(s);
        setState((st) => (st === "idle" ? "preview" : st));
      } catch (e) {
        setError(errText(e));
      }
    },
    [micOn, camOn],
  );

  const goLive = useCallback(async () => {
    const s = streamRef.current;
    if (!s) return;
    setError("");
    setState("connecting");
    try {
      const pc = new RTCPeerConnection({ iceServers: await iceServers(), bundlePolicy: "max-bundle" });
      pcRef.current = pc;
      const trans = s.getTracks().map((t) => pc.addTransceiver(t, { direction: "sendonly" }));
      for (const tr of trans) {
        if (tr.sender.track?.kind !== "video") continue;
        const p = tr.sender.getParameters();
        p.encodings = [{ ...(p.encodings?.[0] ?? {}), maxBitrate: LIVE_MAX_VIDEO_BPS, maxFramerate: 30 }];
        await tr.sender.setParameters(p).catch(() => {});
      }
      await pc.setLocalDescription(await pc.createOffer());
      const tracks = trans.map((tr) => ({ mid: tr.mid!, kind: tr.sender.track!.kind as "audio" | "video" }));
      const r = await api<{ sessionId: string; answer: RTCSessionDescriptionInit }>(`/api/live/${roomId}/publish`, { body: { offer: { type: "offer", sdp: pc.localDescription!.sdp }, tracks } });
      await pc.setRemoteDescription(r.answer);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") setError("Mất kết nối tới máy chủ video. Bấm “Kết thúc” rồi lên sóng lại.");
      };
      setState("live");
    } catch (e) {
      pcRef.current?.close();
      pcRef.current = null;
      setError(errText(e));
      setState("preview");
    }
  }, [roomId]);

  /** Stop broadcasting (tell the room) and turn the camera off. */
  const stop = useCallback(
    (tellServer = true) => {
      if (tellServer) send({ t: "live_stop" });
      release();
      setState("idle");
    },
    [send, release],
  );

  const toggleMic = () => {
    const on = !micOn;
    setMicOn(on);
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = on));
  };
  const toggleCam = () => {
    const on = !camOn;
    setCamOn(on);
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = on));
  };

  useEffect(() => release, [release]);

  return { state, preview, error, micOn, camOn, openPreview, goLive, stop, toggleMic, toggleCam };
}
export type LivePublisher = ReturnType<typeof useLivePublisher>;

function Preview({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} className="live-preview" autoPlay playsInline muted />;
}

function Devices({ pub }: { pub: LivePublisher }) {
  const [list, setList] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!pub.preview) return;
    void navigator.mediaDevices.enumerateDevices().then(setList);
  }, [pub.preview]);
  const cur = (kind: "video" | "audio") => pub.preview?.getTracks().find((t) => t.kind === kind)?.getSettings().deviceId ?? "";
  const cams = list.filter((d) => d.kind === "videoinput");
  const mics = list.filter((d) => d.kind === "audioinput");
  if (cams.length < 2 && mics.length < 2) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {cams.length > 1 && (
        <label className="field">
          Camera
          <select value={cur("video")} onChange={(e) => void pub.openPreview(e.target.value, cur("audio") || undefined)}>
            {cams.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {mics.length > 1 && (
        <label className="field">
          Micro
          <select value={cur("audio")} onChange={(e) => void pub.openPreview(cur("video") || undefined, e.target.value)}>
            {mics.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Micro ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/** Everyone's live panel: ask to go live / camera preview / go on air / stop. */
export function LivePanel({ live, selfId, isMod, send, pub, onClose }: { live: LiveDto; selfId: string; isMod: boolean; send: (m: ClientMsg) => void; pub: LivePublisher; onClose: () => void }) {
  const mine = live.onAir?.userId === selfId;
  const allowed = live.mode !== "off" && (isMod || mine || (live.mode !== "mods" && live.granted === selfId));
  const asked = live.requests.some((r) => r.userId === selfId);
  const blocked = live.quota.blocked && !mine;
  return (
    <aside className="side-panel live-panel" aria-label="Live camera">
      <div className="row between">
        <strong>🎥 Live camera lên màn hình</strong>
        <button className="hud-btn" onClick={onClose} aria-label="Đóng">
          ✕
        </button>
      </div>
      {live.onAir && !mine && (
        <p className="notice">
          🔴 <b>{live.onAir.name}</b> đang live trên màn hình.
        </p>
      )}
      {!live.configured && <p className="notice warn">Máy chủ chưa bật dịch vụ video (Cloudflare Realtime) nên chưa live được.</p>}
      {live.mode === "off" ? (
        <p className="notice">Chủ phòng đang tắt live trong phòng này.</p>
      ) : blocked ? (
        <p className="notice warn">Hệ thống đã dùng hết hạn mức live của tháng này.</p>
      ) : !allowed ? (
        live.mode === "mods" ? (
          <p className="notice">Chỉ chủ phòng và trợ lý được lên sóng trong phòng này.</p>
        ) : asked ? (
          <div className="stack" style={{ gap: 8 }}>
            <p className="notice">⏳ Đã gửi yêu cầu, đang chờ chủ phòng duyệt…</p>
            <button className="hud-btn" onClick={() => send({ t: "live_stop" })}>
              Huỷ yêu cầu
            </button>
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <p className="muted" style={{ margin: 0 }}>
              Dùng camera và micro của bạn để phát hình + tiếng lên màn hình sân khấu cho cả phòng. {live.mode === "approve" ? "Chủ phòng sẽ duyệt trước khi bạn lên sóng." : ""}
            </p>
            <button className="hud-btn primary" onClick={() => send({ t: "live_ask" })}>
              {live.mode === "auto" && !live.onAir ? "🎥 Lên sóng" : "🙋 Xin lên sóng"}
            </button>
          </div>
        )
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {!mine && !isMod && live.granted === selfId && <p className="notice ok">✅ Chủ phòng đã cho bạn lên sóng. Bật camera, xem trước rồi bấm “Lên sóng”.</p>}
          {pub.preview ? <Preview stream={pub.preview} /> : <div className="live-preview empty">Camera đang tắt</div>}
          {pub.state === "idle" && (
            <button className="hud-btn primary" onClick={() => void pub.openPreview()}>
              📷 Bật camera để xem trước
            </button>
          )}
          {pub.preview && (
            <>
              <Devices pub={pub} />
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <button className="hud-btn" aria-pressed={!pub.micOn} onClick={pub.toggleMic}>
                  {pub.micOn ? "🎙️ Tắt mic" : "🔇 Bật mic"}
                </button>
                <button className="hud-btn" aria-pressed={!pub.camOn} onClick={pub.toggleCam}>
                  {pub.camOn ? "📷 Tắt hình" : "🚫 Bật hình"}
                </button>
              </div>
              {pub.state === "preview" && (
                <button className="hud-btn primary live-go" disabled={!live.configured} onClick={() => void pub.goLive()}>
                  🔴 Lên sóng{live.onAir && !mine ? ` (thay ${live.onAir.name})` : ""}
                </button>
              )}
              {pub.state === "connecting" && <p className="notice">Đang kết nối máy chủ video…</p>}
              {(pub.state === "live" || pub.state === "preview") && (
                <button className="hud-btn danger" onClick={() => pub.stop()}>
                  {pub.state === "live" ? "⏹ Kết thúc live" : "Tắt camera"}
                </button>
              )}
            </>
          )}
          {pub.state === "live" && <p className="notice ok">🔴 Bạn đang live — cả phòng thấy và nghe bạn trên màn hình.</p>}
        </div>
      )}
      {pub.error && <p className="notice error">{pub.error}</p>}
      <small className="muted">Không ghi lại buổi live. Chủ phòng có thể cắt sóng bất cứ lúc nào. Người live chịu trách nhiệm nội dung mình phát.</small>
    </aside>
  );
}

/** Owner / co-host tab: who may go live, requests to approve, cut the broadcast. */
export function LiveModeration({ live, send, selfId, onOpenCamera }: { live: LiveDto | null; send: (m: ClientMsg) => void; selfId: string; onOpenCamera: () => void }) {
  if (!live) return null;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {!live.configured && <p className="notice warn">Máy chủ chưa có mã Cloudflare Realtime — chưa ai live được (vẫn chỉnh được quyền).</p>}
      <label className="field">
        Ai được live camera lên màn hình
        <select value={live.mode} onChange={(e) => send({ t: "live_mode", mode: e.target.value as LiveMode })} aria-label="Chế độ live">
          {LIVE_MODES.map((m) => (
            <option key={m} value={m}>
              {LIVE_MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      {live.onAir ? (
        <div className="notice row between" style={{ gap: 8 }}>
          <span>
            🔴 Đang live: <b>{live.onAir.name}</b>
          </span>
          <button className="hud-btn danger" onClick={() => send({ t: "live_stop", userId: live.onAir!.userId })}>
            ✂️ Cắt sóng
          </button>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          Chưa ai live.
        </p>
      )}
      {live.granted && live.granted !== live.onAir?.userId && (
        <div className="row between" style={{ gap: 8 }}>
          <small>Đã duyệt, đang bật camera: {live.requests.find((r) => r.userId === live.granted)?.name ?? "1 người"}</small>
          <button className="hud-btn" onClick={() => send({ t: "live_deny", userId: live.granted! })}>
            Thu hồi
          </button>
        </div>
      )}
      {live.mode !== "off" && (
        <button className="hud-btn primary" onClick={onOpenCamera}>
          🎥 Tôi lên sóng
        </button>
      )}
      <strong style={{ fontSize: 13 }}>Xin lên sóng ({live.requests.length})</strong>
      {live.requests.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Chưa có ai xin.
        </p>
      ) : (
        <ul className="live-requests">
          {live.requests.map((r) => (
            <li key={r.userId}>
              <span>{r.name}</span>
              <span className="row" style={{ gap: 4 }}>
                <button className="hud-btn primary" onClick={() => send({ t: "live_grant", userId: r.userId })} disabled={r.userId === selfId}>
                  Duyệt
                </button>
                <button className="hud-btn" onClick={() => send({ t: "live_deny", userId: r.userId })}>
                  Từ chối
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <small className="muted">
        Hạn mức live tháng này: {live.quota.usedGb} / {live.quota.capGb} GB{live.quota.blocked ? " — đã hết, không mở được lượt mới" : ""}.
      </small>
    </div>
  );
}
