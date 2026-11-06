/**
 * "Nói chuyện với người xung quanh": proximity voice chat.
 *
 * Media never touches this server: each talker publishes one small Opus track (mono, ~32 kbps,
 * silence ≈ 0 thanks to DTX) to Cloudflare Realtime (SFU); each listener pulls at most
 * VOICE_MAX_SOURCES tracks — the people near them, the ones talking first. This server only decides
 * who may talk and *whom each listener hears* (pickSources), a few cheap distance checks per
 * second, and sends a listener a new list only when it changes.
 * Distance fading and left / right direction are done in the listener's browser (Web Audio).
 */
export const VOICE_MODES = ["off", "all", "accounts"] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export const VOICE_MODE_LABEL: Record<VoiceMode, string> = {
  off: "Tắt nói chuyện",
  all: "Mọi người",
  accounts: "Chỉ tài khoản đăng ký",
};

/** You hear people within this distance (metres), quieter the farther they are. */
export const VOICE_RADIUS = 8;
/** Someone already heard stays until this distance (no on/off flicker at the edge). */
export const VOICE_KEEP_RADIUS = 9.5;
/** At most this many voices per listener (the device / network stay light). */
export const VOICE_MAX_SOURCES = 6;
/** Someone who just spoke keeps their place this long (a pause between sentences). */
export const VOICE_STICKY_MS = 8_000;
/** "Recently talking" counts before plain distance when choosing. */
export const VOICE_RECENT_MS = 30_000;
/** Estimated bitrate of one voice while talking (for the monthly traffic meter). */
export const VOICE_BITRATE_BPS = 32_000;

/** May this person turn their mic on? */
export function mayTalk(mode: VoiceMode, who: { isGuest: boolean; isMod: boolean }): boolean {
  if (mode === "off") return false;
  if (who.isMod || mode === "all") return true;
  return !who.isGuest;
}

export interface VoiceCandidate {
  id: string;
  x: number;
  z: number;
  /** Talking right now (the talker's browser measures it). */
  speaking: boolean;
  lastSpokeAt: number;
}

/**
 * Whom this listener hears: talkers with their mic on near them, at most VOICE_MAX_SOURCES.
 * Order of preference: talking now → just talked (pause) → already heard (stability) → talked
 * recently → nearest. Within a tier, nearer first. Returned in a stable order (ids sorted).
 */
export function pickSources(me: { id: string; x: number; z: number }, talkers: VoiceCandidate[], prev: readonly string[], now: number, max = VOICE_MAX_SOURCES): string[] {
  const had = new Set(prev);
  const scored: { id: string; tier: number; d: number }[] = [];
  for (const t of talkers) {
    if (t.id === me.id) continue;
    const d = Math.hypot(t.x - me.x, t.z - me.z);
    if (d > (had.has(t.id) ? VOICE_KEEP_RADIUS : VOICE_RADIUS)) continue;
    const quiet = now - t.lastSpokeAt;
    const tier = t.speaking ? 0 : quiet < VOICE_STICKY_MS ? 1 : had.has(t.id) ? 2 : quiet < VOICE_RECENT_MS ? 3 : 4;
    scored.push({ id: t.id, tier, d });
  }
  scored.sort((a, b) => a.tier - b.tier || a.d - b.d);
  return scored
    .slice(0, max)
    .map((s) => s.id)
    .sort();
}

export const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** One voice a listener should pull. */
export interface VoiceSource {
  userId: string;
  /** Cloudflare session + track of the talker. */
  sessionId: string;
  track: string;
}

/** What every client of the room knows about voice. */
export interface VoiceDto {
  mode: VoiceMode;
  /** Cloudflare Realtime keys are set on the server. */
  configured: boolean;
  /** Monthly traffic cap reached: no new mic. */
  blocked: boolean;
  /** Who has their mic on (moderators can turn it off). */
  mics: string[];
}

/** Volume of a voice at distance d (the browser does the same with a "linear" PannerNode). */
export function voiceGain(d: number, ref = 1.2, max = VOICE_RADIUS): number {
  if (d <= ref) return 1;
  if (d >= max) return 0;
  return 1 - (d - ref) / (max - ref);
}
