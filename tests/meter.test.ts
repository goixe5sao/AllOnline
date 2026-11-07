import { describe, expect, it } from "vitest";
import { LiveMeter } from "../server/live";
import { VOICE_BITRATE_BPS } from "@/core/voice";
import { LIVE_BITRATE_BPS } from "@/core/live";

/** A tiny stand-in for app.kv (the meter only reads / writes rows there). */
function fakeDb(rows: Record<string, unknown> = {}) {
  const kv = new Map(Object.entries(rows));
  return {
    kv,
    async query(sql: string, params: unknown[] = []) {
      if (sql.startsWith("select value from app.kv")) return { rows: kv.has(params[0] as string) ? [{ value: kv.get(params[0] as string) }] : [] };
      if (sql.startsWith("insert into app.kv")) {
        kv.set(params[0] as string, JSON.parse(params[1] as string));
        return { rows: [] };
      }
      if (sql.startsWith("select key, value from app.kv")) return { rows: [...kv].filter(([k]) => k.startsWith("live_usage:")).sort((a, b) => b[0].localeCompare(a[0])).map(([key, value]) => ({ key, value })) };
      throw new Error("unexpected " + sql);
    },
  };
}
const NOV = Date.UTC(2026, 10, 7, 3);

describe("live camera + voice traffic meter", () => {
  it("counts video and voice apart, total = both", async () => {
    const db = fakeDb();
    const m = new LiveMeter(db as never);
    await m.add(10, 3600, NOV); // 10 viewers × 1 h of live camera
    await m.add(4, 3600, NOV, VOICE_BITRATE_BPS, "voice"); // 4 voices heard while talking × 1 h
    const s = await m.split(NOV);
    expect(s.videoGb).toBeCloseTo((10 * 3600 * LIVE_BITRATE_BPS) / 8 / 1e9, 6);
    expect(s.voiceGb).toBeCloseTo((4 * 3600 * VOICE_BITRATE_BPS) / 8 / 1e9, 6);
    expect(s.totalGb).toBeCloseTo(s.videoGb + s.voiceGb, 9);
    await m.save();
    expect(db.kv.get("live_usage:2026-11")).toMatchObject({ video: expect.any(Number), voice: expect.any(Number), bytes: expect.any(Number) });
  });

  it("a month saved before the split (one total) counts as live camera", async () => {
    const m = new LiveMeter(fakeDb({ "live_usage:2026-11": { bytes: 2e9 } }) as never);
    const s = await m.split(NOV);
    expect(s.videoGb).toBeCloseTo(2, 6);
    expect(s.voiceGb).toBe(0);
  });

  it("history: newest month first, each part apart", async () => {
    const m = new LiveMeter(fakeDb({ "live_usage:2026-10": { bytes: 5e9 }, "live_usage:2026-11": { bytes: 3e9, video: 2e9, voice: 1e9 } }) as never);
    const h = await m.history(6);
    expect(h.map((x) => x.month)).toEqual(["2026-11", "2026-10"]);
    expect(h[0]).toMatchObject({ videoGb: 2, voiceGb: 1 });
    expect(h[1]).toMatchObject({ videoGb: 5, voiceGb: 0 });
  });
});
