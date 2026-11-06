import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Config } from "../config";
import type { Db } from "../db";
import type { Auth } from "../auth";
import type { Storage } from "../storage";
import { sniffMime } from "../storage";
import { formatVnd } from "@/core/pricing";
import { vnEventTime } from "@/lib/vn-time";
import { getSettings } from "../services/settings";
import { confirmPayment, getRoomByInvite } from "../services/rooms";
import { findOrCreateZaloUser, linkIdentity, oaUserIdOf, userByIdentity } from "../services/identities";
import { decideReceipt, readReceipt } from "../payments/receipt";
import type { OaSender } from "./oa";

/** "Đăng ký" → "dang ky": commands work with or without Vietnamese accents. */
export function plain(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim().replace(/\s+/g, " ");
}

export type Command =
  | { kind: "login" }
  /** Code shown on the web login page ("DN 123456", or just the 6 digits). */
  | { kind: "weblogin"; code: string }
  | { kind: "link"; code: string }
  | { kind: "remind"; invite: string; on: boolean }
  | { kind: "events" }
  | { kind: "orders" }
  | { kind: "help" };

export function parseCommand(text: string): Command {
  const t = plain(text);
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(?:lk|lien ket)\s*(\d{6})$/))) return { kind: "link", code: m[1] };
  if ((m = t.match(/^(?:(?:dn|dang nhap|login|ma)\s*)?(\d{6})$/))) return { kind: "weblogin", code: m[1] };
  if ((m = t.match(/^(huy nhac|bo nhac|nhac)\s+([a-z0-9]{6,12})$/))) return { kind: "remind", invite: m[2].toUpperCase(), on: m[1] === "nhac" };
  if (/^(dang ky|dang nhap|dk|dn|login|dangky|dangnhap|tao tai khoan)\b/.test(t)) return { kind: "login" };
  if (/^(lich|su kien|lich cua toi|sk)\b/.test(t)) return { kind: "events" };
  if (/^(don|don hang|thanh toan|tt|chuyen khoan)\b/.test(t)) return { kind: "orders" };
  return { kind: "help" };
}

const HELP = [
  "Chào bạn, mình là trợ lý Sân Khấu Online 🤖. Nhắn một trong các lệnh:",
  "• DN 123456 — đăng nhập trang web đang mở (mã hiện ở trang Đăng nhập → Zalo)",
  "• ĐĂNG KÝ hoặc ĐĂNG NHẬP — nhận link đăng nhập (không cần mật khẩu)",
  "• LK 123456 — liên kết tài khoản trên web với Zalo (lấy mã ở trang Tài khoản)",
  "• NHẮC <mã mời> — nhắc bạn trước giờ sự kiện; HỦY NHẮC <mã mời> để bỏ",
  "• LỊCH — các sự kiện bạn đã đăng ký nhắc",
  "• ĐƠN — đơn chờ thanh toán và nội dung chuyển khoản",
  "• Gửi ẢNH chụp màn hình chuyển khoản — bot kiểm tra và mở phòng cho bạn",
].join("\n");

export interface ZaloEvent {
  app_id?: string;
  event_name: string;
  timestamp?: string | number;
  user_id_by_app?: string;
  sender?: { id: string };
  follower?: { id: string };
  message?: { msg_id?: string; text?: string; attachments?: { type: string; payload?: { url?: string; thumbnail?: string } }[] };
}

/**
 * The Sân Khấu Online Zalo OA bot: sign up / sign in with a one-time link, link a web account,
 * event reminders, payment status, and payment screenshots (read by Claude, matched with the
 * bank feed; a screenshot alone opens a room only below the app owner's auto-approve limit).
 */
export class ZaloBot {
  /** Web account link codes (6 digits, 10 minutes). */
  private linkCodes = new Map<string, { userId: string; exp: number }>();
  /** One-time login links already used. */
  private usedLogins = new Set<string>();
  /**
   * Web login codes: the login page shows the code, the person sends it to the bot, the page
   * (holding the secret claim) is signed in. code → claim, expiry, account once confirmed.
   */
  private webLogins = new Map<string, { claim: string; exp: number; userId: string | null }>();
  /** Wrong codes per follower (guessing guard): count, window start. */
  private wrongCodes = new Map<string, { n: number; since: number }>();

