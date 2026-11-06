import { z } from "zod";
import type { Db } from "../db";
import { confirmPayment, type PaymentOutcome } from "../services/rooms";
import { findOrderCode } from "./receipt";

/**
 * SePay webhook body (https://docs.sepay.vn — "Tích hợp Webhooks"). SePay watches the bank
 * account and posts every incoming / outgoing transaction.
 */
export const sepaySchema = z.object({
  id: z.union([z.number(), z.string()]),
  gateway: z.string().nullish(),
  transactionDate: z.string().nullish(),
  accountNumber: z.string().nullish(),
  code: z.string().nullish(),
  content: z.string().nullish(),
  transferType: z.enum(["in", "out"]),
  transferAmount: z.number(),
  referenceCode: z.string().nullish(),
  description: z.string().nullish(),
});
export type SepayTx = z.infer<typeof sepaySchema>;

export interface BankResult {
  outcome: PaymentOutcome | "ignored_out" | "no_code" | "duplicate_tx";
  orderCode: string | null;
  orderId?: string;
  userId?: string;
  roomId?: string;
  kind?: string;
}

/**
 * Records one incoming bank transfer and, when its message holds an order code, confirms that
 * order (idempotent per transaction id; amount checks are done by confirmPayment).
 */
export async function recordBankTransfer(db: Db, provider: "sepay", tx: SepayTx): Promise<BankResult> {
  const id = `${provider}:${tx.id}`;
  if (tx.transferType !== "in") return { outcome: "ignored_out", orderCode: null };
  const orderCode = findOrderCode([tx.code, tx.content, tx.description].filter(Boolean).join(" "));
  const ins = await db.query(
    `insert into app.bank_transactions (id, provider, amount_vnd, content, account_no, reference, occurred_at, order_code, raw)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (id) do nothing returning id`,
    [id, provider, Math.round(tx.transferAmount), tx.content ?? "", tx.accountNumber ?? null, tx.referenceCode ?? null, parseVnTime(tx.transactionDate), orderCode, JSON.stringify(tx)],
  );
  if (!ins.rows.length) return { outcome: "duplicate_tx", orderCode };
  if (!orderCode) {
    await db.query("update app.bank_transactions set outcome = 'no_code' where id = $1", [id]);
    return { outcome: "no_code", orderCode: null };
  }
  const r = await confirmPayment(db, { orderCode, provider: "sepay", txnId: String(tx.id), amount: Math.round(tx.transferAmount), actorId: null, raw: tx });
  await db.query("update app.bank_transactions set outcome = $2 where id = $1", [id, r.outcome]);
  // Screenshots sent for this order are now backed by the bank.
  if (r.order) await db.query("update app.payment_proofs set status = 'matched' where order_id = $1 and status in ('waiting_bank', 'pending_review')", [r.order.id]);
  return { outcome: r.outcome, orderCode, orderId: r.order?.id, userId: r.order?.user_id, roomId: r.roomId, kind: r.order?.kind };
}

/** SePay sends "2026-11-05 14:02:33" in Vietnam time. */
export function parseVnTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5], +(m[6] ?? 0)));
}
