import type { AiStockContent, AiStockCommand } from "./ai-stock";
import { WEB_SPEEDS, type WebSpeed } from "./webscroll";
import { z } from "zod";
import { ANALYSIS_LAYERS, type AnalysisLayer } from "./analysis";
import { CHART_INTERVALS, CHART_TYPES, INDICATORS, type ChartInterval, type ChartType, type Indicator } from "./market";

/** What the stage screen shows. Kept in the room row and in the room log on every change. */
export type ScreenContent =
  | AiStockContent
  | { kind: "blank" }
  | { kind: "text"; text: string }
  | { kind: "image"; url: string }
  /**
   * endMode — what happens when the video ends: "stop" (default), "loop" = play it again from the
   * start, "next" = the next video of `playlist` (back to the first after the last one).
   * `index` = position of `videoId` in `playlist`.
   */
  | { kind: "youtube"; videoId: string; endMode?: YouTubeEndMode; playlist?: string[]; index?: number }
  | { kind: "audio"; url: string; title: string }
  | { kind: "chart"; symbol: string; source: "demo"; interval?: ChartInterval; chartType?: ChartType; indicators?: Indicator[]; layers?: AnalysisLayer[] }
  /** Official TradingView widget (real data, full tools). TradingView does not serve HOSE/HNX symbols in widgets. */
  | { kind: "tradingview"; symbol: string; interval: ChartInterval }
  | { kind: "chat"; text: string; author: string }
  /**
   * A web page shown as a photo of the whole page (taken by the server), scrolled top → bottom →
   * back up over and over, in step for everyone (position from the screen clock).
   */
  | { kind: "web"; url: string; shots: string[]; w: number; h: number; title?: string; speed: WebSpeed; takenAt: number }
  | { kind: "poll"; pollId: string }
  /** A question from the room's Q&A, put on the stage by the owner / a co-host. */
  | { kind: "question"; questionId: string; text: string; author: string; votes: number };
// Reserved for the future "Diễn giả trực tiếp" source (not in v1 scope):
// | { kind: "live_speaker"; speakerUserId: string; streamRef: string }

export const YOUTUBE_END_MODES = ["stop", "loop", "next"] as const;
export type YouTubeEndMode = (typeof YOUTUBE_END_MODES)[number];
/** Longest playlist the owner can build. */
export const PLAYLIST_MAX = 50;
const ytId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);

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
  // https links, uploads, or the site's own sample pictures (demo room library)
  z.object({ kind: z.literal("image"), url: z.union([httpsUrl, z.string().regex(/^\/api\/uploads\/[0-9a-f-]{36}$/), z.string().regex(/^\/(maps\/[a-z_]+\.webp|og\.png)$/)]) }),
  z.object({
    kind: z.literal("youtube"),
    videoId: ytId,
    endMode: z.enum(YOUTUBE_END_MODES).optional(),
    playlist: z.array(ytId).max(PLAYLIST_MAX).optional(),
    index: z.number().int().min(0).max(PLAYLIST_MAX).optional(),
  }),
  z.object({
    kind: z.literal("audio"),
    url: z.union([httpsUrl, z.string().regex(/^\/api\/uploads\/[0-9a-f-]{36}$/)]),
    title: z.string().trim().max(120).default("Âm thanh"),
  }),
  z.object({
    kind: z.literal("chart"),
    symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9.]{1,12}$/),
    source: z.literal("demo"),
    interval: z.enum(CHART_INTERVALS).optional(),
    chartType: z.enum(CHART_TYPES).optional(),
    indicators: z.array(z.enum(INDICATORS)).max(INDICATORS.length).optional(),
    layers: z.array(z.enum(ANALYSIS_LAYERS)).max(ANALYSIS_LAYERS.length).optional(),
  }),
  z.object({ kind: z.literal("tradingview"), symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{1,20}:[A-Z0-9_.!]{1,20}$|^[A-Z0-9_.!]{1,20}$/), interval: z.enum(CHART_INTERVALS) }),
  z.object({
    kind: z.literal("web"),
    url: z.string().max(1000).regex(/^https?:\/\//),
    /** the page photo in strips of WEB_TILE px, top to bottom */
    shots: z.array(z.string().regex(/^\/api\/uploads\/[0-9a-f-]{36}$/)).min(1).max(8),
    w: z.number().int().min(320).max(4000),
    h: z.number().int().min(100).max(20000),
    title: z.string().max(200).optional(),
    speed: z.enum(WEB_SPEEDS),
    takenAt: z.number(),
  }),
  z.object({ kind: z.literal("poll"), pollId: z.string().uuid() }),
  z.object({ kind: z.literal("question"), questionId: z.string().uuid(), text: z.string().max(300), author: z.string().max(60), votes: z.number().int().min(0) }),
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
  return content.kind === "youtube" || content.kind === "audio" || content.kind === "web";
}

