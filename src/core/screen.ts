import { z } from "zod";

/** What the stage screen shows. Kept in the room row and in the room log on every change. */
export type ScreenContent =
  | { kind: "blank" }
  | { kind: "text"; text: string }
  | { kind: "image"; url: string }
  | { kind: "youtube"; videoId: string }
  | { kind: "audio"; url: string; title: string }
  | { kind: "chart"; symbol: string; source: "demo" }
  | { kind: "chat"; text: string; author: string }
  | { kind: "poll"; pollId: string };
// Reserved for the future "Diễn giả trực tiếp" source (not in v1 scope):
// | { kind: "live_speaker"; speakerUserId: string; streamRef: string }

export interface ScreenState {
  content: ScreenContent;
  playing: boolean;
  /** Media position (seconds) at server time `updatedAt`. */
  positionSec: number;
  /** Server epoch ms. Clients never use their own clock as the reference. */
  updatedAt: number;
  rev: number;
}

export const BLANK_SCREEN: ScreenState = { content: { kind: "blank" }, playing: false, positionSec: 0, updatedAt: 0, rev: 0 };

const httpsUrl = z
  .string()
  .max(1000)
  .url()
  .refine((u) => u.startsWith("https://") || u.startsWith("/api/uploads/"), "Chỉ chấp nhận liên kết https");

export const screenContentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("blank") }),
  z.object({ kind: z.literal("text"), text: z.string().trim().min(1).max(500) }),
  z.object({ kind: z.literal("image"), url: z.union([httpsUrl, z.string().regex(/^\/api\/uploads\/[0-9a-f-]{36}$/)]) }),
  z.object({ kind: z.literal("youtube"), videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/) }),
  z.object({
    kind: z.literal("audio"),
    url: z.union([httpsUrl, z.string().regex(/^\/api\/uploads\/[0-9a-f-]{36}$/)]),
    title: z.string().trim().max(120).default("Âm thanh"),
  }),
  z.object({ kind: z.literal("chart"), symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9.]{1,12}$/), source: z.literal("demo") }),
  z.object({ kind: z.literal("poll"), pollId: z.string().uuid() }),
]);

/** Accepts a full YouTube URL or a bare id. Returns null when it is not a YouTube video. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
      return m ? m[1] : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function isPlayable(content: ScreenContent): boolean {
  return content.kind === "youtube" || content.kind === "audio";
}

/** Current media position for a client, using the server clock estimate. */
export function currentPosition(state: ScreenState, serverNow: number): number {
  if (!state.playing) return state.positionSec;
  return Math.max(0, state.positionSec + (serverNow - state.updatedAt) / 1000);
}

export type ScreenAction =
  | { action: "set"; content: ScreenContent }
  | { action: "play" }
  | { action: "pause" }
  | { action: "seek"; positionSec: number };

export function applyScreenAction(prev: ScreenState, a: ScreenAction, now: number): ScreenState {
  const pos = currentPosition(prev, now);
  switch (a.action) {
    case "set":
      return { content: a.content, playing: false, positionSec: 0, updatedAt: now, rev: prev.rev + 1 };
    case "play":
      return { ...prev, playing: isPlayable(prev.content), positionSec: pos, updatedAt: now, rev: prev.rev + 1 };
    case "pause":
      return { ...prev, playing: false, positionSec: pos, updatedAt: now, rev: prev.rev + 1 };
    case "seek":
      return { ...prev, positionSec: Math.max(0, a.positionSec), updatedAt: now, rev: prev.rev + 1 };
  }
}
