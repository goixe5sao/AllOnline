/**
 * Live camera on the stage screen: who may broadcast and who is on air.
 * Media goes person → Cloudflare Realtime (SFU) → viewers; this server only decides permissions.
 *
 * Modes (room owner / co-hosts choose):
 *   off      — nobody can go live;
 *   mods     — only the owner and co-hosts;
 *   approve  — anyone may ask, a moderator approves (default);
 *   auto     — anyone may go live at once (when nobody else is on air).
 * One person on air at a time. Moderators can always go live (unless off) and cut anyone.
 */
export const LIVE_MODES = ["off", "mods", "approve", "auto"] as const;
export type LiveMode = (typeof LIVE_MODES)[number];

export const LIVE_MODE_LABEL: Record<LiveMode, string> = {
  off: "Tắt live",
  mods: "Chỉ chủ phòng & trợ lý",
  approve: "Khán giả xin, chủ phòng duyệt",
  auto: "Khán giả tự lên sóng",
};

/** Estimated bitrate per viewer (720p video + Opus audio), used for the monthly quota meter. */
export const LIVE_BITRATE_BPS = 1_800_000;
/** Max video bitrate the broadcaster sends. */
export const LIVE_MAX_VIDEO_BPS = 1_500_000;

export interface LiveOnAir {
  userId: string;
  name: string;
  /** Cloudflare session of the broadcaster + its track names (viewers pull these). */
  sessionId: string;
  tracks: { audio?: string; video?: string };
  startedAt: number;
}

export interface LiveState {
  mode: LiveMode;
  /** People waiting for approval (approve mode). */
  requests: { userId: string; name: string; at: number }[];
  /** Approved but not on air yet (they are setting up the camera). */
  granted: string | null;
  onAir: LiveOnAir | null;
}

export interface LiveQuota {
  usedGb: number;
  capGb: number;
  /** Cap reached (or 0): no new broadcast this month. */
  blocked: boolean;
}

/** What every client of the room receives. */
export interface LiveDto extends LiveState {
  quota: LiveQuota;
  /** Cloudflare Realtime keys are set on the server. */
  configured: boolean;
}

export const initialLive = (mode: LiveMode = "approve"): LiveState => ({ mode, requests: [], granted: null, onAir: null });

export type LiveAsk = { ok: true; state: LiveState; granted: boolean } | { ok: false; code: string; message: string };

/** A viewer asks to go live. */
export function askLive(s: LiveState, user: { id: string; name: string }, isMod: boolean, now: number): LiveAsk {
  if (s.mode === "off") return { ok: false, code: "LIVE_OFF", message: "Chủ phòng đang tắt live." };
  if (isMod || s.granted === user.id || s.onAir?.userId === user.id) return { ok: true, state: s, granted: true };
  if (s.mode === "mods") return { ok: false, code: "LIVE_MODS_ONLY", message: "Chỉ chủ phòng và trợ lý được lên sóng trong phòng này." };
  if (s.mode === "auto" && !s.onAir && !s.granted) return { ok: true, state: { ...s, granted: user.id, requests: s.requests.filter((r) => r.userId !== user.id) }, granted: true };
  if (s.requests.some((r) => r.userId === user.id)) return { ok: true, state: s, granted: false };
  if (s.requests.length >= 50) return { ok: false, code: "LIVE_QUEUE_FULL", message: "Danh sách xin lên sóng đã đầy." };
  return { ok: true, state: { ...s, requests: [...s.requests, { userId: user.id, name: user.name, at: now }] }, granted: false };
}

/** A moderator approves someone: they may publish now (the current broadcaster is replaced when they do). */
export function grantLive(s: LiveState, userId: string): LiveState {
  return { ...s, granted: userId, requests: s.requests.filter((r) => r.userId !== userId) };
}

export function denyLive(s: LiveState, userId: string): LiveState {
  return { ...s, requests: s.requests.filter((r) => r.userId !== userId), granted: s.granted === userId ? null : s.granted };
}

/** Someone stops (themselves or cut by a moderator): off air, grant and request dropped. */
export function stopLive(s: LiveState, userId: string): LiveState {
  return { ...s, onAir: s.onAir?.userId === userId ? null : s.onAir, granted: s.granted === userId ? null : s.granted, requests: s.requests.filter((r) => r.userId !== userId) };
}

export function setLiveMode(s: LiveState, mode: LiveMode): LiveState {
  if (mode === "off") return { mode, requests: [], granted: null, onAir: null };
  // stricter mode: pending viewer requests no longer make sense
  if (mode === "mods") return { ...s, mode, requests: [], granted: null };
  return { ...s, mode };
}

/** May this person publish right now? (Quota / keys are checked by the server separately.) */
export function mayPublish(s: LiveState, userId: string, isMod: boolean): boolean {
  if (s.mode === "off") return false;
  if (isMod) return true;
  if (s.mode === "mods") return false;
  return s.granted === userId || s.onAir?.userId === userId;
}

/** The broadcaster's media is up: they are on air (replacing anyone else). */
export function goOnAir(s: LiveState, on: LiveOnAir): { state: LiveState; replaced: string | null } {
  const replaced = s.onAir && s.onAir.userId !== on.userId ? s.onAir.userId : null;
  return { state: { ...s, onAir: on, granted: s.granted === on.userId ? null : s.granted, requests: s.requests.filter((r) => r.userId !== on.userId) }, replaced };
}

/** "2026-11" — the month the quota counts in (Vietnam time). */
export function quotaMonth(now: number): string {
  const d = new Date(now + 7 * 3600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
