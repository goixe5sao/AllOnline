import { describe, expect, it } from "vitest";
import { canHear, mayTalk, pickSources, sameList, voiceGain, VOICE_KEEP_RADIUS, VOICE_MAX_SOURCES, VOICE_RADIUS, VOICE_STICKY_MS, type VoiceCandidate } from "@/core/voice";

const me = { id: "me", x: 0, z: 0 };
const t = (id: string, x: number, o: Partial<VoiceCandidate> = {}): VoiceCandidate => ({ id, x, z: 0, speaking: false, lastSpokeAt: 0, ...o });
const NOW = 1_000_000;

describe("who may talk", () => {
  it("off: nobody; all: everyone; accounts: registered people and moderators", () => {
    expect(mayTalk("off", { isGuest: false, isMod: true })).toBe(false);
    expect(mayTalk("all", { isGuest: true, isMod: false })).toBe(true);
    expect(mayTalk("accounts", { isGuest: true, isMod: false })).toBe(false);
    expect(mayTalk("accounts", { isGuest: false, isMod: false })).toBe(true);
    expect(mayTalk("accounts", { isGuest: true, isMod: true })).toBe(true);
  });
});

describe("whom each listener hears", () => {
  it("only talkers within the radius, never yourself", () => {
    expect(pickSources(me, [t("me", 0), t("a", 3), t("far", VOICE_RADIUS + 0.5)], [], NOW)).toEqual(["a"]);
  });

  it("at most 6 voices, the nearest when nobody talks", () => {
    const many = Array.from({ length: 10 }, (_, i) => t(`p${i}`, 1 + i * 0.5));
    const got = pickSources(me, many, [], NOW);
    expect(got).toHaveLength(VOICE_MAX_SOURCES);
    expect(got).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
  });

  it("someone talking beats a nearer quiet person in a crowd", () => {
    const many = Array.from({ length: 6 }, (_, i) => t(`q${i}`, 1 + i * 0.3));
    const got = pickSources(me, [...many, t("talker", 7, { speaking: true, lastSpokeAt: NOW })], [], NOW);
    expect(got).toContain("talker");
    expect(got).not.toContain("q5"); // the farthest quiet one makes room
  });

  it("a short pause keeps the place (no flicker between sentences)", () => {
    const many = Array.from({ length: 6 }, (_, i) => t(`q${i}`, 1 + i * 0.3));
    const paused = t("talker", 7, { lastSpokeAt: NOW - VOICE_STICKY_MS / 2 });
    expect(pickSources(me, [...many, paused], ["talker"], NOW)).toContain("talker");
  });

  it("already heard stays a little beyond the radius (hysteresis)", () => {
    const edge = t("a", (VOICE_RADIUS + VOICE_KEEP_RADIUS) / 2);
    expect(pickSources(me, [edge], [], NOW)).toEqual([]);
    expect(pickSources(me, [edge], ["a"], NOW)).toEqual(["a"]);
    expect(pickSources(me, [t("a", VOICE_KEEP_RADIUS + 0.1)], ["a"], NOW)).toEqual([]);
  });

  it("stable order → the same list compares equal (no message sent)", () => {
    const a = pickSources(me, [t("b", 2), t("a", 1)], [], NOW);
    const b = pickSources(me, [t("a", 1), t("b", 2)], a, NOW);
    expect(sameList(a, b)).toBe(true);
  });

  it("400 listeners × 60 open mics stays cheap", () => {
    const talkers = Array.from({ length: 60 }, (_, i) => t(`t${i}`, (i % 12) * 1.1, { z: Math.floor(i / 12) * 1.4, speaking: i % 7 === 0, lastSpokeAt: NOW - i * 1000 }));
    const t0 = performance.now();
    for (let l = 0; l < 400; l++) pickSources({ id: `l${l}`, x: (l % 20) * 0.7, z: Math.floor(l / 20) * 0.9 }, talkers, [], NOW);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe("distance fading", () => {
  it("full near, silent at the radius", () => {
    expect(voiceGain(0.5)).toBe(1);
    expect(voiceGain(VOICE_RADIUS)).toBe(0);
    expect(voiceGain(4)).toBeGreaterThan(0.3);
    expect(voiceGain(4)).toBeLessThan(0.8);
  });
});

describe("talk only with a group", () => {
  const groups = new Map<string, Set<string>>([["lan", new Set(["minh"])]]);
  const g = (id: string) => groups.get(id);
  it("Lan's voice reaches only the people she chose", () => {
    expect(canHear("minh", "lan", g)).toBe(true);
    expect(canHear("tu", "lan", g)).toBe(false);
  });
  it("and she hears only them", () => {
    expect(canHear("lan", "minh", g)).toBe(true);
    expect(canHear("lan", "tu", g)).toBe(false);
  });
  it("people without a group hear each other as usual", () => {
    expect(canHear("tu", "minh", g)).toBe(true);
    expect(canHear("minh", "tu", g)).toBe(true);
  });
});
