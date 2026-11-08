import { describe, it, expect, vi, afterEach } from "vitest";
import { directStock, startStock, stockFallback, STOCK_DISCLAIMER, stockScanSchema } from "@/core/ai-stock";
import { FixtureScanProvider, STOCK_FIXTURE, StockVnScanProvider } from "../server/ai-stock/provider";
import { StockCommentary, stockPrompt, validCommentary } from "../server/ai-stock/commentary";
import { anthropicClient } from "../server/anthropic";
import { applyScreenAction, BLANK_SCREEN } from "@/core/screen";

vi.mock("../server/anthropic", () => ({ anthropicClient: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("AI Stock director", () => {
  it("rotates top N on the server deadline and wraps", () => {
    const c = startStock(STOCK_FIXTURE, true, 100, 2, 10);
    expect(directStock(c, "tick", 10099)).toBe(c);
    const next = directStock(c, "tick", 10100);
    expect(next.index).toBe(1);
    expect(directStock(next, "tick", 20100).index).toBe(0);
    expect(next.commentary).toContain("HPG");
  });
  it("pauses, pins any scanned symbol, resumes, skips and ignores invalid pins", () => {
    const c = startStock(STOCK_FIXTURE, true, 0, 2, 10);
    const paused = directStock(c, "pause", 10);
    expect(directStock(paused, "tick", 100000)).toBe(paused);
    const pinned = directStock(c, "pin", 10, "VNM");
    expect(pinned.index).toBe(7);
    expect(directStock(pinned, "tick", 100000)).toBe(pinned);
    expect(directStock(c, "pin", 10, "NOPE")).toBe(c);
    const resumed = directStock(pinned, "resume", 20000);
    expect(resumed.pinned).toBe(false);
    expect(resumed.nextAt).toBe(30000);
    expect(directStock(resumed, "skip", 20001).index).toBe(0);
  });
  it("persists a complete late-join state and switching to manual content stops rotation", () => {
    const c = directStock(startStock(STOCK_FIXTURE, true, 0), "pin", 0, "SSI");
    const screen = applyScreenAction(BLANK_SCREEN, { action: "set", content: c }, 10);
    const lateJoin = JSON.parse(JSON.stringify(screen));
    expect(lateJoin.content).toEqual(c);
    expect(lateJoin.content.snapshot.picks[lateJoin.content.index].symbol).toBe("SSI");
    expect(applyScreenAction(screen, { action: "set", content: { kind: "blank" } }, 20).content.kind).toBe("blank");
  });
});
describe("providers", () => {
  it("validates the typed fixture contract and isolates provider results", async () => {
    expect(stockScanSchema.parse(STOCK_FIXTURE)).toEqual(STOCK_FIXTURE);
    const p = new FixtureScanProvider(); const scan = await p.scan();
    scan.picks[0].price = 999;
    expect((await p.scan()).picks[0].price).toBe(132.5);
    expect(stockScanSchema.safeParse({ ...STOCK_FIXTURE, picks: [] }).success).toBe(false);
  });
  it("uses Bearer auth and cached snapshots, rejects HTTP failures and invalid contracts", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(STOCK_FIXTURE)));
    vi.stubGlobal("fetch", fetcher);
    const p = new StockVnScanProvider("http://stockvn.test", "test-token");
    expect(await p.scan()).toEqual(STOCK_FIXTURE); await p.scan();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0].href).toBe("http://stockvn.test/api/ai/scan?universe=VN100");
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe("Bearer test-token");
    fetcher.mockResolvedValueOnce(new Response("", { status: 503 }));
    await expect(new StockVnScanProvider("http://stockvn.test", "token").scan()).rejects.toThrow();
    fetcher.mockResolvedValueOnce(new Response("{}"));
    await expect(new StockVnScanProvider("http://stockvn.test", "token").scan()).rejects.toThrow();
  });
});
describe("commentary", () => {
  const p = STOCK_FIXTURE.picks[0];
  it("places only input numbers into the prompt and fallback, with disclaimer", () => {
    const numbers = new Set(JSON.stringify(p).match(/-?\d+(?:\.\d+)?/g));
    for (const text of [stockPrompt(p), stockFallback(p)]) {
      expect((text.match(/-?\d+(?:\.\d+)?/g) ?? []).every(n=>numbers.has(n))).toBe(true);
    }
    expect(stockPrompt(p)).toContain("không phải xác suất AI dự đoán");
    expect(stockFallback(p).endsWith(STOCK_DISCLAIMER)).toBe(true);
    expect(validCommentary(stockFallback(p), p)).toBe(true);
    expect(validCommentary(`Giá 9999. ${STOCK_DISCLAIMER}`, p)).toBe(false);
    expect(validCommentary(`Nên mua FPT. ${STOCK_DISCLAIMER}`, p)).toBe(false);
  });
  it("falls back without a key, without calling the SDK", async () => {
    vi.mocked(anthropicClient).mockClear();
    expect(await new StockCommentary().get(p, STOCK_FIXTURE.asOf)).toBe(stockFallback(p));
    expect(anthropicClient).not.toHaveBeenCalled();
  });
  it("uses configured model, caches in-flight calls and rate limits across symbols", async () => {
    const create = vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: stockFallback(p) }] });
    vi.mocked(anthropicClient).mockReturnValue({ messages: { create } } as unknown as ReturnType<typeof anthropicClient>);
    const service = new StockCommentary("test", "configured-model");
    const first = service.get(p, "snapshot");
    expect(service.get(p, "snapshot")).toBe(first);
    await first;
    await service.get(STOCK_FIXTURE.picks[1], "snapshot");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].model).toBe("configured-model");
    expect(create.mock.calls[0][1]).toMatchObject({ maxRetries: 0, timeout: 15000 });
  });
  it("falls back on invented numbers, refusal and SDK failure", async () => {
    for (const response of [{ stop_reason: "end_turn", content: [{ type: "text", text: `9999 ${STOCK_DISCLAIMER}` }] }, { stop_reason: "refusal", content: [] }]) {
      const create = vi.fn().mockResolvedValue(response);
      vi.mocked(anthropicClient).mockReturnValue({ messages: { create } } as unknown as ReturnType<typeof anthropicClient>);
      expect(await new StockCommentary("test").get(p, "snapshot")).toBe(stockFallback(p));
    }
    vi.mocked(anthropicClient).mockImplementation(()=>{ throw new Error("offline"); });
    expect(await new StockCommentary("test").get(p, "snapshot")).toBe(stockFallback(p));
  });
});
