import { describe, expect, it } from "vitest";
import { advanceVideo, applyScreenAction, BLANK_SCREEN, screenContentSchema, type ScreenState } from "@/core/screen";
import { parseWatchPage } from "../server/youtube";

const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";
const C = "ccccccccccc";
const yt = (extra: object = {}): ScreenState => ({ ...BLANK_SCREEN, content: { kind: "youtube", videoId: A, ...extra }, playing: true, positionSec: 200, updatedAt: 1000, rev: 7 });

describe("YouTube end of video", () => {
  it("stop (default): nothing happens", () => {
    expect(advanceVideo(yt(), 5000)).toBeNull();
    expect(advanceVideo(yt({ endMode: "stop" }), 5000)).toBeNull();
  });

  it("loop: same video from 0, playing, new revision", () => {
    const n = advanceVideo(yt({ endMode: "loop" }), 5000)!;
    expect(n.content).toMatchObject({ kind: "youtube", videoId: A });
    expect(n).toMatchObject({ playing: true, positionSec: 0, updatedAt: 5000, rev: 8 });
  });

  it("next: following entry, wraps to the first after the last", () => {
    const s1 = advanceVideo(yt({ endMode: "next", playlist: [A, B, C], index: 0 }), 5000)!;
    expect(s1.content).toMatchObject({ videoId: B, index: 1 });
    const s2 = advanceVideo(s1, 6000)!;
    expect(s2.content).toMatchObject({ videoId: C, index: 2 });
    const s3 = advanceVideo(s2, 7000)!;
    expect(s3.content).toMatchObject({ videoId: A, index: 0 });
    expect(s3.playing).toBe(true);
  });

  it("next: a video removed from the list goes on with the list's first video", () => {
    const n = advanceVideo(yt({ endMode: "next", playlist: [B, C] }), 5000)!;
    expect(n.content).toMatchObject({ videoId: B, index: 0 });
  });

  it("next with a single video behaves like loop", () => {
    const n = advanceVideo(yt({ endMode: "next", playlist: [A], index: 0 }), 5000)!;
    expect(n.content).toMatchObject({ videoId: A, index: 0 });
    expect(n.positionSec).toBe(0);
  });

  it("owner skip (yt_next) moves on whatever the mode", () => {
    const n = applyScreenAction(yt({ endMode: "stop", playlist: [A, B], index: 0 }), { action: "yt_next" }, 5000);
    expect(n.content).toMatchObject({ videoId: B });
    expect(n.playing).toBe(true);
  });

  it("yt_options changes the rule without restarting the video", () => {
    const prev = yt({ endMode: "stop" });
    const n = applyScreenAction(prev, { action: "yt_options", endMode: "next", playlist: [C, A, B] }, 3000);
    expect(n.content).toMatchObject({ videoId: A, endMode: "next", playlist: [C, A, B], index: 1 });
    expect(n.playing).toBe(true);
    expect(n.positionSec).toBeCloseTo(202, 5); // still where it was (200 s + 2 s of playing)
    // switching to loop keeps the list for later
    const m = applyScreenAction(n, { action: "yt_options", endMode: "loop", playlist: [C, A, B] }, 3000);
    expect(m.content).toMatchObject({ endMode: "loop", playlist: [C, A, B] });
  });

  it("yt_options on something else than a video does nothing", () => {
    const s = { ...BLANK_SCREEN, content: { kind: "text" as const, text: "x" } };
    expect(applyScreenAction(s, { action: "yt_options", endMode: "loop", playlist: [] }, 1)).toBe(s);
  });

  it("schema: accepts the options, rejects bad ids / too long lists", () => {
    expect(screenContentSchema.safeParse({ kind: "youtube", videoId: A, endMode: "next", playlist: [A, B], index: 1 }).success).toBe(true);
    expect(screenContentSchema.safeParse({ kind: "youtube", videoId: A, endMode: "forever" }).success).toBe(false);
    expect(screenContentSchema.safeParse({ kind: "youtube", videoId: A, playlist: ["bad"] }).success).toBe(false);
    expect(screenContentSchema.safeParse({ kind: "youtube", videoId: A, playlist: Array(51).fill(A) }).success).toBe(false);
    expect(screenContentSchema.safeParse({ kind: "youtube", videoId: A }).success).toBe(true); // old rooms
  });
});

describe("YouTube watch page", () => {
  it("reads title and length", () => {
    const html = `...,"videoDetails":{"videoId":"${A}","title":"Nh\\u1ea1c \\"hay\\" 2026","lengthSeconds":"213","keywords":[]},...`;
    expect(parseWatchPage(html)).toEqual({ title: 'Nhạc "hay" 2026', durationSec: 213 });
  });
  it("no length → null (live stream / blocked page)", () => {
    expect(parseWatchPage("<html>consent</html>")).toBeNull();
    expect(parseWatchPage('"lengthSeconds":"0"')).toBeNull();
  });
});
