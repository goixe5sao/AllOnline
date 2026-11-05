export interface PriceTier {
  max_capacity: number;
  duration_hours: number;
  price_vnd: number;
}

export interface Quote {
  officialCapacity: number;
  waitingCapacity: number;
  totalSlots: number;
  durationHours: number;
  tierCapacity: number;
  basePrice: number;
  waitingSurcharge: number;
  amount: number;
  note: string;
  /**
   * Open-ended room ("mở vô thời hạn – đến khi tắt"): `amount` is the deposit paid up front;
   * the real cost = billed hours × hourlyRate, settled when the room is closed.
   */
  openEnded?: { hourlyRate: number; deposit: number };
  /** Present when a discount code was applied (server-validated). */
  promo?: { code: string; percentOff: number; amountBefore: number; discount: number };
}

export type QuoteResult = { ok: true; quote: Quote } | { ok: false; error: "NO_PRICE_TIER" };

/**
 * Price = smallest tier whose capacity covers the official seats, for the chosen duration.
 * Waiting seats are included in the package by default (surcharge 0%), but they still
 * consume system slots. A surcharge percentage can be configured later.
 */
export function quoteRoom(
  tiers: PriceTier[],
  officialCapacity: number,
  waitingCap: number,
  durationHours: number,
  waitingSurchargePct: number,
): QuoteResult {
  const tier = tiers
    .filter((t) => t.duration_hours === durationHours && t.max_capacity >= officialCapacity)
    .sort((a, b) => a.max_capacity - b.max_capacity)[0];
  if (!tier) return { ok: false, error: "NO_PRICE_TIER" };
  const basePrice = Number(tier.price_vnd);
  const waitingSurcharge = waitingCap > 0 ? Math.round((basePrice * waitingSurchargePct) / 100) : 0;
  return {
    ok: true,
    quote: {
      officialCapacity,
      waitingCapacity: waitingCap,
      totalSlots: officialCapacity + waitingCap,
      durationHours,
      tierCapacity: tier.max_capacity,
      basePrice,
      waitingSurcharge,
      amount: basePrice + waitingSurcharge,
      note:
        waitingSurcharge > 0
          ? `Giá gói ${tier.max_capacity} chỗ + phụ phí chờ ${waitingSurchargePct}%`
          : `Giá gói ${tier.max_capacity} chỗ chính thức; ${waitingCap} chỗ chờ đã gồm trong gói (vẫn trừ slot hệ thống)`,
    },
  };
}

export function formatVnd(amount: number): string {
  return new Intl.NumberFormat("vi-VN").format(amount) + " ₫";
}

/** Applies a percentage discount; 100% → amount 0 (room is then created without payment).
 *  Open-ended rooms: the same percentage applies to the deposit and to the hourly rate. */
export function applyDiscount(q: Quote, code: string, percentOff: number): Quote {
  const pct = Math.min(100, Math.max(0, percentOff));
  const discount = Math.round((q.amount * pct) / 100);
  const openEnded = q.openEnded && { hourlyRate: Math.round((q.openEnded.hourlyRate * (100 - pct)) / 100), deposit: q.amount - discount };
  return { ...q, amount: q.amount - discount, ...(openEnded ? { openEnded } : {}), promo: { code, percentOff: pct, amountBefore: q.amount, discount } };
}

/**
 * Hourly rate for an open-ended room: the cheapest per-hour price among the packages of the
 * smallest capacity tier that fits (normally the 24-hour package), plus the waiting surcharge,
 * rounded up to 100 ₫.
 */
export function openEndedHourlyRate(tiers: PriceTier[], officialCapacity: number, waitingCap: number, waitingSurchargePct: number): number | null {
  const fit = tiers.filter((t) => t.max_capacity >= officialCapacity);
  if (!fit.length) return null;
  const cap = Math.min(...fit.map((t) => t.max_capacity));
  const perHour = Math.min(...fit.filter((t) => t.max_capacity === cap).map((t) => Number(t.price_vnd) / t.duration_hours));
  const withWaiting = waitingCap > 0 ? perHour * (1 + waitingSurchargePct / 100) : perHour;
  return Math.ceil(withWaiting / 100) * 100;
}

export function quoteOpenEnded(tiers: PriceTier[], officialCapacity: number, waitingCap: number, waitingSurchargePct: number, deposit: number): QuoteResult {
  const rate = openEndedHourlyRate(tiers, officialCapacity, waitingCap, waitingSurchargePct);
  if (rate === null) return { ok: false, error: "NO_PRICE_TIER" };
  return {
    ok: true,
    quote: {
      officialCapacity,
      waitingCapacity: waitingCap,
      totalSlots: officialCapacity + waitingCap,
      durationHours: 0,
      tierCapacity: Math.min(...tiers.filter((t) => t.max_capacity >= officialCapacity).map((t) => t.max_capacity)),
      basePrice: deposit,
      waitingSurcharge: 0,
      amount: deposit,
      openEnded: { hourlyRate: rate, deposit },
      note: `Đặt cọc ${formatVnd(deposit)}. Khi tắt phòng: tính ${formatVnd(rate)}/giờ theo số giờ đã mở (làm tròn lên), hoàn lại phần dư hoặc thu thêm phần thiếu.`,
    },
  };
}

/** Final bill of an open-ended room. Every started hour counts; at least one hour. */
export function settleOpenEnded(startedAt: number, endedAt: number, hourlyRate: number, deposit: number) {
  const billedHours = Math.max(1, Math.ceil((endedAt - startedAt) / 3_600_000));
  const charge = billedHours * hourlyRate;
  const balance = deposit - charge;
  return { billedHours, charge, balance, status: balance > 0 ? ("refund_due" as const) : balance < 0 ? ("collect_due" as const) : ("settled" as const) };
}