  constructor(
    private deps: { cfg: Config; db: Db; auth: Auth; storage: Storage; sender: OaSender; origin: () => string; onPaid?: (r: { roomId?: string; kind?: string }) => Promise<void> },
  ) {}

  get sender() {
    return this.deps.sender;
  }

  // ---------- links ----------

  linkCodeFor(userId: string) {
    for (const [c, v] of this.linkCodes) if (v.userId === userId || v.exp < Date.now()) this.linkCodes.delete(c);
    let code = "";
    do code = String(randomInt(100000, 1000000));
    while (this.linkCodes.has(code));
    this.linkCodes.set(code, { userId, exp: Date.now() + 10 * 60_000 });
    return code;
  }

  /** New web login code (10 minutes). The claim stays in the browser that asked for it. */
  createWebLogin(): { code: string; claim: string; expiresAt: number } {
    const now = Date.now();
    for (const [c, v] of this.webLogins) if (v.exp < now) this.webLogins.delete(c);
    if (this.webLogins.size > 20_000) throw new Error("too many pending logins");
    let code = "";
    do code = String(randomInt(100000, 1000000));
    while (this.webLogins.has(code));
    const v = { claim: randomBytes(24).toString("base64url"), exp: now + 10 * 60_000, userId: null };
    this.webLogins.set(code, v);
    return { code, claim: v.claim, expiresAt: v.exp };
  }

  /** The login page asks: has the code been sent to the bot? Single use once confirmed. */
  checkWebLogin(code: string, claim: string): { status: "pending" | "expired" } | { status: "ok"; userId: string } {
    const v = this.webLogins.get(code);
    if (!v || v.claim !== claim || v.exp < Date.now()) return { status: "expired" };
    if (!v.userId) return { status: "pending" };
    this.webLogins.delete(code);
    return { status: "ok", userId: v.userId };
  }

  loginUrl(userId: string) {
    const t = this.deps.auth.signer.sign({ k: "botlogin", uid: userId, n: randomUUID(), exp: Date.now() + 10 * 60_000 });
    return `${this.deps.origin()}/api/auth/zalo/bot-login?t=${encodeURIComponent(t)}`;
  }

  /** Validates a one-time login link; returns the account id. */
  useLoginToken(t: string | null): string | null {
    const p = this.deps.auth.signer.verify<{ k: string; uid: string; n: string; exp: number }>(t);
    if (!p || p.k !== "botlogin" || this.usedLogins.has(p.n)) return null;
    this.usedLogins.add(p.n);
    if (this.usedLogins.size > 5000) this.usedLogins.clear();
    return p.uid;
  }

  // ---------- events ----------

  async handle(e: ZaloEvent) {
    const oaUid = e.sender?.id ?? e.follower?.id;
    if (!oaUid) return;
    if (e.event_name === "follow") return this.say(oaUid, "Cảm ơn bạn đã quan tâm Sân Khấu Online — sân khấu 3D trực tuyến!\n\n" + HELP);
    if (e.event_name === "user_send_text") return this.onText(oaUid, e.message?.text ?? "", e.user_id_by_app);
    if (e.event_name === "user_send_image") {
      const url = e.message?.attachments?.find((a) => a.type === "image")?.payload?.url;
      if (url) return this.onImage(oaUid, url);
    }
  }

  private say(oaUid: string, text: string) {
    return this.deps.sender.sendText(oaUid, text);
  }

  /** The account behind a follower: linked, else (via Zalo Login on the same app) the 'zalo' identity. */
  private async account(oaUid: string, appUid?: string) {
    const linked = await userByIdentity(this.deps.db, "zalo_oa", oaUid);
    if (linked) return linked;
    if (appUid) {
      const viaLogin = await userByIdentity(this.deps.db, "zalo", appUid);
      if (viaLogin) {
        await linkIdentity(this.deps.db, "zalo_oa", oaUid, viaLogin.id);
        return viaLogin;
      }
    }
    return null;
  }

