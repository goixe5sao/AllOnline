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
