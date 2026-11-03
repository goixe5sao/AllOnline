/** Slot maths shared by the UI (preview only) and the server (authoritative). */

export function waitingCapacity(official: number, waitingEnabled: boolean, ratio: number): number {
  if (!waitingEnabled) return 0;
  // Round to 6 decimals first so 50 * 0.2 = 10 and not 9.999999.
  return Math.floor(Math.round(official * ratio * 1e6) / 1e6);
}

export function totalSlots(official: number, waitingEnabled: boolean, ratio: number): number {
  return official + waitingCapacity(official, waitingEnabled, ratio);
}

export interface SlotBudget {
  budget: number;
  /** Slots reserved by open rooms (empty rooms still hold their capacity). */
  allocated: number;
  /** Slots held by pending (unexpired) payment orders. */
  held: number;
  remaining: number;
}

export function summarizeBudget(budget: number, allocated: number, held: number): SlotBudget {
  return { budget, allocated, held, remaining: Math.max(0, budget - allocated - held) };
}

export function canReserve(summary: SlotBudget, requested: number): boolean {
  return Number.isInteger(requested) && requested > 0 && requested <= summary.remaining;
}