  async onText(oaUid: string, text: string, appUid?: string) {
    const cmd = parseCommand(text);
    const db = this.deps.db;
    switch (cmd.kind) {
      case "login": {
        let user = await this.account(oaUid, appUid);
        let created = false;
        if (!user) {
          const p = await this.deps.sender.profile(oaUid);
          ({ user, created } = await findOrCreateZaloUser(db, "zalo_oa", oaUid, p?.name ?? "Người dùng Zalo", p?.avatar));
        }
        return this.say(
          oaUid,
          `${created ? `🎉 Đã tạo tài khoản “${user.display_name}”.` : `Chào ${user.display_name}!`}\nBấm link để đăng nhập Sân Khấu Online (dùng một lần, hết hạn sau 10 phút):\n${this.loginUrl(user.id)}`,
        );
      }
      case "weblogin": {
        const now = Date.now();
        const w = this.wrongCodes.get(oaUid);
        if (w && now - w.since < 10 * 60_000 && w.n >= 8) return this.say(oaUid, "Bạn nhập sai mã quá nhiều lần. Thử lại sau ít phút nhé.");
        const v = this.webLogins.get(cmd.code);
        if (!v || v.exp < now || v.userId) {
          this.wrongCodes.set(oaUid, w && now - w.since < 10 * 60_000 ? { n: w.n + 1, since: w.since } : { n: 1, since: now });
          return this.say(oaUid, "Mã đăng nhập không đúng hoặc đã hết hạn. Trên trang web, bấm “Lấy mã mới” rồi nhắn lại mã mới nhé.");
        }
        let user = await this.account(oaUid, appUid);
        let created = false;
        if (!user) {
          const p = await this.deps.sender.profile(oaUid);
          ({ user, created } = await findOrCreateZaloUser(db, "zalo_oa", oaUid, p?.name ?? "Người dùng Zalo", p?.avatar));
        }
        v.userId = user.id;
        return this.say(oaUid, `${created ? `🎉 Đã tạo tài khoản “${user.display_name}”.\n` : ""}✅ Đã đăng nhập Sân Khấu Online cho ${user.display_name}. Quay lại trang web — trang sẽ tự vào tài khoản của bạn.`);
      }
      case "link": {
        const v = this.linkCodes.get(cmd.code);
        if (!v || v.exp < Date.now()) return this.say(oaUid, "Mã liên kết không đúng hoặc đã hết hạn. Lấy mã mới ở trang Tài khoản trên web nhé.");
        this.linkCodes.delete(cmd.code);
        await linkIdentity(db, "zalo_oa", oaUid, v.userId);
        return this.say(oaUid, "✅ Đã liên kết Zalo với tài khoản Sân Khấu Online của bạn. Từ giờ bot sẽ nhắc sự kiện và báo thanh toán ở đây.");
      }
      case "remind": {
        const user = (await this.account(oaUid, appUid)) ?? (await findOrCreateZaloUser(db, "zalo_oa", oaUid, (await this.deps.sender.profile(oaUid))?.name ?? "Người dùng Zalo")).user;
        const r = await getRoomByInvite(db, cmd.invite);
        if (!r || r.status !== "open") return this.say(oaUid, `Không tìm thấy phòng đang mở với mã ${cmd.invite}.`);
        if (cmd.on) await db.query("insert into app.room_reminders (room_id, user_id) values ($1, $2) on conflict do nothing", [r.id, user.id]);
        else await db.query("delete from app.room_reminders where room_id = $1 and user_id = $2", [r.id, user.id]);
        const when = r.scheduled_at ? ` (${vnEventTime(new Date(r.scheduled_at).getTime())})` : " (chưa có giờ bắt đầu — bot sẽ nhắc khi có lịch)";
        return this.say(oaUid, cmd.on ? `🔔 Sẽ nhắc bạn sự kiện “${r.name}”${when}.` : `Đã bỏ nhắc “${r.name}”.`);
      }
      case "events": {
        const user = await this.account(oaUid, appUid);
        if (!user) return this.say(oaUid, "Bạn chưa có tài khoản. Nhắn ĐĂNG KÝ để bắt đầu.");
        const rows = (
          await db.query<{ name: string; invite_code: string; scheduled_at: Date | null }>(
            `select r.name, r.invite_code, r.scheduled_at from app.room_reminders m join app.rooms r on r.id = m.room_id
             where m.user_id = $1 and r.status = 'open' order by r.scheduled_at nulls last limit 10`,
            [user.id],
          )
        ).rows;
        if (!rows.length) return this.say(oaUid, "Bạn chưa đăng ký nhắc sự kiện nào. Mở link mời và bấm “Nhắc tôi”, hoặc nhắn NHẮC <mã mời>.");
        return this.say(oaUid, "🗓 Sự kiện của bạn:\n" + rows.map((r) => `• ${r.name}${r.scheduled_at ? " — " + vnEventTime(new Date(r.scheduled_at).getTime()) : ""}\n  ${this.deps.origin()}/join/${r.invite_code}`).join("\n"));
      }
      case "orders": {
        const user = await this.account(oaUid, appUid);
        if (!user) return this.say(oaUid, "Bạn chưa có tài khoản. Nhắn ĐĂNG KÝ để bắt đầu.");
        const s = await getSettings(db);
        const rows = (await db.query<{ code: string; amount_vnd: number; kind: string }>("select code, amount_vnd::float8 as amount_vnd, kind from app.orders where user_id = $1 and status = 'pending' and hold_expires_at > now() order by created_at desc limit 5", [user.id])).rows;
        if (!rows.length) return this.say(oaUid, "Bạn không có đơn nào đang chờ thanh toán.");
        return this.say(
          oaUid,
          "💳 Đơn chờ thanh toán:\n" +
            rows.map((o) => `• ${o.code}: ${formatVnd(o.amount_vnd)} (${o.kind === "extend_room" ? "gia hạn" : "tạo phòng"})`).join("\n") +
            (s.qr_account_no ? `\n\nChuyển khoản tới ${s.qr_account_name} — STK ${s.qr_account_no}.` : "") +
            "\nNội dung chuyển khoản: đúng MÃ ĐƠN (ví dụ " + rows[0].code + "). Chuyển xong gửi ảnh chụp màn hình vào đây.",
        );
      }
      default:
        return this.say(oaUid, HELP);
    }
  }

