import { describe, expect, it } from "vitest";
import { DEMO_IMAGES, DEMO_WEB_URL, DEMO_PEOPLE_PER_NETWORK, DEMO_SHOWCASE, DEMO_TEXTS, demoContentAllowed, demoDay, demoSecondsLeft } from "@/core/demo";
import { screenContentSchema } from "@/core/screen";
import { normalizeWebUrl } from "@/core/webscroll";

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
    // the demo host shows anything a real room can (free text, picture / sound links)…
    expect(demoContentAllowed({ kind: "text", text: DEMO_TEXTS[0] })).toBe(true);
    expect(demoContentAllowed({ kind: "text", text: "anything I like" })).toBe(true);
    expect(demoContentAllowed({ kind: "image", url: DEMO_IMAGES[0].url })).toBe(true);
    expect(demoContentAllowed({ kind: "image", url: "https://example.com/x.png" })).toBe(true);
    expect(demoContentAllowed({ kind: "audio", url: "https://example.com/a.mp3", title: "x" })).toBe(true);
    // …only the scrolling web page stays goixe5sao.vn
    const web = (url: string) => ({ kind: "web" as const, url, shots: ["/api/uploads/11111111-1111-1111-1111-111111111111"], w: 1280, h: 5000, speed: "normal" as const, takenAt: 1 });
    expect(demoContentAllowed(web("https://goixe5sao.vn/"))).toBe(true); // the one page a demo room shows
    expect(demoContentAllowed(web("https://www.goixe5sao.vn/dat-xe"))).toBe(true);
    expect(demoContentAllowed(web("https://vnexpress.net/"))).toBe(false);
    expect(demoContentAllowed(web("https://goixe5sao.vn.evil.com/"))).toBe(false);
  });

  it("library pictures and the showcase pass the screen schema", () => {
    for (const i of DEMO_IMAGES) expect(screenContentSchema.safeParse({ kind: "image", url: i.url }).success).toBe(true);
    for (const c of DEMO_SHOWCASE) expect(screenContentSchema.safeParse(c).success).toBe(true);
    expect(screenContentSchema.safeParse({ kind: "image", url: "/etc/passwd" }).success).toBe(false);
    expect(normalizeWebUrl(DEMO_WEB_URL)).toBe(DEMO_WEB_URL);
  });
});
