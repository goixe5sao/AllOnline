import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/** What Claude reads from a bank-app transfer screenshot. Every field may be missing. */
export const ReceiptSchema = z.object({
  is_bank_transfer_receipt: z.boolean().describe("true only for a banking/e-wallet app screen or e-receipt of a money transfer"),
  success: z.boolean().describe("true only if the screen clearly says the transfer succeeded (Thành công / Giao dịch thành công)"),
  amount_vnd: z.number().int().nullable().describe("transferred amount in VND as an integer, e.g. 1.000.000 VND -> 1000000"),
  transfer_content: z.string().nullable().describe("the transfer message / nội dung chuyển khoản, exactly as shown"),
  recipient_account: z.string().nullable().describe("recipient account number, digits only"),
  recipient_name: z.string().nullable(),
  bank: z.string().nullable().describe("sending bank or app name"),
  transferred_at: z.string().nullable().describe("date and time of the transfer as shown on the screen"),
  reference: z.string().nullable().describe("transaction reference / mã giao dịch if shown"),
  confidence: z.enum(["high", "medium", "low"]).describe("how clearly the fields could be read; low if blurry, cropped or edited-looking"),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

const PROMPT = `Đây là ảnh chụp màn hình do khách gửi để chứng minh đã chuyển khoản thanh toán.
Hãy đọc chính xác các thông tin trên ảnh. Không đoán: trường nào không đọc rõ thì để null.
Nếu ảnh không phải màn hình/biên lai chuyển khoản ngân hàng hoặc ví điện tử, đặt is_bank_transfer_receipt = false.
Nếu ảnh có dấu hiệu bị cắt ghép, chỉnh sửa, mờ hoặc thiếu phần trạng thái, đặt confidence = "low".`;

/**
 * Reads one receipt image with Claude (vision + structured output). Returns null when the API key
 * is not set, the model declines, or the output cannot be parsed — the caller then sends the proof
 * to manual review.
 */
export async function readReceipt(apiKey: string | undefined, image: Buffer, mime: "image/jpeg" | "image/png" | "image/webp" | "image/gif"): Promise<Receipt | null> {
  if (!apiKey) return null;
  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      output_config: { effort: "low", format: zodOutputFormat(ReceiptSchema) },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mime, data: image.toString("base64") } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    if (response.stop_reason === "refusal") return null;
    return response.parsed_output ?? null;
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) console.error("[receipt] rate limited");
    else if (e instanceof Anthropic.APIError) console.error(`[receipt] API error ${e.status}:`, e.message);
    else console.error("[receipt]", e);
    return null;
  }
}

const ORDER_CODE = /AO[A-HJ-NP-Z2-9]{6}/;

/** Order code (AOXXXXXX) inside a transfer message; banks often drop spaces or add prefixes. */
export function findOrderCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.toUpperCase().replace(/[^A-Z0-9]/g, "").match(ORDER_CODE);
  return m ? m[0] : null;
}

export type ReceiptDecision =
  | { kind: "not_receipt"; reason: string }
  | { kind: "no_order"; reason: string }
  | { kind: "review"; orderCode: string; reason: string }
  | { kind: "auto_ok"; orderCode: string };

/**
 * Decides what to do with a read receipt. A screenshot is never proof on its own above
 * `autoMax` (fake screenshots are easy); below it, every check must pass.
 */
export function decideReceipt(
  r: Receipt,
  pending: { code: string; amount_vnd: number }[],
  opts: { accountNo: string; autoMax: number; recentAutoApprovals: number },
): ReceiptDecision {
  if (!r.is_bank_transfer_receipt) return { kind: "not_receipt", reason: "Ảnh không phải màn hình chuyển khoản." };
  if (!r.success) return { kind: "not_receipt", reason: "Ảnh chưa cho thấy giao dịch thành công." };
  const code = findOrderCode(r.transfer_content);
  let order: { code: string; amount_vnd: number } | undefined;
  if (code) order = pending.find((o) => o.code === code);
  else {
    // No code in the message: only a single pending order with exactly this amount can match.
    const same = r.amount_vnd != null ? pending.filter((o) => o.amount_vnd === r.amount_vnd) : [];
    order = same.length === 1 ? same[0] : undefined;
  }
  if (!order) return { kind: "no_order", reason: code ? `Không có đơn chờ thanh toán mã ${code}.` : "Không tìm thấy mã đơn (AO……) trong nội dung chuyển khoản." };
  const why: string[] = [];
  if (!code) why.push("nội dung chuyển khoản không có mã đơn");
  if (r.amount_vnd == null || r.amount_vnd < order.amount_vnd) why.push(`số tiền ${r.amount_vnd ?? "?"} ≠ ${order.amount_vnd}`);
  const acc = (r.recipient_account ?? "").replace(/\D/g, "");
  if (!acc || !opts.accountNo || !acc.endsWith(opts.accountNo.replace(/\D/g, "").slice(-4))) why.push("số tài khoản nhận không khớp");
  if (r.confidence !== "high") why.push("ảnh không rõ");
  if (order.amount_vnd > opts.autoMax) why.push("vượt mức tự duyệt bằng ảnh");
  if (opts.recentAutoApprovals >= 2) why.push("đã tự duyệt nhiều lần trong 24 giờ");
  return why.length ? { kind: "review", orderCode: order.code, reason: why.join("; ") } : { kind: "auto_ok", orderCode: order.code };
}
