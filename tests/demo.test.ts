import { describe, expect, it } from "vitest";
import { DEMO_IMAGES, DEMO_PEOPLE_PER_NETWORK, DEMO_SHOWCASE, DEMO_TEXTS, demoContentAllowed, demoDay, demoSecondsLeft } from "@/core/demo";
import { screenContentSchema } from "@/core/screen";

describe("demo rooms", () => {
  it("5 minutes a day per device; the network caps private-tab tricks", () => {
    expect(demoSecondsLeft(300, 0, 0)).toBe(300);
    expect(demoSecondsLeft(300, 120, 120)).toBe(180);
    expect(demoSecondsLeft(300, 300, 300)).toBe(0);
    // a new private tab = new device, but the same network has used up its share
    expect(demoSecondsLeft(300, 0, 300 * DEMO_PEOPLE_PER_NETWORK)).toBe(0);
    expect(demoSecondsLeft(300, 0, 300 * DEMO_PEOPLE_PER_NETWORK - 50)).toBe(50);
  });

  it("the day turns at midnight Vietnam time", () => {
    expect(demoDay(Date.UTC(2026, 10, 6, 16, 59))).toBe("2026-11-06"); // 23:59 in VN
    expect(demoDay(Date.UTC(2026, 10, 6, 17, 0))).toBe("2026-11-07"); // 00:00 in VN
  });

  it("the demo host: YouTube / charts free, text and pictures from the library only", () => {
    expect(demoContentAllowed({ kind: "youtube", videoId: "dQw4w9WgXcQ" })).toBe(true);
    expect(demoContentAllowed({ kind: "chart", symbol: "FPT", source: "demo" })).toBe(true);
    expect(demoContentAllowed({ kind: "text", text: DEMO_TEXTS[0] })).toBe(true);
    expect(demoContentAllowed({ kind: "text", text: "anything I like" })).toBe(false);
    expect(demoContentAllowed({ kind: "image", url: DEMO_IMAGES[0].url })).toBe(true);
    expect(demoContentAllowed({ kind: "image", url: "https://example.com/x.png" })).toBe(false);
    expect(demoContentAllowed({ kind: "audio", url: "https://example.com/a.mp3", title: "x" })).toBe(false);
  });

  it("library pictures and the showcase pass the screen schema", () => {
    for (const i of DEMO_IMAGES) expect(screenContentSchema.safeParse({ kind: "image", url: i.url }).success).toBe(true);
    for (const c of DEMO_SHOWCASE) expect(screenContentSchema.safeParse(c).success).toBe(true);
    expect(screenContentSchema.safeParse({ kind: "image", url: "/etc/passwd" }).success).toBe(false);
  });
});