/** Current media position for a client, using the server clock estimate. */
export function currentPosition(state: ScreenState, serverNow: number): number {
  if (!state.playing) return state.positionSec;
  return Math.max(0, state.positionSec + (serverNow - state.updatedAt) / 1000);
}

export type ScreenAction =
  | AiStockCommand
  | { action: "set"; content: ScreenContent }
  | { action: "play" }
  | { action: "pause" }
  | { action: "seek"; positionSec: number }
  /** Change what happens at the end / the playlist of the video on screen, without restarting it. */
  | { action: "yt_options"; endMode: YouTubeEndMode; playlist: string[] }
  /** Owner skips to the next video of the playlist now. */
  | { action: "yt_next" };

/**
 * What the screen shows once the current YouTube video has ended (or the owner skips):
 * "loop" → same video from 0, "next" → next playlist entry (wrapping), playing at once.
 * null = nothing to do ("stop", or not a YouTube video).
 */
export function advanceVideo(prev: ScreenState, now: number, force = false): ScreenState | null {
  const c = prev.content;
  if (c.kind !== "youtube") return null;
  const mode = force ? (c.playlist?.length ? "next" : "loop") : (c.endMode ?? "stop");
  if (mode === "stop") return null;
  let content: ScreenContent = c;
  if (mode === "next" && c.playlist?.length) {
    const cur = c.index !== undefined && c.playlist[c.index] === c.videoId ? c.index : c.playlist.indexOf(c.videoId);
    const i = (cur + 1) % c.playlist.length; // not in the list any more (cur = -1) → its first video
    content = { ...c, videoId: c.playlist[i], index: i };
  }
  return { content, playing: true, positionSec: 0, updatedAt: now, rev: prev.rev + 1 };
}

export function applyScreenAction(prev: ScreenState, a: ScreenAction, now: number): ScreenState {
  const pos = currentPosition(prev, now);
  switch (a.action) {
    case "ai_stock": return prev; // server director handles this command
    case "set":
      return { content: a.content, playing: false, positionSec: 0, updatedAt: now, rev: prev.rev + 1 };
    case "play":
      return { ...prev, playing: isPlayable(prev.content), positionSec: pos, updatedAt: now, rev: prev.rev + 1 };
    case "pause":
      return { ...prev, playing: false, positionSec: pos, updatedAt: now, rev: prev.rev + 1 };
    case "seek":
      return { ...prev, positionSec: Math.max(0, a.positionSec), updatedAt: now, rev: prev.rev + 1 };
    case "yt_options": {
      const c = prev.content;
      if (c.kind !== "youtube") return prev;
      // the list is kept whatever the mode (switching modes must not lose it); only "next" uses it
      const playlist = a.playlist.length ? a.playlist.slice(0, PLAYLIST_MAX) : undefined;
      const index = playlist ? playlist.indexOf(c.videoId) : undefined;
      // playing state and position untouched: only the rule for "after the end" changes
      return { ...prev, positionSec: pos, updatedAt: now, content: { ...c, endMode: a.endMode, playlist, index: index !== undefined && index >= 0 ? index : undefined }, rev: prev.rev + 1 };
    }
    case "yt_next":
      return advanceVideo(prev, now, true) ?? prev;
  }
}