  /** Payment screenshot: read, match an order, then confirm / wait for the bank / send to review. */
  async onImage(oaUid: string, url: string) {
    const { db, cfg, storage } = this.deps;
    const user = await this.account(oaUid);
    if (!user) return this.say(oaUid, "Mình chưa biết tài khoản của bạn. Nhắn ĐĂNG KÝ (hoặc LK <mã> nếu đã có tài khoản trên web) rồi gửi lại ảnh nhé.");
    const pending = (
      await db.query<{ id: string; code: string; amount_vnd: number }>("select id, code, amount_vnd::float8 as amount_vnd from app.orders where user_id = $1 and status in ('pending', 'underpaid') order by created_at desc limit 10", [user.id])
    ).rows;
    if (!pending.length) return this.say(oaUid, "Bạn không có đơn nào đang chờ thanh toán. Nếu đã chuyển khoản cho đơn cũ, quản trị viên sẽ kiểm tra giúp bạn.");
    const img = await this.deps.sender.fetchImage(url);
    const mime = img ? sniffMime(img) : null;
    if (!img || !mime || !/^image\/(jpeg|png|webp|gif)$/.test(mime)) return this.say(oaUid, "Không mở được ảnh. Bạn gửi lại ảnh chụp màn hình (PNG/JPG) giúp mình nhé.");
    const proofId = randomUUID();
    await storage.put(`receipts/${proofId}`, img, mime).catch((e) => console.error("[bot] save receipt", e));
    await this.say(oaUid, "📥 Đã nhận ảnh, đang kiểm tra…");
    const receipt = await readReceipt(cfg.anthropicApiKey, img, mime as "image/jpeg");
    const s = await getSettings(db);
    const recent = (
      await db.query<{ n: number }>("select count(*)::int as n from app.payment_proofs where user_id = $1 and status = 'approved' and created_at > now() - interval '24 hours'", [user.id])
    ).rows[0].n;
    const decision = receipt
      ? decideReceipt(receipt, pending, { accountNo: s.qr_account_no, autoMax: Number(s.receipt_auto_approve_max_vnd), recentAutoApprovals: recent })
      : { kind: "review" as const, orderCode: pending[0].code, reason: cfg.anthropicApiKey ? "không đọc được ảnh" : "chưa bật đọc ảnh tự động" };
    const order = "orderCode" in decision ? pending.find((o) => o.code === decision.orderCode) : undefined;
    const save = (status: string, note: string | null) =>
      db.query("insert into app.payment_proofs (id, user_id, order_id, image_url, extracted, status, note) values ($1, $2, $3, $4, $5, $6, $7)", [
        proofId,
        user.id,
        order?.id ?? null,
        `receipts/${proofId}`,
        JSON.stringify(receipt ?? {}),
        status,
        note,
      ]);

    if (decision.kind === "not_receipt") {
      await save("rejected", decision.reason);
      return this.say(oaUid, `⚠️ ${decision.reason} Hãy gửi ảnh màn hình báo chuyển khoản THÀNH CÔNG, thấy rõ số tiền và nội dung.`);
    }
    // Already paid by the bank feed (SePay) — the room is open.
    if (order) {
      const st = (await db.query<{ status: string }>("select status from app.orders where id = $1", [order.id])).rows[0]?.status;
      if (st === "paid" || st === "paid_late") {
        await save("matched", "ngân hàng đã báo trước");
        return this.say(oaUid, `✅ Đơn ${order.code} đã được xác nhận thanh toán rồi. Cảm ơn bạn!`);
      }
    }
    if (decision.kind === "auto_ok" && order && receipt?.amount_vnd != null) {
      await save("approved", "tự duyệt bằng ảnh (dưới mức cho phép)");
      const r = await confirmPayment(db, { orderCode: order.code, provider: "receipt", txnId: `receipt:${proofId}`, amount: receipt.amount_vnd, actorId: null, raw: { proofId, receipt } });
      if (r.outcome === "fulfilled" || r.outcome === "fulfilled_late") {
        await this.deps.onPaid?.({ roomId: r.roomId, kind: r.order?.kind });
        return this.notifyPaid(r.order!.id);
      }
      await db.query("update app.payment_proofs set status = 'pending_review', note = $2 where id = $1", [proofId, "confirmPayment: " + r.outcome]);
      return this.say(oaUid, "Đã nhận ảnh. Đơn cần quản trị viên kiểm tra thêm, bạn sẽ được báo ngay khi xong.");
    }
    if (decision.kind === "no_order") {
      await save("pending_review", decision.reason);
      await this.alertAdmins(`Biên lai cần duyệt (${user.display_name}): ${decision.reason}`);
      return this.say(oaUid, `Mình chưa khớp được ảnh với đơn nào (${decision.reason}). Quản trị viên sẽ kiểm tra và báo bạn.`);
    }
    // Needs the bank to confirm (or a person).
    const why = "reason" in decision ? decision.reason : "chờ đối soát";
    if (cfg.sepayApiKey) {
      await save("waiting_bank", why);
      return this.say(oaUid, `Đã nhận ảnh cho đơn ${decision.orderCode}. Phòng sẽ tự mở ngay khi ngân hàng báo tiền về (thường dưới 1 phút). Nếu sau 15 phút chưa thấy, quản trị viên sẽ kiểm tra giúp bạn.`);
    }
    await save("pending_review", why);
    await this.alertAdmins(`Biên lai cần duyệt: đơn ${decision.orderCode} (${user.display_name}) — ${why}`);
    return this.say(oaUid, `Đã nhận ảnh cho đơn ${decision.orderCode}. Quản trị viên sẽ đối chiếu và mở phòng, bạn sẽ được báo tại đây.`);
  }

