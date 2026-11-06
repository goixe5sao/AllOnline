import { describe, expect, it } from "vitest";
import { WEB_BACK_UP, WEB_PAUSE_BOTTOM, WEB_PAUSE_TOP, isPrivateAddress, normalizeWebUrl, webCycle, webOffset, webViewHeight } from "@/core/webscroll";
import { applyScreenAction, BLANK_SCREEN, currentPosition, screenContentSchema } from "@/core/screen";

const W = 1280;
const H = 5000;

describe("web page scrolling", () => {
  it("top → (pause) → scrolls down → (pause at the bottom) → back up → again", () => {
    const c = webCycle(W, H, "normal");
    const travel = H - webViewHeight(W);
    expect(c.travel).toBe(travel);
    expect(c.total).toBeCloseTo(WEB_PAUSE_TOP + travel / 120 + WEB_PAUSE_BOTTOM + WEB_BACK_UP, 5);
    expect(webOffset(0, W, H, "normal")).toBe(0);
    expect(webOffset(WEB_PAUSE_TOP - 0.1, W, H, "normal")).toBe(0);
    const mid = webOffset(WEB_PAUSE_TOP + c.down / 2, W, H, "normal");
    expect(mid).toBeCloseTo(travel / 2, 0);
    expect(webOffset(WEB_PAUSE_TOP + c.down + 1, W, H, "normal")).toBe(travel); // resting at the bottom
    expect(webOffset(c.total - 0.001, W, H, "normal")).toBeLessThan(5); // almost back at the top
    expect(webOffset(c.total + 1, W, H, "normal")).toBe(0); // next round
  });

  it("speed changes the time, not the path; a short page does not move", () => {
    expect(webCycle(W, H, "slow").down).toBeCloseTo(2 * webCycle(W, H, "normal").down, 5);
    expect(webCycle(W, H, "fast").down).toBeCloseTo(webCycle(W, H, "normal").down / 2, 5);
    expect(webOffset(10, W, 600, "normal")).toBe(0);
  });

  it("pause / play / back to the top work like a video", () => {
    const content = { kind: "web" as const, url: "https://vnexpress.net/", shots: ["/api/uploads/11111111-1111-1111-1111-111111111111", "/api/uploads/22222222-2222-2222-2222-222222222222"], w: W, h: H, speed: "normal" as const, takenAt: 1 };
    expect(screenContentSchema.safeParse(content).success).toBe(true);
    let s = applyScreenAction(BLANK_SCREEN, { action: "set", content }, 0);
    s = applyScreenAction(s, { action: "play" }, 0);
    expect(s.playing).toBe(true);
    expect(currentPosition(s, 10_000)).toBeCloseTo(10, 5);
    s = applyScreenAction(s, { action: "pause" }, 10_000);
    expect(currentPosition(s, 60_000)).toBeCloseTo(10, 5);
    s = applyScreenAction(s, { action: "seek", positionSec: 0 }, 60_000);
    expect(currentPosition(s, 60_000)).toBe(0);
  });
});

describe("which pages the server may open", () => {
  it("public sites yes; its own machine / home network / cloud metadata no", () => {
    expect(normalizeWebUrl("vnexpress.net")).toBe("https://vnexpress.net/");
    expect(normalizeWebUrl("https://cafef.vn/thi-truong.chn")).toBe("https://cafef.vn/thi-truong.chn");
    for (const bad of ["http://localhost:3000", "http://127.0.0.1", "http://192.168.1.1/admin", "http://10.0.0.5", "http://169.254.169.254/latest/meta-data", "http://172.20.0.1", "http://[::1]/", "file:///C:/Windows/win.ini", "javascript:alert(1)", "https://user:pass@example.com", "https://example.com:8080/", "http://router.local", "http://intranet"])
      expect(normalizeWebUrl(bad), bad).toBeNull();
  });

  it("private / special addresses", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "192.168.0.10", "172.16.5.4", "100.64.0.1", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "::ffff:127.0.0.1", "224.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "104.16.1.1", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});
