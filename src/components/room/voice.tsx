"use client";

/**
 * Voice chat with the people around you — the browser side.
 *
 *  - Talking: one small Opus track (mono, 32 kbps max, DTX: silence ≈ 0) published to Cloudflare
 *    Realtime once per page; "mic off" only mutes it (instant on/off, no reconnect).
 *    A tiny level meter (VAD) tells the server "talking now / not" on change only.
 *  - Listening: ONE peer connection for all voices. The server says whom to hear (≤ 6, nearest
 *    talkers first); this engine adds / closes tracks to match, one change at a time.
 *  - Sound: Web Audio — each voice through a PannerNode (fades with distance, left / right) set
 *    from the 3D camera ~10× a second; output goes through an <audio> element so the browser's
 *    echo cancellation knows about it. Voices of people you blocked are silent (and not counted).
 *  - When a voice near you is talking, the stage sound is turned down ("ducking").
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { api, ApiError } from "@/lib/api";
import { VOICE_MODE_LABEL, VOICE_MODES, VOICE_RADIUS, type VoiceDto, type VoiceMode, type VoiceSource } from "@/core/voice";
import type { ClientMsg } from "@/core/protocol";
import type { Layout } from "@/core/maps";
import type { MemberStore } from "./use-room";

let iceCache: { at: number; servers: RTCIceServer[] } | null = null;
async function iceServers(): Promise<RTCIceServer[]> {
  if (iceCache && Date.now() - iceCache.at < 3600_000) return iceCache.servers;
  const r = await api<{ iceServers: RTCIceServer[] }>("/api/live/ice");
  iceCache = { at: Date.now(), servers: r.iceServers };
  return r.iceServers;
}

/** Opus for speech: mono, ≤ 32 kbps, DTX (nothing sent while silent), FEC for lossy 4G. */
function tuneOpus(sdp: string): string {
  const pt = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1];
  if (!pt) return sdp;
  return sdp.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`), (_l, params: string) => {
    const keep = params
      .split(";")
      .map((x) => x.trim())
      .filter((x) => x && !/^(usedtx|maxaveragebitrate|stereo|sprop-stereo|useinbandfec)=/i.test(x));
    return `a=fmtp:${pt} ${[...keep, "usedtx=1", "useinbandfec=1", "stereo=0", "maxaveragebitrate=32000"].join(";")}`;
  });
}

const rms = (a: AnalyserNode, buf: Float32Array<ArrayBuffer>) => {
  a.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
};

/** Level above which a voice counts as talking (after the mic's noise suppression). */
const TALK_LEVEL = 0.018;
const HEAR_LEVEL = 0.012;
/** Keep "talking" this long after the last loud frame (pauses between words). */
const TALK_HOLD_MS = 700;
const DUCK_HOLD_MS = 900;

interface Voice {
  source: VoiceSource;
  mid: string | null;
  el?: HTMLAudioElement;
  node?: MediaStreamAudioSourceNode;
  panner?: PannerNode;
  gain?: GainNode;
  analyser?: AnalyserNode;
}

export interface VoiceActivity {
  /** A voice near you is talking (turn the stage down). */
  duck: boolean;
}

export class VoiceEngine {
  ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private outEl: HTMLAudioElement | null = null;
  private buf = new Float32Array(256);
  private micBuf = new Float32Array(512);
  // listening
  private pc: RTCPeerConnection | null = null;
  private pullSession: string | null = null;
  private want: VoiceSource[] = [];
  private voices = new Map<string, Voice>();
  private byMid = new Map<string, string>();
  private busy = false;
  private again = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  blocked = new Set<string>();
  private volume = 1;
  private roomMuted = true;
  // talking
  private micPc: RTCPeerConnection | null = null;
  private micStream: MediaStream | null = null;
  private micAnalyser: AnalyserNode | null = null;
  micOn = false;
  private speaking = false;
  private loudAt = 0;
  private duckAt = 0;
  private duck = false;
  private timer: ReturnType<typeof setInterval>;
  private disposed = false;
  private unlock = () => {
    void this.ctx?.resume();
    void this.outEl?.play().catch(() => {});
  };

  constructor(
    private roomId: string,
    private send: (m: ClientMsg) => void,
    private onActivity: (a: VoiceActivity) => void,
    private onMicLost: (why: string) => void,
  ) {
    // levels: my mic (talking or not) + the voices I hear (ducking), 10× a second, cheap
    this.timer = setInterval(() => this.levels(), 100);
    window.addEventListener("pointerdown", this.unlock);
    window.addEventListener("keydown", this.unlock);
  }

  private ensureCtx(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.roomMuted ? 0 : this.volume;
    // through an <audio> element: the browser's echo cancellation then hears what we play
    const dest = ctx.createMediaStreamDestination();
    this.out.connect(dest);
    this.outEl = new Audio();
    this.outEl.srcObject = dest.stream;
    void this.outEl.play().catch(() => {});
    return ctx;
  }

  /** Room sound on/off and the voices' volume (0..1). */
  setOutput(volume: number, roomMuted: boolean) {
    this.volume = volume;
    this.roomMuted = roomMuted;
    if (this.out && this.ctx) this.out.gain.setTargetAtTime(roomMuted ? 0 : volume, this.ctx.currentTime, 0.05);
    if (!roomMuted) this.unlock();
  }

  setBlocked(ids: Set<string>) {
    this.blocked = ids;
    for (const [id, v] of this.voices) if (v.gain && this.ctx) v.gain.gain.setTargetAtTime(ids.has(id) ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  /** Who is heard now (user ids). */
  heard(): string[] {
    return [...this.voices.keys()];
  }

  // ---------- listening ----------

  /** The server's list of voices for me: add / close tracks to match (one change at a time). */
  setSources(list: VoiceSource[]) {
    this.want = list;
    void this.reconcile();
  }

  private async reconcile() {
    if (this.busy) return void (this.again = true);
    this.busy = true;
    try {
      do {
        this.again = false;
        const want = new Map(this.want.map((s) => [s.userId, s]));
        // gone (or republished with a new track): close
        const drop: string[] = [];
        for (const [id, v] of this.voices) {
          const w = want.get(id);
          if (!w || w.sessionId !== v.source.sessionId || w.track !== v.source.track) drop.push(id);
        }
        if (drop.length) await this.close(drop);
        const add = [...want.values()].filter((s) => !this.voices.has(s.userId));
        if (add.length && !this.disposed) await this.pull(add);
      } while (this.again && !this.disposed);
    } catch (e) {
      // not near any more / Cloudflare hiccup: try again shortly with the latest list
      if (!(e instanceof ApiError && e.code === "VOICE_NOT_NEAR")) console.warn("[voice]", e);
      clearTimeout(this.retry);
      if (!this.disposed) this.retry = setTimeout(() => void this.reconcile(), 3000);
    } finally {
      this.busy = false;
    }
  }

  private async close(ids: string[]) {
    const mids: string[] = [];
    for (const id of ids) {
      const v = this.voices.get(id);
      this.voices.delete(id);
      if (!v) continue;
      if (v.mid) {
        mids.push(v.mid);
        this.byMid.delete(v.mid);
      }
      v.node?.disconnect();
      v.panner?.disconnect();
      v.gain?.disconnect();
      if (v.el) v.el.srcObject = null;
    }
    if (mids.length && this.pullSession) await api(`/api/voice/${this.roomId}/close`, { body: { sessionId: this.pullSession, mids } }).catch(() => {});
  }

  private async pull(add: VoiceSource[]) {
    if (!this.pc) {
      const pc = new RTCPeerConnection({ iceServers: await iceServers(), bundlePolicy: "max-bundle" });
      pc.ontrack = (e) => this.attach(e.transceiver.mid, e.track);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState !== "failed" || this.pc !== pc) return;
        // start over with a new connection
        pc.close();
        this.pc = null;
        this.pullSession = null;
        this.voices.clear();
        this.byMid.clear();
        void this.reconcile();
      };
      this.pc = pc;
    }
    for (const s of add) this.voices.set(s.userId, { source: s, mid: null });
    const r = await api<{ sessionId: string; offer: RTCSessionDescriptionInit; tracks: { mid?: string; track?: string; sessionId?: string }[] }>(`/api/voice/${this.roomId}/pull`, {
      body: { sessionId: this.pullSession, tracks: add.map((s) => ({ sessionId: s.sessionId, track: s.track })) },
    }).catch((e) => {
      for (const s of add) this.voices.delete(s.userId);
      throw e;
    });
    this.pullSession = r.sessionId;
    for (const t of r.tracks) {
      const s = add.find((x) => x.track === t.track && (!t.sessionId || x.sessionId === t.sessionId));
      if (s && t.mid) {
        this.byMid.set(t.mid, s.userId);
        const v = this.voices.get(s.userId);
        if (v) v.mid = t.mid;
      }
    }
    const pc = this.pc!;
    await pc.setRemoteDescription(r.offer);
    await pc.setLocalDescription(await pc.createAnswer());
    await api(`/api/voice/${this.roomId}/answer`, { body: { sessionId: r.sessionId, answer: { type: "answer", sdp: pc.localDescription!.sdp } } });
  }

  /** A voice arrived: element (needed for Web Audio to get remote audio) → panner → gain → out. */
  private attach(mid: string | null, track: MediaStreamTrack) {
    const id = mid ? this.byMid.get(mid) : undefined;
    const v = id ? this.voices.get(id) : undefined;
    if (!v || track.kind !== "audio") return;
    const ctx = this.ensureCtx();
    const stream = new MediaStream([track]);
    const el = new Audio();
    el.muted = true;
    el.srcObject = stream;
    void el.play().catch(() => {});
    const node = ctx.createMediaStreamSource(stream);
    const mobile = typeof navigator !== "undefined" && /Android|iPhone|iPad/i.test(navigator.userAgent);
    const panner = new PannerNode(ctx, { panningModel: mobile ? "equalpower" : "HRTF", distanceModel: "linear", refDistance: 1.2, maxDistance: VOICE_RADIUS, rolloffFactor: 1 });
    const gain = ctx.createGain();
    gain.gain.value = this.blocked.has(id!) ? 0 : 1;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    node.connect(panner).connect(gain).connect(this.out!);
    node.connect(analyser);
    Object.assign(v, { el, node, panner, gain, analyser });
  }

  /** Where I am and where I look (the 3D camera), where each voice is — ~10× a second. */
  setPose(me: { x: number; y: number; z: number; fx: number; fy: number; fz: number }, posOf: (userId: string) => { x: number; y: number; z: number } | null) {
    const ctx = this.ctx;
    if (!ctx || !this.voices.size) return;
    const t = ctx.currentTime;
    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.setTargetAtTime(me.x, t, 0.05);
      L.positionY.setTargetAtTime(me.y, t, 0.05);
      L.positionZ.setTargetAtTime(me.z, t, 0.05);
      L.forwardX.setTargetAtTime(me.fx, t, 0.05);
      L.forwardY.setTargetAtTime(me.fy, t, 0.05);
      L.forwardZ.setTargetAtTime(me.fz, t, 0.05);
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else {
      L.setPosition(me.x, me.y, me.z);
      L.setOrientation(me.fx, me.fy, me.fz, 0, 1, 0);
    }
    for (const [id, v] of this.voices) {
      const p = posOf(id);
      if (!p || !v.panner) continue;
      v.panner.positionX.setTargetAtTime(p.x, t, 0.05);
      v.panner.positionY.setTargetAtTime(p.y, t, 0.05);
      v.panner.positionZ.setTargetAtTime(p.z, t, 0.05);
    }
  }

  // ---------- talking ----------

  /** Mic on / off. The first "on" asks for the mic and publishes the track (needs a click). */
  async setMic(on: boolean) {
    if (on && !this.micPc) await this.publish();
    for (const t of this.micStream?.getAudioTracks() ?? []) t.enabled = on;
    this.micOn = on;
    if (!on) this.speaking = false;
    this.send({ t: "voice_state", mic: on, speaking: this.speaking });
  }

  /** After a reconnect the server no longer knows my mic: publish it again (still on if it was). */
  async republish() {
    if (!this.micPc) return;
    const was = this.micOn;
    this.micPc.close();
    this.micPc = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.micAnalyser = null;
    this.micOn = false;
    if (was) await this.setMic(true);
  }

  /** The server turned my mic off (moderator / mode). */
  forcedOff() {
    for (const t of this.micStream?.getAudioTracks() ?? []) t.enabled = false;
    this.micOn = false;
    this.speaking = false;
  }

  private async publish() {
    const ctx = this.ensureCtx();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    try {
      const pc = new RTCPeerConnection({ iceServers: await iceServers(), bundlePolicy: "max-bundle" });
      const track = stream.getAudioTracks()[0];
      track.enabled = false;
      const tr = pc.addTransceiver(track, { direction: "sendonly", streams: [stream] });
      const p = tr.sender.getParameters();
      p.encodings = [{ ...(p.encodings?.[0] ?? {}), maxBitrate: 32_000 }];
      await tr.sender.setParameters(p).catch(() => {});
      await pc.setLocalDescription(await pc.createOffer());
      const r = await api<{ sessionId: string; answer: RTCSessionDescriptionInit }>(`/api/voice/${this.roomId}/publish`, { body: { offer: { type: "offer", sdp: pc.localDescription!.sdp }, mid: tr.mid } });
      await pc.setRemoteDescription({ type: "answer", sdp: tuneOpus(r.answer.sdp ?? "") });
      pc.onconnectionstatechange = () => {
        if (pc.connectionState !== "failed" || this.micPc !== pc) return;
        this.dropMic();
        this.onMicLost("Mất kết nối âm thanh — bấm 🎙 để bật mic lại.");
      };
      this.micPc = pc;
      this.micStream = stream;
      const a = ctx.createAnalyser();
      a.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(a);
      this.micAnalyser = a;
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      throw e;
    }
  }

  private dropMic() {
    this.micPc?.close();
    this.micPc = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.micAnalyser = null;
    if (this.micOn) this.send({ t: "voice_state", mic: false, speaking: false });
    this.micOn = false;
    this.speaking = false;
  }

  private levels() {
    const now = performance.now();
    // my mic: talking now? (sent on change only)
    if (this.micOn && this.micAnalyser) {
      if (rms(this.micAnalyser, this.micBuf) > TALK_LEVEL) this.loudAt = now;
      const speaking = now - this.loudAt < TALK_HOLD_MS;
      if (speaking !== this.speaking) {
        this.speaking = speaking;
        this.send({ t: "voice_state", mic: true, speaking });
      }
    }
    // voices I hear: anyone talking? → turn the stage down
    let loud = false;
    for (const [id, v] of this.voices) if (v.analyser && !this.blocked.has(id) && rms(v.analyser, this.buf) > HEAR_LEVEL) loud = true;
    if (loud) this.duckAt = now;
    const duck = now - this.duckAt < DUCK_HOLD_MS;
    if (duck !== this.duck) {
      this.duck = duck;
      this.onActivity({ duck });
    }
  }

  /** For tests and support: what this page hears right now (no audio content, levels only). */
  debugState() {
    const voices: Record<string, { level: number; gain: number; connected: boolean }> = {};
    for (const [id, v] of this.voices) voices[id] = { level: v.analyser ? Math.round(rms(v.analyser, this.buf) * 1000) / 1000 : -1, gain: v.gain?.gain.value ?? -1, connected: !!v.node };
    return { micOn: this.micOn, speaking: this.speaking, duck: this.duck, ctx: this.ctx?.state ?? "none", out: this.out?.gain.value ?? -1, voices };
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    clearTimeout(this.retry);
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
    this.dropMic();
    this.pc?.close();
    this.pc = null;
    for (const v of this.voices.values()) if (v.el) v.el.srcObject = null;
    this.voices.clear();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

const BLOCK_KEY = (roomId: string) => `ao-voice-block-${roomId}`;

/** React side: one engine per room page, mic button, blocked people, ducking. */
export function useVoice(roomId: string, send: (m: ClientMsg) => void, o: { voice: VoiceDto | null; sources: VoiceSource[] | null; forced: number; joins: number; isGuest: boolean; isMod: boolean; muted: boolean; volume: number }) {
  const [engine, setEngine] = useState<VoiceEngine | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duck, setDuck] = useState(false);
  const [voiceVolume, setVoiceVolume] = useState(100);
  const [blocked, setBlocked] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(BLOCK_KEY(roomId)) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    const e = new VoiceEngine(
      roomId,
      (m) => sendRef.current(m),
      (a) => setDuck(a.duck),
      (why) => {
        setMicOn(false);
        setError(why);
      },
    );
    setEngine(e);
    (window as unknown as { __aoVoice?: VoiceEngine }).__aoVoice = e;
    return () => e.dispose();
  }, [roomId]);

  useEffect(() => {
    if (engine && o.sources) engine.setSources(o.voice?.mode === "off" ? [] : o.sources);
  }, [engine, o.sources, o.voice?.mode]);
  useEffect(() => engine?.setOutput((o.volume / 100) * (voiceVolume / 100), o.muted), [engine, o.volume, voiceVolume, o.muted]);
  useEffect(() => engine?.setBlocked(blocked), [engine, blocked]);
  // reconnected: the server forgot my mic → publish again
  useEffect(() => {
    if (o.joins > 1 && engine) void engine.republish().catch(() => {
      setMicOn(false);
      setError("Mất mic sau khi kết nối lại — bấm 🎙 để bật lại.");
    });
  }, [o.joins, engine]);
  // the server turned my mic off
  useEffect(() => {
    if (!o.forced || !engine) return;
    engine.forcedOff();
    setMicOn(false);
  }, [o.forced, engine]);

  const v = o.voice;
  const canTalk = !!v && v.mode !== "off" && v.configured && !v.blocked && (o.isMod || v.mode === "all" || !o.isGuest);
  // not allowed any more (mode changed): mic off
  useEffect(() => {
    if (!canTalk && micOn && engine) {
      engine.forcedOff();
      setMicOn(false);
    }
  }, [canTalk, micOn, engine]);

  const toggleMic = useCallback(async () => {
    if (!engine || busy) return;
    setError("");
    setBusy(true);
    try {
      await engine.setMic(!micOn);
      setMicOn(!micOn);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error && e.name === "NotAllowedError" ? "Bạn chưa cho phép dùng micro." : e instanceof Error && e.name === "NotFoundError" ? "Không tìm thấy micro." : "Không bật được mic, thử lại nhé.");
    } finally {
      setBusy(false);
    }
  }, [engine, busy, micOn]);

  const toggleBlock = useCallback(
    (userId: string) => {
      setBlocked((b) => {
        const n = new Set(b);
        if (n.has(userId)) n.delete(userId);
        else n.add(userId);
        try {
          localStorage.setItem(BLOCK_KEY(roomId), JSON.stringify([...n]));
        } catch {}
        return n;
      });
    },
    [roomId],
  );

  // nearTalking: someone near is talking (shown as a hint while the room sound is off)
  return { engine, micOn, busy, error, clearError: () => setError(""), toggleMic, canTalk, duck: duck && !o.muted, nearTalking: duck, blocked, toggleBlock, voiceVolume, setVoiceVolume };
}
export type VoiceApi = ReturnType<typeof useVoice>;

/** Inside the 3D canvas: the listener = the camera; each voice at its avatar's head (~10 Hz). */
export function VoiceSync({ engine, store, layout }: { engine: VoiceEngine | null; store: MemberStore; layout: Layout }) {
  const { camera } = useThree();
  const last = useRef(0);
  const dir = useRef(new THREE.Vector3());
  useFrame(() => {
    if (!engine) return;
    const now = performance.now();
    if (now - last.current < 100) return;
    last.current = now;
    camera.getWorldDirection(dir.current);
    engine.setPose({ x: camera.position.x, y: camera.position.y, z: camera.position.z, fx: dir.current.x, fy: dir.current.y, fz: dir.current.z }, (id) => {
      const m = store.map.get(id);
      if (!m) return null;
      const seat = m.status === "seated" && m.seatId ? layout.seats.find((s) => s.id === m.seatId) : undefined;
      return { x: m.x, y: (seat?.y ?? 0) + 1.2, z: m.z };
    });
  });
  return null;
}

/** Settings: voices' volume, and the people you hear (block one just for you). */
export function VoiceSettings({ voice, names }: { voice: VoiceApi; names: (id: string) => string }) {
  const heard = voice.engine?.heard() ?? [];
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 2000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="stack voice-settings" style={{ gap: 6 }}>
      <label className="hud-menu-row">
        <span>🗣 Giọng người xung quanh</span>
        <input type="range" min={0} max={150} value={voice.voiceVolume} onChange={(e) => voice.setVoiceVolume(Number(e.target.value))} aria-label="Âm lượng giọng nói" />
      </label>
      {heard.length > 0 && (
        <div className="voice-heard">
          <small className="muted">Đang nghe được ({heard.length}) — bấm để chặn tiếng riêng với bạn:</small>
          {heard.map((id) => (
            <button key={id} type="button" className={`hud-btn voice-person ${voice.blocked.has(id) ? "off" : ""}`} aria-pressed={voice.blocked.has(id)} onClick={() => voice.toggleBlock(id)}>
              {voice.blocked.has(id) ? "🔇" : "🔊"} {names(id)}
            </button>
          ))}
        </div>
      )}
      {voice.blocked.size > 0 && heard.every((id) => !voice.blocked.has(id)) && (
        <button type="button" className="hud-btn" onClick={() => [...voice.blocked].forEach((id) => voice.toggleBlock(id))}>
          Bỏ chặn {voice.blocked.size} người
        </button>
      )}
    </div>
  );
}

/** Owner / co-host: who may talk, mute everyone, mute one person (list of open mics). */
export function VoiceModeration({ voice, send, names, selfId }: { voice: VoiceDto | null; send: (m: ClientMsg) => void; names: (id: string) => string; selfId: string }) {
  if (!voice) return null;
  const others = voice.mics.filter((id) => id !== selfId);
  return (
    <div className="stack voice-mod" style={{ gap: 8 }}>
      <strong>🎙 Nói chuyện với người xung quanh</strong>
      {!voice.configured && <small className="notice warn">Máy chủ chưa có mã Cloudflare Realtime — chưa ai bật mic được.</small>}
      <label className="field">
        Ai được bật mic
        <select value={voice.mode} onChange={(e) => send({ t: "voice_mode", mode: e.target.value as VoiceMode })} aria-label="Chế độ nói chuyện">
          {VOICE_MODES.map((m) => (
            <option key={m} value={m}>
              {VOICE_MODE_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <div className="row between" style={{ gap: 8 }}>
        <small>{others.length ? `Đang bật mic: ${others.length} người` : "Chưa ai bật mic."}</small>
        {others.length > 0 && (
          <button className="hud-btn danger" onClick={() => send({ t: "voice_mute" })}>
            🔇 Tắt mic tất cả
          </button>
        )}
      </div>
      {others.length > 0 && (
        <ul className="voice-mics">
          {others.map((id) => (
            <li key={id}>
              <span>🎙 {names(id)}</span>
              <button className="hud-btn" onClick={() => send({ t: "voice_mute", userId: id })}>
                Tắt mic
              </button>
            </li>
          ))}
        </ul>
      )}
      <small className="muted">Mỗi người nghe tối đa 6 giọng gần nhất (bán kính ~{VOICE_RADIUS} m), xa thì nhỏ dần. Không ghi âm.</small>
    </div>
  );
}