  /** Tell the payer their order is paid and the room is open (when they follow the OA). */
  async notifyPaid(orderId: string) {
    const o = (
      await this.deps.db.query<{ code: string; user_id: string; kind: string; room_id: string | null }>("select code, user_id, kind, room_id from app.orders where id = $1", [orderId])
    ).rows[0];
    if (!o) return;
    const to = await oaUserIdOf(this.deps.db, o.user_id);
    if (!to) return;
    const room = o.room_id ? (await this.deps.db.query<{ name: string; invite_code: string }>("select name, invite_code from app.rooms where id = $1", [o.room_id])).rows[0] : null;
    await this.say(
      to,
      o.kind === "extend_room"
        ? `✅ Đã nhận thanh toán đơn ${o.code}. Phòng “${room?.name ?? ""}” đã được gia hạn.`
        : `✅ Đã nhận thanh toán đơn ${o.code}. Phòng “${room?.name ?? ""}” đã mở!\nLink mời: ${this.deps.origin()}/join/${room?.invite_code ?? ""}`,
    );
  }

  private async alertAdmins(text: string) {
    const r = await this.deps.db.query<{ provider_uid: string }>("select i.provider_uid from app.user_identities i join app.users u on u.id = i.user_id where i.provider = 'zalo_oa' and u.role = 'app_owner'");
    for (const row of r.rows) await this.say(row.provider_uid, "🛎 " + text).catch(() => undefined);
  }

