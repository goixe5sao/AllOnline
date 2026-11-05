import { describe, expect, it } from "vitest";
import { askLive, denyLive, goOnAir, grantLive, initialLive, mayPublish, quotaMonth, setLiveMode, stopLive } from "@/core/live";

const A = { id: "a", name: "An" };
const B = { id: "b", name: "Bình" };
const air = (userId: string) => ({ userId, name: userId, sessionId: "s-" + userId, tracks: { video: "v", audio: "a" }, startedAt: 1 });

describe("live camera permissions", () => {
  it("approve (default): a viewer asks, waits, a moderator approves, then may publish", () => {
    let s = initialLive();
    expect(s.mode).toBe("approve");
    const r = askLive(s, A, false, 10);
    expect(r.ok && !r.granted).toBe(true);
    s = (r as { state: typeof s }).state;
    expect(s.requests).toEqual([{ userId: "a", name: "An", at: 10 }]);
    expect(mayPublish(s, "a", false)).toBe(false);
    // asking twice does not duplicate
    expect((askLive(s, A, false, 11) as { state: typeof s }).state.requests).toHaveLength(1);
    s = grantLive(s, "a");
    expect(s.requests).toEqual([]);
    expect(mayPublish(s, "a", false)).toBe(true);
    expect(mayPublish(s, "b", false)).toBe(false);
  });

  it("deny removes the request; stop takes someone off air and drops their grant", () => {
    let s = (askLive(initialLive(), A, false, 1) as { state: ReturnType<typeof initialLive> }).state;
    s = denyLive(s, "a");
    expect(s.requests).toEqual([]);
    s = goOnAir(grantLive(s, "b"), air("b")).state;
    expect(s.onAir?.userId).toBe("b");
    expect(s.granted).toBeNull();
    s = stopLive(s, "b");
    expect(s.onAir).toBeNull();
    expect(mayPublish(s, "b", false)).toBe(false);
  });

  it("auto: the first viewer goes straight on; a second one waits while someone is live", () => {
    let s = initialLive("auto");
    const r1 = askLive(s, A, false, 1);
    expect(r1.ok && r1.granted).toBe(true);
    s = goOnAir((r1 as { state: typeof s }).state, air("a")).state;
    const r2 = askLive(s, B, false, 2);
    expect(r2.ok && !r2.granted).toBe(true);
    expect((r2 as { state: typeof s }).state.requests.map((x) => x.userId)).toEqual(["b"]);
  });

  it("mods only: viewers are refused, moderators may always publish", () => {
    const s = initialLive("mods");
    const r = askLive(s, A, false, 1);
    expect(r.ok).toBe(false);
    expect(mayPublish(s, "owner", true)).toBe(true);
    // switching to "mods" withdraws a viewer's approval
    const g = setLiveMode(grantLive(initialLive(), "a"), "mods");
    expect(g.granted).toBeNull();
    expect(mayPublish(g, "a", false)).toBe(false);
  });

  it("off: nobody, and switching off ends the broadcast and clears requests", () => {
    let s = goOnAir(grantLive(initialLive(), "a"), air("a")).state;
    s = setLiveMode(s, "off");
    expect(s).toEqual({ mode: "off", requests: [], granted: null, onAir: null });
    expect(mayPublish(s, "owner", true)).toBe(false);
    expect(askLive(s, A, true, 1).ok).toBe(false);
  });

  it("a newly approved person replaces the one on air when their camera is up", () => {
    let s = goOnAir(grantLive(initialLive(), "a"), air("a")).state;
    s = grantLive(s, "b");
    expect(s.onAir?.userId).toBe("a"); // still live while B sets up
    const r = goOnAir(s, air("b"));
    expect(r.replaced).toBe("a");
    expect(r.state.onAir?.userId).toBe("b");
  });

  it("quota month is counted in Vietnam time", () => {
    expect(quotaMonth(Date.UTC(2026, 10, 30, 18, 0))).toBe("2026-12"); // 01:00 on 1 Dec in VN
    expect(quotaMonth(Date.UTC(2026, 10, 30, 16, 0))).toBe("2026-11");
  });
});
