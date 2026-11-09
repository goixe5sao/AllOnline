import { effectivePlan, PLAN_KINDS, PLAN_LIMIT, VIP_REASON } from "@/core/ai-plan";
import type { Queryable } from "../db";
import { getUser } from "./users";
import { AppError } from "./rooms";
export { effectivePlan };
export async function requireAi(q: Queryable, id: string, vip = false) {
  const plan = effectivePlan(await getUser(q, id));
  if (plan === "off" || (vip && plan !== "vip")) throw new AppError("AI_PLAN", vip ? VIP_REASON : "AI đã tắt cho tài khoản này. Liên hệ quản trị.", 403);
  return { plan, limit: PLAN_LIMIT[plan], allowedKinds: PLAN_KINDS[plan] };
}
export async function setFollow(q: Queryable, id: string, symbol: string, on: boolean) {
  await q.query("select id from app.users where id=$1 for update", [id]);
  const { limit } = await requireAi(q, id);
  if (on) {
    if (!(await q.query("select 1 from app.market_symbols where symbol=$1", [symbol])).rows.length) throw new AppError("SYMBOL", "Mã không có trong danh sách thị trường.", 400);
    const rows = await q.query<{symbol:string}>("select symbol from app.stock_follows where user_id=$1", [id]);
    if (!rows.rows.some(r => r.symbol === symbol) && rows.rows.length >= limit) throw new AppError("LIMIT", `Tối đa ${limit} mã theo dõi.`, 400);
    await q.query("insert into app.stock_follows(user_id,symbol) values($1,$2) on conflict do nothing", [id,symbol]);
  } else await q.query("delete from app.stock_follows where user_id=$1 and symbol=$2", [id,symbol]);
}
