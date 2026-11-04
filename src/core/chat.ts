/** Proximity chat helpers. Chat text is never persisted; see room-engine for delivery rules. */

// Control chars, zero-width and bidi override characters are stripped.
const UNSAFE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;

export function sanitizeChat(text: unknown, maxLength: number): string | null {
  if (typeof text !== "string") return null;
  const clean = text.replace(UNSAFE, "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.slice(0, maxLength);
}

/** Token bucket: `burst` messages, refilled at one token every `refillMs`. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(
    private burst: number,
    private refillMs: number,
  ) {}

  take(key: string, now: number): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    const refill = Math.floor((now - b.at) / this.refillMs);
    if (refill > 0) {
      b.tokens = Math.min(this.burst, b.tokens + refill);
      b.at += refill * this.refillMs;
    }
    if (b.tokens <= 0) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    return true;
  }

  forget(key: string) {
    this.buckets.delete(key);
  }
}

/** Repeated identical messages inside the window count as spam. */
export class DuplicateFilter {
  private last = new Map<string, { text: string; at: number; count: number }>();
  constructor(private windowMs: number, private maxRepeats: number) {}
  allow(key: string, text: string, now: number): boolean {
    const prev = this.last.get(key);
    if (prev && prev.text === text && now - prev.at < this.windowMs) {
      prev.count += 1;
      prev.at = now;
      return prev.count <= this.maxRepeats;
    }
    this.last.set(key, { text, at: now, count: 1 });
    return true;
  }
}
