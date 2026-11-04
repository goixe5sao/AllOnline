"use client";

/**
 * Mindfulness bell, synthesised with the Web Audio API (no audio file, no licensing):
 * a few inharmonic partials of a struck bowl with long exponential decays.
 */
let ctx: AudioContext | null = null;

/** Browsers only allow audio after a user gesture: call this from any pointer/key handler. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* audio unavailable */
  }
}

export function audioReady() {
  return !!ctx && ctx.state === "running";
}

/** @param volume 0..1 */
export function ringBell(volume = 0.6): boolean {
  if (!ctx || ctx.state !== "running" || volume <= 0) return false;
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = Math.min(1, volume) * 0.35;
  master.connect(ctx.destination);
  const base = 220; // A3, low and calm
  // Partial ratios / relative gains / decay seconds of a singing-bowl-like bell.
  const partials: [number, number, number][] = [
    [1, 1, 8],
    [2.01, 0.55, 6],
    [2.76, 0.4, 5],
    [5.4, 0.18, 3],
    [8.93, 0.08, 2],
  ];
  for (const [ratio, gain, decay] of partials) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = base * ratio;
    // a slight beating, like a real bowl
    osc.detune.value = (ratio - 1) * 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    osc.connect(g).connect(master);
    osc.start(now);
    osc.stop(now + decay + 0.1);
  }
  return true;
}

/** Index of the hour (in ms since epoch / 3.6e6). Hours are aligned in UTC and Vietnam alike. */
export function hourIndex(serverMs: number) {
  return Math.floor(serverMs / 3_600_000);
}

export function vnHourLabel(serverMs: number) {
  return new Date(serverMs).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });
}
