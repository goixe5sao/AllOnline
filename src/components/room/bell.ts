"use client";

/**
 * Mindfulness bell with the sound of a Vietnamese temple bell (chuông chùa), synthesised with
 * the Web Audio API — no audio file, no licensing.
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

/**
 * Temple bell (chuông chùa): a large bronze bell struck with a wooden log.
 * Deep fundamental with a "hum" an octave below, inharmonic bell partials — each made of two
 * slightly detuned oscillators so the tone slowly swells ("uông… uông…") — a dull wooden strike,
 * and a long decay (clearly audible ~20 s, fully silent ~45 s) in which the high partials fade first.
 * Works with any AudioContext / OfflineAudioContext (also used to render previews).
 */
export function scheduleTempleBell(ac: BaseAudioContext, destination: AudioNode, t0: number, volume: number) {
  const master = ac.createGain();
  master.gain.value = Math.min(1, Math.max(0, volume)) * 0.32;
  // Big bells sound warm and dark: soften the top end.
  const tone = ac.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 2400;
  master.connect(tone).connect(destination);

  const f0 = 98; // ~G2
  // [ratio to f0, gain, decay seconds, beat Hz]
  const partials: [number, number, number, number][] = [
    [0.5, 0.55, 45, 0.35], // hum
    [1.0, 1.0, 36, 0.6], // prime
    [1.19, 0.45, 24, 0.9], // minor-third "tierce": the temple-bell colour
    [1.56, 0.35, 18, 1.1],
    [2.0, 0.5, 14, 0.8], // nominal
    [2.74, 0.25, 9, 1.4],
    [3.76, 0.16, 6, 1.9],
    [5.4, 0.08, 3.5, 2.6],
  ];
  for (const [ratio, gain, decay, beat] of partials) {
    for (const side of [-1, 1]) {
      const osc = ac.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f0 * ratio + (side * beat) / 2;
      const g = ac.createGain();
      const peak = gain / 2;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(peak * 0.6, t0 + 0.4); // the first bloom settles
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      osc.connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + decay + 0.1);
    }
  }

  // Wooden log strike: a short, low, dull thump.
  const len = Math.floor(ac.sampleRate * 0.12);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  const thud = ac.createBiquadFilter();
  thud.type = "lowpass";
  thud.frequency.value = 320;
  const tg = ac.createGain();
  tg.gain.value = 0.9;
  noise.connect(thud).connect(tg).connect(master);
  noise.start(t0);
  return t0 + 45;
}

/** Plays the temple bell now. @param volume 0..1 */
export function ringBell(volume = 0.6): boolean {
  if (!ctx || ctx.state !== "running" || volume <= 0) return false;
  scheduleTempleBell(ctx, ctx.destination, ctx.currentTime + 0.02, volume);
  return true;
}

/** Index of the hour (in ms since epoch / 3.6e6). Hours are aligned in UTC and Vietnam alike. */
export function hourIndex(serverMs: number) {
  return Math.floor(serverMs / 3_600_000);
}

export function vnHourLabel(serverMs: number) {
  return new Date(serverMs).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });
}