  // ---------- every minute ----------

  /** Event reminders ("sắp bắt đầu" N minutes before, "đang bắt đầu" at the time) and stale proofs. */
  async tick() {
    const { db } = this.deps;
    const s = await getSettings(db);
    const due = (
      await db.query<{ room_id: string; user_id: string; name: string; invite_code: string; scheduled_at: Date; stage: "soon" | "start" }>(
        `select m.room_id, m.user_id, r.name, r.invite_code, r.scheduled_at,
                case when r.scheduled_at <= now() then 'start' else 'soon' end as stage
         from app.room_reminders m join app.rooms r on r.id = m.room_id
         where r.status = 'open' and r.scheduled_at is not null and (
           (m.sent_soon_at is null and r.scheduled_at > now() and r.scheduled_at <= now() + make_interval(mins => $1)) or
           (m.sent_start_at is null and r.scheduled_at <= now() and r.scheduled_at > now() - interval '15 minutes'))
         limit 500`,
        [s.reminder_minutes_before],
      )
    ).rows;
    for (const d of due) {
      const col = d.stage === "start" ? "sent_start_at" : "sent_soon_at";
      // Mark first: a reminder is never sent twice, even if sending fails.
      const mark = await db.query(`update app.room_reminders set ${col} = now()${d.stage === "start" ? ", sent_soon_at = coalesce(sent_soon_at, now())" : ""} where room_id = $1 and user_id = $2 and ${col} is null returning 1`, [d.room_id, d.user_id]);
      if (!mark.rows.length) continue;
      const to = await oaUserIdOf(db, d.user_id);
      if (!to) continue;
      const link = `${this.deps.origin()}/join/${d.invite_code}`;
      const mins = Math.max(1, Math.round((new Date(d.scheduled_at).getTime() - Date.now()) / 60_000));
      await this.say(to, d.stage === "start" ? `🎬 “${d.name}” đang bắt đầu! Vào ngay: ${link}` : `⏰ Còn khoảng ${mins} phút nữa “${d.name}” bắt đầu (${vnEventTime(new Date(d.scheduled_at).getTime())}).\nLink: ${link}`);
    }
    // Screenshots still not backed by the bank after 15 minutes → a person checks them.
    const stale = await db.query<{ id: string }>("update app.payment_proofs set status = 'pending_review', note = coalesce(note, '') || ' · quá 15 phút chưa thấy tiền về' where status = 'waiting_bank' and created_at < now() - interval '15 minutes' returning id");
    if (stale.rows.length) await this.alertAdmins(`${stale.rows.length} biên lai chưa thấy tiền về sau 15 phút — cần kiểm tra trong /admin.`);
  }
}
